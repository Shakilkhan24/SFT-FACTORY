/**
 * T-1.02 oracle — the migration runner.
 *
 * checklist 02 T-1.02: "`factory db migrate | status | partitions`" and
 * "Migrations are **forward-only**; never edit an applied migration."
 *
 * The forward-only rule is only real if editing an applied migration is
 * *detected*. This test proves it: it applies the migrations, edits one, and
 * shows that the runner refuses to continue rather than silently applying a
 * schema that no longer matches the repository.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  destroyDatabase,
  migrate,
  orphanedMigrations,
  status,
  type FactoryDatabase,
  type Kysely,
} from '../../packages/db/src/index.ts';
// The CLI's `run` is imported **statically**, not with a dynamic
// `import()` inside each test. The dynamic form put the module-graph
// load *inside* the test's 5 s timeout budget, and under load — 13
// invariant files in parallel, with the Docker-backed suites running —
// the first test to touch it timed out. The test itself is trivial
// (`run(['db'], {})`); the load was the cost.
import { run } from '../../apps/cli/src/index.ts';
import { createPostgres, type Postgres } from '../helpers/postgres.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const migrationsDir = join(repoRoot, 'migrations');

/**
 * The migration files on disk, in order.
 *
 * The assertions below read the *directory* rather than a list written out
 * in the test. A hard-coded list is a snapshot of the directory at the
 * moment the test was written, so every later migration breaks it — and
 * the break looks like a defect in the runner rather than a stale
 * expectation. Reading the directory means the test still says what it
 * means: "the runner applied **every** migration, and only those".
 */
const migrationFiles = (): string[] =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

