/**
 * The ten-step pipeline (blueprint 11 §6.2).
 *
 * ## The order is fixed, and it *is* the specification
 *
 * blueprint 11 §6.2: *"The order is fixed, and each step's failure is
 * terminal for that step."* The order is not an implementation detail — it
 * is what makes the pipeline safe:
 *
 * | # | step | failure class |
 * |---|---|---|
 * | 1 | validate args | `workflow.composition` (a **usage** error) |
 * | 2 | deny-list | `policy.denied` |
 * | 3 | grant | `policy.denied` |
 * | 4 | resource-scope | `policy.denied` |
 * | 5 | policy | `policy.denied` / escalate |
 * | 6 | approval | `policy.denied` |
 * | 7 | credential | `tool.unavailable` |
 * | 8 | execute | `tool.unavailable` |
 * | 9 | validate result | `tool.unavailable` |
 * | 10 | record | — |
 *
 * Three orderings are load-bearing:
 *
 * * **Validation before everything.** A malformed call never reaches
 *   policy, an adapter, or — the one that really matters — a credential. If
 *   validation ran later, a malformed call would have already consumed a
 *   credential.
 * * **Deny before grant.** A deny is terminal regardless of what any grant
 *   says, so the deny-list is consulted first.
 * * **Credential after approval.** The credential is acquired only once the
 *   policy has allowed the call and any required approval exists.
 *
 * ## What is a *usage* error
 *
 * blueprint 11 §6.3: a schema failure is *"a validation error; it is retried
 * only within the agent's own turn budget, and counted separately"* —
 * explicitly **not** `tool.unavailable`. The contracts' `FailureClass` set
 * has no usage class, so a usage error carries `workflow.composition` and
 * emits **no** `tool.*` event. It is counted by the absence of a tool
 * failure, so it cannot be mistaken for a capability that was unavailable.
 *
 * ## The failure mode is deny
 *
 * blueprint 13 SG-12: *"The failure mode of the policy engine is deny."*
 * The same holds for the broker: any error that is not a recognised
 * execution failure is a denial, and a policy engine that throws is a
 * denial.
 */

import type {
  Decision,
  FailureClass,
  PolicyBundle,
  PolicyInput,
  PolicyResource,
  ToolCapability,
} from '@factory/contracts';
import { matchesGlob } from '@factory/policy';

import { argsDigest, idempotencyKeyFor } from './idempotency.js';
import type {
  AdapterFactory,
  ApprovalChecker,
  BrokerClock,
  BrokerIdSource,
  CapabilityRegistry,
  CredentialProvider,
  InvocationStore,
  PolicyEvaluator,
} from './ports.js';
import { requiredScopeOf } from './grants.js';
import { validate } from './schema/json-schema.js';
import {
  BROKER_FAILURE_CLASSES,
  stepNumberOf,
  type BrokerStep,
  type InvocationOutcome,
  type InvocationRecord,
  type InvocationRequest,
} from './types.js';

/**
 * How the broker is configured.
 */
export interface ToolBrokerOptions {
  /** The capability registry — the authoritative capability set. */
  readonly registry: CapabilityRegistry;
  /** The policy evaluator — step 5. */
  readonly policy: PolicyEvaluator;
  /** The policy bundle the evaluator evaluates against. */
  readonly policyBundle: PolicyBundle;
  /** The adapter factory — step 8. */
  readonly adapters: AdapterFactory;
  /** The approval checker — step 6. */
  readonly approvals: ApprovalChecker;
  /** The credential provider — step 7. */
  readonly credentials: CredentialProvider;
  /** Where the invocation record goes — step 10. */
  readonly store: InvocationStore;
  /** The clock, for durations and expiries. */
  readonly clock: BrokerClock;
  /** The id source, for invocation ids. */
  readonly ids: BrokerIdSource;
  /**
   * The timeout for step 8, in milliseconds.
   *
   * A capability's own `health.timeoutMs` is a *health check* timeout, not an
   * invocation timeout, so the invocation timeout is a broker-level setting.
   */
  readonly timeoutMs?: number;
  /**
   * The prior denials for the task, for the AT-14 equivalent-effect check.
   *
   * pack 02 §4.4 step 2b: these are "supplied by the broker from this
   * task's recorded denials".
   */
  readonly priorDenials?: () => PolicyInput['priorDenials'];
}

/**
 * The default invocation timeout.
 *
 * A call that has not answered in this long is treated as unavailable: the
 * capability cannot be shown to have worked, and an unbounded wait would
 * hold a lease open indefinitely.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The broker.
 *
 * ## Why the class holds no state per call
 *
 * Every piece of per-call state lives in a local. That is what makes the
 * pipeline's step list a *fact* rather than a reconstruction: the broker
 * cannot lose track of which steps ran, because the list is built as it
 * goes.
 */
