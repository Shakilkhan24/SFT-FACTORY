/**
 * `gateway` — the Postgres-backed model call store.
 *
 * ## One transaction, for the row and the event
 *
 * blueprint 09 §6: "State transitions and their events are written in
 * one transaction." The same holds here — a `model_calls` row and the
 * `model.requested` event that records it are written in **one**
 * transaction, so the event log can never claim a call the table does
 * not record.
 *
 * The event log is the factory's single source of truth (blueprint 09
 * §5.2), so a disagreement there is not a cosmetic bug.
 *
 * ## The idempotency key is a unique index
 *
 * `model_calls.idempotency_key` is `UNIQUE` in the DDL, so a second
 * call with the same key cannot be written. That is what makes the
 * replay oracle **provable against a real database** rather than only
 * against the in-memory double.
 */

import type { NewEvent } from '@factory/contracts';
import { type FactoryDatabase, type Kysely, sql, type Transaction } from '@factory/db';
import { PostgresEventLog } from '@factory/eventlog';

import type { ModelCallStore } from '../ports.js';
import type { GatewayEvent, ModelCallRecord } from '../types.js';

/**
 * The options for a {@link PostgresModelCallStore}.
 */
export interface PostgresModelCallStoreOptions {
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
 * The Postgres model call store.
 */
export class PostgresModelCallStore implements ModelCallStore {
  readonly #db: Kysely<FactoryDatabase>;
  readonly #eventLog: PostgresEventLog;

  constructor(options: PostgresModelCallStoreOptions) {
    this.#db = options.db;
    this.#eventLog = options.eventLog ?? new PostgresEventLog({ db: options.db });
  }

  /**
   * Write the call and its event, in one transaction.
   */
  public async record(record: ModelCallRecord, event: GatewayEvent): Promise<void> {
    await this.#db.transaction().execute(async (trx) => {
      await this.#insert(trx, record);
      await this.#append(trx, record, event);
    });
  }

  /**
   * The call recorded for an idempotency key.
   *
   * @returns the record, or `undefined` when the key has not been used.
   */
  public async findByKey(idempotencyKey: string): Promise<ModelCallRecord | undefined> {
    const rows = await sql<ModelCallRow>`
      SELECT * FROM factory.model_calls WHERE idempotency_key = ${idempotencyKey}
    `.execute(this.#db);

    const row = rows.rows[0];
    return row === undefined ? undefined : recordFrom(row);
  }

  /**
   * Insert the call row.
   */
  async #insert(
    trx: Transaction<FactoryDatabase>,
    record: ModelCallRecord,
  ): Promise<void> {
    await sql`
      INSERT INTO factory.model_calls (
        id, run_id, task_id, provider, model, route_rule, prompt_sha256,
        tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
        cost_usd_micros, latency_ms, status, cached, via, idempotency_key
      ) VALUES (
        ${record.id},
        ${record.runId ?? null},
        ${record.taskId},
        ${record.provider},
        ${record.model},
        ${record.routeRule ?? null},
        ${record.promptSha256 === undefined ? null : Buffer.from(record.promptSha256, 'hex')},
        ${record.tokens.tokensIn},
        ${record.tokens.tokensOut},
        ${record.tokens.cacheRead},
        ${record.tokens.cacheWrite},
        ${record.costUsdMicros},
        ${record.latencyMs ?? null},
        ${record.status},
        ${record.cached},
        ${record.via},
        ${record.idempotencyKey}
      )
    `.execute(trx);
  }

  /**
   * Append the event, inside the same transaction.
   */
  async #append(
    trx: Transaction<FactoryDatabase>,
    record: ModelCallRecord,
    event: GatewayEvent,
  ): Promise<void> {
    const newEvent: NewEvent = {
      eventType: event.eventType,
      // The model call belongs to the **task**. The task's aggregate is
      // the one the event log can version and chain.
      //
      // The `version` is `0` because the event does **not** bump the
      // task's version — a model call records work, it does not change
      // the task's state. The broker's invocation events do the same.
      aggregate: { kind: 'task', id: record.taskId, version: 0 },
      correlationId: record.idempotencyKey,
      actor: {
        kind: 'system',
        id: 'gateway',
        model: { provider: record.provider, model: record.model },
      },
      authority: { basis: 'system-rule' },
      context: { items: [] },
      subject: {},
      payload: event.payload,
      // The call row is not the event log's aggregate, so the event does
      // not bump the task's version: it records a call, it does not
      // change the task's state.
      bumpsVersion: false,
      ...(event.costUsdMicros === undefined
        ? {}
        : { costUsdMicros: event.costUsdMicros }),
    };

    await this.#eventLog.appendInTransaction(trx, [newEvent]);
  }
}

/**
 * The row type the store reads.
 */
interface ModelCallRow {
  readonly id: string;
  readonly run_id: string | null;
  readonly task_id: string;
  readonly provider: string;
  readonly model: string;
  readonly route_rule: string | null;
  readonly prompt_sha256: Buffer | null;
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
  readonly tokens_cache_read: number | null;
  readonly tokens_cache_write: number | null;
  readonly cost_usd_micros: string | number;
  readonly latency_ms: number | null;
  readonly status: string;
  readonly cached: boolean;
  readonly via: 'complete' | 'passthrough';
  readonly idempotency_key: string;
}

/**
 * Read a row into a record.
 */
const recordFrom = (row: ModelCallRow): ModelCallRecord => ({
  id: row.id,
  ...(row.run_id === null ? {} : { runId: row.run_id }),
  taskId: row.task_id,
  provider: row.provider,
  model: row.model,
  ...(row.route_rule === null ? {} : { routeRule: row.route_rule }),
  ...(row.prompt_sha256 === null
    ? {}
    : { promptSha256: row.prompt_sha256.toString('hex') }),
  tokens: {
    tokensIn: row.tokens_in ?? 0,
    tokensOut: row.tokens_out ?? 0,
    cacheRead: row.tokens_cache_read ?? 0,
    cacheWrite: row.tokens_cache_write ?? 0,
  },
  costUsdMicros: Number(row.cost_usd_micros),
  ...(row.latency_ms === null ? {} : { latencyMs: row.latency_ms }),
  status: row.status,
  cached: row.cached,
  via: row.via,
  idempotencyKey: row.idempotency_key,
});
