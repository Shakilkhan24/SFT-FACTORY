/**
 * `cli` — the **real** checks `factory doctor` runs.
 *
 * ## Why the checks live here and not in `doctor.ts`
 *
 * `doctor.ts` is the **runner**: it takes checks and reports them. This
 * file builds the checks that the production wiring uses — the ones that
 * talk to a real database, the real log and the real schema export.
 *
 * The split is what lets the doctor be **tested without a database**: a
 * test builds its own checks (a failing one, a throwing one, a passing
 * one) and proves the runner reports each of them by name. The checks in
 * this file are then proved by the **acceptance** suite, against a real
 * Postgres — where a check that always passed would be caught.
 *
 * ## Every check is a **named** thing
 *
 * Each check names what it proves and, when it fails, says **why**. That
 * is the difference between a doctor an operator can act on and one that
 * says "not healthy" and stops.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  checkEventLogHealth,
  PostgresEventLog,
  type EventLogHealth,
} from '@factory/eventlog';
import {
  createDatabase,
  destroyDatabase,
  orphanedMigrations,
  status,
  type FactoryDatabase,
  type Kysely,
} from '@factory/db';

import type { CheckOutcome, DoctorCheck } from './doctor.js';

/**
 * The options the production checks are built with.
 */
export interface DoctorCheckOptions {
  /** The connection string for the owner role. */
  readonly connectionString: string;
  /** The directory holding the `.sql` migration files. */
  readonly migrationsDir: string;
  /** How the owner role is assumed. */
  readonly mode?: 'direct' | 'assume';
  /**
   * The directory holding the exported JSON Schemas.
   *
   * The default is `<repo>/schemas`.
   */
  readonly schemasDir?: string;
  /**
   * The directory holding the contracts' compiled schema registry.
   *
   * The export is compared against what the contracts **would** produce,
   * which means the contracts have to be built.
   */
  readonly contractsDistDir?: string;
  /**
   * How long to wait for the database, in milliseconds.
   *
   * The default is **three** seconds, not the connection layer's ten.
   *
   * The reason is the doctor specifically: it is the command an operator
   * runs when the environment is *broken*, and the commonest breakage is
   * an unreachable database. Every check opens the database, so a ten
   * second timeout would make the doctor take a minute to report five
   * failures that all say the same thing. Three seconds is long enough
   * for a slow TLS handshake on a real cluster and short enough that the
   * operator is not left wondering whether the command hung.
   */
  readonly connectTimeoutMs?: number;
}

/**
 * The doctor's own connection timeout.
 */
const DEFAULT_DOCTOR_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Open the database, run the body, and close it.
 *
 * Each check opens its own pool and closes it again. The alternative — one
 * pool for the whole doctor — would be faster, but it would also mean that
 * a check which needs a *different* session (the tamper case, where the
 * append-only trigger has to be disabled) could not have one. And a
 * doctor that shares a pool across checks cannot report a broken
 * connection honestly: the first check would break it and every later
 * check would inherit the failure.
 */
const withDatabase = async <T>(
  options: DoctorCheckOptions,
  body: (db: Kysely<FactoryDatabase>) => Promise<T>,
): Promise<T> => {
  const db = createDatabase({
    connectionString: options.connectionString,
    role: 'factory_owner',
    mode: options.mode ?? 'direct',
    max: 2,
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_DOCTOR_CONNECT_TIMEOUT_MS,
  });
  try {
    return await body(db);
  } finally {
    await destroyDatabase(db);
  }
};

/**
 * The `database` check — the database is reachable and the schema is there.
 */
const databaseCheck = (options: DoctorCheckOptions): DoctorCheck => ({
  name: 'database',
  run: () =>
    withDatabase(options, async (db) => {
      // A trivial statement that touches the schema, so the check proves
      // the **schema** is there and not merely that the server answers.
      await db.selectFrom('tasks').select('id').limit(1).execute();
      return { ok: true, detail: 'reachable; the factory schema is present' };
    }),
});

/**
 * The `migrations` check — every migration is applied, none is orphaned.
 */
const migrationsCheck = (options: DoctorCheckOptions): DoctorCheck => ({
  name: 'migrations',
  run: () =>
    withDatabase(options, async (db) => {
      const rows = await status(db, options.migrationsDir);
      const pending = rows.filter((row) => row.state !== 'applied');
      const orphans = await orphanedMigrations(db, options.migrationsDir);

      if (pending.length > 0) {
        return {
          ok: false,
          reason: `${String(pending.length)} migration(s) are not applied: ${pending
            .map((row) => row.name)
            .join(', ')} — run \`factory db migrate\``,
        };
      }
      if (orphans.length > 0) {
        return {
          ok: false,
          reason: `${String(orphans.length)} applied migration(s) have no file: ${orphans.join(', ')}`,
        };
      }
      return { ok: true, detail: `${String(rows.length)} applied, none pending` };
    }),
});

/**
 * The `event-log` check — the log has no `seq` gap and no version gap.
 */
