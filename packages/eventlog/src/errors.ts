/**
 * Errors raised by the event log.
 *
 * pack 02 §4.2: "Failure: transaction rollback leaves no partial state; an
 * append failure aborts the surrounding operation (state and event are never
 * separated)."
 *
 * Two failures are named by the corpus and are therefore *distinct types*,
 * not strings:
 *
 * * `ConcurrencyError` — the CAS on an aggregate version failed. Another
 *   writer won. The append is refused and **no event is written**. This is
 *   the "exactly-once state transition" mechanism (blueprint `09` §6:
 *   "Optimistic concurrency on `aggregate.version`; one writer wins").
 * * `EventLogError` — anything else that made the append fail (bad event
 *   type, unknown aggregate kind, a redaction that could not be applied).
 *   The transaction rolls back and **no event is written**.
 *
 * Both are distinguishable by a caller without string-matching, because a
 * caller must be able to tell "retry me" from "you sent nonsense".
 */

/**
 * The optimistic-concurrency failure.
 *
 * Thrown when an aggregate's version is not the one the caller expected. The
 * caller may re-read the aggregate and retry — the log guarantees exactly one
 * of the competing writers wins.
 */
export class ConcurrencyError extends Error {
  /** The aggregate whose version did not match. */
  public readonly aggregateKind: string;

  /** The aggregate whose version did not match. */
  public readonly aggregateId: string;

  /** The version the caller expected. */
  public readonly expectedVersion: number;

  /** The version the database actually holds — `undefined` when the row does not exist. */
  public readonly actualVersion: number | undefined;

  constructor(
    aggregateKind: string,
    aggregateId: string,
    expectedVersion: number,
    actualVersion: number | undefined,
  ) {
    super(
      `concurrency conflict on ${aggregateKind}:${aggregateId}: expected version ${String(
        expectedVersion,
      )}, found ${actualVersion === undefined ? 'no row' : String(actualVersion)}`,
    );
    this.name = 'ConcurrencyError';
    this.aggregateKind = aggregateKind;
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Any other event-log failure.
 *
 * The transaction is rolled back before this escapes, so the caller can
 * safely treat the log as unchanged.
 */
export class EventLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventLogError';
  }
}
