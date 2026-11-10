/**
 * `gateway` — the in-memory model call store.
 *
 * The double where the oracle lives. It mirrors the Postgres store's
 * contract exactly (I-12: *"fakes must pass the same contract tests as
 * the real thing"*), which means:
 *
 * * `findByKey` returns the recorded call — so a replay returns the
 *   **recorded** result (blueprint 11 §6.4).
 * * `record` stores the row **and** the event, so a test can assert
 *   that the two agree.
 *
 * The idempotency key is unique here too: a second `record` with the
 * same key **replaces** the first, matching the database's `UNIQUE`
 * constraint (the database would refuse the second insert; the
 * replacement is the double's way of saying "there can only be one").
 */

import type { GatewayEvent, ModelCallRecord } from '../types.js';
import type { ModelCallStore } from '../ports.js';

/**
 * The in-memory model call store.
 */
export class InMemoryModelCallStore implements ModelCallStore {
  readonly #byKey = new Map<string, ModelCallRecord>();

  readonly #records: ModelCallRecord[] = [];

  readonly #events: GatewayEvent[] = [];

  /** Every recorded call, in order. */
  public get records(): readonly ModelCallRecord[] {
    return this.#records;
  }

  /** Every appended event, in order. */
  public get events(): readonly GatewayEvent[] {
    return this.#events;
  }

  /** The call recorded for an idempotency key. */
  public findByKey(idempotencyKey: string): Promise<ModelCallRecord | undefined> {
    return Promise.resolve(this.#byKey.get(idempotencyKey));
  }

  /** Record a call and its event. */
  public record(record: ModelCallRecord, event: GatewayEvent): Promise<void> {
    this.#byKey.set(record.idempotencyKey, record);
    this.#records.push(record);
    this.#events.push(event);
    return Promise.resolve();
  }
}
