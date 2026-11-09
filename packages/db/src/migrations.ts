/**
 * `db` — the migration runner (checklist 02, T-1.02).
 *
 * Migrations are **forward-only** (pack 03 §2: "SQL-first, forward-only
 * migrations in `/migrations` (R4 path)"). There is no `down`, no `rollback`,
 * and no "edit the applied migration" path — an applied migration is
 * immutable, and a change to the schema is a new numbered file.
 *
 * The runner keeps its own ledger in `factory.schema_migrations`, separate from
 * the event log. The ledger is *not* an event: it is infrastructure bookkeeping
 * about which SQL files have been applied, and putting it in the event log
 * would put a non-consequential row in a log whose every row is consequential
 * (I-3). The `schema_migration.applied` event type records the consequential
 * fact — that the schema changed — in the log where the audit expects it.
 *
 * Every migration runs inside its own transaction, so a failure leaves the
 * database exactly as it was.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql, type Kysely } from 'kysely';

import type { FactoryDatabase } from './types.js';

/**
 * The migration ledger table.
 *
 * It is created by the runner itself, not by a migration file, because the
 * runner needs it before it can know which migrations to run.
 */
export const MIGRATION_LEDGER = 'schema_migrations';

export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

/**
 * The checksum of a migration's SQL.
 *
 * SHA-256 over the file bytes. If a migration file changes after it was
 * applied, the checksum no longer matches and the runner refuses to continue —
 * that is the "never edit an applied migration" rule enforced rather than
 * merely stated.
 */
export const checksumOf = (sqlText: string): string =>
  createHash('sha256').update(sqlText, 'utf8').digest('hex');

/**
 * Read the migration files from a directory, in order.
 *
 * The order is the lexicographic order of the file names, which is why they
 * are zero-padded (`0001_…`, `0002_…`).
 */
export const readMigrations = (directory: string): MigrationFile[] => {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return names.map((name) => {
    const text = readFileSync(join(directory, name), 'utf8');
    return { name, sql: text, checksum: checksumOf(text) };
  });
};

/**
 * Create the ledger table if it is absent.
 *
 * The schema is created first, if it does not exist: the very first
 * migration creates it too, but the ledger has to exist *before* the first
 * migration can be recorded — so the runner cannot wait for the DDL to
 * create the schema.
 */