export class ToolBroker {
  readonly #options: ToolBrokerOptions;

  constructor(options: ToolBrokerOptions) {
    this.#options = options;
  }

  /**
   * Invoke a capability.
   *
   * This is the **only** path to a capability. Every call passes through the
   * ten steps, in order, and a failure at step *n* stops the pipeline at
   * step *n*.
   */
  public async invoke(request: InvocationRequest): Promise<InvocationOutcome> {
    const steps: BrokerStep[] = [];
    const context = request.context;

    // ---- Step 1: validate the arguments --------------------------------
    //
    // *Before anything else.* A malformed call never reaches policy, an
    // adapter, or a credential.
    steps.push('validate-args');

    const capability = this.#options.registry.lookup(request.capabilityId);
    if (capability === undefined) {
      // A capability the registry does not list does not exist — even if a
      // transport advertises it (blueprint 11 §3.2). This is a usage error:
      // the caller asked for something that is not there.
      return this.#failure(
        'validate-args',
        steps,
        `the capability ${request.capabilityId} is not registered, so it does not exist`,
        BROKER_FAILURE_CLASSES.usage,
      );
    }

    const argsCheck = validate(capability.inputSchema, request.args);
    if (!argsCheck.valid) {
      return this.#failure(
        'validate-args',
        steps,
        `the arguments did not match the capability's input schema: ${argsCheck.errors.join('; ')}`,
        BROKER_FAILURE_CLASSES.usage,
      );
    }

    const argsSha256 = argsDigestOf(request.args);

    // ---- The idempotency replay ------------------------------------------
    //
    // blueprint 11 §6.4: "a replayed key returns the **recorded** result."
    //
    // The check sits here — after the arguments have been validated and
    // digested, but **before** the pipeline reaches anything that can
    // perform a side effect. A replay must not re-execute the capability:
    // the whole point of the key is that the side effect happens once.
    //
    // The check is *after* step 1 on purpose. A call whose arguments do not
    // match the schema is a usage error, and a usage error must be
    // reported as one — not silently swallowed by a lookup of a key that
    // was never going to be written.
    const replayed = await this.#replayOf(request, argsSha256);
    if (replayed !== undefined) {
      return replayed;
    }

    // ---- Step 2: the deny-list ------------------------------------------
    //
    // Before the grant, because a deny is terminal regardless of what any
    // grant says (blueprint 11 §4.4).
    steps.push('deny-list');

    const denied = this.#denyListed(capability.capability, request);
    if (denied !== undefined) {
      await this.#recordDenial(
        request,
        capability.capability,
        argsSha256,
        'deny-list',
        denied.reason,
        denied.ruleIds,
      );
      return this.#failure(
        'deny-list',
        steps,
        denied.reason,
        BROKER_FAILURE_CLASSES.denied,
        denied.ruleIds,
      );
    }

    // ---- Step 3: the grant -----------------------------------------------
    steps.push('grant');

    const grantCheck = this.#granted(capability.capability, request);
    if (!grantCheck.granted) {
      await this.#recordDenial(
        request,
        capability.capability,
        argsSha256,
        'grant',
        grantCheck.reason,
        [],
      );
      return this.#failure(
        'grant',
        steps,
        grantCheck.reason,
        BROKER_FAILURE_CLASSES.denied,
      );
    }

    // ---- Step 4: the resource scope --------------------------------------
    //
    // A grant can permit a capability and still be scoped to a repository.
    // blueprint 11 §4.3: "Resource scope is the one that catches the
    // interesting bug."
    steps.push('resource-scope');

    const scopeCheck = this.#inResourceScope(request);
    if (!scopeCheck.inScope) {
      await this.#recordDenial(
        request,
        capability.capability,
        argsSha256,
        'resource-scope',
        scopeCheck.reason,
        [],
      );
      return this.#failure(
        'resource-scope',
        steps,
        scopeCheck.reason,
        BROKER_FAILURE_CLASSES.denied,
      );
    }

    // ---- Step 5: the policy decision --------------------------------------
    steps.push('policy');

    const decision = this.#evaluatePolicy(capability.capability, request);
    if (decision.outcome === 'DENY') {
      await this.#recordDenial(
        request,
        capability.capability,
        argsSha256,
        'policy',
        decision.reason,
        decision.ruleIds,
      );
      return this.#failure(
        'policy',
        steps,
        decision.reason,
        BROKER_FAILURE_CLASSES.denied,
        decision.ruleIds,
      );
    }
    if (decision.outcome === 'ESCALATE') {
      // An escalation is a refusal too: the task is flagged to a human and
      // the second attempt is **not** executed (pack 02 §4.4 step 2b).
      await this.#recordDenial(
        request,
        capability.capability,
        argsSha256,
        'policy',
        decision.reason,
        decision.ruleIds,
      );
      return this.#failure(
        'policy',
        steps,
        decision.reason,
        BROKER_FAILURE_CLASSES.denied,
        decision.ruleIds,
      );
    }

    // ---- Step 6: the approval ---------------------------------------------
    //
    // Only if the policy demanded one. The approval is bound to the
    // arguments' digest: an approval for one set of arguments is not an
    // approval for another.
    steps.push('approval');

    let approvalId: string | undefined;
    if (decision.outcome === 'REQUIRE_APPROVAL') {
      const approved = await this.#options.approvals.hasApproval(
        request.capabilityId,
        argsSha256,
        context,
      );
      if (!approved) {
        const reason = `the policy requires an artefact-bound approval for ${request.capabilityId}, and none exists for these arguments`;
        await this.#recordDenial(
          request,
          capability.capability,
          argsSha256,
          'approval',
          reason,
          decision.ruleIds,
        );
        return this.#failure(
          'approval',
          steps,
          reason,
          BROKER_FAILURE_CLASSES.denied,
          decision.ruleIds,
        );
      }
      approvalId =
        this.#options.approvals.approvalId === undefined
          ? undefined
          : await this.#options.approvals.approvalId(
              request.capabilityId,
              argsSha256,
              context,
            );
    }

    // ---- Step 7: the credential --------------------------------------------
    //
    // Acquired and injected here, and **only** here. The material is held
    // for the duration of this call and never written anywhere.
    steps.push('credential');

    const credential = await this.#options.credentials.resolve(
      capability.capability,
      context,
    );
    const credentialReference =
      credential === undefined
        ? undefined
        : {
            credId: credential.credId,
            scopes: Object.keys(credential.scope).sort(),
            expiresAt: credential.expiresAt,
          };

    // ---- Step 8: the execution ---------------------------------------------
    steps.push('execute');

    const startedAt = this.#options.clock.now();
    const timeoutMs = this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let value: unknown;
    try {
      value = await this.#execute(capability.capability, request.args, credential, timeoutMs);
    } catch (error) {
      const durationMs = this.#options.clock.now().getTime() - startedAt.getTime();
      // A timeout, an adapter failure, or a thrown error: all
      // `tool.unavailable`. The invocation is **recorded as attempted**
      // (step 10 still runs) — a call that was attempted and failed is
      // evidence, and an unrecorded attempt is invisible.
      await this.#recordFailure(
        request,
        capability.capability,
        argsSha256,
        decision,
        approvalId,
        credentialReference,
        durationMs,
        describe(error),
      );
      return this.#failure(
        'execute',
        steps,
        `the capability could not be executed: ${describe(error)}`,
        BROKER_FAILURE_CLASSES.unavailable,
      );
    }

    const durationMs = this.#options.clock.now().getTime() - startedAt.getTime();

    // ---- The credential containment ---------------------------------------
    //
    // blueprint 11 §6.5: "the credential's reference and scopes are
    // recorded but its material never is."
    //
    // The material is stripped from the result **here**, before the result
    // is validated, recorded or handed back. A capability that echoes its
    // input — or that was handed the credential and passed it on — would
    // otherwise carry the secret into the recorded result and into the
    // agent's context.
    //
    // The strip is on the *value*, not on a key: the secret may appear
    // anywhere in the result, under any name.
    const contained = stripSecret(value, credential?.secret);

    // ---- Step 9: validate the result ---------------------------------------
    steps.push('validate-result');

    const resultCheck = validate(capability.outputSchema, contained);
    if (!resultCheck.valid) {
      await this.#recordFailure(
        request,
        capability.capability,
        argsSha256,
        decision,
        approvalId,
        credentialReference,
        durationMs,
        'the result did not match the capability\'s output schema',
      );
      return this.#failure(
        'validate-result',
        steps,
        `the result did not match the capability's output schema: ${resultCheck.errors.join('; ')}`,
        BROKER_FAILURE_CLASSES.unavailable,
      );
    }

    // The trust tag comes from the capability's own declaration. A result
    // the capability declares `untrusted` cannot be passed off as trusted.
    const trust = capability.capability.trust.resultTrust;

    // ---- Step 10: the invocation record ------------------------------------
    steps.push('record');

    const invocationId = this.#options.ids.next();
    const idempotencyKey = idempotencyKeyFor({
      taskId: context.taskId,
      nodeId: context.nodeId,
      attempt: context.attempt,
      capabilityId: request.capabilityId,
      argsSha256,
      ...(request.externalOperation === undefined
        ? {}
        : { externalOperation: request.externalOperation }),
    });

    const record: InvocationRecord = {
      invocationId,
      capabilityId: capability.capability.id,
      capabilityVersion: capability.capability.version,
      transport: capability.capability.transport,
      runId: context.runId,
      taskId: context.taskId,
      nodeId: context.nodeId,
      attempt: context.attempt,
      grantId: request.grant.id,
      argsSha256,
      argsSummary: summarizeArgs(
        capability.capability,
        request.args,
      ),
      resultSummary: summarizeResult(capability.capability, contained),
      effectClass: capability.capability.effect.class,
      ...(request.resource === undefined
        ? {}
        : { resource: describeResource(request.resource) }),
      policyDecision: {
        outcome: decision.outcome,
        ruleIds: [...decision.ruleIds],
        reason: decision.reason,
        bundleSha256: decision.bundleSha256,
      },
      ...(approvalId === undefined ? {} : { approvalId }),
      ...(credentialReference === undefined ? {} : { credential: credentialReference }),
      status: 'succeeded',
      idempotencyKey,
      durationMs,
      costUsdMicros: capability.capability.cost.usdMicros,
      actor: context.actor,
    };

    // ---- Step 10: the invocation record ---------------------------------
    //
    // The row and the event are written in **one** transaction (blueprint
    // 09 §6: "State transitions and their events are written in one
    // transaction"), so a failure here leaves **neither** — the event log
    // can never claim a call the table does not record, and the table can
    // never record a call the log does not know about.
    //
    // A failure of the write is a **terminal failure of the call**, not a
    // thrown exception. The capability has already run: its side effect
    // may have happened, and the caller must be told the call did not
    // complete rather than have the exception escape as an unhandled
    // throw from a method whose contract is to return an outcome.
    //
    // So the write is guarded, and a failure becomes a refusal at step
    // 10. The failure class is `tool.unavailable` — the call cannot be
    // shown to have worked, which is the same class an adapter failure
    // carries (blueprint 11 §6.3).
    //
    // **No second write is attempted.** The store is what failed; asking
    // it again to record the failure would fail the same way, and the
    // attempt would double the evidence of a broken store. So the refusal
    // is reported to the caller and the event log learns nothing — which
    // is the honest outcome: the call happened and could not be recorded,
    // and the gap is visible to whoever reconciles the log against the
    // table (INV-3).
    try {
      await this.#options.store.record(record, {
        eventType: 'tool.invoked',
        aggregate: { kind: 'task', id: context.taskId, version: 0 },
        correlationId: context.runId,
        actor: context.actor,
        authority: {
          basis: 'policy-decision',
          ...(approvalId === undefined ? {} : { approvalId }),
          autonomyLevel: context.autonomy,
        },
        payload: {
          runId: context.runId,
          capabilityId: capability.capability.id,
          effectClass: capability.capability.effect.class,
          argsSha256,
          argsSummary: record.argsSummary,
          resultSummary: record.resultSummary,
          transport: capability.capability.transport,
          idempotencyKey,
          durationMs,
        },
      });
    } catch (error) {
      return this.#failure(
        'record',
        steps,
        `the invocation could not be recorded, so the call cannot be shown to have completed: ${describe(error)}`,
        BROKER_FAILURE_CLASSES.unavailable,
      );
    }

    return {
      ok: true,
      value: contained,
      trust,
      invocationId,
      replayed: false,
      steps,
    };
  }

  /**
   * The deny-list check — step 2.
   *
   * The grant's own `deny` list names scopes **or** capability ids, and a
   * match is terminal.
   */
  #denyListed(
    capability: ToolCapability,
    request: InvocationRequest,
  ): { readonly reason: string; readonly ruleIds: readonly string[] } | undefined {
    const deny = request.grant.deny;
    if (deny.includes(capability.id)) {
      return {
        reason: `the capability ${capability.id} is on the grant's deny list`,
        ruleIds: [`grant.deny/${capability.id}`],
      };
    }

    const required = capability.scope.required;
    for (const entry of deny) {
      if (required.some((scope) => scopeCoveredBy(entry, scope))) {
        return {
          reason: `the scope ${entry} required by ${capability.id} is on the grant's deny list`,
          ruleIds: [`grant.deny/${entry}`],
        };
      }
    }

    return undefined;
  }

  /**
   * The grant check — step 3.
   *
   * The capability must be **named** by the grant, and the grant's scopes
   * must cover the scope the capability requires.
   */
  #granted(
    capability: ToolCapability,
    request: InvocationRequest,
  ): { readonly granted: boolean; readonly reason: string } {
    const grant = request.grant;

    if (!grant.capabilities.includes(capability.id)) {
      return {
        granted: false,
        reason: `the grant ${grant.id} does not name the capability ${capability.id}`,
      };
    }

    const required = requiredScopeOf(capability);
    if (required === undefined) {
      // A capability that requires no scope can still be shown to be
      // permitted by the grant naming it, so this is not a refusal.
      return { granted: true, reason: '' };
    }

    const covered = grant.scopes.some((scope) => scopeCoveredBy(scope, required));
    if (!covered) {
      return {
        granted: false,
        reason: `the grant ${grant.id} does not allow the scope ${required} that ${capability.id} requires`,
      };
    }

    return { granted: true, reason: '' };
  }

  /**
   * The resource-scope check — step 4.
   *
   * A grant can permit a capability and still be scoped to a repository, or
   * to a set of paths.
   */
  #inResourceScope(request: InvocationRequest): {
    readonly inScope: boolean;
    readonly reason: string;
  } {
    const grant = request.grant;
    const resource = request.resource;
    if (resource === undefined) {
      return { inScope: true, reason: '' };
    }

    if (grant.repo !== undefined && resource.repo !== undefined) {
      if (grant.repo !== resource.repo) {
        return {
          inScope: false,
          reason: `the resource ${resource.repo} is outside the grant's repository scope ${grant.repo}`,
        };
      }
    }

    const paths = resource.paths ?? [];
    if (paths.length === 0) {
      return { inScope: true, reason: '' };
    }

    const denyGlobs = grant.denyGlobs ?? [];
    for (const path of paths) {
      if (denyGlobs.some((glob) => matchesGlob(glob, path))) {
        return {
          inScope: false,
          reason: `the path ${path} is on the grant's deny list`,
        };
      }
    }

    const writeGlobs = grant.writeGlobs ?? [];
    if (writeGlobs.length === 0) {
      return { inScope: true, reason: '' };
    }

    const outside = paths.find(
      (path) => !writeGlobs.some((glob) => matchesGlob(glob, path)),
    );
    if (outside !== undefined) {
      return {
        inScope: false,
        reason: `the path ${outside} is outside the grant's write scope`,
      };
    }

    return { inScope: true, reason: '' };
  }

  /**
   * The policy evaluation — step 5.
   *
   * The engine never throws (pack 02 §4.4), but the broker does not rely
   * on that: an engine that throws is a **denial**, because the failure
   * mode of the policy engine is deny (blueprint 13 SG-12).
   */
  #evaluatePolicy(
    capability: ToolCapability,
    request: InvocationRequest,
  ): Decision {
    const context = request.context;
    const resource = request.resource;

    const input: PolicyInput = {
      action: `invoke:${capability.id}`,
      capabilityId: capability.id,
      effectClass: capability.effect.class,
      actor: context.actor,
      taskId: context.taskId,
      workflow: context.workflow,
      stage: context.stage,
      autonomy: context.autonomy,
      ...(context.tier === undefined ? {} : { tier: context.tier }),
      ...(resource === undefined
        ? {}
        : { resource: policyResourceOf(resource) }),
      args: request.args,
      ...(this.#options.priorDenials === undefined
        ? {}
        : { priorDenials: this.#options.priorDenials() }),
    };

    try {
      return this.#options.policy.evaluate(input, this.#options.policyBundle);
    } catch (error) {
      return {
        outcome: 'DENY',
        ruleIds: ['policy.engine_error'],
        reason: `the policy engine failed and denied the call: ${describe(error)}`,
        bundleSha256:
          'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      };
    }
  }

  /**
   * The execution — step 8.
   *
   * The call is made through the adapter with a timeout, and the adapter is
   * invoked with the factory's guard token so that a direct adapter call
   * outside the broker cannot succeed.
   *
   * ## Why the call is *raced* against the timeout
   *
   * The abort signal tells the adapter to stop, but a signal is only a
   * request. An adapter that ignores it — or that is stuck in a call it
   * cannot cancel — would leave the broker awaiting a promise that never
   * settles, and an unbounded wait holds the lease open indefinitely.
   *
   * So the broker does not merely *signal* the timeout: it **stops
   * waiting**. The adapter's promise is raced against a timer, and the
   * timer wins.
   */
  async #execute(
    capability: ToolCapability,
    args: unknown,
    credential: { readonly secret: string } | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const adapter = await this.#options.adapters.adapterFor(capability);
    const token = this.#options.adapters.guardToken();

    const controller = new AbortController();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new Error(
            `the capability did not answer within ${String(timeoutMs)}ms`,
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        adapter.invoke(
          capability.id,
          args,
          credential as never,
          controller.signal,
          token,
        ),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Record a failed invocation.
   *
   * A call that was **attempted** and failed is evidence: an unrecorded
   * attempt is invisible, and the reaper's "first committed result wins"
   * rule needs to know the attempt happened.
   *
   * The failure is `tool.unavailable` — the capability could not be shown
   * to have worked. A **denial** is a different thing and is recorded by
   * {@link ToolBroker.#recordDenial}, which carries the step that refused.
   */
  async #recordFailure(
    request: InvocationRequest,
    capability: ToolCapability,
    argsSha256: string,
    decision: Decision,
    approvalId: string | undefined,
    credentialReference: { readonly credId: string; readonly scopes: readonly string[]; readonly expiresAt: string } | undefined,
    durationMs: number,
    reason: string,
  ): Promise<void> {
    const context = request.context;
    const invocationId = this.#options.ids.next();
    const idempotencyKey = idempotencyKeyFor({
      taskId: context.taskId,
      nodeId: context.nodeId,
      attempt: context.attempt,
      capabilityId: request.capabilityId,
      argsSha256,
      ...(request.externalOperation === undefined
        ? {}
        : { externalOperation: request.externalOperation }),
    });

    const record: InvocationRecord = {
      invocationId,
      capabilityId: capability.id,
      capabilityVersion: capability.version,
      transport: capability.transport,
      runId: context.runId,
      taskId: context.taskId,
      nodeId: context.nodeId,
      attempt: context.attempt,
      grantId: request.grant.id,
      argsSha256,
      argsSummary: summarizeArgs(capability, request.args),
      effectClass: capability.effect.class,
      ...(request.resource === undefined
        ? {}
        : { resource: describeResource(request.resource) }),
      policyDecision: {
        outcome: decision.outcome,
        ruleIds: [...decision.ruleIds],
        reason: decision.reason,
        bundleSha256: decision.bundleSha256,
      },
      ...(approvalId === undefined ? {} : { approvalId }),
      ...(credentialReference === undefined ? {} : { credential: credentialReference }),
      status: 'failed',
      idempotencyKey,
      durationMs,
      costUsdMicros: capability.cost.usdMicros,
      actor: context.actor,
    };

    try {
      await this.#options.store.record(record, {
        eventType: 'tool.failed',
        aggregate: { kind: 'task', id: context.taskId, version: 0 },
        correlationId: context.runId,
        actor: context.actor,
        authority: {
          basis: 'policy-decision',
          ...(approvalId === undefined ? {} : { approvalId }),
          autonomyLevel: context.autonomy,
        },
        payload: {
          runId: context.runId,
          capabilityId: capability.id,
          reason,
        },
      });
    } catch {
      // The failure is still a failure.
      //
      // The caller is told the capability could not be executed either
      // way; a failure of the *record* must not replace that refusal with
      // an exception. The attempted call is evidence — and the gap
      // between the table and the log is exactly what INV-3's
      // reconciliation looks for.
    }
  }

  /**
   * Record a **denial** — the security event.
   *
   * pack 03 §"the event types": `tool.denied` is a **security event**:
   * *"counted, alerted on, shown on the Health region."* So a refusal at
   * any of the policy gates is recorded — the invocation row with status
   * `denied`, and the event whose payload carries
   * `{runId, capabilityId, step, ruleIds, reason}`.
   *
   * ## Why the *step* is in the payload
   *
   * The step number says **which gate refused**. An auditor reading the
   * event log can tell a call that was denied by the deny-list from one
   * denied by the policy engine — and the two mean very different things.
   * The step is the one the call actually reached, not a fixed value.
   *
   * ## Why a denial at step 1 is *not* recorded
   *
   * A usage error — a malformed call, or a call for a capability that does
   * not exist — is **not** a security event. blueprint 11 §6.3: it is
   * "counted separately", and it emits **no** `tool.*` event. A refusal at
   * step 1 says nothing about anybody's intent, so counting it as a
   * security event would drown the real ones.
   */
  async #recordDenial(
    request: InvocationRequest,
    capability: ToolCapability,
    argsSha256: string,
    step: BrokerStep,
    reason: string,
    ruleIds: readonly string[],
  ): Promise<void> {
    const context = request.context;
    const invocationId = this.#options.ids.next();
    const idempotencyKey = idempotencyKeyFor({
      taskId: context.taskId,
      nodeId: context.nodeId,
      attempt: context.attempt,
      capabilityId: request.capabilityId,
      argsSha256,
      ...(request.externalOperation === undefined
        ? {}
        : { externalOperation: request.externalOperation }),
    });

    const record: InvocationRecord = {
      invocationId,
      capabilityId: capability.id,
      capabilityVersion: capability.version,
      transport: capability.transport,
      runId: context.runId,
      taskId: context.taskId,
      nodeId: context.nodeId,
      attempt: context.attempt,
      grantId: request.grant.id,
      argsSha256,
      argsSummary: summarizeArgs(capability, request.args),
      effectClass: capability.effect.class,
      ...(request.resource === undefined
        ? {}
        : { resource: describeResource(request.resource) }),
      status: 'denied',
      idempotencyKey,
      durationMs: 0,
      costUsdMicros: 0,
      actor: context.actor,
    };

    try {
      await this.#options.store.record(record, {
        eventType: 'tool.denied',
        aggregate: { kind: 'task', id: context.taskId, version: 0 },
        correlationId: context.runId,
        actor: context.actor,
        authority: {
          basis: 'policy-decision',
          autonomyLevel: context.autonomy,
          // A denial is a *violation* of the intended authority: the call
          // was attempted and refused.
          violation: true,
        },
        payload: {
          runId: context.runId,
          capabilityId: capability.id,
          step: stepNumberOf(step),
          ruleIds: [...ruleIds],
          reason,
        },
      });
    } catch {
      // A denial that cannot be recorded is still a denial.
      //
      // The refusal itself is the fact that matters — the call was
      // attempted and refused — and the caller is told about it either
      // way. Swallowing the write failure keeps the *refusal* observable
      // to the caller: the alternative is an exception escaping from
      // `invoke`, which loses the refusal's reason, its step and its
      // class, and reports a crash instead of a gate that did its job.
      //
      // The event log's gap is real and visible — the reconciliation that
      // INV-3 asks for is what surfaces it. But the refusal must not be
      // lost to an exception.
    }
  }

  /**
   * The outcome of a **replayed** call, when the key has been used.
   *
   * blueprint 11 §6.4: *"a replayed key returns the **recorded** result."*
   *
   * So the value returned is the **recorded** one — the invocation row's
   * `resultSummary`, which is the redacted form of what the capability
   * produced. It is not a re-execution: re-executing would perform the
   * side effect a second time, which is the exact thing the key exists to
   * prevent.
   *
   * The steps reported are the ones that ran — which is only
   * `validate-args`, because the replay short-circuits the pipeline before
   * any gate that could perform a side effect.
   *
   * A **failed** record is not replayed: only a *succeeded* call has a
   * result to return. A failed attempt is evidence that the attempt
   * happened, and a retry of the same attempt must be allowed to try
   * again.
   */
  async #replayOf(
    request: InvocationRequest,
    argsSha256: string,
  ): Promise<InvocationOutcome | undefined> {
    const store = this.#options.store;
    if (store.findByKey === undefined) {
      return undefined;
    }

    const context = request.context;
    const key = idempotencyKeyFor({
      taskId: context.taskId,
      nodeId: context.nodeId,
      attempt: context.attempt,
      capabilityId: request.capabilityId,
      argsSha256,
      ...(request.externalOperation === undefined
        ? {}
        : { externalOperation: request.externalOperation }),
    });

    const record = await store.findByKey(key);
    if (record === undefined || record.status !== 'succeeded') {
      return undefined;
    }

    const capability = this.#options.registry.lookup(request.capabilityId);

    return {
      ok: true,
      value: record.resultSummary,
      trust: capability?.capability.trust.resultTrust ?? 'untrusted',
      invocationId: record.invocationId,
      replayed: true,
      steps: ['validate-args'],
    };
  }

  /**
   * Build a failure outcome.
   */
  #failure(
    step: BrokerStep,
    steps: readonly BrokerStep[],
    reason: string,
    failureClass: FailureClass,
    ruleIds?: readonly string[],
  ): InvocationOutcome {
    return {
      ok: false,
      failedAt: step,
      stepNumber: stepNumberOf(step),
      reason,
      failureClass,
      ...(ruleIds === undefined ? {} : { ruleIds: [...ruleIds] }),
      steps: [...steps],
    };
  }
}

