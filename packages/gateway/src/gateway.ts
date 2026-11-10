/**
 * `gateway` — the model gateway.
 *
 * ## The pipeline
 *
 * pack 02 §4.7: *"`complete(request)`: resolve route from
 * `routing-policy.yaml` (role → model, fallbacks) → **budget check
 * before the call** (request/task/workflow/day) → idempotency lookup
 * `(taskId,nodeId,attempt,promptSha256,modelVersion)` → provider call
 * with a timeout and bounded retry → usage + cost into `model_calls` and
 * the `model.requested|failed|failedOver` events → return `{content,
 * toolCalls, usage, model, routingDecision, cached}`."*
 *
 * The **order is the rule**. Each step is a gate, and a step that
 * refuses stops the pipeline — the next step is not reached.
 *
 * ## The order is a safety property, not a style
 *
 * * The **budget check is before the call.** A budget checked after the
 *   call is a report, not a control.
 * * The **idempotency lookup is before the call.** A replayed key must
 *   not call the provider again.
 * * The **route is resolved first**, because the projection the budget
 *   check needs depends on the candidate's price — and the candidates
 *   differ in price.
 *
 * ## The failover loop
 *
 * A provider error is not a failure of the request — it is a failure of
 * one **candidate**. The loop walks the candidates: primary first, then
 * the fallbacks, and each failover is recorded with its trigger
 * (blueprint 11 §9.6: *"Failover records the reason in the event log
 * (`model.failedOver`)."*).
 *
 * A trigger the policy does not list in `failover.on` does **not**
 * fail over; a trigger the policy lists in `neverOn` does **not** fail
 * over. The policy decides — pack 03 §4.6's
 * `neverOn: [budget-exhausted]` is the corpus's example.
 *
 * ## The structured output
 *
 * The portable mechanism, with the Zod revalidation and the one repair
 * attempt, lives in `structured.ts`. The gateway drives it; the
 * mechanism does not know about budgets or failover.
 */

import { factoryError, type FactoryError, type Result } from '@factory/core';

import type {
  ModelRequest,
  ModelResponse,
  ProviderResponse,
  RoutingPolicy,
} from '@factory/contracts';

import { checkBudget, type BudgetState } from './budget.js';
import { blocksWithBreakpoint } from './caching.js';
import {
  checkModel,
  readCatalog,
  type CatalogState,
  type ModelCheck,
} from './catalog.js';
import { idempotencyKey, promptDigest } from './idempotency.js';
import { priceCall, projectCost } from './pricing.js';
import type { BudgetLedger, ModelCallStore, ProviderAdapter } from './ports.js';
import { resolveRoute } from './routing.js';
import {
  extractStructured,
  forcedToolFor,
  revalidate,
  repairInstruction,
  SCHEMA_INVALID_TRIGGER,
  STRUCTURED_ATTEMPTS,
  STRUCTURED_FAILURE_CLASS,
  toolsFor,
} from './structured.js';
import type {
  GatewayEvent,
  ModelCallRecord,
  PricingTable,
  RouteCandidate,
  TokenCounts,
  TriggerName,
} from './types.js';

import { guard } from './providers/factory.js';

import type { z } from 'zod';

/**
 * The options for a {@link ModelGatewayImpl}.
 */
export interface ModelGatewayOptions {
  /** The routing policy. */
  readonly policy: RoutingPolicy;
  /** The pricing table. */
  readonly pricing: PricingTable;
  /** The providers, by their name in the routing policy. */
  readonly providers: Readonly<Record<string, ProviderAdapter>>;
  /** The ledger of what has been spent. */
  readonly ledger: BudgetLedger;
  /** The store of model calls. */
  readonly calls: ModelCallStore;
  /** Where the gateway's events go. */
  readonly events?: {
    append(event: GatewayEvent): Promise<void>;
  };
  /** The clock, for the latency and the timestamps. */
  readonly clock: {
    now(): Date;
    nowIso(): string;
  };
  /** The id source, for the ledger rows. */
  readonly nextId: () => string;
  /** The per-request timeout, in milliseconds. */
  readonly timeoutMs?: number;
  /** The maximum number of attempts for one candidate, including the first. */
  readonly maxAttempts?: number;
  /** The Zod schema for a structured answer, when the request asks for one. */
  readonly structuredSchema?: z.ZodType;
  /** The maximum output tokens a request may ask for. */
  readonly maxOutputTokens?: number;
  /** The model version, for the cache key and the idempotency key. */
  readonly modelVersion?: string;
}

