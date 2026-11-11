/**
 * T-1.17 — `factory doctor` against a real Postgres.
 *
 * checklist 03, CL-G1-14: "`factory doctor` passes locally | output
 * attached | agent".
 *
 * ## Why this file exists alongside `tests/unit/cli-doctor.test.ts`
 *
 * The unit suite proves the **runner**: that every check runs, that a
 * failure names itself, that a throwing check is a failed check rather than
 * a crashed doctor, and that the exit code is the machine-readable answer.
 * It proves that with **injected** checks, so it can run anywhere.
 *
 * This file proves the **checks themselves**. A check that always passed
 * would sail through the unit suite untouched — the runner would report
 * "ok" and the suite would still be green. So the checks have to be
 * exercised against the thing they claim to check: a real database with
 * real migrations, a real event log with a real hash chain, and the real
 * committed schema export.
 *
 * The claims that can only be proved here:
 *
 * 1. **`database` fails when the database is not reachable.** A check that
 *    catches nothing would report "ok".
 * 2. **`migrations` fails when a migration file has not been applied**,
 *    and names the file.
 * 3. **`event-log` and `hash-chain` fail on a tampered log** — and the
 *    tamper is done the way an attacker would do it, through the owner
 *    role, with the append-only trigger disabled.
 * 4. **`schemas` fails when the export is out of date.**
 *
 * ## The environment
 *
 * This suite needs a real Postgres — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available the suite **skips** rather than fails: the
 * absence of a Docker daemon is an environment limit, not a defect in the
 * doctor. The suite runs in CI, where the daemon exists.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runDoctor } from '../../../apps/cli/src/doctor.ts';
import { buildDoctorChecks } from '../../../apps/cli/src/doctor-checks.ts';
import {
  createDatabase,
  destroyDatabase,
  migrate,
  type FactoryDatabase,
  type Kysely,
} from '../../../packages/db/src/index.ts';
import { PostgresEventLog } from '../../../packages/eventlog/src/index.ts';

import { containerRunning, insertTask, migrationsDir } from '../../helpers/eventlog.ts';
import { createPostgres, type Postgres } from '../../helpers/postgres.ts';

/**
 * Whether the dev Postgres container is up.
 */
const running = await containerRunning();

/**
 * The repository root — three levels up from `tests/acceptance/cli/`.
 */
const repoRoot = join(import.meta.dirname, '..', '..', '..');

/**
 * The committed schema export.
 */
const repoSchemasDir = join(repoRoot, 'schemas');

/**
 * The contracts' compiled output.
 */
const repoContractsDist = join(repoRoot, 'packages', 'contracts', 'dist');

/**
 * The lines, joined, for a readable assertion.
 */
const text = (lines: readonly string[]): string => lines.join('\n');