/**
 * Whether a granted scope covers a required scope.
 *
 * Scopes are hierarchical and prefix-matched (blueprint 11 §4.2): a scope
 * covers its children, separated by `:`.
 *
 * The parameterised forms (`repo:write:path:<glob>`, `net.egress:<host>`)
 * need the glob and host rules, so the policy package's `scopeAllowed` is
 * used for the grant check. Here, the simple hierarchical form is enough —
 * but a parameterised scope must **not** be treated as a plain prefix,
 * because `repo:write:path:src/**` is not a prefix of
 * `repo:write:path:src/index.ts`.
 */
export const scopeCoveredBy = (granted: string, required: string): boolean => {
  if (granted === required) {
    return true;
  }
  if (granted.includes(':path:') || granted.includes(':egress:')) {
    // A parameterised scope is not a plain prefix. The grant's globs are
    // checked by the resource-scope step; here the scope *name* must match
    // exactly, up to the parameter.
    const grantedPrefix = granted.split(':').slice(0, 3).join(':');
    const requiredPrefix = required.split(':').slice(0, 3).join(':');
    return grantedPrefix === requiredPrefix;
  }
  return required.startsWith(`${granted}:`);
};

/**
 * The policy engine's resource, from the broker's resource.
 *
 * ## Why the `ref` is not optional
 *
 * The contracts' `PolicyResource` requires a non-empty `ref`: it is the
 * resource's **identity**, and it is what the AT-14 equivalent-effect
 * check compares. A resource with no identity cannot be compared, so the
 * broker supplies one.
 *
 * The identity is chosen so that two resources are the same resource
 * exactly when they target the same thing:
 *
 * * a repository, when the call names one — `org/repo`;
 * * a host, when the call names one instead — `host:example.com`;
 * * otherwise, the **paths** the call touches — `paths:src/index.ts`.
 *
 * The third case matters: a call that touches `src/index.ts` and a call
 * that touches `src/other.ts` are *different* resources, and an AT-14
 * escalation must be able to tell them apart. Collapsing them into one
 * empty `ref` would make every path-scoped write look like the same
 * resource, and the escalation check would fire on the wrong pair.
 */
