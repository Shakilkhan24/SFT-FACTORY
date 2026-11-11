#!/usr/bin/env node
/**
 * `tools/fault-worker` — the process that gets **killed** (T-1.17).
 *
 * ## Why a separate process
 *
 * A0.5's claim is about a **process dying**:
 *
 * > **A0.5** | Killing the control plane mid-run yields a resumed or
 * > explicitly failed task — **never a silent loss** | Fault injection
 *
 * A `FakeExecutor` that throws, or a promise that rejects, is not a kill.
 * Those are *handled* failures: the runner catches them and records them.
 * A `SIGKILL` is different — the process does not run any cleanup, does not
 * finish its promise chain, and does not get to write anything on the way
 * out. The only way to observe that is to **actually kill a process** and
 * then look at what survived.
 *
 * So this file is a real program: it starts a run, writes the run's row to
 * Postgres, announces that it is ready, and then **hangs** — waiting for a
 * signal that will never be handled. The parent kills it and then inspects
 * the database.
 *
 * ## The protocol
 *
 * The worker speaks a line protocol on **stdout**:
 *
 * | line | meaning |
 * |---|---|
 * | `READY <runId>` | the row is durable; the worker is now hanging |
 * | `ERROR <message>` | the worker could not start; it is exiting non-zero |
 *
 * The parent reads the `READY` line, kills the worker, and then reads the
 * database. So the kill always lands *after* the evidence is durable —
 * otherwise the test would be racing the write rather than testing the kill.
 *
 * ## Why the row is written by the worker and not by the parent
 *
 * Because the row must be written by **the process that dies**. If the
 * parent wrote it, the row would survive a kill that happened *before* the
 * worker ever started — and the proof would be worthless. The `READY` line
 * is the worker's own claim that *it* wrote *that* row.
 *
 * ## Usage
 *
 * ```
 * node tools/fault-worker.ts --connection-string <url> --task-id <id> --run-id <id> --node-id <id>
 * ```
 *
 * The worker exits **0** only when it is told to exit cleanly (never, in
 * the fault suite) and **non-zero** when it could not start.
 *
 * ## Why it runs the **compiled** packages
 *
 * The repo's sources use `NodeNext` with `.js` specifiers, so importing a
 * package's `src` entry would not resolve at runtime under Node's native
 * type-stripping (it does not rewrite `./dep.js` to `./dep.ts`).
 *
 * And the workspace packages declare `"exports": { ".": "./src/index.ts" }`,
 * so a bare `@factory/db` resolves to the **source** — which then fails on
 * its own `.js` specifiers. `tools/compiled-resolver.mjs` is the hook that
 * maps `@factory/<name>` to `packages/<name>/dist/index.js`, and the
 * worker is launched through it:
 *
 * ```
 * node --import ./tools/compiled-resolver.mjs tools/fault-worker.ts …
 * ```
 *
 * So the worker runs the **built** packages — the artifacts that ship —
 * and the packages must have been built (`pnpm typecheck` does that, and
 * the CI chain runs it before the suites).
 */

import { createDatabase, type FactoryDatabase, type Kysely, sql } from '@factory/db';
import { PostgresRunRecordStore } from '@factory/artefacts';

/**
 * The parsed arguments.
 */
interface Options {
  readonly connectionString: string;
  readonly taskId: string;
  readonly runId: string;
  readonly nodeId: string;
  /**
   * When the worker's lease expires.
   *
   * The lease is the liveness oracle, so the value decides what the
   * database says about the worker after it dies. An **already-expired**
   * lease is the honest value for a worker that is about to be killed:
   * nobody is holding it, so it is already reclaimable.
   */
  readonly leaseExpiresAt: string;
}

/**
 * Read the arguments.
 *
 * The worker is a program, not a library, so it reads `argv` directly. A
 * missing argument is a **hard** failure — the worker must not start in a
 * half-configured state, because a worker that started without a run id
 * would write a row nobody could find, and the fault suite would then be
 * measuring nothing.
 */
const readOptions = (argv: readonly string[]): Options => {
  const valueOf = (name: string): string => {
    const index = argv.indexOf(name);
    const value = index === -1 ? undefined : argv[index + 1];
    if (value === undefined || value.length === 0) {
      throw new Error(`the worker needs a value for ${name}`);
    }
    return value;
  };

  return {
    connectionString: valueOf('--connection-string'),
    taskId: valueOf('--task-id'),
    runId: valueOf('--run-id'),
    nodeId: valueOf('--node-id'),
    leaseExpiresAt: valueOf('--lease-expires-at'),
  };
};

/**
 * The worker's main.
 */
const main = async (): Promise<void> => {
  const options = readOptions(process.argv.slice(2));

  let db: Kysely<FactoryDatabase> | undefined;
  try {
    db = createDatabase({
      connectionString: options.connectionString,
      role: 'factory_owner',
      mode: 'assume',
      max: 2,
    });

    const store = new PostgresRunRecordStore({ db });

    // The row is written **before** the worker announces itself. This is
    // the run's durable beginning: the run is `running`, it has no
    // `ended_at`, and it has no record. That is exactly the state a kill
    // leaves behind.
    await store.writeStarted({
      runId: options.runId,
      taskId: options.taskId,
      nodeId: options.nodeId,
      attempt: 1,
      role: 'worker',
      stageKind: 'implement',
      executorKind: 'harness',
      status: 'running',
      startedAt: new Date().toISOString(),
      costUsdMicros: 0,
      tokens: {},
      retentionClass: 'engineering',
    });

    // The worker's **lease**.
    //
    // The lease is the liveness oracle: pack `02` §4.8 says a node with an
    // expired lease is re-queued, and the resume path asks the lease store
    // who is still working. So a killed worker must leave a lease behind —
    // one that has already expired, because the worker that held it is gone.
    //
    // The lease is written by the worker itself, for the same reason the
    // run row is: the evidence must be written by the process that dies.
    await sql`
      INSERT INTO factory.jobs (
        task_id, node_id, kind, status, priority, available_at,
        lease_owner, lease_expires_at, attempt, max_attempts,
        idempotency_key, payload
      ) VALUES (
        ${options.taskId},
        ${options.nodeId},
        'implement',
        'leased',
        100,
        now(),
        'worker-killed',
        ${options.leaseExpiresAt},
        1,
        3,
        ${`job_${options.runId}`},
        '{}'::jsonb
      )
    `.execute(db);

    // The `READY` line is the handshake. It is written **after** the row
    // is committed, so the parent knows the evidence is durable before it
    // fires the kill.
    process.stdout.write(`READY ${options.runId}\n`);

    // Now hang. The worker simulates a worker that is inside a long stage
    // when the operator (or the OOM killer, or the node) takes it down.
    //
    // The hang is deliberate and is **not** a busy-wait: a spin would burn
    // a core for the duration of the test. An unresolved promise parks the
    // event loop's work, and the process sits there until the signal
    // arrives.
    //
    // `SIGKILL` cannot be caught, so there is no handler — that is the
    // point. A `SIGTERM` handler that cleaned up would prove nothing about
    // the case A0.5 is about.
    await new Promise<void>(() => {
      /* never resolves */
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`ERROR ${message}\n`);
    process.exitCode = 1;
  } finally {
    // The `finally` runs only when the worker exits **normally** — which,
    // under `SIGKILL`, it never does. The pool is torn down here so the
    // error path does not leave a socket open.
    await db?.destroy().catch(() => undefined);
  }
};

await main();