describe('T-1.02 · the migration runner', () => {
  let pg: Postgres;
  let db: Kysely<FactoryDatabase>;

  beforeAll(async () => {
    pg = await createPostgres('factory_t1_02_migrations');
    db = createDatabase({
      connectionString: pg.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
      max: 2,
    });
  }, 120_000);

  afterAll(async () => {
    await destroyDatabase(db);
    await pg?.destroy();
  });

  it('A1.12 applies every pending migration', async () => {
    const result = await migrate(db, migrationsDir);
    expect(result.applied).toEqual(migrationFiles());
    expect(result.alreadyApplied).toEqual([]);
  }, 120_000);

  it('A1.12 a second run applies nothing', async () => {
    const result = await migrate(db, migrationsDir);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toEqual(migrationFiles());
  }, 60_000);

  it('A1.12 status reports every migration as applied', async () => {
    const rows = await status(db, migrationsDir);
    expect(rows.map((row) => row.state)).toEqual(
      migrationFiles().map(() => 'applied'),
    );
    for (const row of rows) {
      expect(row.appliedAt).not.toBeNull();
    }
  });

  it('A1.12 the migrated database has the event log and the counter row', async () => {
    const out = await pg.psqlAsOwner('SELECT count(*) FROM factory.events;');
    expect(Number(out.split('\n').pop())).toBe(0);
    const counter = await pg.psqlAsOwner('SELECT value FROM factory.event_counter;');
    expect(Number(counter.split('\n').pop())).toBe(0);
  });

  it('A1.12 the migration ledger is not in the event log', async () => {
    // The ledger is infrastructure bookkeeping, not a consequential action.
    // Every row of `events` is consequential (I-3), so the ledger must not
    // be one of them.
    const out = await pg.psqlAsOwner(`
      SELECT count(*) FROM factory.events
      WHERE aggregate_kind = 'system' AND event_type = 'schema_migration.applied';
    `);
    expect(Number(out.split('\n').pop())).toBe(0);
  });

  it('A1.12 editing an applied migration is detected and refused', async () => {
    // Copy the migrations to a scratch directory, apply them, then change one.
    const scratch = mkdtempSync(join(tmpdir(), 'factory-migrations-'));
    const core = readFileSync(join(migrationsDir, '0001_core.sql'), 'utf8');
    const grants = readFileSync(join(migrationsDir, '0001_grants.sql'), 'utf8');
    writeFileSync(join(scratch, '0001_core.sql'), core, 'utf8');
    writeFileSync(join(scratch, '0001_grants.sql'), grants, 'utf8');

    try {
      // A second database for this check, so the main one is untouched.
      const other = await createPostgres('factory_t1_02_edit');
      const otherDb = createDatabase({
        connectionString: other.superuserUrl,
        role: 'factory_owner',
        mode: 'assume',
        max: 2,
      });
      try {
        await migrate(otherDb, scratch);

        // Now edit the applied migration.
        writeFileSync(
          join(scratch, '0001_core.sql'),
          `${core}\n-- an innocent-looking comment\n`,
          'utf8',
        );

        await expect(migrate(otherDb, scratch)).rejects.toThrow(
          /forward-only/i,
        );
      } finally {
        await destroyDatabase(otherDb);
        await other.destroy();
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 180_000);

  it('A1.12 a deleted migration file is reported as an orphan', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'factory-migrations-'));
    const core = readFileSync(join(migrationsDir, '0001_core.sql'), 'utf8');
    const grants = readFileSync(join(migrationsDir, '0001_grants.sql'), 'utf8');
    writeFileSync(join(scratch, '0001_core.sql'), core, 'utf8');

    try {
      const other = await createPostgres('factory_t1_02_orphan');
      const otherDb = createDatabase({
        connectionString: other.superuserUrl,
        role: 'factory_owner',
        mode: 'assume',
        max: 2,
      });
      try {
        await migrate(otherDb, scratch);
        // The grants file disappears after it was applied.
        writeFileSync(join(scratch, '0001_grants.sql'), grants, 'utf8');
        await migrate(otherDb, scratch);
        rmSync(join(scratch, '0001_grants.sql'));

        const orphans = await orphanedMigrations(otherDb, scratch);
        expect(orphans).toEqual(['0001_grants.sql']);
      } finally {
        await destroyDatabase(otherDb);
        await other.destroy();
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('T-1.02 · the CLI', () => {
  it('A1.13 `factory db` with no subcommand explains itself', async () => {
    const result = await run(['db'], {});
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toContain('factory db migrate | status | partitions');
  });

  it('A1.13 `factory db status` without a connection string says so', async () => {
    const result = await run(['db', 'status'], {});
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toContain('FACTORY_OWNER_DATABASE_URL');
  });

  it('A1.13 an unknown subcommand exits non-zero', async () => {
    const result = await run(['db', 'nope'], { FACTORY_OWNER_DATABASE_URL: 'postgresql://x/y' });
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toContain('unknown command');
  });

  it('A1.13 `factory db migrate` applies the migrations', async () => {
    const pg = await createPostgres('factory_t1_02_cli');
    try {
      const result = await run(['db', 'migrate'], {
        FACTORY_OWNER_DATABASE_URL: pg.superuserUrl,
        FACTORY_MIGRATIONS_DIR: migrationsDir,
        FACTORY_DB_ROLE_MODE: 'assume',
      });
      expect(result.exitCode).toBe(0);
      expect(result.lines.join('\n')).toContain('applied  0001_core.sql');

      // The schema really is there.
      const out = await pg.psqlAsOwner('SELECT count(*) FROM factory.events;');
      expect(Number(out.split('\n').pop())).toBe(0);
    } finally {
      await pg.destroy();
    }
  }, 180_000);

  it('A1.13 `factory db partitions --ensure` creates the monthly partitions', async () => {
    const pg = await createPostgres('factory_t1_02_cli_parts');
    try {
      const env = {
        FACTORY_OWNER_DATABASE_URL: pg.superuserUrl,
        FACTORY_MIGRATIONS_DIR: migrationsDir,
        FACTORY_DB_ROLE_MODE: 'assume',
      };
      await run(['db', 'migrate'], env);
      const result = await run(['db', 'partitions', '--ensure', '3'], env);
      expect(result.exitCode).toBe(0);
      const text = result.lines.join('\n');
      expect(text).toContain('ensured partitions 3 month(s) ahead');
      expect(text).toContain('default  events_default');
      expect(text).toMatch(/monthly\s+events_\d{4}_\d{2}/);
    } finally {
      await pg.destroy();
    }
  }, 180_000);
});
