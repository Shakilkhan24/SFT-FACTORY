/**
 * `artefacts` — the Postgres-backed `runs` index.
 *
 * ## What the row is
 *
 * The `runs` table (`migrations/0001_core.sql:118`) is the **index**
 * side of a record: `record_uri`, `record_sha256`, `retention_class`,
 * `retain_until`, `cost_usd_micros`, `tokens`. The record's *bytes* live
 * in the object store; the row says where they are and what they hash to.
 *
 * pack 02 §4.11: "objects go to `runs/<runId>/…` in the object store;
 * Postgres `runs` indexes sha256 and cost."
 *
 * ## The row and the terminal event are in **one transaction**
 *
 * blueprint 15 §2.4: "The artefact's final state and the terminal event
 * are written in one transaction, so a completed run always has a
 * complete artefact."
 *
 * The event log is the factory's **source of truth** (blueprint 15 §3.1),
 * so a row without its terminal event — or an event without its row — is
 * a disagreement in the source of truth. Both are written together.
 *
 * ## The purge marks the row; it does not delete it
 *
 * The run **happened**. The `runs` table is the index of what happened,
 * and the artefact's *bytes* are what the purge removes. Deleting the row
 * would erase the fact that the run existed, which is a different thing
 * from removing its retained content.
 *
 * And the purge **never touches `events`** — the events that reference a
 * purged run stay, because the event log is the source of truth and a
 * record whose events have vanished looks like a run that never happened.
 */

import type { NewEvent } from '@factory/contracts';
import { type FactoryDatabase, type Kysely, sql, type Transaction } from '@factory/db';
import { PostgresEventLog } from '@factory/eventlog';

import type {
  PurgeCandidateRow,
  RunIndexEntry,
  RunRecordStore,
} from '../ports.js';

/**
 * The options for a {@link PostgresRunRecordStore}.
 */
export interface PostgresRunRecordStoreOptions {
  /** The database handle. */
  readonly db: Kysely<FactoryDatabase>;
  /**
   * The event log to append to.
   *
   * Defaults to a `PostgresEventLog` over the same handle. A caller may
   * pass its own — one with a redaction policy, for instance.
   */
  readonly eventLog?: PostgresEventLog;
}

/**
 * The Postgres run-record store.
 */
export class PostgresRunRecordStore implements RunRecordStore {
  readonly #db: Kysely<FactoryDatabase>;
  readonly #eventLog: PostgresEventLog;

  constructor(options: PostgresRunRecordStoreOptions) {
    this.#db = options.db;
    this.#eventLog = options.eventLog ?? new PostgresEventLog({ db: options.db });
  }

