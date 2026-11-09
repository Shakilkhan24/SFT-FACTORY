/**
 * The event-log test harness.
 *
 * checklist 02 T-1.03's exit criteria are all statements about *concurrency*
 * and *durability* against a real server:
 *
 * * "50 concurrent appends ⇒ gapless strictly-increasing `seq` in commit
 *   order"
 * * "a CAS conflict ⇒ `ConcurrencyError` and **no event**"
 * * "a rollback leaves no `seq` gap"
 * * "tampering via the owner role is detected by `verifyChain`"
 *
 * None of those can be proved against a mock. A mock has no `FOR UPDATE`, no
 * transactions, no triggers and no `bytea`. So the harness stands up a
 * throwaway Postgres (the same helper the DDL tests use), applies the
 * migrations, and hands back a Kysely handle the tests drive directly.
 *
 * The harness refuses to create a database it did not create — the name is
 * prefixed `factory_t1_`, the same rule the DDL harness uses.
 */

import { join, resolve } from 'node:path';

import { createDatabase, destroyDatabase, migrate, type FactoryDatabase, type Kysely } from '../../packages/db/src/index.ts';
import { createPostgres, type Postgres } from './postgres.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..');

/** The migrations directory. */
export const migrationsDir = join(repoRoot, 'migrations');

/**
 * A live event-log environment: a throwaway database with the schema
 * applied, and a Kysely handle pointed at it.
 */
export interface EventLogHarness {
  /** The throwaway database. */
  readonly pg: Postgres;

  /** A handle that acts as `factory_owner` (the role that owns the schema). */
  readonly db: Kysely<FactoryDatabase>;

  /** A second handle on the same database — used to simulate a second writer. */
  readonly second: Kysely<FactoryDatabase>;

  /** Tear everything down. */
  readonly destroy: () => Promise<void>;
}

/**
 * Whether the dev Postgres container is running.
 *
 * The container is the only place the schema can exist. When it is not
 * running the tests skip — loudly, because a silently-skipped oracle is a
 * weakened oracle.
 */
export const containerRunning = async (): Promise<boolean> => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const container = process.env['FACTORY_PG_CONTAINER'] ?? 'factory-postgres-dev';
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Names}}'], {
      encoding: 'utf8',
    });
    return stdout.split('\n').some((name) => name.trim() === container);
  } catch {
    return false;
  }
};

/**
 * Stand up a throwaway database with the schema applied.
 *
 * The handle acts as `factory_owner` in `assume` mode: it logs in as the
 * superuser and `SET ROLE`s. That is how the dev cluster works, and it is
 * the only way to be the *owner* of the tables — which the tamper test
 * needs, because tampering is done by the owner.
 */
export const createEventLogHarness = async (
  name: string,
): Promise<EventLogHarness> => {
  const pg = await createPostgres(name);

  const db = createDatabase({
    connectionString: pg.superuserUrl,
    role: 'factory_owner',
    mode: 'assume',
    max: 20,
  });

  await migrate(db, migrationsDir);

  const second = createDatabase({
    connectionString: pg.superuserUrl,
    role: 'factory_owner',
    mode: 'assume',
    max: 20,
  });

  return {
    pg,
    db,
    second,
    destroy: async () => {
      await destroyDatabase(db);
      await destroyDatabase(second);
      await pg.destroy();
    },
  };
};

/**
 * Insert a task row directly, bypassing the event log.
 *
 * The event log's CAS-bump needs a row to bump. A test that wants to append
 * an event about a task therefore needs the task to exist first — and that
 * creation is *not* an event (a task row is created by the intake path,
 * which T-1.04 owns).
 */
export const insertTask = async (
  db: Kysely<FactoryDatabase>,
  taskId: string,
  overrides: { readonly version?: number } = {},
): Promise<void> => {
  await db
    .insertInto('tasks')
    .values({
      id: taskId,
      repo: 'org/repo',
      workflow: 'wf_test',
      state: 'INTAKE',
      version: overrides.version ?? 0,
      autonomy_level: 2,
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
 * Read a task's current version.
 */
export const taskVersion = async (
  db: Kysely<FactoryDatabase>,
  taskId: string,
): Promise<number | undefined> => {
  const rows = await db
    .selectFrom('tasks')
    .select('version')
    .where('id', '=', taskId)
    .execute();
  return rows[0] === undefined ? undefined : rows[0].version;
};

/**
 * The number of rows in the event log.
 */
export const eventCount = async (db: Kysely<FactoryDatabase>): Promise<number> => {
  const rows = await db
    .selectFrom('events')
    .select('seq')
    .execute();
  return rows.length;
};

/**
 * The `seq` values currently in the log, in order.
 */
export const eventSeqs = async (db: Kysely<FactoryDatabase>): Promise<number[]> => {
  const rows = await db
    .selectFrom('events')
    .select('seq')
    .orderBy('seq', 'asc')
    .execute();
  return rows.map((row) => Number(row.seq));
};
