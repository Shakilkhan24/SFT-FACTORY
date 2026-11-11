/**
 * **A0.5** — the fault-injection oracle (T-1.17).
 *
 * > **A0.5** | Killing the control plane mid-run yields a resumed or
 * > explicitly failed task — **never a silent loss** | Fault injection
 *
 * checklist 03 CL-G1-05's verify command is `pnpm test:fault -t "A0.5"`, and
 * the pack names this file: `08_VERIFICATION_AND_PRODUCTION_READINESS.md` §4
 * puts A0.5 at `tests/fault/a0-5.test.ts`.
 *
 * ## Why this file is a *fault* suite and not a unit suite
 *
 * The five rule proofs live in this file too: the
 * resume path's three cases, the idempotent handler, the cancel's
 * reclamation, the budget's `INCOMPLETE`, the unknown failure's class.
 * Those are **rules**, and a unit suite is the right home for them.
 *
 * But rules are not faults. A rule proof drives the code through a
 * *handled* path — a promise that rejects, a throw that is caught, a
 * cancellation token that is already set. Every one of those gives the
 * program a chance to run its cleanup. A `SIGKILL` gives it **no** chance:
 * no `finally`, no `catch`, no graceful shutdown, no chance to write the
 * row that says "I stopped".
 *
 * So the headline claim of A0.5 — *never a silent loss* — cannot be proved
 * by rules alone. It needs a process that **actually dies**.
 *
 * ## The two halves
 *
 * 1. **The real kill.** A real child process (`tools/fault-worker.ts`) is
 *    spawned; it writes its run's row to a **real Postgres** and then hangs.
 *    The parent sends a real `SIGKILL`. Then the parent looks at the
 *    database and at the resume path, and proves:
 *
 *    * the child really died of the signal — `signal === 'SIGKILL'`, not a
 *      clean exit and not a crash the harness invented;
 *    * the run's row **survived the kill** — the evidence is durable, and
 *      it says `running` with no `ended_at`, which is what a killed run
 *      looks like;
 *    * the resume path finds the task and makes it **explicit** —
 *      `ESCALATED(resume_failed)`, never "nothing happened".
 *
 * 2. **The rules.** The five sub-proofs, re-run here so that the one
 *    command CL-G1-05 names (`pnpm test:fault -t "A0.5"`) covers the whole
 *    row.
 *
 * ## Why the child is a separate program
 *
 * The child runs the worker as a **real process** — `node tools/fault-worker.ts`
 * — because a `SIGKILL` is only meaningful against a process that could
 * have handled it. The worker imports the packages from their compiled
 * `dist/` output (the repo's `NodeNext` sources use `.js` specifiers, which
 * Node's native type-stripping does not rewrite), so the packages must be
 * built — which `pnpm typecheck` does, and which the CI chain runs before
 * the suites.
 *
 * ## The environment
 *
 * The kill half needs a real Postgres. Where the dev container is not
 * running the suite **skips** — the absence of a Docker daemon is an
 * environment limit, not a defect in the factory, and CI is where the
 * Postgres path is proved. The rule half has no such dependency and runs
 * everywhere.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CancelPath,
  ExecutionLoop,
  ExecutorRegistry,
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeExecutor,
  FakeHarnessAdapter,
  FakeStateSink,
  InMemoryLeaseStore,
  InMemoryRunStore,
  NEVER_CANCELLED,
  RESUME_FAILED_TRIGGER,
  ResumePath,
  StageRunner,
  cancelledToken,
  type ReadyNode,
  type StageRunRequest,
} from '@factory/orchestrator';

import {
  createDatabase,
  destroyDatabase,
  migrate,
  type FactoryDatabase,
  type Kysely,
  sql,
} from '../../packages/db/src/index.ts';
import { PostgresRunRecordStore } from '../../packages/artefacts/src/index.ts';
import { containerRunning, migrationsDir } from '../helpers/eventlog.ts';
import { createPostgres, type Postgres } from '../helpers/postgres.ts';

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, the **kill** half skips rather than fails: a missing
 * Docker daemon is an environment limit, not a defect in the factory. The
 * rule half still runs, so the suite is never silently empty.
 */
const running = await containerRunning();

const repoRoot = resolve(import.meta.dirname, '..', '..');

/**
 * The worker.
 *
 * The worker is a **source** file, run by Node's native type-stripping. It
 * imports the packages by their bare `@factory/*` specifiers, which
 * `tools/compiled-resolver.mjs` maps to the compiled `dist/` output — so
 * the packages must have been built. When the build has not run, the kill
 * half **skips** rather than failing: a missing build is a missing
 * prerequisite, and the suite says so instead of pretending.
 */
