/**
 * The Postgres-backed invocation store.
 *
 * ## One transaction, for the row and the event
 *
 * blueprint 09 §6: "State transitions and their events are written in one
 * transaction." The same holds here for an invocation: the row in
 * `factory.tool_invocations` and the event that records it are written in
 * **one** transaction, so the event log can never claim a call the table
 * does not record.
 *
 * Splitting them would let the log and the table disagree — and the log is
 * the factory's single source of truth (blueprint 09 §5.2), so a
 * disagreement there is not a cosmetic bug.
 *
 * ## The idempotency key is a unique index
 *
 * The replay oracle is enforced by the **database**, not by the broker:
 * `tool_invocations.idempotency_key` is unique, so a second invocation
 * with the same key cannot be written. That is what makes the replay
 * *provable* against a real database rather than only against the
 * in-memory double.
 */

import type { NewEvent } from '@factory/contracts';
import { type FactoryDatabase, type Kysely, sql, type Transaction } from '@factory/db';
import { PostgresEventLog } from '@factory/eventlog';

import type { BrokerEvent, InvocationStore } from '../ports.js';
import type { InvocationRecord } from '../types.js';

/**
 * The options for a {@link PostgresInvocationStore}.
 */
export interface PostgresInvocationStoreOptions {
  /** The database handle. */
  readonly db: Kysely<FactoryDatabase>;
  /**
   * The event log to append to.
   *
   * It defaults to a `PostgresEventLog` over the same handle. A caller may
   * pass its own — one with a redaction policy, for instance.
   */
  readonly eventLog?: PostgresEventLog;
}

/**
 * The Postgres invocation store.
 */
export class PostgresInvocationStore implements InvocationStore {
  readonly #db: Kysely<FactoryDatabase>;
  readonly #eventLog: PostgresEventLog;

  constructor(options: PostgresInvocationStoreOptions) {
    this.#db = options.db;
    this.#eventLog = options.eventLog ?? new PostgresEventLog({ db: options.db });
  }

  /**
   * Write the invocation record and its event, in one transaction.
   */
  public async record(record: InvocationRecord, event: BrokerEvent): Promise<void> {
    await this.#db.transaction().execute(async (trx) => {
      await this.#insert(trx, record);
      await this.#append(trx, event);
    });
  }

  /**
   * The record for an idempotency key — the port's lookup.
   *
   * blueprint 11 §6.4: "a replayed key returns the **recorded** result."
   * So the lookup is what the broker consults to decide whether to replay.
   */
  public async findByKey(idempotencyKey: string): Promise<InvocationRecord | undefined> {
    return this.byKey(idempotencyKey);
  }

  /**
   * The record for an idempotency key.
   *
   * `undefined` when the key has not been used.
   */
  public async byKey(idempotencyKey: string): Promise<InvocationRecord | undefined> {
    const rows = await sql<{
      id: string;
      run_id: string | null;
      task_id: string;
      node_id: string | null;
      attempt: number;
      capability_id: string;
      effect_class: string;
      transport: string;
      args_sha256: Buffer;
      args_summary: unknown;
      result_summary: unknown;
      policy_decision_id: string | null;
      approval_id: string | null;
      status: string;
      idempotency_key: string;
      duration_ms: number | null;
      cost_usd_micros: number | null;
      started_at: Date;
    }>`
      SELECT * FROM factory.tool_invocations WHERE idempotency_key = ${idempotencyKey}
    `.execute(this.#db);

    const row = rows.rows[0];
    return row === undefined ? undefined : recordFrom(row);
  }

  /**
   * Insert the invocation row.
   */
  async #insert(
    trx: Transaction<FactoryDatabase>,
    record: InvocationRecord,
  ): Promise<void> {
    await sql`
      INSERT INTO factory.tool_invocations (
        id, run_id, task_id, node_id, attempt, capability_id, effect_class,
        transport, args_sha256, args_summary, result_summary,
        policy_decision_id, approval_id, status, idempotency_key,
        duration_ms, cost_usd_micros
      ) VALUES (
        ${record.invocationId},
        ${record.runId},
        ${record.taskId},
        ${record.nodeId},
        ${record.attempt},
        ${record.capabilityId},
        ${record.effectClass},
        ${record.transport},
        ${Buffer.from(record.argsSha256, 'hex')},
        ${JSON.stringify(record.argsSummary ?? null)}::jsonb,
        ${record.resultSummary === undefined ? null : JSON.stringify(record.resultSummary)}::jsonb,
        ${record.policyDecision === undefined ? null : record.policyDecision.outcome},
        ${record.approvalId ?? null},
        ${record.status},
        ${record.idempotencyKey},
        ${record.durationMs},
        ${record.costUsdMicros}
      )
    `.execute(trx);
  }

  /**
   * Append the event, inside the same transaction.
   */
  async #append(
    trx: Transaction<FactoryDatabase>,
    event: BrokerEvent,
  ): Promise<void> {
    const newEvent: NewEvent = {
      eventType: event.eventType,
      aggregate: event.aggregate,
      correlationId: event.correlationId,
      actor: event.actor,
      authority: event.authority,
      context: { items: [] },
      subject: event.subject ?? {},
      payload: event.payload,
      // The invocation row is not the event log's aggregate, so the event
      // does not bump an aggregate version: it records a call, it does not
      // change the task's state.
      bumpsVersion: false,
    };

    await this.#eventLog.appendInTransaction(trx, [newEvent]);
  }
}

/**
 * The row type the store reads.
 */
interface InvocationRow {
  readonly id: string;
  readonly run_id: string | null;
  readonly task_id: string;
  readonly node_id: string | null;
  readonly attempt: number;
  readonly capability_id: string;
  readonly effect_class: string;
  readonly transport: string;
  readonly args_sha256: Buffer;
  readonly args_summary: unknown;
  readonly result_summary: unknown;
  readonly policy_decision_id: string | null;
  readonly approval_id: string | null;
  readonly status: string;
  readonly idempotency_key: string;
  readonly duration_ms: number | null;
  readonly cost_usd_micros: number | null;
  readonly started_at: Date;
}

/**
 * Build an invocation record from a row.
 *
 * The `tool_invocations` table does not carry every field the broker's
 * record has — the capability's version and the actor, for instance — so
 * the record built here carries the table's fields and the rest as
 * undefined. The row is the **database's** record of the call; the
 * broker's richer record is what the in-memory store keeps.
 */
const recordFrom = (row: InvocationRow): InvocationRecord => ({
  invocationId: row.id,
  capabilityId: row.capability_id,
  capabilityVersion: '',
  transport: row.transport,
  runId: row.run_id ?? '',
  taskId: row.task_id,
  nodeId: row.node_id ?? '',
  attempt: row.attempt,
  grantId: '',
  argsSha256: row.args_sha256.toString('hex'),
  argsSummary: row.args_summary,
  ...(row.result_summary === null ? {} : { resultSummary: row.result_summary }),
  effectClass: row.effect_class as InvocationRecord['effectClass'],
  status: row.status as InvocationRecord['status'],
  idempotencyKey: row.idempotency_key,
  durationMs: row.duration_ms ?? 0,
  costUsdMicros: row.cost_usd_micros ?? 0,
  actor: { kind: 'system', id: 'factory' },
});
