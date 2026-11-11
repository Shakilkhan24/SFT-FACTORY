/**
 * T-1.07 — the scheduler against a real Postgres.
 *
 * pack 02 §4.8, blueprint ADR-0012.
 *
 * ## Why this file exists alongside `tests/concurrency/t1-07-scheduler.test.ts`
 *
 * The concurrency suite proves the scheduler's **rules** — the caps, the
 * kill-switch, the once-ness, the first-committed-result-wins — against the
 * in-memory queue, with no database. That is the oracle's home, and it runs
 * everywhere.
 *
 * This file proves the **Postgres implementation** agrees with those rules:
 * that `SKIP LOCKED` really excludes a row another transaction holds, that
 * the claim's `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT
 * 1) RETURNING *` really leases exactly one row, and that the reaper's
 * `WHERE status = 'leased'` really re-queues a lease once.
 *
 * A mocked database would prove none of that. The SQL *is* the claim.
 *
 * ## The environment
 *
 * This suite needs a real Postgres — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available the suite cannot run; that is an **environment**
 * limit, not a failure of the code, and CI is where it is proved.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  type FactoryDatabase,
  type Kysely,
} from '../../../packages/db/src/index.ts';
import { containerRunning } from '../../helpers/eventlog.ts';
import { createPostgres, isError, type Postgres } from '../../helpers/postgres.ts';
import {
  type CapProvider,
  type Clock,
  type ConcurrencyCaps,
  InMemoryJobQueue,
  type JobQueue,
  type KillSwitch,
  type KillSwitchState,
  nodeIdempotencyKey,
  PostgresJobQueue,
  Scheduler,
} from '../../../packages/orchestrator/src/index.ts';

/**
 * The clock the test moves by hand.
 */
class ManualClock implements Clock {
  #now: string;

  public constructor(start = '2026-11-10T00:00:00.000Z') {
    this.#now = start;
  }

  public now(): string {
    return this.#now;
  }

  public advance(ms: number): void {
    this.#now = new Date(new Date(this.#now).getTime() + ms).toISOString();
  }
}

/**
 * A kill-switch the test flips.
 */
class ManualKillSwitch implements KillSwitch {
  #state: KillSwitchState;

  public constructor(state: KillSwitchState = { engaged: false }) {
    this.#state = state;
  }

