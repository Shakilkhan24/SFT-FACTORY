/**
 * The Postgres-backed {@link JobQueue}.
 *
 * This is where pack 02 §4.8's algorithm lives in SQL:
 *
 * > claim with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)
 * > RETURNING *`
 *
 * ## Why `SKIP LOCKED`
 *
 * Without it, a second worker claiming while the first holds the row lock
 * would **block** until the first committed. That serialises the queue: one
 * worker at a time, no matter how many are free. `SKIP LOCKED` says "if that
 * row is locked, give me a different one" — the work is *skipped*, not
 * *waited on*, so N workers pull N different rows concurrently.
 *
 * The `LIMIT 1` is inside the subquery, so the lock is taken on exactly one
 * candidate row, not on the whole result set.
 *
 * ## The once-ness of the reaper
 *
 * The reaper must re-queue an expired lease **once**. The reaper selects the
 * expired leases under a row lock (`FOR UPDATE OF j SKIP LOCKED`) and then
 * updates exactly those rows. The `status = 'leased'` clause is what makes
 * it *once*: the re-queue flips the row out of `leased`, so a second reap of
 * the same lease finds nothing to select.
 *
 * ## Why the claim checks the cap
 *
 * The cap check lives **inside** the claim's transaction, not before it. A
 * separate count-then-claim would leave a window in which N workers all
 * read "one leased, cap is two" and all claim — ending at three.
 *
 * Sharing one transaction is **not** sufficient on its own, though, and the
 * distinction matters. Under `READ COMMITTED` — Postgres's default — each
 * *statement* sees its own snapshot, so a concurrent claimer's count can
 * still miss a lease committed after that snapshot was taken. And
 * `SKIP LOCKED` makes that worse rather than better: it does not make the
 * second claimer wait for the first, it makes it pick a **different** row.
 * Two claimers, a global cap of one, two rows ready: the cap is exceeded.
 *
 * So the count is taken under a **transaction-scoped advisory lock**
 * (`pg_advisory_xact_lock`), which every claim takes and which is held
 * until the transaction ends. The second claimer's count therefore
 * necessarily includes the first claimer's lease. `SKIP LOCKED` keeps its
 * own job — it guards the *candidate row*, so a claimer never blocks
 * behind a row another transaction holds.
 *
 * The per-workflow cap is applied in the subquery's `WHERE`: a workflow at
 * its cap is *skipped*, so another workflow's work is still claimable. (A
 * workflow absent from the cap map is uncapped, and an absent cap is no
 * cap — never zero.)
 */

import { type FactoryDatabase, type Kysely, sql, type Transaction } from '@factory/db';

import type { JobQueue } from './ports.js';
import {
  attemptOf,
  type ClaimRefusal,
  type CompleteOutcome,
  type ConcurrencyCaps,
  type EnqueueJob,
  type EnqueueOutcome,
  type HeartbeatOutcome,
  type Job,
  type JobStatus,
  type ReapOutcome,
  type RequeuedJob,
} from './types.js';

/**
 * The advisory lock key that serialises the **count** of leased jobs.
 *
 * ## Why this exists
 *
 * `pg_advisory_xact_lock` takes a `bigint` key and holds it until the
 * transaction ends. Every claim takes the same key, so the claims are
 * serialised with respect to each other's *count*.
 *
 * This is a different lock from the one `SKIP LOCKED` provides:
 *
 * * `FOR UPDATE SKIP LOCKED` guards the **candidate row**. A claimer that
 *   finds the row locked picks a different one instead of waiting. It is
 *   what lets N workers pull N different rows concurrently.
 * * The advisory lock guards the **leased count**. A claimer that finds
 *   the count locked waits, because proceeding on a stale count would let
 *   it exceed the cap.
 *
 * Without the second lock, a global cap of one would be exceeded by two
 * concurrent claims: both read "zero leased", and `SKIP LOCKED` sends
 * them to two different rows.
 *
 * The key is a fixed constant, so every process using this queue
 * serialises against the same lock. It is namespaced by the application's
 * use of the `bigint` advisory-lock space; the value is arbitrary but must
 * not collide with any other advisory lock the factory takes.
 */
