/**
 * `gateway` — the ports the gateway talks to.
 *
 * ## Why the gateway owns its own ports
 *
 * The gateway needs three things from the world: a place to record what
 * it spent, a place to record what it called, and somewhere to put its
 * events. Each of those has two implementations — a Postgres one and an
 * in-memory one — and the gateway must run against both without knowing
 * which it has.
 *
 * Declaring the ports here (rather than importing a concrete store)
 * is what makes the oracle possible: the tests drive the gateway against
 * the in-memory doubles, and the acceptance test drives it against
 * Postgres.
 *
 * The contracts' `ProviderAdapter` is **not** redeclared here. It is
 * the contract, and the gateway uses it directly.
 */

import type { ProviderAdapter } from '@factory/contracts';

import type { BudgetState } from './budget.js';
import type { GatewayEvent, ModelCallRecord } from './types.js';

export type { ProviderAdapter };

/**
 * The ledger of what has been spent.
 *
 * The gateway reads the **remaining** budget from it; it never writes
 * to it directly. The spending is recorded through the
 * {@link ModelCallStore}, and the ledger is the projection of those
 * records — so the two can never disagree.
 */
export interface BudgetLedger {
  /**
   * The budget state for a request's task.
   *
   * @param taskId the task.
   */
  remainingFor(taskId: string): Promise<BudgetState>;
}

/**
 * The store of model calls — the `model_calls` ledger.
 */
export interface ModelCallStore {
  /**
   * The call recorded for an idempotency key.
   *
   * @returns the record, or `undefined` when the key has not been used.
   */
  findByKey(idempotencyKey: string): Promise<ModelCallRecord | undefined>;

  /**
   * Record a call and its event, **in one transaction**.
   *
   * blueprint 09 §6: "State transitions and their events are written in
   * one transaction." The same holds here — the event log is the
   * factory's single source of truth (blueprint 09 §5.2), so a
   * `model.requested` event without its `model_calls` row — or the
   * reverse — is a disagreement in the source of truth.
   */
  record(record: ModelCallRecord, event: GatewayEvent): Promise<void>;
}

/**
 * Where the gateway's events go.
 */
export interface GatewayEventSink {
  /**
   * Append an event.
   *
   * The event types are registered in the contracts:
   * `model.requested`, `model.failed`, `model.failedOver` and
   * `budget.exhausted`.
   */
  append(event: GatewayEvent): Promise<void>;
}

/**
 * The catalogue of models a provider offers.
 *
 * This is the `ProviderAdapter`'s own `models()` — the port exists so
 * the startup check can be expressed without the gateway knowing how a
 * provider lists its models.
 */
export interface ModelCatalog {
  /** The model ids the provider offers. */
  models(provider: string): Promise<readonly string[]>;
}