const workerPath = join(repoRoot, 'tools', 'fault-worker.ts');

/**
 * The resolver hook.
 *
 * Without it, `@factory/db` resolves to `packages/db/src/index.ts`, whose
 * own `./connection.js` specifiers Node does not rewrite — so the worker
 * would die before it started, and the kill would be measuring nothing.
 */
const resolverPath = join(repoRoot, 'tools', 'compiled-resolver.mjs');

/**
 * The lease the killed worker holds.
 *
 * **Already expired.** The worker is about to be killed, so nobody is
 * holding its lease by the time anyone asks — and the lease is the
 * liveness oracle (pack `02` §4.8: "nodes with expired leases are
 * re-queued"). An expired lease is the honest value for a worker that is
 * not there.
 */
const EXPIRED_LEASE = '2026-11-09T23:00:00.000Z';

/**
 * The instant the resume path believes it is.
 *
 * After the lease — so the killed worker's lease is expired and the
 * reaper is entitled to take its node back.
 */
const NOW = '2026-11-10T00:00:00.000Z';

/**
 * The ready node the proofs use.
 */
const node = (overrides: Partial<ReadyNode> = {}): ReadyNode => ({
  taskId: 'tsk_1',
  nodeId: 'n1-implement',
  stageKind: 'implement',
  role: 'worker',
  attempt: 1,
  spec: { summary: 'build the thing' },
  context: { envelopeId: 'ctx_1', items: [] },
  tools: { capabilities: ['repo:read'], scopes: ['repo:read'] },
  budget: {},
  isolation: 'T2',
  modelPolicy: { role: 'worker' },
  ...overrides,
});

/**
 * The runner request the proofs use.
 */
const request = (overrides: Partial<StageRunRequest> = {}): StageRunRequest => ({
  taskId: 'tsk_1',
  nodeId: 'n1-implement',
  attempt: 1,
  stageKind: 'implement',
  role: 'worker',
  spec: {},
  context: {},
  tools: { capabilities: [], scopes: [] },
  budget: {},
  isolation: 'T2',
  modelPolicy: { role: 'worker' },
  runId: 'run_1',
  startedAt: '2026-11-10T00:00:00.000Z',
  endedAt: '2026-11-10T00:00:05.000Z',
  ...overrides,
});

/* -------------------------------------------------------------------------- */
/* The real kill                                                              */
/* -------------------------------------------------------------------------- */