const eventLogCheck = (options: DoctorCheckOptions): DoctorCheck => ({
  name: 'event-log',
  run: () =>
    withDatabase(options, async (db) => {
      const health: EventLogHealth = await checkEventLogHealth(db);

      if (health.seqGaps.length > 0) {
        return {
          ok: false,
          reason: `the log has ${String(health.seqGaps.length)} seq gap(s): ${health.seqGaps.join(', ')}`,
        };
      }
      if (health.versionGaps.length > 0) {
        return {
          ok: false,
          reason: `the log has ${String(health.versionGaps.length)} aggregate-version gap(s): ${health.versionGaps
            .map((gap) => `${gap.aggregateKind}:${gap.aggregateId} is missing version ${String(gap.missingVersion)}`)
            .join(', ')}`,
        };
      }
      return { ok: true, detail: 'no seq gaps, no version gaps' };
    }),
});

/**
 * The `hash-chain` check — every aggregate's chain verifies.
 *
 * The log is tamper-evident: each event's hash covers the previous one.
 * A single altered event breaks the chain from that point on, and the
 * broken aggregate is **named** — because "the log is tampered with" is
 * not an actionable report.
 */
const hashChainCheck = (options: DoctorCheckOptions): DoctorCheck => ({
  name: 'hash-chain',
  run: () =>
    withDatabase(options, async (db) => {
      const log = new PostgresEventLog({ db });

      const aggregates = await db
        .selectFrom('events')
        .select(['aggregate_kind', 'aggregate_id'])
        .distinct()
        .execute();

      const broken: string[] = [];
      for (const aggregate of aggregates) {
        const verdict = await log.verifyChain({
          kind: aggregate.aggregate_kind,
          id: aggregate.aggregate_id,
        });
        if (!verdict.ok) {
          broken.push(
            `${aggregate.aggregate_kind}:${aggregate.aggregate_id} breaks at seq ${String(verdict.brokenAtSeq ?? '?')}`,
          );
        }
      }

      if (broken.length > 0) {
        return {
          ok: false,
          reason: `${String(broken.length)} aggregate chain(s) are broken: ${broken.join('; ')}`,
        };
      }
      return {
        ok: true,
        detail: `${String(aggregates.length)} aggregate chain(s) verified`,
      };
    }),
});

/**
 * The `schemas` check — `/schemas` matches what the contracts produce.
 *
 * The export is deterministic, so a difference is a **real** change to a
 * contract that was not re-exported — not noise. The check therefore
 * compares the committed files with the registry's output.
 */
const schemasCheck = (options: DoctorCheckOptions): DoctorCheck => ({
  name: 'schemas',
  run: async (): Promise<CheckOutcome> => {
    const schemasDir = options.schemasDir;
    if (schemasDir === undefined) {
      return { ok: false, reason: 'no schemas directory was configured' };
    }
    if (!existsSync(schemasDir)) {
      return {
        ok: false,
        reason: `the schemas directory ${schemasDir} does not exist`,
      };
    }

    const contractsDistDir = options.contractsDistDir;
    if (contractsDistDir === undefined) {
      return { ok: false, reason: 'no contracts build directory was configured' };
    }

    // The contracts must be **built** for the comparison to be possible:
    // the export reads the compiled registry.
    const registryPath = join(contractsDistDir, 'schema-registry.js');
    if (!existsSync(registryPath)) {
      return {
        ok: false,
        reason: `the contracts are not built (${registryPath} is missing) — run \`pnpm typecheck\``,
      };
    }

    try {
      // The documents are built by the **contracts** package, so the check
      // compares against the same bytes the exporter writes. Two
      // implementations of "what the export looks like" would drift, and a
      // drifted check would report a healthy export as stale — a lie.
      const { exportDocuments } = (await import(
        join(contractsDistDir, 'export.js')
      )) as {
        exportDocuments: () => readonly {
          readonly name: string;
          readonly content: string;
        }[];
      };

      const expected = exportDocuments();

      const mismatched: string[] = [];
      for (const document of expected) {
        const path = join(schemasDir, document.name);
        if (!existsSync(path)) {
          mismatched.push(`${document.name} is missing`);
          continue;
        }
        const onDisk = await readFile(path, 'utf8');
        if (onDisk !== document.content) {
          mismatched.push(`${document.name} differs`);
        }
      }

      if (mismatched.length > 0) {
        return {
          ok: false,
          reason: `the schema export is out of date: ${mismatched.join(', ')} — run \`pnpm schemas\``,
        };
      }
      return {
        ok: true,
        detail: `${String(expected.length)} schema(s) match the contracts`,
      };
    } catch (error) {
      return {
        ok: false,
        reason: `the schema export could not be compared: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
});

/**
 * Build the production checks.
 *
 * The order is the order an operator wants to read them in: the
 * infrastructure first, then the data, then the artefacts. A check that
 * depends on an earlier one failing would be misleading, so the order is
 * also the order of **least** to most dependent.
 */
export const buildDoctorChecks = (
  options: DoctorCheckOptions,
): readonly DoctorCheck[] => [
  databaseCheck(options),
  migrationsCheck(options),
  eventLogCheck(options),
  hashChainCheck(options),
  schemasCheck(options),
];
