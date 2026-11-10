/**
 * `gateway` — the fake provider adapter.
 *
 * ## Why the fake is a **real** adapter
 *
 * INV-9: *"Fake provider A errors ⇒ routed to B with `model.failedOver`."*
 *
 * The failover test needs a provider that can be made to fail on
 * demand, and the test needs to know that provider B was called
 * **instead** — not that provider A failed.
 *
 * So the fake is not a stub that returns a canned response. It is an
 * adapter with the same shape as a real one, plus the two controls the
 * test needs: an injected error, and a record of what it was asked.
 *
 * ## It supports **both** structured-output mechanisms
 *
 * The fake can be told to answer with a **forced tool call** (the
 * portable mechanism the gateway implements) or with a **native**
 * structured output. The gateway only *reads* the forced tool call,
 * so the native mode is how a future S-6-driven change would be
 * exercised: the fake already speaks it.
 *
 * ## The runtime guard
 *
 * blueprint 11 §9.4: *"All provider-specific behaviour is confined to
 * the adapter."* The fake is an adapter, so it lives in `providers/` —
 * and the gateway's lint rule (INV-9) keeps every other file out of
 * that directory.
 */

import type {
  ProviderRequest,
  ProviderResponse,
  ToolUse,
  Usage,
} from '@factory/contracts';

import { FORCED_TOOL_NAME } from '../structured.js';

/**
 * The options for a {@link FakeProvider}.
 */
export interface FakeProviderOptions {
  /** The provider's id — its name in the routing policy. */
  readonly id: string;
  /** The model ids the provider offers. */
  readonly models: readonly string[];
  /**
   * The token counts the provider reports.
   *
   * Defaults to one input and one output token, so a test that does not
   * care about tokens does not have to say anything.
   */
  readonly usage?: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  /**
   * The error the provider throws, when it should fail.
   *
   * A test sets it to make the provider fail; the gateway's failover
   * loop is what must respond.
   */
  readonly error?: Error;
  /**
   * Whether the provider answers a structured request with a **native**
   * structured output rather than a forced tool call.
   *
   * The gateway implements only the portable path today; this is where
   * spike S-6's native mechanism would be exercised once its findings
   * exist.
   */
  readonly nativeStructuredOutput?: boolean;
  /**
   * The structured answer the provider produces.
   *
   * When absent, the provider answers a structured request with a
   * forced tool call carrying `{}` — which is how a test provokes an
   * invalid structured answer.
   */
  readonly structuredAnswer?: unknown;
  /**
   * The health the provider reports.
   */
  readonly health?: 'healthy' | 'degraded' | 'unavailable';
}

/**
 * A request the fake was asked.
 */
export interface FakeCall {
  /** The request. */
  readonly request: ProviderRequest;
  /** The model that answered. */
  readonly model: string;
}

/**
 * The token counts the fake reports.
 */
interface FakeUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * The fake provider adapter.
 */
export class FakeProvider {
  readonly id: string;

  readonly #models: readonly string[];
  readonly #usage: FakeUsage;
  readonly #options: FakeProviderOptions;
  readonly #calls: FakeCall[] = [];

  /**
   * The error the provider throws, when it should fail.
   *
   * It is a **mutable** field rather than part of the options, so a
   * test can make a provider fail *after* it was constructed — which
   * is how the failover test arms the failure at the moment it wants
   * it, rather than at construction time.
   */
  #error: Error | undefined;

  /**
   * The error the **models list** throws, when it should fail.
   *
   * The catalogue is a separate failure from the call: a provider
   * whose `models()` endpoint is down may still answer calls, and the
   * startup check must be able to tell the two apart — the catalogue
   * being unreadable makes the models **unavailable**, while a failing
   * call is a **provider error** that fails over.
   */
  #modelsError: Error | undefined;

