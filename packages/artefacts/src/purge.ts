/**
 * `artefacts` — the **purge job**.
 *
 * checklist 03: "implement `retain_until` and a purge job that **never
 * touches `events`**."
 *
 * ## What the purge does
 *
 * For every row whose `retain_until` has passed:
 *
 * 1. **delete the object's bytes** from the object store;
 * 2. **mark the row** as purged.
 *
 * That is all. It does not delete a row, and it does not touch the event
 * log.
 *
 * ## Why it never touches `events`
 *
 * The event log is the factory's **source of truth** (blueprint 15 §3.1:
 * "The event log is the source of truth. The projections are disposable.").
 * Purging a run's artefact must not delete the events that reference it.
 *
 * The reason is not tidiness. An event *is* the record that something
 * happened — a decision, a tool call, an approval. A run whose events
 * have vanished is a run that looks like it never happened, and the audit
 * trail (element 9 of the record) would be hollow. The retention policy
 * governs **retained content** — prompts, code, generated text — not the
 * factory's history.
 *
 * So the property is **provable**: the job's only effect is on the object
 * store and on the row, and a test counts the events before and after.
 *
 * ## A failed delete does not mark the row
 *
 * If the object's bytes could not be deleted, the row is **not** marked
 * purged. Marking it would say "the content is gone" when it is still
 * there — and the next run of the job would skip it, because the row says
 * it is done. The job therefore **fails loudly** and leaves the row
 * eligible for the next pass.
 */

import type { ObjectStore, RunRecordStore } from './ports.js';
import { selectPurgeCandidates } from './retention.js';

/**
 * The result of one purge pass.
 */
export interface PurgeResult {
  /** The rows that were purged. */
  readonly purged: readonly string[];
  /** The rows that could not be purged, and why. */
  readonly failed: readonly { readonly runId: string; readonly reason: string }[];
}

/**
 * The options for a {@link PurgeJob}.
 */
export interface PurgeJobOptions {
  /** Where the records' bytes live. */
  readonly objectStore: ObjectStore;
  /** The `runs` index. */
  readonly runStore: RunRecordStore;
}

/**
 * The purge job.
 */
export class PurgeJob {
  readonly #objectStore: ObjectStore;
  readonly #runStore: RunRecordStore;

  constructor(options: PurgeJobOptions) {
    this.#objectStore = options.objectStore;
    this.#runStore = options.runStore;
  }

  /**
   * Run one purge pass.
   *
   * @param asOf the day to purge up to — an ISO date. A record whose
   * `retain_until` is **on** this day is purged: the last day of
   * retention is included, and the record goes after it.
   */
  public async purge(asOf: string): Promise<PurgeResult> {
    const rows = await this.#runStore.listPurgeCandidates(asOf);
    const candidates = selectPurgeCandidates(rows, asOf);

    const purged: string[] = [];
    const failed: { readonly runId: string; readonly reason: string }[] = [];

    for (const candidate of candidates) {
      try {
        await this.#objectStore.delete(this.#keyFor(candidate.recordUri));
        await this.#runStore.markPurged(candidate.runId);
        purged.push(candidate.runId);
      } catch (error) {
        // The bytes are still there, so the row is **not** marked. The
        // failure is reported and the row stays eligible for the next pass.
        failed.push({
          runId: candidate.runId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { purged, failed };
  }

  /**
   * The object key a record's URI names.
   *
   * The URI is `s3://<bucket>/<key>` (blueprint 15 §2.3), so the key is
   * everything after the bucket. The key is derived from the URI rather
   * than recomputed from the run id, because the URI is what the row
   * actually recorded — if they ever disagreed, the URI is the record's
   * own statement of where its bytes are.
   */
  #keyFor(recordUri: string): string {
    const withoutScheme = recordUri.replace(/^s3:\/\//, '');
    const slash = withoutScheme.indexOf('/');
    if (slash < 0) {
      return withoutScheme;
    }
    return withoutScheme.slice(slash + 1);
  }
}