export const ensureLedger = async (db: Kysely<FactoryDatabase>): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS factory`.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS factory.${sql.id(MIGRATION_LEDGER)} (
      name        text        PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
};

/**
 * The migrations already applied to this database.
 */
export const appliedMigrations = async (
  db: Kysely<FactoryDatabase>,
): Promise<AppliedMigration[]> => {
  const rows = await sql<{ name: string; checksum: string; applied_at: Date }>`
    SELECT name, checksum, applied_at
    FROM factory.${sql.id(MIGRATION_LEDGER)}
    ORDER BY name
  `.execute(db);
  return rows.rows.map((row) => ({
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
};

export interface MigrateResult {
  /** The migrations this run applied, in order. */
  readonly applied: readonly string[];
  /** The migrations that were already applied. */
  readonly alreadyApplied: readonly string[];
}

/**
 * A migration that was applied and has since changed on disk.
 */
export class MigrationChecksumMismatchError extends Error {
  public readonly migrationName: string;
  public readonly expected: string;
  public readonly actual: string;

  constructor(migrationName: string, expected: string, actual: string) {
    super(
      `migration ${migrationName} was applied with checksum ${expected} but the file on disk now hashes to ${actual}; ` +
        'migrations are forward-only — revert the file or add a new migration',
    );
    this.name = 'MigrationChecksumMismatchError';
    this.migrationName = migrationName;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Apply every pending migration, in order, each in its own transaction.
 *
 * The transaction is per migration, not for the whole run: a failure in
 * migration 7 must not roll back migration 6, and each migration is an
 * independent unit of change.
 */
export const migrate = async (
  db: Kysely<FactoryDatabase>,
  directory: string,
): Promise<MigrateResult> => {
  await ensureLedger(db);

  const files = readMigrations(directory);
  const applied = await appliedMigrations(db);
  const appliedByName = new Map(applied.map((row) => [row.name, row]));

  // A migration that was applied and whose file has changed is a hard error.
  // The alternatives — re-applying it, or ignoring the difference — are both
  // wrong: the database would no longer match the repository.
  for (const file of files) {
    const prior = appliedByName.get(file.name);
    if (prior !== undefined && prior.checksum !== file.checksum) {
      throw new MigrationChecksumMismatchError(file.name, prior.checksum, file.checksum);
    }
  }

  const appliedNames: string[] = [];
  const alreadyApplied: string[] = [];

  for (const file of files) {
    if (appliedByName.has(file.name)) {
      alreadyApplied.push(file.name);
      continue;
    }

    await db.transaction().execute(async (trx) => {
      await sql.raw(file.sql).execute(trx);
      await sql`
        INSERT INTO factory.${sql.id(MIGRATION_LEDGER)} (name, checksum)
        VALUES (${file.name}, ${file.checksum})
      `.execute(trx);
    });

    appliedNames.push(file.name);
  }

  return { applied: appliedNames, alreadyApplied };
};

export interface MigrationStatus {
  readonly name: string;
  readonly state: 'applied' | 'pending';
  readonly checksum: string;
  readonly appliedAt: Date | null;
}

/**
 * The status of every migration, applied or not.
 */
export const status = async (
  db: Kysely<FactoryDatabase>,
  directory: string,
): Promise<MigrationStatus[]> => {
  await ensureLedger(db);
  const files = readMigrations(directory);
  const applied = await appliedMigrations(db);
  const appliedByName = new Map(applied.map((row) => [row.name, row]));

  return files.map((file) => {
    const prior = appliedByName.get(file.name);
    return {
      name: file.name,
      state: prior === undefined ? 'pending' : 'applied',
      checksum: file.checksum,
      appliedAt: prior?.appliedAt ?? null,
    };
  });
};

/**
 * The names of the migrations that are applied but whose file is gone.
 *
 * A deleted migration file is a removed unit of history — the database still
 * has it. The runner reports it rather than pretending it does not exist.
 */
export const orphanedMigrations = async (
  db: Kysely<FactoryDatabase>,
  directory: string,
): Promise<string[]> => {
  await ensureLedger(db);
  const files = readMigrations(directory);
  const onDisk = new Set(files.map((file) => file.name));
  const applied = await appliedMigrations(db);
  return applied.filter((row) => !onDisk.has(row.name)).map((row) => row.name);
};

export interface PartitionInfo {
  /** The partition's name, e.g. `events_2026_11`. */
  readonly name: string;
  /** The partition's lower bound (inclusive). */
  readonly from: string;
  /** The partition's upper bound (exclusive). */
  readonly to: string;
  /** `false` for the default partition. */
  readonly isDefault: boolean;
}

/**
 * List the partitions of `factory.events`, oldest first, default last.
 */
export const eventPartitions = async (
  db: Kysely<FactoryDatabase>,
): Promise<PartitionInfo[]> => {
  const rows = await sql<{
    name: string;
    bounds: string;
    is_default: boolean;
  }>`
    SELECT
      c.relname                                        AS name,
      pg_get_expr(c.relpartbound, c.oid)              AS bounds,
      (pg_get_expr(c.relpartbound, c.oid) LIKE '%DEFAULT%') AS is_default
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent = 'factory.events'::regclass
    ORDER BY c.relname
  `.execute(db);

  return rows.rows.map((row) => {
    const bounds = row.bounds ?? '';
    const numbers = bounds.match(/'([^']+)'/g) ?? [];
    const from = numbers[0]?.replace(/'/g, '') ?? '';
    const to = numbers[1]?.replace(/'/g, '') ?? '';
    return {
      name: row.name,
      from,
      to,
      isDefault: row.is_default,
    };
  });
};

/**
 * Create the monthly partitions for the next `monthsAhead` months.
 *
 * The function `factory.ensure_event_partitions()` is idempotent by
 * construction: it checks `to_regclass` before creating. The runner calls it
 * and reports how many partitions exist afterwards.
 *
 * This must run as `factory_owner` — it needs CREATE on the schema, and no
 * runtime role has it.
 */
export const ensurePartitions = async (
  db: Kysely<FactoryDatabase>,
  monthsAhead = 3,
): Promise<number> => {
  await sql`SELECT factory.ensure_event_partitions(${monthsAhead})`.execute(db);
  const partitions = await eventPartitions(db);
  return partitions.length;
};
