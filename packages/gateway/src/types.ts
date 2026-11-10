/**
 * `gateway` — the gateway's own vocabulary.
 *
 * ## Why these types are not in the contracts
 *
 * The contracts own the **wire shapes**: `ModelRequest`, `ModelResponse`,
 * `ProviderAdapter`, `RoutingPolicy`. They are what crosses a boundary
 * between two components.
 *
 * These types are the gateway's **internals** — the route it resolved, the
 * price it computed, the budget it checked, the call it recorded. They
 * never leave the package except through the gateway's own public surface.
 *
 * So they live here rather than in `packages/contracts`, which is frozen
 * (HR-12: no contract edit inside another ticket) and which would gain
 * types that no other component needs.
 */

/**
 * The budget scopes (pack 03 §4.6, blueprint 11 §9.5).
 *
 * The order matters: `request` is the tightest and `workflow-day` the
 * loosest, and the gateway refuses on the **first** scope that is
 * exhausted.
 */
export const BUDGET_SCOPES = ['request', 'task', 'workflow-day'] as const;

export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/**
 * The failover triggers (pack 03 §4.6).
 *
 * ```yaml
 * failover: { on: [provider-error, rate-limited, schema-invalid-twice], neverOn: [budget-exhausted] }
 * ```
 *
 * These are the triggers the corpus names. The policy's `on`/`neverOn`
 * lists are free-form strings, so the gateway does not *restrict* the
 * set — it honours whatever the policy declares. These are the ones the
 * gateway itself can *raise*, and the ones the default policy uses.
 */
export const FAILOVER_TRIGGERS = [
  'provider-error',
  'rate-limited',
  'schema-invalid-twice',
] as const;

export type FailoverTrigger = (typeof FAILOVER_TRIGGERS)[number];

/**
 * The name of a failover trigger, as the policy names it.
 *
 * The policy's `on`/`neverOn` lists are **free-form string arrays** —
 * the gateway honours whatever the policy declares — so a trigger the
 * gateway did not know about when it was written is still a valid
 * trigger name. {@link FailoverTrigger} is the set the gateway itself
 * raises; this is the wider set a policy may name.
 */
export type TriggerName = string;

/**
 * The trigger for a refusal that must never fail over (pack 03 §4.6).
 *
 * The gateway's budget refusal never reaches the failover loop at all —
 * it happens *before* the call. The constant exists so the default
 * policy and the gateway agree on the spelling.
 */
export const BUDGET_EXHAUSTED_TRIGGER = 'budget-exhausted';

/**
 * A route candidate — one provider/model pair the gateway may call.
 */
export interface RouteCandidate {
  /** The provider's name, as the routing policy names it. */
  readonly provider: string;
  /** The model id, as the routing policy names it. */
  readonly model: string;
  /** Whether this candidate is the primary or a fallback. */
  readonly kind: 'primary' | 'fallback';
}

/**
 * The route the gateway resolved for a request.
 */
export interface Route {
  /** The policy rule that matched. */
  readonly rule: string;
  /** The policy class the rule selected. */
  readonly className: string;
  /** The primary, then the fallbacks, in order. */
  readonly candidates: readonly RouteCandidate[];
}

/**
 * A price for one token class, in micro-USD **per million tokens**.
 *
 * pack 04 §6: "per-model USD per million tokens, per token class".
 *
 * The unit is micro-USD because every money value in the factory is
 * integer micro-USD (pack 04 §6: "Costs are integer micro-USD") — a
 * float here would lose cents at the per-million scale and the
 * golden cost tests could not assert exact integers.
 */
export interface PriceEntry {
  /** The price of a million input tokens, in micro-USD. */
  readonly inputPerMillionUsdMicros: number;
  /** The price of a million output tokens, in micro-USD. */
  readonly outputPerMillionUsdMicros: number;
  /** The price of a million cache-read tokens, in micro-USD. */
  readonly cacheReadPerMillionUsdMicros: number;
  /** The price of a million cache-write tokens, in micro-USD. */
  readonly cacheWritePerMillionUsdMicros: number;
}

/**
 * The pricing table — model id to price.
 *
 * **No model id is ever hard-coded in the gateway's source.** Every id
 * here comes from `definition/pricing.yaml` (pack 04 §6: "**never
 * hard-coded**"). INV-9's second half is that rule, and
 * `tests/unit/gateway-model-ids.test.ts` proves it mechanically.
 */
export type PricingTable = Readonly<Record<string, PriceEntry>>;

/**
 * The token counts the gateway accounts for.
 *
 * The four classes mirror the Anthropic adapter's usage fields (pack
 * 04 §6: "usage fields for input/output/cache read/cache write tokens")
 * and the `model_calls` columns `tokens_in`, `tokens_out`,
 * `tokens_cache_read`, `tokens_cache_write`.
 */
export interface TokenCounts {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * A recorded model call — the row in `model_calls`.
 */
export interface ModelCallRecord {
  /** The row's id. */
  readonly id: string;
  /** The run the call belongs to, when there is one. */
  readonly runId?: string;
  /** The task the call was made for. */
  readonly taskId: string;
  /** The provider that answered. */
  readonly provider: string;
  /** The model that answered. */
  readonly model: string;
  /** The routing rule that selected the candidate. */
  readonly routeRule?: string;
  /** The prompt's digest. */
  readonly promptSha256?: string;
  /** The tokens accounted for. */
  readonly tokens: TokenCounts;
  /** The cost, in integer micro-USD. */
  readonly costUsdMicros: number;
  /** The latency, in milliseconds. */
  readonly latencyMs?: number;
  /** The status — `ok`, `failed`, `schema-invalid`, `budget-exhausted`. */
  readonly status: string;
  /** Whether the answer came from the cache. */
  readonly cached: boolean;
  /** `complete` or `passthrough`. */
  readonly via: 'complete' | 'passthrough';
  /** The idempotency key. */
  readonly idempotencyKey: string;
}

/**
 * The status a recorded call may carry.
 *
 * A call that failed is **recorded** — a failure that leaves no trace
 * cannot be reconciled with the provider's billing (blueprint 11 §9.5:
 * "Tokens and currency are recorded on every request").
 */
export const MODEL_CALL_STATUSES = [
  'ok',
  'failed',
  'schema-invalid',
  'budget-exhausted',
] as const;

export type ModelCallStatus = (typeof MODEL_CALL_STATUSES)[number];

/**
 * The gateway's events.
 *
 * The types are registered in the contracts
 * (`packages/contracts/src/event-log.ts`): `model.requested`,
 * `model.failed`, `model.failedOver` and `budget.exhausted`.
 */
export interface GatewayEvent {
  readonly eventType:
    | 'model.requested'
    | 'model.failed'
    | 'model.failedOver'
    | 'budget.exhausted';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly costUsdMicros?: number;
}
