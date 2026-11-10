/**
 * `artefacts` — the ports the store talks to.
 *
 * ## Why the package owns its own ports
 *
 * The store needs three things from the world: somewhere to put the
 * record's bytes, somewhere to put them when that place is down, and
 * somewhere to record the run's *index* row. Each has two
 * implementations — a real one and an in-memory one — and the store must
 * run against both without knowing which it has.
 *
 * pack 02 §4.11: "objects go to `runs/<runId>/…` in the object store;
 * Postgres `runs` indexes sha256 and cost."
 *
 * ## The object store is **injected**, never an SDK
 *
 * HR-6: no provider SDK. The S3 adapter takes an **injected HTTP
 * transport** — the same pattern T-1.10's provider adapters use — so the
 * adapter's *shape* (the key, the signing, the error handling) is proved
 * against a fake and no test touches the network.
 *
 * ## The spool is not a fallback that hides a failure
 *
 * pack 04 INT-08: "S3-compatible object store | … | `artefact.write` |
 * T-1.11 | **spool locally, then fail stage**".
 *
 * So when the object store is down, the record's bytes are written to the
 * **spool** — and the stage **fails**. The spool is where the bytes wait
 * to be retried; it is not a way to keep going as though the write
 * succeeded. The store returns a failure either way.
 */

import type { RunRecord } from './types.js';

/**
 * A place to put an object's bytes.
 *
 * The key is the object's path within the store — `runs/<runId>/record.json`.
 */
export interface ObjectStore {
  /**
   * Put an object's bytes.
   *
   * @param key the object's key.
   * @param bytes the object's content.
   * @returns where the object now lives.
   * @throws {ObjectStoreError} when the write fails. A failure is never a
   * silent success — the caller must know the bytes are not in the store.
   */
  put(key: string, bytes: Uint8Array): Promise<ObjectLocation>;

  /**
   * Get an object's bytes.
   *
   * @returns the bytes, or `undefined` when the object is absent.
   */
  get(key: string): Promise<Uint8Array | undefined>;

  /**
   * Delete an object's bytes.
   *
   * Deleting an absent object is **not** an error — the purge job may run
   * twice over the same row, and the second run must succeed.
   */
  delete(key: string): Promise<void>;
}

/**
 * Where an object lives.
 */
export interface ObjectLocation {
  /** The object's key. */
  readonly key: string;
  /** The object's full URI — `s3://<bucket>/runs/<runId>/record.json`. */
  readonly uri: string;
}

/**
 * A local spool — where an object's bytes wait when the store is down.
 */
export interface Spool {
  /**
   * Spool an object's bytes.
   *
   * @param key the object's key.
   * @param bytes the object's content.
   */
  spool(key: string, bytes: Uint8Array): Promise<void>;

  /**
   * The bytes spooled under a key.
   *
   * @returns the bytes, or `undefined` when nothing is spooled under it.
   */
  peek(key: string): Promise<Uint8Array | undefined>;

  /**
   * The keys currently spooled.
   */
  keys(): Promise<readonly string[]>;

  /**
   * Discard a spooled object — it was written to the store, or it is gone.
   */
  discard(key: string): Promise<void>;
}

/**
 * The **index** side of a record: the `runs` row.
 *
 * The row and the terminal event are written in one transaction, so a
 * completed run always has a complete artefact.
 */
export interface RunRecordStore {
  /**
   * Write the run's index row and its terminal event, **in one
   * transaction**.
   *
   * @param index the row's contents.
   */
  writeFinalised(index: RunIndexEntry): Promise<void>;

  /**
   * Write the run's index row **before** the run completes.
   *
   * This is the incremental side: the row exists from the start, with no
   * `record_uri` and no `record_sha256`, and it is updated when the record
   * is finalised.
   */
  writeStarted(index: RunIndexEntry): Promise<void>;

  /**
   * The index row for a run.
   *
   * @returns the row, or `undefined` when the run is unknown.
   */
  find(runId: string): Promise<RunIndexEntry | undefined>;