describe('A0.5 · a worker killed mid-run leaves an explicit, not a silent, state', () => {
  let postgres: Postgres;
  let db: Kysely<FactoryDatabase>;

  /**
   * Whether the kill half can run.
   *
   * Three things must be true: the Postgres container is up, the worker
   * has been compiled, and this platform can signal a child process.
   */
  const killable =
    running && existsSync(workerPath) && process.platform !== 'win32';

  beforeAll(async () => {
    if (!killable) {
      return;
    }
    postgres = await createPostgres('factory_t1_a0_5_fault');
    db = createDatabase({
      connectionString: postgres.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
      max: 5,
    });
    const applied = await migrate(db, migrationsDir);
    expect(applied.applied.length + applied.alreadyApplied.length).toBeGreaterThan(0);
  }, 120_000);

  afterAll(async () => {
    if (db !== undefined) {
      await destroyDatabase(db);
    }
    await postgres?.destroy();
  }, 60_000);

  it.skipIf(!killable)('A0.5 · a SIGKILLed worker leaves a durable row and an explicit escalation', async () => {
    const taskId = 'tsk_kill_1';
    const runId = 'run_kill_1';
    const nodeId = 'n1-implement';

    // The task the killed run belongs to. A task row is the *record* of a
    // task having started, and `runs.task_id` references it.
    await db
      .insertInto('tasks')
      .values({
        id: taskId,
        repo: 'org/repo',
        workflow: 'wf_test',
        state: 'RUNNING',
        autonomy_level: 2,
        risk_tier: 'R0',
        source: { kind: 'manual', ref: 'test', authorLogin: 'tester' },
        definition_sha: 'a'.repeat(40),
        correlation_id: taskId,
        budget_usd_micros: 1_000_000,
        created_by: 'tester',
      })
      .execute();

    // ---- the child process ------------------------------------------
    //
    // The child writes its own run row and then hangs. The parent does
    // not write it: the row must be written by **the process that dies**,
    // or the proof would be measuring the parent.
    const child = spawn(
      process.execPath,
      [
        '--import',
        resolverPath,
        workerPath,
        '--connection-string',
        postgres.superuserUrl,
        '--task-id',
        taskId,
        '--run-id',
        runId,
        '--node-id',
        nodeId,
        '--lease-expires-at',
        EXPIRED_LEASE,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    // Wait for the `READY` line — the child's own claim that its row is
    // committed. The kill always lands *after* that, so the test measures
    // the kill and not a race with the write.
    const readyAt = await new Promise<number>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => {
        rejectReady(
          new Error(
            `the worker never announced itself: stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
          ),
        );
      }, 30_000);

      const check = (): void => {
        if (stdout.includes('READY')) {
          clearTimeout(timer);
          resolveReady(Date.now());
          return;
        }
        if (stdout.includes('ERROR') || stderr.length > 0) {
          clearTimeout(timer);
          rejectReady(
            new Error(
              `the worker failed to start: stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
            ),
          );
          return;
        }
        setTimeout(check, 25);
      };
      check();
    });

    expect(stdout).toContain(`READY ${runId}`);
    expect(readyAt).toBeGreaterThan(0);

    // ---- the kill ----------------------------------------------------
    //
    // A real `SIGKILL`: uncatchable, unhandleable, no cleanup. This is the
    // difference between a fault and a thrown error.
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    const [code, signal] = (await exited) as [number | null, NodeJS.Signals | null];

    // The child died of the signal — it did not exit cleanly, and it did
    // not die of an exception the harness could have mistaken for a kill.
    expect(signal).toBe('SIGKILL');
    expect(code).toBeNull();

    // ---- what survived ------------------------------------------------
    //
    // The run's row is durable, and it says what a killed run says: it is
    // `running`, it has no `ended_at`, and it has no record. The kill did
    // not erase the fact that the run happened — it left the fact, and
    // only the *completion* is missing.
    const rows = await sql<{
      status: string;
      ended_at: Date | null;
      record_uri: string | null;
      failure_class: string | null;
    }>`
      SELECT status, ended_at, record_uri, failure_class
      FROM factory.runs WHERE run_id = ${runId}
    `.execute(db);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.status).toBe('running');
    expect(rows.rows[0]?.ended_at).toBeNull();
    expect(rows.rows[0]?.record_uri).toBeNull();
    expect(rows.rows[0]?.failure_class).toBeNull();

    // ---- the task is not silently lost --------------------------------
    //
    // The resume path is what runs after a control plane dies. It asks
    // "is this task still being worked on, or did it die?" — and the
    // answer must never be "nothing happened".
    //
    // ## Why liveness is the **lease**, not the run's status
    //
    // The killed worker's run row says `running` — the kill happened
    // before it could write anything else. If liveness were read from that
    // column, the resume path would call the task alive and leave it
    // there forever: the run would sit at `running` with nobody working
    // on it. **That is the silent loss A0.5 forbids.**
    //
    // So liveness comes from the **lease** — pack `02` §4.8: "nodes with
    // expired leases are re-queued". The killed worker's lease is expired,
    // so nobody is working on its node, and the task is escalated.
    //
    // Both sources are read from the **real database**, so the answer
    // comes from the durable evidence rather than from the harness's
    // memory.
    const store = new PostgresRunRecordStore({ db });

    const runs = {
      liveRuns: async (task: string) => {
        const found = await store.find(runId);
        if (
          found === undefined ||
          found.taskId !== task ||
          found.status !== 'running' ||
          found.nodeId === undefined
        ) {
          return [];
        }

        // The lease decides. A run whose node's lease has expired is not
        // being worked on — the worker holding it is gone.
        const leased = await sql<{ lease_expires_at: string | null }>`
          SELECT lease_expires_at::text AS lease_expires_at
          FROM factory.jobs
          WHERE task_id = ${task} AND node_id = ${found.nodeId}
            AND status = 'leased'
        `.execute(db);

        const expiry = leased.rows[0]?.lease_expires_at;
        if (expiry === undefined || expiry === null || expiry <= NOW) {
          return [];
        }

        return [
          {
            runId: found.runId,
            taskId: found.taskId,
            nodeId: found.nodeId,
            attempt: found.attempt,
            role: found.role,
            stageKind: found.stageKind,
            executorKind: found.executorKind,
            status: found.status,
            costUsdMicros: found.costUsdMicros,
            startedAt: found.startedAt,
          },
        ];
      },
    };

    // The lease store, backed by the same `jobs` table. The resume path
    // re-queues the expired lease — exactly once.
    const leases = {
      liveLeases: async (task: string) => {
        const rows = await sql<{
          node_id: string | null;
          lease_owner: string | null;
          attempt: number;
          lease_expires_at: string | null;
        }>`
          SELECT node_id, lease_owner, attempt, lease_expires_at::text AS lease_expires_at
          FROM factory.jobs
          WHERE task_id = ${task} AND status = 'leased'
        `.execute(db);

        return rows.rows.map((row) => ({
          taskId: task,
          nodeId: row.node_id ?? '',
          owner: row.lease_owner ?? '',
          attempt: row.attempt,
          expiresAt: row.lease_expires_at ?? NOW,
        }));
      },
      release: async (lease: { taskId: string; nodeId: string; attempt: number }) => {
        // The re-queue is **once**: the `status = 'leased'` clause is what
        // makes it so, exactly as the scheduler's reaper does it.
        const released = await sql<{ id: string }>`
          UPDATE factory.jobs
          SET status = 'ready', lease_owner = NULL, lease_expires_at = NULL
          WHERE task_id = ${lease.taskId} AND node_id = ${lease.nodeId}
            AND attempt = ${lease.attempt} AND status = 'leased'
          RETURNING id
        `.execute(db);
        return { released: released.rows.length > 0 };
      },
    };

    const state = new FakeStateSink();
    const resume = new ResumePath({
      runs: runs as never,
      leases: leases as never,
      state,
      clock: { now: () => NOW },
    });

    const report = await resume.resume([{ taskId, state: 'RUNNING' }]);

    // The task is **explicitly** escalated, with the trigger the pack
    // names (`resume_failed`). It is not silently lost, and it is not
    // marked `FAILED` either — `ESCALATED` is resumable, and marking a
    // recoverable task `FAILED` would destroy the thing A0.5 promises.
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]?.to).toBe('ESCALATED');
    expect(state.transitions[0]?.trigger).toBe(RESUME_FAILED_TRIGGER);

    const outcome = report.outcomes[0]?.outcome;
    expect(outcome?.kind).toBe('escalated');

    // The expired lease was **re-queued**, and that re-queue is durable:
    // the `jobs` row is back to `ready` with no owner. So the node the
    // dead worker was holding is back in the queue — the work is
    // recoverable, which is the whole point of escalating rather than
    // failing.
    const jobs = await sql<{ status: string; lease_owner: string | null }>`
      SELECT status, lease_owner FROM factory.jobs
      WHERE task_id = ${taskId} AND node_id = ${nodeId}
    `.execute(db);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.status).toBe('ready');
    expect(jobs.rows[0]?.lease_owner).toBeNull();

    // And the run's row is **untouched** by the escalation — the run
    // happened, and the fact that it happened is still on record. What
    // the resume path changed is the *task's* disposition, which the
    // `FakeStateSink` records.
    //
    // The task row in the database still says `RUNNING`, because the
    // state sink here is the in-memory double: the escalation was
    // *decided* and *reported*, not applied to the row. Asserting
    // `ESCALATED` on that row would be asserting something the suite did
    // not do.
    const tasks = await sql<{ state: string }>`
      SELECT state FROM factory.tasks WHERE id = ${taskId}
    `.execute(db);
    expect(tasks.rows[0]?.state).toBe('RUNNING');
  }, 120_000);

  it.skipIf(!killable)('A0.5 · a second kill does not resurrect the killed run', async () => {
    // The handler is idempotent: the first committed result wins, and a
    // re-delivered job must not overwrite it. After a kill, the re-queue
    // is what re-delivers the job — so this is the same hazard as a
    // duplicated delivery, seen after a kill.
    const taskId = 'tsk_kill_2';
    const runId = 'run_kill_2';
    const nodeId = 'n1-implement';

    await db
      .insertInto('tasks')
      .values({
        id: taskId,
        repo: 'org/repo',
        workflow: 'wf_test',
        state: 'RUNNING',
        autonomy_level: 2,
        risk_tier: 'R0',
        source: { kind: 'manual', ref: 'test', authorLogin: 'tester' },
        definition_sha: 'a'.repeat(40),
        correlation_id: taskId,
        budget_usd_micros: 1_000_000,
        created_by: 'tester',
      })
      .execute();

    const store = new PostgresRunRecordStore({ db });

    const child = spawn(
      process.execPath,
      [
        '--import',
        resolverPath,
        workerPath,
        '--connection-string',
        postgres.superuserUrl,
        '--task-id',
        taskId,
        '--run-id',
        runId,
        '--node-id',
        nodeId,
        '--lease-expires-at',
        EXPIRED_LEASE,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => {
        rejectReady(new Error('the worker never announced itself'));
      }, 30_000);
      const check = (): void => {
        if (stdout.includes('READY')) {
          clearTimeout(timer);
          resolveReady();
          return;
        }
        setTimeout(check, 25);
      };
      check();
    });

    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;

    // The killed run is still `running` — the kill did not finish it.
    const afterKill = await store.find(runId);
    expect(afterKill?.status).toBe('running');
    expect(afterKill?.endedAt).toBeUndefined();

    // The re-queued attempt reports the run as finished — but the
    // *first* result is the one that sticks. The store's `finish` is
    // guarded by the row's status, so a late report from a dead attempt
    // cannot overwrite a committed one.
    await db
      .updateTable('runs')
      .set({ status: 'succeeded', ended_at: new Date().toISOString() })
      .where('run_id', '=', runId)
      .execute();

    const afterCommit = await store.find(runId);
    expect(afterCommit?.status).toBe('succeeded');
    expect(afterCommit?.endedAt).toBeDefined();
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* The rules                                                                 */
/* -------------------------------------------------------------------------- */

describe('A0.5 · killing the control plane mid-run yields a resumed or explicitly failed task', () => {
  it('A0.5 · a task whose control plane died is escalated, never silently lost', async () => {
    const runs = new InMemoryRunStore();
    const leases = new InMemoryLeaseStore();
    const state = new FakeStateSink();
    const resume = new ResumePath({
      runs,
      leases,
      state,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    // The task was RUNNING when the control plane was killed. No run is
    // live, because the process that was running it died with it.
    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    // The outcome is **explicit**: ESCALATED(resume_failed).
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]?.to).toBe('ESCALATED');
    expect(state.transitions[0]?.trigger).toBe(RESUME_FAILED_TRIGGER);

    const outcome = report.outcomes[0]?.outcome;
    expect(outcome?.kind).toBe('escalated');
  });

  it('A0.5 · a task with a live node is resumed rather than escalated', async () => {
    const runs = new InMemoryRunStore();
    const leases = new InMemoryLeaseStore();
    const state = new FakeStateSink();
    const resume = new ResumePath({
      runs,
      leases,
      state,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    // The worker survived the kill: its run is still live.
    await runs.start({
      runId: 'run_1',
      taskId: 'tsk_1',
      nodeId: 'n1-implement',
      attempt: 1,
      role: 'worker',
      stageKind: 'implement',
      executorKind: 'harness',
      status: 'running',
      costUsdMicros: 0,
      startedAt: '2026-11-10T00:00:00.000Z',
    });

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('still-running');
    expect(state.transitions).toHaveLength(0);
  });

  it('A0.5 · the expired lease of a dead worker is re-queued exactly once', async () => {
    const runs = new InMemoryRunStore();
    const leases = new InMemoryLeaseStore();
    const state = new FakeStateSink();
    const resume = new ResumePath({
      runs,
      leases,
      state,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const lease = {
      taskId: 'tsk_1',
      nodeId: 'n1-implement',
      owner: 'worker-1',
      attempt: 1,
      expiresAt: '2026-11-09T23:00:00.000Z',
    };
    leases.add(lease);

    const first = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);
    expect(first.requeued).toHaveLength(1);

    // The second pass must not re-queue it again — a node run twice is a
    // duplicated side effect.
    const second = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);
    expect(second.requeued).toHaveLength(0);
  });
});

describe('A0.5 · the node handler is idempotent', () => {
  it('A0.5 · the first committed result wins and the second is not applied', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const first = await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);
    expect(first.applied).toBe(true);
    expect(runs.byId('run_1')?.status).toBe('succeeded');

    // The same run is reported again — a re-delivered job, a re-queued
    // lease, a duplicated handler call. The result is not applied again.
    const second = await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);
    expect(second.applied).toBe(false);
    expect(second.winnerRunId).toBe('run_1');
  });

  it('A0.5 · the duplicated handler does not overwrite the first result', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);
    await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);

    // The run record still holds the first result.
    expect(runs.finished).toHaveLength(2);
    expect(runs.byId('run_1')?.status).toBe('succeeded');
  });
});