  constructor(options: FakeProviderOptions) {
    this.id = options.id;
    this.#models = options.models;
    this.#options = options;
    this.#error = options.error;
    this.#usage = {
      tokensIn: options.usage?.tokensIn ?? 1,
      tokensOut: options.usage?.tokensOut ?? 1,
      cacheRead: options.usage?.cacheRead ?? 0,
      cacheWrite: options.usage?.cacheWrite ?? 0,
    };
  }

  /** The requests the fake was asked. */
  public get calls(): readonly FakeCall[] {
    return this.#calls;
  }

  /** How many times the fake was called. */
  public get callCount(): number {
    return this.#calls.length;
  }

  /** The error the fake throws on the next call, when one is set. */
  public failWith(error: Error): void {
    this.#error = error;
  }

  /** Stop the fake failing. */
  public succeed(): void {
    this.#error = undefined;
  }

  /**
   * The error the **models list** throws, when it should fail.
   *
   * The catalogue is a separate failure from the call: a provider
   * whose `models()` endpoint is down may still answer calls. The
   * gateway's startup check needs the two apart — an unreadable
   * catalogue makes the models **unavailable** (fail closed), while a
   * failing call is a **provider error** that fails over.
   */
  public failModelsWith(error: Error): void {
    this.#modelsError = error;
  }

  /** The model ids the provider offers. */
  public models(): Promise<string[]> {
    const error = this.#modelsError;
    if (error !== undefined) {
      return Promise.reject(error);
    }

    return Promise.resolve([...this.#models]);
  }

  /**
   * The index of the block that carries the **cache breakpoint**.
   *
   * The gateway marks the last block of the stable prefix; the adapter
   * turns that mark into the provider's own cache control. The fake
   * records where the mark was, so a test can see the breakpoint the
   * gateway asked for.
   *
   * `undefined` when the request carried no marked block — which is
   * the correct state for a request that asks for no caching.
   */
  public get cacheBreakpointIndex(): number | undefined {
    const last = this.#calls.at(-1);
    if (last === undefined) {
      return undefined;
    }

    const blocks = last.request.system ?? [];
    const index = blocks.findIndex(
      (block) =>
        (block as { readonly cacheBreakpoint?: boolean }).cacheBreakpoint ===
        true,
    );

    return index === -1 ? undefined : index;
  }

  /** The provider's health. */
  public health(): Promise<'healthy' | 'degraded' | 'unavailable'> {
    return Promise.resolve(this.#options.health ?? 'healthy');
  }

  /**
   * The projected cost of a request.
   *
   * The fake estimates **one** token per message plus a fixed output
   * allowance, so a test can reason about the projection without
   * knowing the pricing table.
   */
  public estimateCostMicros(request: ProviderRequest): number {
    return (request.messages.length + 1) * 1000;
  }

  /**
   * Answer a request.
   */
  public complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.#calls.push({ request, model: request.model });

    const error = this.#error;
    if (error !== undefined) {
      return Promise.reject(error);
    }

    const usage: Usage = {
      tokensIn: this.#usage.tokensIn,
      tokensOut: this.#usage.tokensOut,
      cacheRead: this.#usage.cacheRead,
      cacheWrite: this.#usage.cacheWrite,
      costUsdMicros: 0,
    };

    const structured = this.#structuredAnswerFor(request);

    return Promise.resolve({
      content: 'ok',
      usage,
      model: request.model,
      ...(structured === undefined ? {} : structured),
    });
  }

  /**
   * The structured part of the answer.
   */
  #structuredAnswerFor(
    request: ProviderRequest,
  ): { readonly json?: unknown; readonly toolCalls?: readonly ToolUse[] } | undefined {
    const forced = request.tools?.find((tool) => tool.name === FORCED_TOOL_NAME);

    if (forced === undefined) {
      return undefined;
    }

    const answer = this.#options.structuredAnswer ?? {};

    if (this.#options.nativeStructuredOutput === true) {
      // The **native** mechanism: the answer is the content, not a
      // tool call. The gateway does not read this today — it is where
      // spike S-6's finding would land.
      return { json: answer };
    }

    // The **portable** mechanism: a forced single tool call whose
    // arguments are the answer.
    return {
      toolCalls: [
        {
          id: 'call_1',
          name: FORCED_TOOL_NAME,
          input: answer,
        },
      ],
    };
  }
}
