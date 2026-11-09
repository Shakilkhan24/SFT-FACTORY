/**
 * The Postgres-backed {@link StateMachineStore}.
 *
 * This is where the machine meets the database. Two things happen here that
 * the pure parts cannot do:
 *
 * 1. **The row lock.** `SELECT ... FOR UPDATE` on the task row. The ticket's
 *    algorithm puts the lock first: "lock the aggregate row → check
 *    `(from,to)` is allowed → …". Taking it here, in the store, means every
 *    caller gets it by construction rather than by remembering.
 *
 * 2. **One transaction for the state change and the event.** The `UPDATE
 *    tasks` and the `append` share a transaction, so a failure in either
 *    rolls back both. blueprint `09` §6: "State transitions and their events
 *    are written in one transaction."
 *
 * ## Why this file is not in `packages/state`
 *
 * pack 02 §3: "`policy`, `state`, `context`(assembler), `review`(scorer,
 * panel), `merge`(rules) are **pure**: no `node:fs/net/child_process`, no
 * `pg`, no network, no clock/randomness except injected".
 *
 * `packages/state` holds the machine — the tables, the guards, and
 * `transition()` — and the machine talks to storage through an interface
 * (`StateMachineStore`). This file is the Postgres implementation of that
 * interface, and it lives here because `orchestrator` "may import
 * everything except apps" while `state` may import nothing that touches a
 * database.
 *
 * The split is not a convenience. It is what makes the guards testable: the
 * machine can be driven against an in-memory store with no database at all,
 * and the property tests do exactly that.
 */

import type { EventEnvelope, NewEvent, TaskState } from '@factory/contracts';
import { type FactoryDatabase, type Kysely, sql, type Transaction } from '@factory/db';
import { PostgresEventLog } from '@factory/eventlog';
import type {
  LockedTaskContext,
  StateMachineStore,
} from '@factory/state';

export type {
  LockedTaskContext,
  StateMachineStore,
  TransitionOutcome,
  TransitionRequest,
} from '@factory/state';

/**
 * The options for a {@link PostgresStateMachineStore}.
 */
export interface PostgresStateMachineStoreOptions {
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
 * The row the lock reads.
 */
interface LockedTaskRow {
  readonly id: string;
  readonly state: string;
  readonly version: number;
  readonly autonomy_level: number;
}

/**
 * A `StateMachineStore` against Postgres.
 */
export class PostgresStateMachineStore implements StateMachineStore {
  private readonly db: Kysely<FactoryDatabase>;
  private readonly eventLog: PostgresEventLog;

  public constructor(options: PostgresStateMachineStoreOptions) {
    this.db = options.db;
    this.eventLog = options.eventLog ?? new PostgresEventLog({ db: options.db });
  }

  /**
   * Run `body` with the task row locked.
   *
   * The whole body is one transaction. If `body` throws, the transaction
   * rolls back — including any state change it made — and the lock is
   * released.
   */
  public async withLockedTask<T>(
    taskId: string,
    body: (context: LockedTaskContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      // The lock. `FOR UPDATE` blocks until every other holder of this row
      // has released it, so the read-check-write below is serialised against
      // every other transition of the same task.
      const rows = await sql<LockedTaskRow>`
        SELECT id, state, version, autonomy_level
        FROM factory.tasks
        WHERE id = ${taskId}
        FOR UPDATE
      `.execute(trx);

      const row = rows.rows[0];
      if (row === undefined) {
        throw new Error(`task ${taskId} does not exist`);
      }

      const context = this.makeContext(trx, {
        id: row.id,
        state: row.state,
        version: Number(row.version),
        autonomy_level: Number(row.autonomy_level),
      });

      return body(context);
    });
  }

  /**
   * Append the refusal event in its own transaction.
   *
   * The refusal must be durable even though the transition it records was
   * refused — that is the point of a `policy.denied` event. And it must not
   * change the task's state, so it is written separately from the (rolled
   * back) transition transaction.
   */
  public async appendRefusal(events: readonly NewEvent[]): Promise<void> {
    await this.eventLog.append(events);
  }

  /**
   * Build the context for a locked task.
   */
  private makeContext(
    trx: Transaction<FactoryDatabase>,
    row: LockedTaskRow,
  ): LockedTaskContext {
    // The version the task is at right now. The state change and the event
    // log's CAS both key off it.
    let currentVersion = row.version;

    return {
      state: row.state as TaskState,
      version: row.version,
      autonomyLevel: row.autonomy_level,

      updateState: async (to: TaskState): Promise<void> => {
        // The **state** is set here; the **version** is bumped by the event
        // log's CAS, in the same transaction.
        //
        // The split is deliberate. The event log's CAS is the optimistic
        // concurrency check blueprint `09` §6 asks for ("optimistic
        // concurrency on `aggregate.version`; one writer wins"), and it
        // already reads and bumps the row correctly. If this statement
        // bumped the version too, the task's version would advance twice per
        // transition and the caller's `expectedVersion` would be wrong by
        // one on the next call.
        //
        // The `WHERE version = ...` clause is the second line of defence
        // against a concurrent write. The row lock already prevents one,
        // but the clause makes the check explicit at the database level.
        const updated = await sql<{ version: number }>`
          UPDATE factory.tasks
          SET state = ${to},
              updated_at = now(),
              terminal_at = CASE WHEN ${to} IN ('MERGED','DEPLOYED','REJECTED','FAILED','ABANDONED','INCOMPLETE')
                                 THEN now() ELSE terminal_at END
          WHERE id = ${row.id} AND version = ${currentVersion}
          RETURNING version
        `.execute(trx);

        const next = updated.rows[0];
        if (next === undefined) {
          throw new Error(
            `task ${row.id} changed under the lock: expected version ${String(currentVersion)}`,
          );
        }
      },

      append: async (events: readonly NewEvent[]): Promise<readonly EventEnvelope[]> => {
        // `appendInTransaction` — the event goes into the *same* transaction
        // as the state change, so the two cannot be separated.
        //
        // `expectedVersions` tells the event log which version the row is at,
        // so its CAS is a real check rather than an unconditional bump. The
        // event carries `bumpsVersion: true`, which is what makes the log
        // bump `tasks.version` from `currentVersion` to `currentVersion + 1`
        // — exactly one bump per transition.
        const envelopes = await this.eventLog.appendInTransaction(
          trx,
          events.map((event) => ({ ...event, bumpsVersion: true })),
          { expectedVersions: { [`task:${row.id}`]: currentVersion } },
        );

        // The event log's bump is now the row's version.
        currentVersion += 1;

        return envelopes;
      },
    };
  }
}