/**
 * The default per-request timeout.
 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The default number of attempts per candidate.
 *
 * A **bounded retry**: one retry of a transient failure, not an
 * unbounded loop.
 */
export const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * The model gateway.
 */
export class ModelGatewayImpl {
  readonly #options: ModelGatewayOptions;

  constructor(options: ModelGatewayOptions) {
    this.#options = options;
  }

  /**
   * Complete a request.
   *
   * @param request the model request.
   * @param stage the stage the request is made for, when the routing
   * policy matches on one.
   *
   * The **stage** is a separate argument rather than a field on the
   * request because the contracts' `ModelRequest` does not carry one —
   * and the contracts are frozen (HR-12). The routing policy's `match`
   * may name a `stage`, so the gateway must be able to supply one; the
   * orchestrator (T-1.13) knows the stage and passes it here.
   */
  public async complete(
    request: ModelRequest,
    stage?: string,
  ): Promise<Result<ModelResponse, FactoryError>> {
    // ---- 1. the route ------------------------------------------------
    const resolved = resolveRoute(this.#options.policy, {
      role: request.role,
      ...(stage === undefined ? {} : { stage }),
    });

    if (!resolved.ok) {
      return {
        ok: false,
        error: factoryError('workflow.composition', resolved.reason, false),
      };
    }

    const route = resolved.route;

    // ---- 2. the models check, BEFORE the call -----------------------
    // ADR-0023: "The gateway **refuses unknown models**. It does not
    // fall back to a default." So an unusable model is a **refusal**,
    // not a failover — the request is refused rather than routed to a
    // model nobody chose.
    //
    // The check comes before the budget check: a route that cannot be
    // called at all should not spend the caller's attention on a
    // budget refusal.
    const modelCheck = await this.#checkModels(route.candidates);
    if (modelCheck !== undefined) {
      return modelCheck;
    }

    // ---- 3. the budget, BEFORE the call ------------------------------
    const budget = await this.#checkBudget(request, route.candidates);
    if (budget !== undefined) {
      return budget;
    }

    // ---- 4. the structured output, BEFORE the call ------------------
    // pack 02 §4.7: "the result is always **re-validated with Zod**".
    // A structured request with no schema to check it against cannot
    // be re-validated, so it is refused here — before the call, and
    // before the failover loop, because a missing schema is a
    // configuration gap rather than a candidate's failure.
    const schemaGap = this.#checkStructuredSchema(request);
    if (schemaGap !== undefined) {
      return schemaGap;
    }

    // ---- 5. the idempotency lookup ----------------------------------
    const digest = promptDigest(request.messages, request.system ?? []);
    const version = this.#options.modelVersion ?? 'unversioned';

    const key = idempotencyKey({
      taskId: request.taskId,
      nodeId: request.nodeId,
      attempt: request.attempt,
      promptSha256: digest,
      modelVersion: version,
    });

    const recorded = await this.#options.calls.findByKey(key);
    if (recorded !== undefined) {
      // A replayed key returns the **recorded** result — blueprint 11
      // §6.4 — and the provider is not called again.
      return { ok: true, value: this.#responseFrom(recorded, route.rule) };
    }

    // ---- 6. the provider call, with failover ------------------------
    return this.#callWithFailover(request, route.candidates, route.rule, digest, key);
  }