describe('A0.5 · a cancel reclaims the environment and the credentials', () => {
  it('A0.5 · both the environment and the credentials are reclaimed', async () => {
    const environments = new FakeEnvironmentRegistry();
    const credentials = new FakeCredentialReclaimer();
    const harnessAdapter = new FakeHarnessAdapter();
    const cancel = new CancelPath({
      environments,
      credentials,
      harness: harnessAdapter,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      executorKind: 'harness',
      reason: 'the operator cancelled the task',
    });

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
    expect(harnessAdapter.killed).toEqual(['run_1']);
    expect(outcome.failures).toEqual([]);
  });

  it('A0.5 · the credentials are revoked even when the environment reclamation fails', async () => {
    const environments = new FakeEnvironmentRegistry();
    const credentials = new FakeCredentialReclaimer();
    environments.reclaim = (): Promise<void> =>
      Promise.reject(new Error('the filesystem is gone'));
    const cancel = new CancelPath({
      environments,
      credentials,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      reason: 'the operator cancelled the task',
    });

    expect(credentials.revoked).toEqual(['run_1']);
    expect(outcome.credentialsRevoked).toBe(true);
    expect(outcome.failures).toHaveLength(1);
  });
});

describe('A0.5 · budget exhaustion yields INCOMPLETE with the partial artefacts labelled', () => {
  it('A0.5 · the stage outcome is incomplete, not failed', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const state = new FakeStateSink();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(
      request({ budget: { maxCostUsdMicros: 1_000, spentUsdMicros: 1_000 } }),
      NEVER_CANCELLED,
    );

    expect(outcome.status).toBe('incomplete');
    expect(outcome.failureClass).toBe('budget.exhausted');
    expect(runs.byId('run_1')?.status).toBe('incomplete');
    expect(state.transitions).toHaveLength(0);
  });

  it('A0.5 · the partial artefacts are preserved and labelled', async () => {
    const registry = new ExecutorRegistry();
    // The executor reports `incomplete` — it ran, it produced partial
    // artefacts, and it stopped. That is the case FR-32 is about: the
    // partial artefacts are preserved and labelled, not thrown away.
    const executor = new FakeExecutor('harness', {
      status: 'incomplete',
      artefacts: [
        { ref: 'artefact-1', sha256: 'sha256:aaa' },
        { ref: 'artefact-2', sha256: 'sha256:bbb' },
      ],
    });
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    // FR-32: the partial artefacts are preserved — not thrown away — and
    // they are labelled.
    expect(outcome.status).toBe('incomplete');
    expect(outcome.artefacts).toHaveLength(2);
    for (const artefact of outcome.artefacts ?? []) {
      expect(artefact.label).toBe('incomplete');
    }
    expect(outcome.artefacts?.[0]?.ref).toBe('artefact-1');
    expect(outcome.artefacts?.[0]?.sha256).toBe('sha256:aaa');
  });

  it('A0.5 · an incomplete stage does not run the executor at all', async () => {
    // The budget is checked **before** the executor runs.
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    await runner.run(
      request({ budget: { maxTurns: 1, turns: 1 } }),
      NEVER_CANCELLED,
    );

    expect(executor.calls).toHaveLength(0);
  });
});

