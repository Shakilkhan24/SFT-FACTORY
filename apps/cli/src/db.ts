/**
 * `factory db` — the database operations commands.
 *
 * checklist 02 T-1.02: "`factory db migrate | status | partitions`".
 * The command names are normative (pack 04 §"Command catalogue").
 *
 * `migrate` and `partitions` run as `factory_owner` — the owner role owns the
 * schema, applies migrations and may create partitions (which needs CREATE on
 * the schema). `status` runs as the owner too, because it reads the migration
 * ledger, which no runtime role can see.
 */

import {
  createDatabase,
  destroyDatabase,
  ensurePartitions,
  eventPartitions,
  migrate,
  orphanedMigrations,
  status,
  type FactoryDatabase,
} from '@factory/db';
import type { Kysely } from 'kysely';

import { resolveMigrationDirectory } from './paths.js';

export interface DbOptions {
  /** The connection string for the owner role. */
  readonly connectionString: string;
  /** The directory holding the `.sql` migration files. */
  readonly migrationsDir: string;
  /**
   * How the owner role is assumed.
   *
   * `direct` — the connection string logs in as `factory_owner` itself
   *   (production). `assume` — the connection logs in as a superuser and
   *   `SET ROLE factory_owner` (the dev cluster, where the role is NOLOGIN).
   *
   * The mode matters for correctness, not just convenience: the tables must
   * be *owned* by `factory_owner`, because the owner role is the one the
   * privileges are written against.
   */
  readonly mode?: 'direct' | 'assume';
}

export interface DbCommandResult {
  /** The lines to print. */
  readonly lines: readonly string[];
  /** The process exit code. */
  readonly exitCode: number;
}

const withDatabase = async <T>(
  options: DbOptions,
  body: (db: Kysely<FactoryDatabase>) => Promise<T>,
): Promise<T> => {
  const db = createDatabase({
    connectionString: options.connectionString,
    role: 'factory_owner',
    mode: options.mode ?? 'direct',
    max: 2,
  });
  try {
    return await body(db);
  } finally {
    await destroyDatabase(db);
  }
};

/**
 * `factory db migrate` — apply every pending migration.
 */
export const dbMigrate = async (options: DbOptions): Promise<DbCommandResult> =>
  withDatabase(options, async (db) => {
    const result = await migrate(db, options.migrationsDir);
    const lines: string[] = [];
    for (const name of result.applied) {
      lines.push(`applied  ${name}`);
    }
    if (result.applied.length === 0) {
      lines.push('no pending migrations');
    }
    for (const name of result.alreadyApplied) {
      lines.push(`skipped  ${name} (already applied)`);
    }
    const orphans = await orphanedMigrations(db, options.migrationsDir);
    for (const name of orphans) {
      lines.push(`WARNING  ${name} is applied but the file is gone from the migrations directory`);
    }
    return { lines, exitCode: 0 };
  });

/**
 * `factory db status` — which migrations are applied and which are pending.
 */
export const dbStatus = async (options: DbOptions): Promise<DbCommandResult> =>
  withDatabase(options, async (db) => {
    const rows = await status(db, options.migrationsDir);
    const lines = rows.map((row) => {
      const mark = row.state === 'applied' ? 'applied' : 'pending';
      const when = row.appliedAt === null ? '' : ` at ${row.appliedAt.toISOString()}`;
      return `${mark.padEnd(8)} ${row.name}${when}`;
    });
    const orphans = await orphanedMigrations(db, options.migrationsDir);
    for (const name of orphans) {
      lines.push(`orphan   ${name} (applied, file missing)`);
    }
    if (lines.length === 0) {
      lines.push('no migrations found');
    }
    return { lines, exitCode: 0 };
  });

/**
 * `factory db partitions` — list the event-log partitions.
 *
 * With `--ensure [months]`, create the monthly partitions ahead of time. The
 * function is idempotent: running it twice creates nothing the second time.
 */
export const dbPartitions = async (
  options: DbOptions,
  monthsAhead?: number,
): Promise<DbCommandResult> =>
  withDatabase(options, async (db) => {
    const lines: string[] = [];
    if (monthsAhead !== undefined) {
      const count = await ensurePartitions(db, monthsAhead);
      lines.push(`ensured partitions ${monthsAhead} month(s) ahead — ${count} partition(s) total`);
    }
    const partitions = await eventPartitions(db);
    for (const partition of partitions) {
      if (partition.isDefault) {
        lines.push(`default  ${partition.name}`);
      } else {
        lines.push(`monthly  ${partition.name}  [${partition.from} .. ${partition.to})`);
      }
    }
    if (partitions.length === 0) {
      lines.push('no partitions — run `factory db migrate` first');
    }
    return { lines, exitCode: 0 };
  });

/**
 * Dispatch `factory db <subcommand>`.
 */
export const runDbCommand = async (
  subcommand: string,
  options: DbOptions,
  argv: readonly string[],
): Promise<DbCommandResult> => {
  switch (subcommand) {
    case 'migrate': {
      return dbMigrate(options);
    }
    case 'status': {
      return dbStatus(options);
    }
    case 'partitions': {
      const ensureIndex = argv.indexOf('--ensure');
      if (ensureIndex === -1) {
        return dbPartitions(options);
      }
      const raw = argv[ensureIndex + 1];
      const months = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 3;
      return dbPartitions(options, months);
    }
    default: {
      return {
        lines: [`unknown command \`factory db ${subcommand}\``, 'usage: factory db migrate | status | partitions'],
        exitCode: 2,
      };
    }
  }
};

/**
 * Where the migration files live, relative to the repository root.
 */
export const defaultMigrationsDir = (
  environment: NodeJS.ProcessEnv = process.env,
): string => resolveMigrationDirectory(environment);