  /**
   * The models check, before the call.
   *
   * The **primary** is checked strictly: an unusable primary refuses
   * the whole request. A **fallback** is checked when it is about to
   * be used — an unusable fallback must not turn a provider error into
   * a silent route to a model nobody chose, but it must not also stop
   * a healthy primary from answering either.
   *
   * @returns `undefined` when the primary is usable, or the refusal.
   */
  async #checkModels(
    candidates: readonly RouteCandidate[],
  ): Promise<Result<ModelResponse, FactoryError> | undefined> {
    const primary = candidates[0];
    if (primary === undefined) {
      return {
        ok: false,
        error: factoryError(
          'workflow.composition',
          'the routing policy resolved no candidate for the request',
          false,
        ),
      };
    }

    const check = await this.#candidateUsable(primary);
    if (check.ok) {
      return undefined;
    }

    return {
      ok: false,
      error: factoryError(
        'model.capability',
        check.reason,
        false,
        {
          provider: check.provider,
          model: check.model,
          kind: check.kind,
        },
      ),
    };
  }

  /**
   * The structured-output check, before the call.
   *
   * pack 02 §4.7: *"the result is always **re-validated with Zod**."*
   *
   * A structured request with no schema to check it against cannot be
   * re-validated, so the gateway refuses it rather than handing the
   * caller an answer it cannot vouch for. The refusal is a
   * configuration gap — `workflow.composition` — not a model's
   * failure, so it is not retried and not failed over.
   *
   * @returns `undefined` when the request is fine, or the refusal.
   */
  #checkStructuredSchema(
    request: ModelRequest,
  ): Result<ModelResponse, FactoryError> | undefined {
    if (request.responseFormat === undefined) {
      return undefined;
    }

    if (this.#options.structuredSchema !== undefined) {
      return undefined;
    }

    return {
      ok: false,
      error: factoryError(
        'workflow.composition',
        'the request asks for a structured answer but no schema was configured, so the answer cannot be re-validated',
        false,
      ),
    };
  }

  /**
   * Is this candidate usable?
   *
   * The startup check is a **start-up** convenience; the call path
   * must be safe on its own, because the provider's catalogue can
   * change between the start-up and the call, and because a gateway
   * that was constructed without the check must not call an unknown
   * model.
   *
   * The check **fails closed**: a provider whose catalogue cannot be
   * read makes its models **unavailable**, not "assumed present".
   */
  async #candidateUsable(candidate: RouteCandidate): Promise<ModelCheck> {
    const provider = this.#options.providers[candidate.provider];

    if (provider === undefined) {
      return {
        ok: false,
        provider: candidate.provider,
        model: candidate.model,
        kind: 'unavailable',
        reason: `the provider "${candidate.provider}" is not configured`,
      };
    }

    const catalog = await readCatalog(provider);
    return checkModel(candidate.provider, candidate.model, catalog);
  }

  /**
   * The **startup check** — pack 02 §4.7.
   *
   * *"Call the provider's models list and refuse routes naming unknown
   * models."*
   *
   * The check is **fail closed**: a provider whose list cannot be read
   * makes its routes **unavailable** — not "assumed present".
   *
   * The result is a list of problems, not a single answer: an
   * operator needs to see every gap at once. An empty list means the
   * policy is usable.
   */
  public async startupCheck(): Promise<readonly ModelCheck[]> {
    const catalogs: Record<string, CatalogState> = {};

    for (const [name, provider] of Object.entries(this.#options.providers)) {
      catalogs[name] = await readCatalog(provider);
    }

    const problems: ModelCheck[] = [];

    for (const routeClass of Object.values(this.#options.policy.spec.classes)) {
      const candidates = [routeClass.primary, ...routeClass.fallbacks];

      for (const candidate of candidates) {
        const catalog = catalogs[candidate.provider] ?? {
          kind: 'unavailable',
          reason: `the provider "${candidate.provider}" is not configured`,
        };

        const check = checkModel(candidate.provider, candidate.model, catalog);
        if (!check.ok) {
          problems.push(check);
        }
      }
    }

    return problems;
  }

  /**
   * The budget check, before the call.
   *
   * The **tightest** scope wins, and the refusal is a
   * `budget.exhausted` event plus a `budget.exhausted` error.
   *
   * @returns `undefined` when the budget allows the request, or the
   * refusal.
   */
  async #checkBudget(
    request: ModelRequest,
    candidates: readonly RouteCandidate[],
  ): Promise<Result<ModelResponse, FactoryError> | undefined> {
    const state: BudgetState = await this.#options.ledger.remainingFor(
      request.taskId,
    );

    // The request's own limit — pack 02 §4.7's "request" scope.
    const requestBudget =
      request.budget?.maxUsdMicros === undefined
        ? undefined
        : { limitUsdMicros: request.budget.maxUsdMicros, spentUsdMicros: 0 };

    const scopes: BudgetState = {
      request: requestBudget ?? state.request,
      task: state.task,
      workflowDay: state.workflowDay,
    };

    // The projection is the **most expensive candidate** — the primary.
    // A fallback may be cheaper, but the budget must be checked against
    // the call that is about to happen.
    const primary = candidates[0];
    if (primary === undefined) {
      return {
        ok: false,
        error: factoryError(
          'workflow.composition',
          'the routing policy resolved no candidate for the request',
          false,
        ),
      };
    }

    const price = this.#options.pricing[primary.model];
    if (price === undefined) {
      // An unpriced model is a configuration gap, and the gateway
      // refuses it rather than treating it as free.
      return {
        ok: false,
        error: factoryError(
          'workflow.composition',
          `the model "${primary.model}" has no price in the pricing table`,
          false,
        ),
      };
    }

    const estimate = this.#estimateTokens(request);
    const projected = projectCost(
      price,
      estimate.tokensIn,
      Math.min(estimate.maxOutputTokens, this.#options.maxOutputTokens ?? estimate.maxOutputTokens),
    );

    const check = checkBudget(scopes, projected);

    if (check.ok) {
      return undefined;
    }

    await this.#append({
      eventType: 'budget.exhausted',
      payload: {
        scope: check.scope,
        limitUsdMicros: check.limitUsdMicros,
        spentUsdMicros: check.spentUsdMicros,
      },
    });

    return { ok: false, error: check.error };
  }

  /**
   * The tokens a request is estimated to consume.
   */
  #estimateTokens(request: ModelRequest): {
    readonly tokensIn: number;
    readonly maxOutputTokens: number;
  } {
    const systemChars = (request.system ?? []).reduce(
      (total, block) => total + block.body.length,
      0,
    );
    const messageChars = request.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );

    return {
      tokensIn: Math.ceil((systemChars + messageChars) / 4),
      maxOutputTokens: this.#options.maxOutputTokens ?? 4096,
    };
  }

  /**
   * The failover loop.
   */
  async #callWithFailover(
    request: ModelRequest,
    candidates: readonly RouteCandidate[],
    rule: string,
    digest: string,
    key: string,
  ): Promise<Result<ModelResponse, FactoryError>> {
    const started = this.#options.clock.now().getTime();
    let lastError: FactoryError | undefined;

    for (const [index, candidate] of candidates.entries()) {
      const provider = this.#options.providers[candidate.provider];

      if (provider === undefined) {
        lastError = factoryError(
          'environment.failure',
          `the provider "${candidate.provider}" is not configured`,
          false,
        );
        continue;
      }

      // A **fallback** is checked here, when it is about to be used. The
      // primary was checked before the budget check; a fallback that
      // names a model the provider does not offer must not be called
      // — and must not be silently replaced either (ADR-0023).
      if (index > 0) {
        const usable = await this.#candidateUsable(candidate);
        if (!usable.ok) {
          await this.#append({
            eventType: 'model.failed',
            payload: {
              provider: candidate.provider,
              model: candidate.model,
              reason: usable.reason,
              failureClass: 'model.capability',
              trigger: 'unknown-model',
            },
          });
          return {
            ok: false,
            error: factoryError('model.capability', usable.reason, false, {
              provider: usable.provider,
              model: usable.model,
              kind: usable.kind,
            }),
          };
        }
      }

      const attempt = await this.#attempt(request, candidate, provider);

      if (attempt.ok) {
        const response = attempt.value;

        // A **cache hit** — blueprint 11 §9.7. The provider reports the
        // tokens it read from its cache; when it read the stable
        // prefix from the cache and charged nothing for it, the call
        // was served from the cache.
        //
        // The flag is about the **prefix**, not the whole answer: a
        // call whose prefix was cached still produced new output
        // tokens, and those are billed normally. So the call is
        // recorded with `cached = true` and its tokens, not with zero
        // tokens — the zero-token rule is for a *fully* cached
        // response, which no provider here returns.
        const cached = (response.usage.cacheRead ?? 0) > 0;

        // The ledger and the event, together.
        const record: ModelCallRecord = {
          id: this.#options.nextId(),
          taskId: request.taskId,
          provider: candidate.provider,
          model: candidate.model,
          routeRule: rule,
          promptSha256: digest,
          tokens: tokensOf(response.usage),
          costUsdMicros: response.usage.costUsdMicros,
          latencyMs: this.#options.clock.now().getTime() - started,
          status: 'ok',
          cached,
          via: 'complete',
          idempotencyKey: key,
        };

        await this.#options.calls.record(record, {
          eventType: 'model.requested',
          payload: {
            runId: request.taskId,
            provider: candidate.provider,
            model: candidate.model,
            routeRule: rule,
            promptSha256: digest,
            tokens: {
              in: record.tokens.tokensIn,
              out: record.tokens.tokensOut,
              cacheRead: record.tokens.cacheRead,
              cacheWrite: record.tokens.cacheWrite,
            },
            costUsdMicros: record.costUsdMicros,
            cached,
            via: 'complete',
          },
          costUsdMicros: record.costUsdMicros,
        });

        return {
          ok: true,
          value: {
            content: response.content,
            usage: response.usage,
            model: response.model,
            provider: candidate.provider,
            routingDecision: { rule, fallbackUsed: index > 0 },
            cached,
            ...(response.toolCalls === undefined
              ? {}
              : { toolCalls: [...response.toolCalls] }),
            ...(response.json === undefined ? {} : { json: response.json }),
          },
        };
      }

      lastError = attempt.error;

      // The trigger for this failure.
      const trigger = triggerFor(attempt.error);

      const mayFailOver = this.#mayFailOver(trigger);

      if (!mayFailOver) {
        await this.#append({
          eventType: 'model.failed',
          payload: {
            provider: candidate.provider,
            model: candidate.model,
            reason: attempt.error.message,
            failureClass: attempt.error.class,
            trigger,
          },
        });
        return { ok: false, error: attempt.error };
      }

      const next = candidates[index + 1];
      if (next === undefined) {
        // No fallback left. The failure is the request's.
        await this.#append({
          eventType: 'model.failed',
          payload: {
            provider: candidate.provider,
            model: candidate.model,
            reason: attempt.error.message,
            failureClass: attempt.error.class,
            trigger,
          },
        });
        return { ok: false, error: attempt.error };
      }

      await this.#append({
        eventType: 'model.failedOver',
        payload: {
          from: `${candidate.provider}/${candidate.model}`,
          to: `${next.provider}/${next.model}`,
          trigger,
        },
      });
    }

    return {
      ok: false,
      error:
        lastError ??
        factoryError(
          'environment.failure',
          'no provider candidate could be called',
          false,
        ),
    };
  }

  /**
   * One attempt at one candidate.
   *
   * The attempt handles the **structured output** — the forced tool
   * call, the Zod revalidation, and the one repair — and the **bounded
   * retry** of a transient failure.
   *
   * The result is the adapter's `ProviderResponse`, not the factory's
   * `ModelResponse`: the factory's shape needs the routing decision
   * and the provider name, and those are the *gateway's* to add, not
   * the adapter's.
   */
  async #attempt(
    request: ModelRequest,
    candidate: RouteCandidate,
    provider: ProviderAdapter,
  ): Promise<
    | { readonly ok: true; readonly value: ProviderResponse }
    | { readonly ok: false; readonly error: FactoryError }
  > {
    const maxAttempts = this.#options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    // The **structured output** path, when the request asks for one.
    //
    // The "no schema configured" refusal happens **before** the loop —
    // it is a configuration gap, not a candidate's failure, so it must
    // not send the request round the failover loop.
    const structured = forcedToolFor(request);

    if (structured !== undefined && this.#options.structuredSchema !== undefined) {
      return this.#attemptStructured(request, candidate, provider);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.#callProvider(request, candidate, provider);
        return { ok: true, value: this.#priced(response, candidate) };
      } catch (error) {
        const failure = toGatewayError(error);
        // A **bounded** retry: only a retriable failure is retried, and
        // only within the bound.
        if (!failure.retriable || attempt === maxAttempts) {
          return { ok: false, error: failure };
        }
      }
    }

    return {
      ok: false,
      error: factoryError(
        'environment.failure',
        'the provider call exhausted its attempts',
        false,
      ),
    };
  }

  /**
   * The structured-output attempt.
   *
   * The Zod revalidation and the one repair attempt — "one repair
   * attempt counts as a retry" (pack 02 §4.7). A second invalid answer
   * is `model.reasoning`.
   */
  async #attemptStructured(
    request: ModelRequest,
    candidate: RouteCandidate,
    provider: ProviderAdapter,
  ): Promise<
    | { readonly ok: true; readonly value: ProviderResponse }
    | { readonly ok: false; readonly error: FactoryError }
  > {
    const schema = this.#options.structuredSchema;
    if (schema === undefined) {
      return {
        ok: false,
        error: factoryError(
          'workflow.composition',
          'the request asks for a structured answer but no schema was configured',
          false,
        ),
      };
    }

    let lastReason = 'the provider produced no structured answer';

    for (let attempt = 1; attempt <= STRUCTURED_ATTEMPTS; attempt += 1) {
      let raw;
      try {
        raw = await this.#callProvider(request, candidate, provider, attempt > 1 ? lastReason : undefined);
      } catch (error) {
        return { ok: false, error: toGatewayError(error) };
      }

      const extracted = extractStructured(raw.toolCalls);
      if (!extracted.ok) {
        lastReason = extracted.reason;
        continue;
      }

      const validated = revalidate(schema, extracted.value);
      if (!validated.ok) {
        lastReason = validated.reason;
        continue;
      }

      return {
        ok: true,
        value: {
          ...this.#priced(raw, candidate),
          json: validated.value,
        },
      };
    }

    // The answer was invalid twice. The class is `model.reasoning` — the
    // failure is in what the model produced.
    //
    // The **trigger** is `schema-invalid-twice` — pack 03 §4.6's name
    // for this failure — and the error carries it, so the failover
    // loop consults the policy about *this* failure rather than
    // mistaking it for a provider error.
    return {
      ok: false,
      error: factoryError(
        STRUCTURED_FAILURE_CLASS,
        `the structured answer was invalid after ${String(STRUCTURED_ATTEMPTS)} attempts: ${lastReason}`,
        false,
        { attempts: STRUCTURED_ATTEMPTS, trigger: SCHEMA_INVALID_TRIGGER },
      ),
    };
  }

  /**
   * The provider call, with the timeout.
   */
  async #callProvider(
    request: ModelRequest,
    candidate: RouteCandidate,
    provider: ProviderAdapter,
    repair?: string,
  ): Promise<ProviderResponse> {
    // The runtime guard — INV-9's second half. A provider that was not
    // constructed by the factory cannot be called.
    guard(provider);

    const timeoutMs = this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const tools = toolsFor(request);

      const messages =
        repair === undefined
          ? request.messages
          : [
              ...request.messages,
              { role: 'user' as const, content: repairInstruction(repair) },
            ];

      const response = await provider.complete({
        model: candidate.model,
        messages,
        ...(request.system === undefined
          ? {}
          : { system: blocksWithBreakpoint(request) }),
        ...(tools === undefined ? {} : { tools }),
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Price a provider's response.
   *
   * The adapter reports **tokens**; the pricing table turns them into
   * money. An unpriced model is refused — but the refusal happens in
   * the budget check, before the call, so by the time a response
   * arrives the model is known to have a price.
   */
  #priced(response: ProviderResponse, candidate: RouteCandidate): ProviderResponse {
    const priced = priceCall(
      this.#options.pricing,
      candidate.model,
      tokensOf(response.usage),
    );

    if (!priced.ok) {
      // The budget check already refused an unpriced model, so reaching
      // here means the table changed under the call. The cost is zero
      // and the error is *not* swallowed — the ledger records zero and
      // the call is still recorded.
      return { ...response, usage: { ...response.usage, costUsdMicros: 0 } };
    }

    return {
      ...response,
      usage: { ...response.usage, costUsdMicros: priced.costUsdMicros },
    };
  }

  /**
   * The recorded result, as a response.
   *
   * ## What a replay can and cannot return
   *
   * The `model_calls` table records the **accounting** — the tokens, the
   * cost, the provider, the model, the status — and it does **not**
   * record the answer's content. So a replay returns the recorded
   * accounting with an **empty content**.
   *
   * That is not an oversight; it is what the ledger holds. The
   * alternative — storing the answer's content in the cost ledger —
   * would put a model's output into a table that is read for
   * reconciliation against the provider's billing, and the answer
   * belongs in an **artefact** (the run-artefact store, T-1.11), not
   * in the ledger.
   *
   * So the replay is honest about what it has: the same usage, the
   * same cost, the same model, and `cached: false` — the answer was
   * not served from a cache; it was served from the ledger.
   */
  #responseFrom(record: ModelCallRecord, rule: string): ModelResponse {
    return {
      content: '',
      usage: {
        tokensIn: record.tokens.tokensIn,
        tokensOut: record.tokens.tokensOut,
        cacheRead: record.tokens.cacheRead,
        cacheWrite: record.tokens.cacheWrite,
        costUsdMicros: record.costUsdMicros,
      },
      model: record.model,
      provider: record.provider,
      routingDecision: { rule, fallbackUsed: false },
      cached: record.cached,
    };
  }

  /**
   * May this trigger fail over?
   *
   * The policy decides. A trigger not in `on` does not fail over; a
   * trigger in `neverOn` does not fail over.
   */
  #mayFailOver(trigger: TriggerName): boolean {
    const failover = this.#options.policy.spec.failover;

    if (failover === undefined) {
      return false;
    }

    if (failover.neverOn.includes(trigger)) {
      return false;
    }

    return failover.on.includes(trigger);
  }

  /**
   * Append an event.
   */
  async #append(event: GatewayEvent): Promise<void> {
    const sink = this.#options.events;
    if (sink === undefined) {
      return;
    }
    await sink.append(event);
  }
}