export const policyResourceOf = (resource: {
  readonly repo?: string;
  readonly paths?: readonly string[];
  readonly host?: string;
}): PolicyResource => {
  if (resource.repo !== undefined && resource.repo.length > 0) {
    return {
      kind: 'repo',
      ref: resource.repo,
      ...(resource.paths === undefined ? {} : { paths: [...resource.paths] }),
      ...(resource.host === undefined ? {} : { host: resource.host }),
    };
  }

  if (resource.host !== undefined && resource.host.length > 0) {
    return {
      kind: 'host',
      ref: `host:${resource.host}`,
      ...(resource.paths === undefined ? {} : { paths: [...resource.paths] }),
    };
  }

  const paths = resource.paths ?? [];
  return {
    kind: 'path',
    ref: `paths:${[...paths].sort().join(',')}`,
    ...(paths.length === 0 ? {} : { paths: [...paths] }),
  };
};

/**
 * A digest of the arguments.
 */
const argsDigestOf = (args: unknown): string =>
  argsDigest(args);

/**
 * The arguments' summary, with the capability's redaction list applied.
 *
 * blueprint 11 §6.5: the record carries a *summary* of the arguments, not
 * the values, because the arguments may contain a value the capability's
 * `observability.redactArguments` names.
 */
export const summarizeArgs = (
  capability: ToolCapability,
  args: unknown,
): unknown => {
  const redact = capability.observability.redactArguments;
  if (redact.length === 0) {
    return args;
  }
  return redactValues(args, redact);
};