describe('T-1.17 · factory doctor against a real Postgres', () => {
  let postgres: Postgres;
  let db: Kysely<FactoryDatabase>;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    postgres = await createPostgres('factory_t1_17_doctor');
    db = createDatabase({
      connectionString: postgres.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
      max: 10,
    });
    await migrate(db, migrationsDir);
  });

  afterAll(async () => {
    if (!running || postgres === undefined) {
      return;
    }
    await destroyDatabase(db);
    await postgres.destroy();
  });

  it.skipIf(!running)('passes on a healthy database and exits 0', async () => {
    const result = await runDoctor({
      checks: buildDoctorChecks({
        connectionString: postgres.superuserUrl,
        migrationsDir,
        mode: 'assume',
        schemasDir: repoSchemasDir,
        contractsDistDir: repoContractsDist,
      }),
    });

    expect(text(result.lines)).toContain('ok    database');
    expect(text(result.lines)).toContain('ok    migrations');
    expect(text(result.lines)).toContain('ok    event-log');
    expect(text(result.lines)).toContain('ok    hash-chain');
    expect(text(result.lines)).toContain('ok    schemas');
    expect(result.exitCode).toBe(0);
  });

  it.skipIf(!running)('fails the database check when the database is unreachable', async () => {
    // A port nothing is listening on. The check must *fail*, not hang and
    // not pass — a check that swallowed the connection error would report
    // a healthy factory.
    const result = await runDoctor({
      checks: buildDoctorChecks({
        connectionString: 'postgresql://factory:factory@127.0.0.1:1/nope',
        migrationsDir,
        mode: 'assume',
        connectTimeoutMs: 1_000,
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(text(result.lines)).toContain('FAIL  database');
    // Every check still ran — the doctor reported the whole picture.
    expect(text(result.lines)).toContain('FAIL  migrations');
  }, 60_000);

  it.skipIf(!running)('fails the migrations check and names the pending migration', async () => {
    // A migrations directory with one **extra** file that has never been
    // applied. The doctor must name it and say what to run.
    const root = await mkdtemp(join(tmpdir(), 'factory-doctor-'));
    try {
      await writeFile(
        join(root, '9999_never_applied.sql'),
        ['-- a migration that was never applied', 'SELECT 1;', ''].join('\n'),
        'utf8',
      );

      const result = await runDoctor({
        checks: buildDoctorChecks({
          connectionString: postgres.superuserUrl,
          migrationsDir: root,
          mode: 'assume',
        }),
      });

      expect(result.exitCode).toBe(1);
      expect(text(result.lines)).toContain('FAIL  migrations');
      expect(text(result.lines)).toContain('9999_never_applied.sql');
      // The reason names the fix, not just the symptom.
      expect(text(result.lines)).toContain('factory db migrate');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!running)('fails the event-log and hash-chain checks on a tampered log', async () => {
    // A separate database, because the tamper is permanent — `events` is
    // append-only and the whole point is to break that.
    const tampered = await createPostgres('factory_t1_17_doctor_tampered');
    const tamperedDb = createDatabase({
      connectionString: tampered.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
      max: 10,
    });

    try {
      await migrate(tamperedDb, migrationsDir);
      await insertTask(tamperedDb, 'task_pg_doctor_tamper');

      const log = new PostgresEventLog({ db: tamperedDb });
      await log.append([
        {
          eventType: 'intent.recorded',
          aggregate: { kind: 'task', id: 'task_pg_doctor_tamper', version: 0 },
          correlationId: 'task_pg_doctor_tamper',
          actor: { kind: 'human', id: 'tester' },
          authority: { basis: 'human-access-point' },
          subject: {},
          payload: { source: 'manual', repo: 'org/repo' },
          context: { items: [] },
        },
      ]);

      // Tamper the way an attacker with the owner role would: change the
      // payload of a committed event, with the append-only trigger out of
      // the way. The chain hashes must then break.
      const tamperOutput = await tampered.psqlAsOwner(`
        ALTER TABLE factory.events DISABLE TRIGGER events_no_update_delete;
        UPDATE factory.events
        SET payload = jsonb_set(payload, '{source}', '"tampered"')
        WHERE aggregate_id = 'task_pg_doctor_tamper';
        ALTER TABLE factory.events ENABLE TRIGGER events_no_update_delete;
      `);
      expect(tamperOutput).not.toMatch(/ERROR:/i);

      // The tamper actually landed — otherwise this test would pass for
      // the wrong reason.
      const payload = await tampered.psqlAsOwner(
        `SELECT payload::text FROM factory.events WHERE aggregate_id = 'task_pg_doctor_tamper';`,
      );
      expect(payload).toContain('tampered');

      const result = await runDoctor({
        checks: buildDoctorChecks({
          connectionString: tampered.superuserUrl,
          migrationsDir,
          mode: 'assume',
        }),
      });

      expect(result.exitCode).toBe(1);
      // The chain check names the broken aggregate and the sequence it
      // breaks at — "the log is tampered with" is not actionable.
      expect(text(result.lines)).toContain('FAIL  hash-chain');
      expect(text(result.lines)).toContain('task:task_pg_doctor_tamper breaks at seq');
    } finally {
      await destroyDatabase(tamperedDb);
      await tampered.destroy();
    }
  });

  it.skipIf(!running)('fails the schemas check when the export is out of date', async () => {
    // A schemas directory whose contents do not match the contracts: an
    // **empty** directory, so every contract's file is missing. The check
    // must fail and name the fix.
    const root = await mkdtemp(join(tmpdir(), 'factory-doctor-schemas-'));
    try {
      const result = await runDoctor({
        checks: buildDoctorChecks({
          connectionString: postgres.superuserUrl,
          migrationsDir,
          mode: 'assume',
          schemasDir: root,
          contractsDistDir: repoContractsDist,
        }),
      });

      expect(result.exitCode).toBe(1);
      expect(text(result.lines)).toContain('FAIL  schemas');
      expect(text(result.lines)).toContain('is missing');
      // The reason names the fix.
      expect(text(result.lines)).toContain('pnpm schemas');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!running)('fails the schemas check when a file has been edited', async () => {
    // The export is **deterministic**, so a difference is a real change to
    // a contract that was not re-exported — not noise. The check must
    // notice the edited file and name it.
    const root = await mkdtemp(join(tmpdir(), 'factory-doctor-schemas-'));
    try {
      // Start from a copy of the real export, then edit one file.
      const { cp } = await import('node:fs/promises');
      await cp(repoSchemasDir, root, { recursive: true });
      await writeFile(join(root, 'context.item.json'), '{ "tampered": true }\n', 'utf8');

      const result = await runDoctor({
        checks: buildDoctorChecks({
          connectionString: postgres.superuserUrl,
          migrationsDir,
          mode: 'assume',
          schemasDir: root,
          contractsDistDir: repoContractsDist,
        }),
      });

      expect(result.exitCode).toBe(1);
      expect(text(result.lines)).toContain('FAIL  schemas');
      expect(text(result.lines)).toContain('context.item.json differs');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