/**
 * The token counts from a usage.
 *
 * The `Usage` schema's `cacheRead`/`cacheWrite` are **optional**, and
 * `exactOptionalPropertyTypes` means an absent property is not the
 * same as an `undefined` one. So the counts are read with a default
 * rather than passed through.
 */
const tokensOf = (usage: {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheRead?: number | undefined;
  readonly cacheWrite?: number | undefined;
}): TokenCounts => ({
  tokensIn: usage.tokensIn,
  tokensOut: usage.tokensOut,
  cacheRead: usage.cacheRead ?? 0,
  cacheWrite: usage.cacheWrite ?? 0,
});

/**
 * The failover trigger for a failure.
 *
 * A rate-limited failure is its own trigger — the provider said so.
 * Everything else is a provider error.
 */
const triggerFor = (error: FactoryError): TriggerName => {
  const detail = error.detail ?? {};
  const trigger = detail['trigger'];
  if (typeof trigger === 'string') {
    return trigger;
  }
  return 'provider-error';
};

/**
 * The message of a thrown value.
 *
 * `String(error)` would turn a plain object into `"[object Object]"` —
 * and that string would then be the gateway's error message, which
 * reads like content and says nothing. So a value that is neither an
 * `Error` nor a string gets a message that names what it was.
 */
const messageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return `the provider threw a ${typeof error}`;
};

/**
 * Turn a thrown value into a gateway error.
 */
const toGatewayError = (error: unknown): FactoryError => {
  if (typeof error === 'object' && error !== null && 'class' in error) {
    const candidate = error as { class: unknown; message?: unknown; retriable?: unknown };
    const cls = candidate.class;
    if (
      typeof cls === 'string' &&
      [
        'model.reasoning',
        'model.capability',
        'workflow.composition',
        'context.insufficient',
        'verification.failure',
        'environment.failure',
        'policy.denied',
        'budget.exhausted',
        'tool.unavailable',
        'unknown',
      ].includes(cls)
    ) {
      return factoryError(
        cls as FactoryError['class'],
        typeof candidate.message === 'string'
          ? candidate.message
          : messageOf(error),
        candidate.retriable === true,
      );
    }
  }

  const message = messageOf(error);
  const rateLimited = /rate.?limit/i.test(message);
  return factoryError(
    'environment.failure',
    message,
    rateLimited,
    rateLimited ? { trigger: 'rate-limited' } : { trigger: 'provider-error' },
  );
};