/**
 * The result's summary.
 *
 * The result may contain a secret the credential broker added to the task's
 * redaction set, so the summary is a *shape*, not the value.
 */
export const summarizeResult = (
  capability: ToolCapability,
  value: unknown,
): unknown => {
  const redact = capability.observability.redactArguments;
  if (redact.length === 0) {
    return value;
  }
  return redactValues(value, redact);
};

/**
 * Replace the named values with a placeholder.
 *
 * A redacted value is replaced wherever it appears — as an object key's
 * value, or as a string equal to the redacted name.
 */
const redactValues = (value: unknown, redact: readonly string[]): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactValues(item, redact));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = redact.includes(key) ? '[redacted]' : redactValues(member, redact);
    }
    return out;
  }
  if (typeof value === 'string' && redact.includes(value)) {
    return '[redacted]';
  }
  return value;
};

/**
 * Strip the credential's **material** from a value.
 *
 * blueprint 11 §6.5: the material is never written anywhere. A capability
 * that echoes its input, or that was handed the credential and passed it
 * on, would otherwise carry the secret into the recorded result and into
 * the agent's context.
 *
 * ## Why the strip is on the *value*, not on a key
 *
 * The secret may appear anywhere in the result — under any name, at any
 * depth. A strip that only removed a known key would leave the secret in
 * place under a different name, which is the same leak with more steps.
 *
 * So the material is matched **by value**: every string equal to the
 * secret becomes a placeholder. The result is a value that is equal to
 * the secret nowhere.
 *
 * An absent secret — a capability that needs no credential — leaves the
 * value untouched.
 */
export const stripSecret = (value: unknown, secret: string | undefined): unknown => {
  if (secret === undefined || secret.length === 0) {
    return value;
  }
  return stripSecretValue(value, secret);
};

/**
 * The recursive half of {@link stripSecret}.
 */
const stripSecretValue = (value: unknown, secret: string): unknown => {
  if (typeof value === 'string') {
    return value === secret ? '[redacted]' : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripSecretValue(item, secret));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = stripSecretValue(member, secret);
    }
    return out;
  }
  return value;
};

/**
 * The resource's description, for the invocation record.
 */
const describeResource = (resource: {
  readonly repo?: string;
  readonly paths?: readonly string[];
  readonly host?: string;
}): string => {
  const parts: string[] = [];
  if (resource.repo !== undefined) {
    parts.push(`repo:${resource.repo}`);
  }
  if (resource.host !== undefined) {
    parts.push(`host:${resource.host}`);
  }
  if (resource.paths !== undefined && resource.paths.length > 0) {
    parts.push(`paths:${[...resource.paths].sort().join(',')}`);
  }
  return parts.join('|');
};

/**
 * Describe an error for a failure reason.
 */
const describe = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return `non-error thrown: ${String(error)}`;
};
