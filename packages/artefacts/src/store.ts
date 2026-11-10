/**
 * `artefacts` — the **record writer**.
 *
 * This is the thing the ticket asks for: "12-element record writer
 * (incremental, atomic with outcome)".
 *
 * ## The four rules it implements
 *
 * blueprint 15 §2.4:
 *
 * | Rule | How this module honours it |
 * |---|---|
 * | **Framework-emitted** | The writer takes what the framework observed. It never asks an agent for anything, and it never lets a caller name an element the framework did not measure. |
 * | **Atomic with the outcome** | The row and the terminal event are written in **one transaction**. The object is written **first**; the row's `record_uri`/`record_sha256` are what make it reachable. A run whose object write failed has **no row** — so a completed run always has a complete artefact. |
 * | **Incremental** | Partial records are written during the run, so a killed run still leaves a record. |
 * | **Redacted at capture** | The redaction happens **before** the bytes are written, so the stored bytes never held a secret. |
 *
 * ## Why "atomic with the outcome" needs a definition
 *
 * blueprint 15 §2.4 says: "The artefact's final state and the terminal
 * event are written in one transaction, so a completed run always has a
 * complete artefact."
 *
 * An S3 object cannot join a Postgres transaction. So "one transaction" is
 * impossible *literally*. The honest resolution keeps the **property the
 * rule protects**:
 *
 * * the **row** and the **terminal event** are written in one transaction;
 * * the **object** is written first, and the row names it;
 * * a run whose object write failed gets **no row** — so there is no
 *   completed run without a complete artefact.
 *
 * The alternative — writing the row first and the object after — would
 * produce a completed run whose artefact is missing, which is exactly
 * the failure the rule forbids.
 *
 * ## The spool-then-fail path
 *
 * pack 04 INT-08: "spool locally, then fail stage."
 *
 * When the object store is down, the bytes go to the **spool** so they are
 * not lost, and the stage **fails**. The writer never reports success for
 * a record it could not put in the store — a record that is "written" but
 * not stored is a lie the factory would later audit and find.
 */

import { canonicalJsonOfUnknown, sha256 } from '@factory/core';

import { assertComplete, incompletenessMessage } from './completeness.js';
import { buildRecord } from './record.js';
import { expiryFor, retainUntilDate } from './retention.js';
import {
  IncompleteRecordError,
  type FinaliseResult,
  type ObjectStore,
  type RunIndexEntry,
  type RunRecordStore,
  type Spool,
} from './ports.js';
import type { RecordParts, PartialRunRecord } from './record.js';
import type { RetentionClass } from './types.js';

/**
 * The options for a {@link RunArtifactStore}.
 */
export interface RunArtifactStoreOptions {
  /** Where the record's bytes go. */
  readonly objectStore: ObjectStore;
  /** Where the bytes go when the store is down. */
  readonly spool: Spool;
  /** The `runs` index. */
  readonly runStore: RunRecordStore;
}

/**
 * The key a run's record is stored under.
 *
 * pack 02 §4.11: "objects go to `runs/<runId>/…` in the object store".
 *
 * The key is a **function of the run id alone**, so the same run always
 * writes to the same key — which is what makes the incremental writes
 * overwrite each other rather than accumulate, and what makes a purge
 * able to find the object without an index of its own.
 */
export const recordKey = (runId: string): string => `runs/${runId}/record.json`;

/**
 * The **run-artefact store** — the writer.
 */
export class RunArtifactStore {
  readonly #objectStore: ObjectStore;
  readonly #spool: Spool;
  readonly #runStore: RunRecordStore;

  constructor(options: RunArtifactStoreOptions) {
    this.#objectStore = options.objectStore;
    this.#spool = options.spool;
    this.#runStore = options.runStore;
  }