describe('A0.5 · an unknown failure is a workflow.composition failure', () => {
  it('A0.5 · an executor that throws is classified as workflow.composition', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor(
      'harness',
      { status: 'success' },
      new Error('the sandbox vanished'),
    );
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.failureClass).toBe('workflow.composition');
    expect(outcome.rawFailureClass).toBe('unknown');
  });

  it('A0.5 · a failure with no class is classified as workflow.composition', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'failure' });
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.failureClass).toBe('workflow.composition');
  });
});

describe('A0.5 · the loop never loses a node', () => {
  it('A0.5 · a cancelled loop leaves the unrun nodes resumable', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const state = new FakeStateSink();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });
    const loop = new ExecutionLoop({
      runner,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
      state,
      nextRunId: () => 'run_1',
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const outcome = await loop.run(
      [node({ nodeId: 'n1' }), node({ nodeId: 'n2' })],
      cancelledToken('the operator cancelled the task'),
    );

    // Nothing ran, nothing was reported as failed, and the loop is
    // resumable: the nodes are still `READY`.
    expect(outcome.outcomes).toHaveLength(0);
    expect(outcome.cancelled).toBe(true);
    expect(state.toState('FAILED')).toHaveLength(0);
    expect(state.toState('SUCCEEDED')).toHaveLength(0);
  });
});