  /**
   * The rows that are due for purging.
   *
   * @param asOf the day to purge up to.
   */
  listPurgeCandidates(asOf: string): Promise<readonly PurgeCandidateRow[]>;

  /**
   * Mark a run's record as purged.
   *
   * The row is **marked**, not deleted: the run still happened, and the
   * `runs` table is the index of what happened. What is gone is the
   * object's bytes.
   */
  markPurged(runId: string): Promise<void>;
}

/**
 * The `runs` row's contents.
 */
export interface RunIndexEntry {
  /** The run's id. */
  readonly runId: string;
  /** The task the run serves. */
  readonly taskId: string;
  /** The node the run executed, when it executed one. */
  readonly nodeId?: string;
  /** The attempt number. */
  readonly attempt: number;
  /** The role the run played. */
  readonly role: string;
  /** The stage kind the run executed. */
  readonly stageKind: string;
  /** The executor kind — `deterministic`, `completion`, `harness`, `human`. */
  readonly executorKind: string;
  /** The route the gateway took. */
  readonly route?: unknown;
  /** The run's status. */
  readonly status: string;
  /** The run's outcome. */
  readonly outcome?: string;
  /** The failure's class. */
  readonly failureClass?: string;
  /** When the run started. */
  readonly startedAt: string;
  /** When the run ended. */
  readonly endedAt?: string;
  /** Where the record's object lives — absent until the record is written. */
  readonly recordUri?: string;
  /** The record's content hash — absent until the record is written. */
  readonly recordSha256?: string;
  /** The context envelope the run used. */
  readonly contextEnvelopeId?: string;
  /** The run's cost, in integer micro-USD. */
  readonly costUsdMicros: number;
  /** The run's token counts. */
  readonly tokens: unknown;
  /** The record's retention class. */
  readonly retentionClass: string;
  /** The date the record is retained until. */
  readonly retainUntil?: string;
}

/**
 * A row the purge job may act on.
 */
export interface PurgeCandidateRow {
  readonly runId: string;
  readonly recordUri: string | null;
  readonly retentionClass: string;
  readonly retainUntil: string | null;
}

/**
 * Where the store's events go.
 *
 * The terminal event is written in the same transaction as the `runs` row,
 * so the sink takes a transaction handle.
 */
export interface ArtefactEventSink {
  /**
   * Append the run's terminal event, inside a transaction.
   *
   * The event types are registered in the contracts: `run.started`,
   * `run.completed`, `stage.failed`.
   */
  appendTerminal(event: ArtefactEvent): Promise<void>;
}

/**
 * An event the artefacts package emits.
 *
 * The envelope is the contracts' shape; the payloads here are the two
 * the artefacts package owns.
 */
export interface ArtefactEvent {
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Raised when the object store cannot hold an object's bytes.
 *
 * A distinct type so the store can tell "the store is down" (spool it)
 * from "the bytes were rejected" (fail the stage either way, but say so).
 */
export class ObjectStoreError extends Error {
  /** Whether retrying might succeed. */
  public readonly retriable: boolean;

  constructor(message: string, retriable = true) {
    super(message);
    this.name = 'ObjectStoreError';
    this.retriable = retriable;
  }
}

/**
 * Raised when a record is not complete and cannot be finalised.
 */
export class IncompleteRecordError extends Error {
  /** The elements that were missing or empty. */
  public readonly missing: readonly string[];

  constructor(message: string, missing: readonly string[]) {
    super(message);
    this.name = 'IncompleteRecordError';
    this.missing = missing;
  }
}

/**
 * The record writer's result for one run.
 */
export interface FinaliseResult {
  /** The run's id. */
  readonly runId: string;
  /** Where the record's object lives. */
  readonly recordUri: string;
  /** The record's content hash. */
  readonly recordSha256: string;
  /** The record itself. */
  readonly record: RunRecord;
}