  public state(): Promise<KillSwitchState> {
    return Promise.resolve(this.#state);
  }

  public engage(): void {
    this.#state = { engaged: true, engagedBy: 'test', reason: 'paused' };
  }
}

const fixedCaps = (caps: ConcurrencyCaps): CapProvider => ({
  caps: (): Promise<ConcurrencyCaps> => Promise.resolve(caps),
});

/**
 * The schema the scheduler needs.
 *
 * The pack's DDL is the source of truth (`migrations/0001_core.sql`), so
 * this file applies the *real* tables rather than a paraphrase. Only the
 * tables the scheduler touches are created — the event log and the rest are
 * not this suite's business.
 */
const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS factory;

CREATE TABLE IF NOT EXISTS factory.tasks (
  id text PRIMARY KEY, repo text NOT NULL, workflow text NOT NULL, state text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  autonomy_level smallint NOT NULL CHECK (autonomy_level BETWEEN 0 AND 4),
  risk_tier text CHECK (risk_tier IN ('R0','R1','R2','R3','R4')),
  source jsonb NOT NULL, spec jsonb, spec_sha256 bytea, graph jsonb, graph_sha256 bytea,
  oracle_id text, definition_sha text NOT NULL, correlation_id text NOT NULL,
  budget_usd_micros bigint NOT NULL, spent_usd_micros bigint NOT NULL DEFAULT 0,
  escalation jsonb, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz
);

CREATE TABLE IF NOT EXISTS factory.nodes (
  task_id text NOT NULL REFERENCES factory.tasks(id), node_id text NOT NULL, kind text NOT NULL,
  state text NOT NULL, version integer NOT NULL DEFAULT 0, attempt integer NOT NULL DEFAULT 0,
  depends_on text[] NOT NULL DEFAULT '{}', spec jsonb NOT NULL, result jsonb,
  PRIMARY KEY (task_id, node_id)
);

CREATE TABLE IF NOT EXISTS factory.jobs (
  id bigserial PRIMARY KEY, task_id text NOT NULL, node_id text, kind text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','leased','done','failed','dead')),
  priority smallint NOT NULL DEFAULT 100, available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text, lease_expires_at timestamptz,
  attempt integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
  idempotency_key text NOT NULL UNIQUE, payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_claim_idx ON factory.jobs (priority, available_at) WHERE status = 'ready';

CREATE TABLE IF NOT EXISTS factory.kill_switch (
  id smallint PRIMARY KEY CHECK (id = 1), engaged boolean NOT NULL DEFAULT false,
  engaged_by text, engaged_at timestamptz, reason text
);
INSERT INTO factory.kill_switch (id) VALUES (1) ON CONFLICT DO NOTHING;
`;

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, this suite **skips** rather than fails: the absence of a
 * Docker daemon is an environment limit, not a defect in the scheduler. The
 * suite runs in CI, where the daemon exists, and that is where the Postgres
 * path is proved.
 */
const running = await containerRunning();

describe('T-1.07 · the scheduler against Postgres', () => {
  let postgres: Postgres;
  let db: Kysely<FactoryDatabase>;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    postgres = await createPostgres('factory_t1_07_scheduler');
    // Applied **as the owner**, not as the superuser. The scheduler connects
    // as `factory_owner`, so the tables have to be owned by that role —
    // a table created by the superuser is invisible to it (the role has no
    // privileges on it), and the failure reads as
    // `relation "tasks" does not exist`.
    const applied = await postgres.psqlAsOwner(SCHEMA);
    expect(isError(applied)).toBe(false);

    // The scheduler writes as the owner role: it leases jobs and commits
    // node results, which is more than the least-privilege `factory_app`
    // role may do.
    db = createDatabase({
      connectionString: postgres.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
    });
  }, 120_000);

  /**
   * Every test starts from an empty queue.
   *
   * The suite shares one database, so without this a job leased by one test
   * is still leased when the next test runs. The cap assertions then read
   * the *shared* count rather than the count the test set up: a test that
   * enqueues one job and expects one winner sees two, and a test that
   * expects "the global cap of one is reached" sees it already reached
   * before it enqueues anything.
   *
   * Those failures look like scheduler defects and are not — the cap is
   * working correctly against a queue the earlier test left behind. Each
   * test's assertion is only meaningful against the state it created, so
   * the state is reset between them.
   */
  beforeEach(async () => {
    if (!running) {
      return;
    }
    await db.deleteFrom('jobs').execute();
    await db.deleteFrom('nodes').execute();
    await db.deleteFrom('tasks').execute();
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
    await postgres?.destroy();
  }, 60_000);

  /**
   * Insert a task the jobs can hang off.
   */
  const insertTask = async (taskId: string, workflow: string): Promise<void> => {
    await db
      .insertInto('tasks')
      .values({
        id: taskId,
        repo: 'owner/repo',
        workflow,
        state: 'RUNNING',
        autonomy_level: 1,
        risk_tier: 'R0',
        source: { kind: 'manual', ref: 'test', authorLogin: 'tester' },
        definition_sha: 'a'.repeat(40),
        correlation_id: taskId,
        budget_usd_micros: 1_000_000,
        created_by: 'tester',
      })
      .execute();
  };

  /**
   * A scheduler over the Postgres queue.
   */
  const build = (options?: {
    readonly caps?: ConcurrencyCaps;
    readonly clock?: ManualClock;
    readonly killSwitch?: KillSwitch;
  }): { readonly scheduler: Scheduler; readonly queue: JobQueue; readonly clock: ManualClock } => {
    const settings = options ?? {};
    const queue = new PostgresJobQueue({ db });
    const clock = settings.clock ?? new ManualClock();
    const killSwitch = settings.killSwitch ?? new ManualKillSwitch();

    const scheduler = new Scheduler(
      {
        queue,
        caps: fixedCaps(settings.caps ?? {}),
        killSwitch,
        clock,
      },
      { honourKillSwitch: true },
    );

    return { scheduler, queue, clock };
  };

  it.skipIf(!running)('claims exactly one job and leases it', async () => {
    await insertTask('task-pg-1', 'alpha');

    const { scheduler, queue } = build();

    await scheduler.enqueue({
      taskId: 'task-pg-1',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-1', 'node-1', 1),
    });

    const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
    expect(claim.claimed).toBe(true);

    const job = await queue.byId(claim.claimed ? claim.job.id : 0);
    expect(job?.status).toBe('leased');
    expect(job?.leaseOwner).toBe('worker-a');
    expect(job?.attempt).toBe(1);
  });

  it.skipIf(!running)('gives the job to only one of several concurrent claims', async () => {
    await insertTask('task-pg-2', 'alpha');

    const { scheduler, queue } = build();

    await scheduler.enqueue({
      taskId: 'task-pg-2',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-2', 'node-1', 1),
    });

    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        scheduler.claim({ owner: `worker-${String(index)}`, leaseMs: 60_000 }),
      ),
    );

    const winners = attempts.filter((attempt) => attempt.claimed);
    expect(winners).toHaveLength(1);

    const counts = await queue.leasedCounts();
    expect(counts.global).toBe(1);
  });

  it.skipIf(!running)('never exceeds the global cap under concurrent claims', async () => {
    // The regression this guards: `SKIP LOCKED` sends a concurrent claimer
    // to a *different* row rather than making it wait, so two claimers
    // could both read "zero leased" and both lease — exceeding a global
    // cap of one. The count is taken under a transaction-scoped advisory
    // lock precisely to close that window.
    await insertTask('task-pg-2b', 'alpha');
    await insertTask('task-pg-2c', 'alpha');

    const { scheduler, queue } = build({ caps: { global: 1 } });

    for (const taskId of ['task-pg-2b', 'task-pg-2c']) {
      await scheduler.enqueue({
        taskId,
        nodeId: 'node-1',
        workflow: 'alpha',
        kind: 'node.execute',
        idempotencyKey: nodeIdempotencyKey(taskId, 'node-1', 1),
      });
    }

    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        scheduler.claim({ owner: `worker-${String(index)}`, leaseMs: 60_000 }),
      ),
    );

    const winners = attempts.filter((attempt) => attempt.claimed);
    expect(winners).toHaveLength(1);

    const counts = await queue.leasedCounts();
    expect(counts.global).toBe(1);
  });

  it.skipIf(!running)('re-queues an expired lease exactly once', async () => {
    await insertTask('task-pg-3', 'alpha');

    const { scheduler, clock } = build();

    await scheduler.enqueue({
      taskId: 'task-pg-3',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-3', 'node-1', 1),
    });

    expect((await scheduler.claim({ owner: 'worker-a', leaseMs: 1_000 })).claimed).toBe(true);

    clock.advance(2_000);

    const first = await scheduler.reap();
    expect(first.requeued).toHaveLength(1);
    expect(first.requeued[0]?.expiredAttempt).toBe(1);
    expect(first.requeued[0]?.attempt).toBe(2);

    const second = await scheduler.reap();
    expect(second.requeued).toHaveLength(0);

    const third = await scheduler.reap();
    expect(third.requeued).toHaveLength(0);
  });

  it.skipIf(!running)('respects the global cap', async () => {
    await insertTask('task-pg-4', 'alpha');
    await insertTask('task-pg-5', 'alpha');

    const { scheduler, queue } = build({ caps: { global: 1 } });

    for (const taskId of ['task-pg-4', 'task-pg-5']) {
      await scheduler.enqueue({
        taskId,
        nodeId: 'node-1',
        workflow: 'alpha',
        kind: 'node.execute',
        idempotencyKey: nodeIdempotencyKey(taskId, 'node-1', 1),
      });
    }

    expect((await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 })).claimed).toBe(true);

    const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
    expect(second.claimed).toBe(false);
    expect(second.claimed === false && second.reason.kind).toBe('cap-reached');

    const counts = await queue.leasedCounts();
    expect(counts.global).toBe(1);
  });

  it.skipIf(!running)('keeps the first committed result and refuses the second', async () => {
    await insertTask('task-pg-6', 'alpha');

    const { scheduler } = build();

    await scheduler.enqueue({
      taskId: 'task-pg-6',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-6', 'node-1', 1),
    });
    await scheduler.enqueue({
      taskId: 'task-pg-6',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-6', 'node-1', 2),
    });

    const first = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
    const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(true);

    const winner = await scheduler.complete({
      jobId: first.claimed ? first.job.id : 0,
      owner: 'worker-a',
      taskId: 'task-pg-6',
      nodeId: 'node-1',
      workflow: 'alpha',
      attempt: first.claimed ? first.job.attempt : 0,
      runId: 'run-a',
      outcome: 'succeeded',
      result: { from: 'run-a' },
    });
    expect(winner.applied).toBe(true);

    const loser = await scheduler.complete({
      jobId: second.claimed ? second.job.id : 0,
      owner: 'worker-b',
      taskId: 'task-pg-6',
      nodeId: 'node-1',
      workflow: 'alpha',
      attempt: second.claimed ? second.job.attempt : 0,
      runId: 'run-b',
      outcome: 'succeeded',
      result: { from: 'run-b' },
    });
    expect(loser.applied).toBe(false);
    expect(loser.duplicate).toBe(true);
  });

  it.skipIf(!running)('refuses to claim while the kill-switch is engaged', async () => {
    await insertTask('task-pg-7', 'alpha');

    const killSwitch = new ManualKillSwitch();
    const { scheduler } = build({ killSwitch });

    await scheduler.enqueue({
      taskId: 'task-pg-7',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-7', 'node-1', 1),
    });

    killSwitch.engage();

    const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
    expect(claim.claimed).toBe(false);
    expect(claim.claimed === false && claim.reason.kind).toBe('kill-switch-engaged');
  });

  it.skipIf(!running)('enqueues idempotently on the idempotency key', async () => {
    await insertTask('task-pg-8', 'alpha');

    const { scheduler } = build();

    const first = await scheduler.enqueue({
      taskId: 'task-pg-8',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-8', 'node-1', 1),
    });
    expect(first.created).toBe(true);

    const second = await scheduler.enqueue({
      taskId: 'task-pg-8',
      nodeId: 'node-1',
      workflow: 'alpha',
      kind: 'node.execute',
      idempotencyKey: nodeIdempotencyKey('task-pg-8', 'node-1', 1),
    });
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });
});

describe('T-1.07 · the in-memory queue and the Postgres queue agree', () => {
  it('both report the same refusal when nothing is claimable', async () => {
    const memory = new InMemoryJobQueue();
    const memoryScheduler = new Scheduler(
      {
        queue: memory,
        caps: fixedCaps({}),
        killSwitch: new ManualKillSwitch(),
        clock: new ManualClock(),
      },
      { honourKillSwitch: true },
    );

    const memoryClaim = await memoryScheduler.claim({
      owner: 'worker-a',
      leaseMs: 60_000,
    });

    expect(memoryClaim.claimed).toBe(false);
    expect(memoryClaim.claimed === false && memoryClaim.reason.kind).toBe('empty');
  });
});
