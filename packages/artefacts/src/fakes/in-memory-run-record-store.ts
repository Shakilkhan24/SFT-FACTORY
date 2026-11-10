/**
 * `artefacts` — the in-memory `runs` index.
 *
 * ## What the double must be able to show
 *
 * * The row exists only **after** the record was written — the
 *   atomic-with-the-outcome property, observed at the index side.
 * * A run whose object write failed has **no row**.
 * * The purge **marks** the row rather than deleting it, and the row
 *   keeps its history.
 *
 * So the double records the rows it holds and the order it wrote them,
 * and it never invents a row the store did not write.
 */

import type {
  PurgeCandidateRow,
  RunIndexEntry,
  RunRecordStore,
} from '../ports.js';

/**
 * The in-memory run-record store.
 */
export class InMemoryRunRecordStore implements RunRecordStore {
  readonly #rows = new Map<string, RunIndexEntry>();

  /** The ids of the runs whose rows were written, in order. */
  public readonly written: string[] = [];

  /** The ids of the runs whose rows were marked purged, in order. */
  public readonly purged: string[] = [];

  /**
   * Write the run's index row and its terminal event, in one transaction.
   *
   * The double has no transaction of its own — it is the *store* that
   * promises the row and the event go together, and the double records
   * the row so a test can observe that the promise was kept (or not).
   */
  public writeFinalised(index: RunIndexEntry): Promise<void> {
    this.#rows.set(index.runId, index);
    this.written.push(index.runId);
    return Promise.resolve();
  }

  /**
   * Write the run's index row before the run completes.
   */
  public writeStarted(index: RunIndexEntry): Promise<void> {
    this.#rows.set(index.runId, index);
    this.written.push(index.runId);
    return Promise.resolve();
  }

  /**
   * The index row for a run.
   */
  public find(runId: string): Promise<RunIndexEntry | undefined> {
    return Promise.resolve(this.#rows.get(runId));
  }

  /**
   * The rows that are due for purging.
   */
  public listPurgeCandidates(asOf: string): Promise<readonly PurgeCandidateRow[]> {
    return Promise.resolve(
      [...this.#rows.values()]
        .filter(
          (row) =>
            row.retainUntil !== undefined &&
            row.retainUntil <= asOf &&
            row.recordUri !== undefined,
        )
        .map((row) => ({
          runId: row.runId,
          recordUri: row.recordUri ?? null,
          retentionClass: row.retentionClass,
          retainUntil: row.retainUntil ?? null,
        })),
    );
  }

  /**
   * Mark a run's record as purged.
   *
   * The row's `recordUri` and `recordSha256` are **removed** rather than
   * set to `undefined`: the members are optional, and `exactOptionalPropertyTypes`
   * distinguishes "absent" from "present and undefined". A purged row has
   * no record — it does not have a record whose location is unknown.
   */
  public markPurged(runId: string): Promise<void> {
    const row = this.#rows.get(runId);
    if (row === undefined) {
      return Promise.resolve();
    }
    this.purged.push(runId);
    const { recordUri: _uri, recordSha256: _digest, ...rest } = row;
    void _uri;
    void _digest;
    this.#rows.set(runId, { ...rest, status: 'purged' });
    return Promise.resolve();
  }

  /**
   * The number of rows the double holds.
   */
  public get size(): number {
    return this.#rows.size;
  }
}