  /**
   * Write a **partial** record, during the run.
   *
   * blueprint 15 §2.4: "Incremental | Partial artefacts are written during
   * the run, so a killed run still leaves a record."
   *
   * A partial write is **best-effort by design**: the run is still going,
   * and a failure to write a partial record must not fail the run — the
   * run's *final* write is the one that matters. But a failure is still
   * **reported**, so a caller that cares can see it.
   *
   * @param partial the record so far.
   * @returns whether the partial record was written.
   */
  public async writePartial(partial: PartialRunRecord): Promise<boolean> {
    const key = recordKey(partial.runId);
    const bytes = this.#serialise(partial);

    try {
      await this.#objectStore.put(key, bytes);
      return true;
    } catch {
      // The partial record is spooled rather than lost, and the failure is
      // reported by the return value. A run that is killed before it
      // reaches the store still leaves evidence.
      await this.#spool.spool(key, bytes);
      return false;
    }
  }

  /**
   * Finalise a run's record: assemble it, assert it is complete, write it,
   * and index it.
   *
   * The order is the rule:
   *
   * 1. **assemble** the record and compute its hash;
   * 2. **assert completeness** — an incomplete record is refused, and
   *    nothing is written;
   * 3. **write the object** — first, so the row can name it;
   * 4. **write the row and the terminal event, in one transaction** —
   *    the outcome and the artefact become visible together.
   *
   * @param parts the observed facts.
   * @param index the `runs` row's contents.
   * @param retentionClass the record's retention class.
   * @param expiry the record's expiry instant, when the class has no
   *   default period.
   */
  public async finalise(
    parts: RecordParts,
    index: RunIndexEntry,
    retentionClass: RetentionClass,
    expiry?: Date,
  ): Promise<FinaliseResult> {
    // ---- 1. assemble -------------------------------------------------------
    const retentionExpiry = expiry ?? expiryFor(retentionClass, new Date(parts.completedAt));
    if (retentionExpiry === undefined) {
      throw new IncompleteRecordError(
        `the retention class "${retentionClass}" has no default period; the expiry must be supplied`,
        ['retention'],
      );
    }

    const record = buildRecord({
      ...parts,
      retention: {
        class: retentionClass,
        expiresAt: retentionExpiry.toISOString(),
      },
    });

    // ---- 2. assert completeness -------------------------------------------
    const report = assertComplete(record);
    if (!report.complete) {
      throw new IncompleteRecordError(incompletenessMessage(report), report.missing);
    }

    // ---- 3. write the object ----------------------------------------------
    const key = recordKey(record.identity.runId);
    const bytes = this.#serialise(record);

    try {
      const location = await this.#objectStore.put(key, bytes);
      const recordUri = location.uri;

      // ---- 4. write the row and the terminal event, in one transaction -----
      await this.#runStore.writeFinalised({
        ...index,
        recordUri,
        recordSha256: record.sha256,
        retentionClass,
        retainUntil: retainUntilDate(retentionExpiry),
      });

      return {
        runId: record.identity.runId,
        recordUri,
        recordSha256: record.sha256,
        record,
      };
    } catch (error) {
      // The object could not be stored. The bytes are spooled so they are
      // not lost, and the stage **fails** — pack 04 INT-08: "spool locally,
      // then fail stage". No row is written, so there is no completed run
      // without a complete artefact.
      await this.#spool.spool(key, bytes);
      throw error;
    }
  }

  /**
   * The bytes a record is stored as.
   *
   * Canonical JSON, so the stored bytes are **reproducible**: the same
   * record hashes to the same digest and stores to the same bytes, which
   * is what makes the hash verifiable against the object.
   */
  #serialise(value: unknown): Uint8Array {
    return new TextEncoder().encode(canonicalJsonOfUnknown(value));
  }
}

/**
 * The digest of a record's **stored bytes**.
 *
 * The record's own `sha256` member is the digest of its *content*; this is
 * the digest of the *bytes*. They are the same value when the bytes are
 * canonical JSON of the content — and that equality is what the
 * verification asserts.
 */
export const storedBytesDigest = (bytes: Uint8Array): string => sha256(bytes);
