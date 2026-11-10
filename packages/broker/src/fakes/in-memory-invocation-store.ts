/**
 * The in-memory invocation store — the double where the oracle lives.
 *
 * ## What it proves
 *
 * The broker's tenth step writes an invocation record **and** its event,
 * and the two must be consistent: an event log entry that claims a call the
 * table does not record, or a record with no event, both break the log's
 * claim to be the single source of truth (blueprint 09 §5.2).
 *
 * The double therefore records both, and exposes a **replay** lookup — so
 * the idempotency oracle can be proved without a database.
 *
 * ## Why the replay lookup matters
 *
 * blueprint 11 §6.4: a replayed key returns the **recorded** result. So the
 * store must be able to answer "what did this key produce last time?" —
 * and the answer must be the recorded value, not a re-execution.
 */

import type { InvocationStore, BrokerEvent } from '../ports.js';
import type { InvocationRecord } from '../types.js';

/**
 * A record and its event, as the store holds them.
 */
export interface StoredInvocation {
  readonly record: InvocationRecord;
  readonly event: BrokerEvent;
}

/**
 * An in-memory invocation store.
 */
export class InMemoryInvocationStore implements InvocationStore {
  /** The records, by idempotency key. */
  readonly #byKey = new Map<string, InvocationRecord>();

  /** The events, in write order. */
  readonly #events: BrokerEvent[] = [];

  /** The records, in write order. */
  readonly #records: InvocationRecord[] = [];

  /**
   * Write the invocation record and its event.
   *
   * The store writes both, so the two can never disagree. In the Postgres
   * implementation they share a transaction; here there is no transaction,
   * so the store writes them in one synchronous step and a failure between
   * them is not expressible.
   */
  public record(record: InvocationRecord, event: BrokerEvent): Promise<void> {
    this.#records.push(record);
    this.#events.push(event);
    this.#byKey.set(record.idempotencyKey, record);
    return Promise.resolve();
  }

  /**
   * The record for an idempotency key.
   *
   * `undefined` when the key has not been used.
   */
  public byKey(idempotencyKey: string): InvocationRecord | undefined {
    return this.#byKey.get(idempotencyKey);
  }

  /**
   * The record for an idempotency key — the port's lookup.
   *
   * blueprint 11 §6.4: "a replayed key returns the **recorded** result."
   * So the lookup is what the broker consults to decide whether to replay.
   */
  public findByKey(idempotencyKey: string): Promise<InvocationRecord | undefined> {
    return Promise.resolve(this.#byKey.get(idempotencyKey));
  }

  /**
   * Every record, in write order.
   */
  public records(): readonly InvocationRecord[] {
    return [...this.#records];
  }

  /**
   * Every event, in write order.
   */
  public events(): readonly BrokerEvent[] {
    return [...this.#events];
  }

  /**
   * How many records the store holds.
   */
  public size(): number {
    return this.#records.length;
  }
}