  /**
   * Write the run's index row and its terminal event, in one transaction.
   */
  public async writeFinalised(index: RunIndexEntry): Promise<void> {
    await this.#db.transaction().execute(async (trx) => {
      await this.#upsert(trx, index);
      await this.#appendTerminal(trx, index);
    });
  }

  /**
   * Write the run's index row **before** the run completes.
   *
   * The incremental side: the row exists from the start, with no
   * `record_uri` and no `record_sha256`, and it is updated when the record
   * is finalised.
   */
  public async writeStarted(index: RunIndexEntry): Promise<void> {
    await this.#db.transaction().execute(async (trx) => {
      await this.#upsert(trx, index);
    });
  }

  /**
   * The index row for a run.
   */
  public async find(runId: string): Promise<RunIndexEntry | undefined> {
    const rows = await sql<RunRow>`
      SELECT * FROM factory.runs WHERE run_id = ${runId}
    `.execute(this.#db);

    const row = rows.rows[0];
    return row === undefined ? undefined : indexFrom(row);
  }

  /**
   * The rows that are due for purging.
   */
  public async listPurgeCandidates(asOf: string): Promise<readonly PurgeCandidateRow[]> {
    const rows = await sql<PurgeRow>`
      SELECT run_id, record_uri, retention_class, retain_until
      FROM factory.runs
      WHERE retain_until IS NOT NULL
        AND retain_until <= ${asOf}
        AND record_uri IS NOT NULL
        AND status <> 'purged'
      ORDER BY run_id
    `.execute(this.#db);

    return rows.rows.map((row) => ({
      runId: row.run_id,
      recordUri: row.record_uri,
      retentionClass: row.retention_class,
      retainUntil: row.retain_until === null ? null : String(row.retain_until).slice(0, 10),
    }));
  }

  /**
   * Mark a run's record as purged.
   *
   * The row is **marked**, not deleted: the run still happened. What is
   * gone is the object's bytes.
   */
  public async markPurged(runId: string): Promise<void> {
    await sql`
      UPDATE factory.runs
      SET status = 'purged', record_uri = NULL, record_sha256 = NULL
      WHERE run_id = ${runId}
    `.execute(this.#db);
  }

  /**
   * Write the row.
   *
   * An **upsert**: the row may already exist from the incremental write, and
   * the finalisation updates it rather than failing on the primary key.
   */
  async #upsert(trx: Transaction<FactoryDatabase>, index: RunIndexEntry): Promise<void> {
    await sql`
      INSERT INTO factory.runs (
        run_id, task_id, node_id, attempt, role, stage_kind, executor_kind,
        route, status, outcome, failure_class, started_at, ended_at,
        record_uri, record_sha256, context_envelope_id, cost_usd_micros,
        tokens, retention_class, retain_until
      ) VALUES (
        ${index.runId},
        ${index.taskId},
        ${index.nodeId ?? null},
        ${index.attempt},
        ${index.role},
        ${index.stageKind},
        ${index.executorKind},
        ${index.route === undefined ? null : JSON.stringify(index.route)}::jsonb,
        ${index.status},
        ${index.outcome ?? null},
        ${index.failureClass ?? null},
        ${index.startedAt},
        ${index.endedAt ?? null},
        ${index.recordUri ?? null},
        ${index.recordSha256 === undefined ? null : Buffer.from(index.recordSha256.replace(/^sha256:/, ''), 'hex')},
        ${index.contextEnvelopeId ?? null},
        ${index.costUsdMicros},
        ${JSON.stringify(index.tokens)}::jsonb,
        ${index.retentionClass},
        ${index.retainUntil ?? null}
      )
      ON CONFLICT (run_id) DO UPDATE SET
        status = EXCLUDED.status,
        outcome = EXCLUDED.outcome,
        failure_class = EXCLUDED.failure_class,
        ended_at = EXCLUDED.ended_at,
        record_uri = EXCLUDED.record_uri,
        record_sha256 = EXCLUDED.record_sha256,
        context_envelope_id = EXCLUDED.context_envelope_id,
        cost_usd_micros = EXCLUDED.cost_usd_micros,
        tokens = EXCLUDED.tokens,
        retention_class = EXCLUDED.retention_class,
        retain_until = EXCLUDED.retain_until
    `.execute(trx);
  }

  /**
   * Append the terminal event, inside the same transaction.
   *
   * The event type is `stage.completed` or `stage.failed` — the two
   * registered terminal events for a stage execution (pack 03 §5). The
   * record's location and digest are **not** in the payload: the payload
   * schemas are `.strict()`, so an extra member is a validation failure.
   * The digest lives in the row, and the row is the index.
   */
  async #appendTerminal(
    trx: Transaction<FactoryDatabase>,
    index: RunIndexEntry,
  ): Promise<void> {
    const failed = index.outcome === 'failure';

    const newEvent: NewEvent = {
      eventType: failed ? 'stage.failed' : 'stage.completed',
      aggregate: { kind: 'task', id: index.taskId, version: 0 },
      correlationId: index.runId,
      actor: { kind: 'system', id: 'artefacts' },
      authority: { basis: 'system-rule' },
      context: { items: [] },
      subject: {},
      payload: failed
        ? {
            runId: index.runId,
            failureClass: index.failureClass ?? 'unknown',
            retriable: false,
          }
        : {
            runId: index.runId,
            nodeId: index.nodeId ?? index.runId,
            outcome: index.outcome === 'incomplete' ? 'incomplete' : 'success',
            artefactRefs:
              index.recordUri === undefined ? [] : [index.recordUri],
          },
      bumpsVersion: false,
      ...(index.costUsdMicros === undefined
        ? {}
        : { costUsdMicros: index.costUsdMicros }),
    };

    await this.#eventLog.appendInTransaction(trx, [newEvent]);
  }
}

/**
 * The row type the purge query reads.
 */
interface PurgeRow {
  readonly run_id: string;
  readonly record_uri: string | null;
  readonly retention_class: string;
  readonly retain_until: Date | string | null;
}

/**
 * The row type the store reads.
 */
interface RunRow {
  readonly run_id: string;
  readonly task_id: string;
  readonly node_id: string | null;
  readonly attempt: number;
  readonly role: string;
  readonly stage_kind: string;
  readonly executor_kind: 'deterministic' | 'completion' | 'harness' | 'human';
  readonly route: unknown;
  readonly status: string;
  readonly outcome: string | null;
  readonly failure_class: string | null;
  readonly started_at: Date;
  readonly ended_at: Date | null;
  readonly record_uri: string | null;
  readonly record_sha256: Buffer | null;
  readonly context_envelope_id: string | null;
  readonly cost_usd_micros: string | number;
  readonly tokens: unknown;
  readonly retention_class: string;
  readonly retain_until: Date | string | null;
}

/**
 * Read a row into an index entry.
 */
const indexFrom = (row: RunRow): RunIndexEntry => ({
  runId: row.run_id,
  taskId: row.task_id,
  ...(row.node_id === null ? {} : { nodeId: row.node_id }),
  attempt: row.attempt,
  role: row.role,
  stageKind: row.stage_kind,
  executorKind: row.executor_kind,
  ...(row.route === null ? {} : { route: row.route }),
  status: row.status,
  ...(row.outcome === null ? {} : { outcome: row.outcome }),
  ...(row.failure_class === null ? {} : { failureClass: row.failure_class }),
  startedAt: new Date(row.started_at).toISOString(),
  ...(row.ended_at === null ? {} : { endedAt: new Date(row.ended_at).toISOString() }),
  ...(row.record_uri === null ? {} : { recordUri: row.record_uri }),
  ...(row.record_sha256 === null
    ? {}
    : { recordSha256: `sha256:${row.record_sha256.toString('hex')}` }),
  ...(row.context_envelope_id === null ? {} : { contextEnvelopeId: row.context_envelope_id }),
  costUsdMicros: Number(row.cost_usd_micros),
  tokens: row.tokens,
  retentionClass: row.retention_class,
  ...(row.retain_until === null
    ? {}
    : { retainUntil: String(row.retain_until).slice(0, 10) }),
});