const CLAIM_ADVISORY_LOCK_KEY = 8_675_309_001n;

/**
 * The options for a {@link PostgresJobQueue}.
 */
export interface PostgresJobQueueOptions {
  /** The database handle. */
  readonly db: Kysely<FactoryDatabase>;
}

/**
 * The row `jobs` yields.
 */
interface JobRow {
  readonly id: number;
  readonly task_id: string;
  readonly node_id: string | null;
  readonly workflow: string;
  readonly kind: string;
  readonly status: JobStatus;
  readonly priority: number;
  readonly available_at: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly idempotency_key: string;
}

/**
 * A `JobQueue` against Postgres.
 */
export class PostgresJobQueue implements JobQueue {
  readonly #db: Kysely<FactoryDatabase>;
  /**
   * Why the last claim found nothing.
   */
  #lastRefusal: ClaimRefusal | undefined;

  public constructor(options: PostgresJobQueueOptions) {
    this.#db = options.db;
  }

  public async enqueue(job: EnqueueJob): Promise<EnqueueOutcome> {
    return this.#db.transaction().execute(async (trx) => {
      // The insert is idempotent on the key: `ON CONFLICT DO NOTHING`
      // followed by a read of the row. The read *must* be in the same
      // transaction — a concurrent insert of the same key would otherwise
      // make the read see nothing.
      //
      // The attempt is the **node's** attempt, and it is the last
      // component of the idempotency key `(taskId,nodeId,attempt)`. It is
      // read from the key rather than counted from zero, because the
      // attempt is what makes the key unique — two job rows for the same
      // node with different attempts are two different executions of that
      // node, not the same execution twice.
      const inserted = await sql<{ id: number }>`
        INSERT INTO factory.jobs
          (task_id, node_id, kind, status, priority, available_at, max_attempts, attempt, idempotency_key)
        VALUES (
          ${job.taskId},
          ${job.nodeId},
          ${job.kind},
          'ready',
          ${job.priority ?? 100},
          ${job.availableAt ?? new Date(0).toISOString()},
          ${job.maxAttempts ?? 3},
          ${attemptOf(job.idempotencyKey)},
          ${job.idempotencyKey}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `.execute(trx);

      const insertedId = inserted.rows[0]?.id;

      const row = await sql<JobRow>`
        SELECT j.id, j.task_id, j.node_id, t.workflow, j.kind, j.status, j.priority,
               j.available_at::text AS available_at,
               j.lease_owner, j.lease_expires_at::text AS lease_expires_at,
               j.attempt, j.max_attempts, j.idempotency_key
        FROM factory.jobs j
        JOIN factory.tasks t ON t.id = j.task_id
        WHERE j.idempotency_key = ${job.idempotencyKey}
      `.execute(trx);

      const found = row.rows[0];
      if (found === undefined) {
        throw new Error(`job ${job.idempotencyKey} vanished immediately after insert`);
      }

      return {
        job: rowToJob(found),
        created: insertedId !== undefined,
      };
    });
  }

  public async leasedCounts(): Promise<{
    readonly global: number;
    readonly perWorkflow: Readonly<Record<string, number>>;
  }> {
    const rows = await sql<{ workflow: string; leased: number }>`
      SELECT t.workflow, count(*)::int AS leased
      FROM factory.jobs j
      JOIN factory.tasks t ON t.id = j.task_id
      WHERE j.status = 'leased'
      GROUP BY t.workflow
    `.execute(this.#db);

    const perWorkflow: Record<string, number> = {};
    let global = 0;

    for (const row of rows.rows) {
      perWorkflow[row.workflow] = Number(row.leased);
      global += Number(row.leased);
    }

    return { global, perWorkflow };
  }

  public async claim(input: {
    readonly owner: string;
    readonly leaseMs: number;
    readonly now: string;
    readonly caps?: ConcurrencyCaps;
  }): Promise<Job | undefined> {
    return this.#db.transaction().execute(async (trx) => {
      // **The cap check, inside the claim's transaction, under a lock that
      // a concurrent claimer respects.**
      //
      // The count must not be stale. Under `READ COMMITTED` — Postgres's
      // default — a plain aggregate read sees a snapshot taken at the
      // start of *that statement*, so two concurrent claimers both read
      // "zero leased" and both proceed. `SKIP LOCKED` makes it worse, not
      // better: it does not make the second claimer wait for the first, it
      // makes it pick a *different* row. Two claimers, a global cap of
      // one, two rows ready — the cap is exceeded.
      //
      // The count and the lease must therefore be serialised *against each
      // other*, not merely against each other's candidate rows. The
      // transaction-scoped advisory lock below does exactly that: it is
      // held until the transaction ends, so the second claimer's count
      // necessarily includes the first claimer's lease.
      //
      // `SKIP LOCKED` is unaffected and still required: it governs the
      // *candidate selection*, so a claimer never blocks behind a row some
      // other transaction holds. The advisory lock governs the *count*.
      // They are different jobs, and the pack's algorithm — `UPDATE …
      // WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` —
      // is used verbatim.
      await sql`SELECT pg_advisory_xact_lock(${CLAIM_ADVISORY_LOCK_KEY})`.execute(trx);

      const globalCap = input.caps?.global;

      const counts = await sql<{ workflow: string; leased: number }>`
        SELECT t.workflow, count(*)::int AS leased
        FROM factory.jobs j
        JOIN factory.tasks t ON t.id = j.task_id
        WHERE j.status = 'leased'
        GROUP BY t.workflow
      `.execute(trx);

      let leasedGlobal = 0;
      const leasedPerWorkflow: Record<string, number> = {};
      for (const row of counts.rows) {
        leasedGlobal += Number(row.leased);
        leasedPerWorkflow[row.workflow] = Number(row.leased);
      }

      if (globalCap !== undefined && leasedGlobal >= globalCap) {
        this.#lastRefusal = { kind: 'cap-reached' };
        return undefined;
      }

      const perWorkflow = input.caps?.perWorkflow;

      const expiresAt = new Date(
        new Date(input.now).getTime() + input.leaseMs,
      ).toISOString();

      // **The claim.** pack 02 §4.8's algorithm, verbatim:
      //
      //   UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)
      //   RETURNING *
      //
      // The subquery picks one ready, available job, locking it and
      // *skipping* any row another transaction already holds. The outer
      // `UPDATE` then flips that row to `leased` and stamps the lease.
      //
      // The per-workflow cap is applied in the subquery's `WHERE`: a
      // workflow at its cap is *skipped*, so another workflow's work is
      // still claimable. (A workflow absent from the cap map is uncapped.)
      //
      // The cap map and the leased counts are passed as JSON and read with
      // `jsonb_each_text` / `->>`. The comparison is between two **numbers**
      // — the cap and the count — so both sides are cast to `int`.
      const capMapJson = perWorkflow === undefined ? null : JSON.stringify(perWorkflow);
      const countsJson = JSON.stringify(leasedPerWorkflow);

      const claimed = await sql<JobRow>`
        UPDATE factory.jobs j
        SET status = 'leased',
            lease_owner = ${input.owner},
            lease_expires_at = ${expiresAt}
        WHERE j.id = (
          SELECT candidate.id
          FROM factory.jobs candidate
          JOIN factory.tasks t ON t.id = candidate.task_id
          WHERE candidate.status = 'ready'
            AND candidate.available_at <= ${input.now}
            AND (
              ${capMapJson}::jsonb IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM jsonb_each_text(COALESCE(${capMapJson}::jsonb, '{}'::jsonb)) cap
                WHERE cap.key = t.workflow
                  AND cap.value::int <= COALESCE((${countsJson}::jsonb ->> t.workflow)::int, 0)
              )
            )
          ORDER BY candidate.priority ASC, candidate.available_at ASC, candidate.id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING j.id, j.task_id, j.node_id, j.kind, j.status, j.priority,
                  j.available_at::text AS available_at,
                  j.lease_owner, j.lease_expires_at::text AS lease_expires_at,
                  j.attempt, j.max_attempts, j.idempotency_key
      `.execute(trx);

      const row = claimed.rows[0];
      if (row === undefined) {
        // Nothing was claimable. If there was ready work, it was blocked by
        // a per-workflow cap; name the first workflow that was blocked.
        const ready = await sql<{ workflow: string }>`
          SELECT DISTINCT t.workflow
          FROM factory.jobs j
          JOIN factory.tasks t ON t.id = j.task_id
          WHERE j.status = 'ready' AND j.available_at <= ${input.now}
          ORDER BY t.workflow ASC
        `.execute(trx);

        const blocked = ready.rows.find((candidate) => {
          const limit = perWorkflow?.[candidate.workflow];
          return limit !== undefined && (leasedPerWorkflow[candidate.workflow] ?? 0) >= limit;
        })?.workflow;

        this.#lastRefusal =
          blocked === undefined
            ? { kind: 'empty' }
            : { kind: 'cap-reached', workflow: blocked };

        return undefined;
      }

      this.#lastRefusal = undefined;

      // The workflow is not in the `RETURNING` list (the update touches only
      // `jobs`); it is read from the task row.
      const workflow = await sql<{ workflow: string }>`
        SELECT workflow FROM factory.tasks WHERE id = ${row.task_id}
      `.execute(trx);

      return rowToJob({ ...row, workflow: workflow.rows[0]?.workflow ?? '' });
    });
  }

  /**
   * Why the last claim found nothing.
   */
  public claimRefusal(): ClaimRefusal | undefined {
    return this.#lastRefusal;
  }

  public async heartbeat(input: {
    readonly jobId: number;
    readonly owner: string;
    readonly leaseMs: number;
    readonly now: string;
  }): Promise<HeartbeatOutcome> {
    const expiresAt = new Date(
      new Date(input.now).getTime() + input.leaseMs,
    ).toISOString();

    const renewed = await sql<JobRow>`
      UPDATE factory.jobs
      SET lease_expires_at = ${expiresAt}
      WHERE id = ${input.jobId}
        AND status = 'leased'
        AND lease_owner = ${input.owner}
      RETURNING id, task_id, node_id, kind, status, priority,
                available_at::text AS available_at,
                lease_owner, lease_expires_at::text AS lease_expires_at,
                attempt, max_attempts, idempotency_key
    `.execute(this.#db);

    const row = renewed.rows[0];
    if (row === undefined) {
      return { renewed: false };
    }

    return {
      renewed: true,
      lease: {
        jobId: row.id,
        owner: input.owner,
        attempt: Number(row.attempt),
        expiresAt: row.lease_expires_at ?? expiresAt,
      },
    };
  }

  public async reap(input: { readonly now: string }): Promise<ReapOutcome> {
    return this.#db.transaction().execute(async (trx) => {
      // **The reaper.**
      //
      // Two statements, in one transaction. The first *selects* the expired
      // leases and locks them; the second updates exactly those rows. The
      // select-then-update is safe because the first statement holds the
      // row locks (`FOR UPDATE SKIP LOCKED`) until the transaction ends —
      // a concurrent reaper cannot get the same rows.
      //
      // The once-ness comes from the `status = 'leased'` clause: the update
      // flips the row out of `leased`, so a second reap of the same lease
      // finds nothing to select.
      //
      // The re-queue **increments the attempt** and rewrites the
      // idempotency key. The re-queued job is a new *attempt* of the same
      // node, and the attempt is part of the key — so a handler keyed by
      // `(taskId,nodeId,attempt)` treats it as distinct work.
      const candidates = await sql<{
        id: number;
        task_id: string;
        node_id: string | null;
        workflow: string;
        attempt: number;
        lease_owner: string | null;
        max_attempts: number;
      }>`
        SELECT j.id, j.task_id, j.node_id, t.workflow, j.attempt, j.lease_owner,
               j.max_attempts
        FROM factory.jobs j
        JOIN factory.tasks t ON t.id = j.task_id
        WHERE j.status = 'leased'
          AND j.lease_expires_at IS NOT NULL
          AND j.lease_expires_at <= ${input.now}
        ORDER BY j.lease_expires_at ASC
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 100
      `.execute(trx);

      const requeued: RequeuedJob[] = [];
      const deadLettered: Job[] = [];

      for (const candidate of candidates.rows) {
        const expiredAttempt = Number(candidate.attempt);
        const nextAttempt = expiredAttempt + 1;

        if (nextAttempt > Number(candidate.max_attempts)) {
          const dead = await sql<JobRow>`
            UPDATE factory.jobs
            SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL
            WHERE id = ${candidate.id}
            RETURNING id, task_id, node_id, kind, status, priority,
                      available_at::text AS available_at,
                      lease_owner, lease_expires_at::text AS lease_expires_at,
                      attempt, max_attempts, idempotency_key
          `.execute(trx);

          const deadRow = dead.rows[0];
          if (deadRow !== undefined) {
            deadLettered.push(rowToJob({ ...deadRow, workflow: candidate.workflow }));
          }
          continue;
        }

        const updated = await sql<JobRow>`
          UPDATE factory.jobs
          SET status = 'ready',
              lease_owner = NULL,
              lease_expires_at = NULL,
              available_at = ${input.now},
              attempt = ${nextAttempt},
              idempotency_key = ${candidate.task_id} || ':' ||
                                COALESCE(${candidate.node_id}, 'job') || ':' ||
                                ${String(nextAttempt)}
          WHERE id = ${candidate.id}
          RETURNING id, task_id, node_id, kind, status, priority,
                    available_at::text AS available_at,
                    lease_owner, lease_expires_at::text AS lease_expires_at,
                    attempt, max_attempts, idempotency_key
        `.execute(trx);

        const updatedRow = updated.rows[0];
        if (updatedRow === undefined) {
          continue;
        }

        requeued.push({
          jobId: Number(candidate.id),
          taskId: candidate.task_id,
          nodeId: candidate.node_id,
          workflow: candidate.workflow,
          expiredAttempt,
          attempt: nextAttempt,
          previousOwner: candidate.lease_owner,
        });
      }

      return { requeued, deadLettered };
    });
  }

  public async complete(input: {
    readonly jobId: number;
    readonly owner: string;
    readonly taskId: string;
    readonly nodeId: string | null;
    readonly workflow: string;
    readonly attempt: number;
    readonly runId: string;
    readonly outcome: 'succeeded' | 'failed';
    readonly result?: unknown;
  }): Promise<CompleteOutcome> {
    return this.#db.transaction().execute(async (trx) => {
      // The lease must still be current — the same owner, the same attempt.
      // If it is not, the worker is stale: its lease was reaped and the job
      // re-queued or completed by someone else.
      const current = await sql<JobRow>`
        SELECT id, task_id, node_id, kind, status, priority,
               available_at::text AS available_at,
               lease_owner, lease_expires_at::text AS lease_expires_at,
               attempt, max_attempts, idempotency_key
        FROM factory.jobs
        WHERE id = ${input.jobId}
        FOR UPDATE
      `.execute(trx);

      const row = current.rows[0];
      const leaseIsCurrent =
        row !== undefined &&
        row.status === 'leased' &&
        row.lease_owner === input.owner &&
        Number(row.attempt) === input.attempt;

      if (!leaseIsCurrent) {
        const winner = await this.#winnerRunId(trx, input.taskId, input.nodeId);
        return {
          applied: false,
          duplicate: true,
          ...(winner === undefined ? {} : { winnerRunId: winner }),
        };
      }

      // The node's first committed result wins. The node row is locked, so
      // two workers reporting the same node cannot both find it uncommitted.
      if (input.nodeId !== null) {
        const winner = await this.#winnerRunId(trx, input.taskId, input.nodeId);
        if (winner !== undefined) {
          return { applied: false, duplicate: true, winnerRunId: winner };
        }
      }

      await sql`
        UPDATE factory.jobs
        SET status = ${input.outcome === 'succeeded' ? 'done' : 'failed'},
            lease_owner = NULL,
            lease_expires_at = NULL
        WHERE id = ${input.jobId}
      `.execute(trx);

      if (input.nodeId !== null) {
        // `winnerRunId` is written **here**, on the same statement that
        // commits the result.
        //
        // The duplicate check above reads the winner back out of
        // `spec->>'winnerRunId'`. If this statement did not write it, that
        // read would always find nothing, the second worker to report the
        // same node would find no committed result, and **both** results
        // would be applied — which is exactly the "the first committed
        // result wins" rule failing. The write and the read are two halves
        // of one mechanism, so they have to be changed together.
        //
        // The statement **upserts**. A plain `UPDATE` matches nothing when
        // the node row has not been created yet, and then the winner is
        // recorded nowhere — the same failure, by a quieter route. The
        // node row is this mechanism's only durable record of which run
        // won, so committing a result has to be able to create it.
        await sql`
          INSERT INTO factory.nodes (task_id, node_id, kind, state, spec, result, version)
          VALUES (
            ${input.taskId},
            ${input.nodeId},
            ${row.kind},
            ${input.outcome === 'succeeded' ? 'SUCCEEDED' : 'FAILED'},
            jsonb_build_object('winnerRunId', ${input.runId}::text),
            ${JSON.stringify(input.result ?? null)}::jsonb,
            1
          )
          ON CONFLICT (task_id, node_id) DO UPDATE
          SET state = EXCLUDED.state,
              result = EXCLUDED.result,
              spec = COALESCE(factory.nodes.spec, '{}'::jsonb) || EXCLUDED.spec,
              version = factory.nodes.version + 1
        `.execute(trx);
      }

      return { applied: true, duplicate: false, winnerRunId: input.runId };
    });
  }

  public async byId(jobId: number): Promise<Job | undefined> {
    const rows = await sql<JobRow>`
      SELECT j.id, j.task_id, j.node_id, j.kind, j.status, j.priority,
             j.available_at::text AS available_at,
             j.lease_owner, j.lease_expires_at::text AS lease_expires_at,
             j.attempt, j.max_attempts, j.idempotency_key,
             t.workflow
      FROM factory.jobs j
      JOIN factory.tasks t ON t.id = j.task_id
      WHERE j.id = ${jobId}
    `.execute(this.#db);

    const row = rows.rows[0];
    return row === undefined ? undefined : rowToJob(row);
  }

  /**
   * The run id whose result was committed for the node, if any.
   *
   * The node row's `result` is the committed record; the winning run id is
   * kept in the node's `spec` under `winnerRunId` — or, when the row was
   * written by another adapter, in the job's payload. The lookup prefers
   * the node row and falls back to the job.
   */
  async #winnerRunId(
    trx: Transaction<FactoryDatabase>,
    taskId: string,
    nodeId: string | null,
  ): Promise<string | undefined> {
    if (nodeId === null) {
      return undefined;
    }

    const rows = await sql<{ winner_run_id: string | null }>`
      SELECT spec->>'winnerRunId' AS winner_run_id
      FROM factory.nodes
      WHERE task_id = ${taskId} AND node_id = ${nodeId}
    `.execute(trx);

    const winner = rows.rows[0]?.winner_run_id;
    return winner === null || winner === undefined ? undefined : winner;
  }
}

/**
 * Map a database row to a {@link Job}.
 */
export const rowToJob = (row: JobRow): Job => ({
  id: Number(row.id),
  taskId: row.task_id,
  nodeId: row.node_id,
  workflow: row.workflow,
  kind: row.kind,
  status: row.status,
  priority: Number(row.priority),
  availableAt: row.available_at,
  leaseOwner: row.lease_owner,
  leaseExpiresAt: row.lease_expires_at,
  attempt: Number(row.attempt),
  maxAttempts: Number(row.max_attempts),
  idempotencyKey: row.idempotency_key,
});
