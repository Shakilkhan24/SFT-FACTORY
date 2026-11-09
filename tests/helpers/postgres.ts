/**
 * A throwaway PostgreSQL for the DDL tests.
 *
 * checklist 02 T-1.02: the oracle "applies on an empty DB" and "as
 * `factory_app`, UPDATE/DELETE/TRUNCATE on `events` fail". Proving those
 * needs a real server — a mocked database would prove nothing about
 * privileges or triggers.
 *
 * The server is the one from `docker-compose.dev.yml` (`postgres:16-alpine`,
 * the same major version the pack validated against). Each test file gets its
 * OWN database, dropped and recreated, so the tests do not interfere with
 * each other and each one starts from an empty database — the pack's own
 * requirement.
 *
 * The harness never touches a database it did not create: the name is
 * prefixed `factory_t1_` and the harness refuses to drop anything else.
 *
 * SQL is delivered by `docker cp` + `psql -f`, not by piping to stdin. A
 * piped stdin through `docker exec -i` does not terminate reliably from
 * Node's `execFile`, and a harness that hangs is worse than no harness.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The container that runs the dev Postgres. */
const CONTAINER = process.env['FACTORY_PG_CONTAINER'] ?? 'factory-postgres-dev';

/** The superuser inside the container. */
const SUPERUSER = process.env['FACTORY_PG_SUPERUSER'] ?? 'factory';

/** The password for the dev cluster. It is a fixed, non-secret dev password. */
const PASSWORD = process.env['FACTORY_PG_PASSWORD'] ?? 'factory';

/** The database the container exposes. */
const HOST_DB = process.env['FACTORY_PG_DATABASE'] ?? 'factory';

/** The prefix for every database this harness creates. */
const DB_PREFIX = 'factory_t1_';

/**
 * Every role the DDL expects. The pack names them normatively; the harness
 * creates them so the tests do not depend on the cluster's state.
 */
export const DDL_ROLES = [
  'factory_owner',
  'factory_app',
  'factory_projector',
  'factory_applier',
  'factory_edge',
  'factory_readonly',
] as const;

export interface Postgres {
  /** The database name. */
  readonly database: string;
  /** A connection string for the superuser. */
  readonly superuserUrl: string;
  /** A connection string for a role. */
  readonly urlFor: (role: string) => string;
  /** Run a statement as the superuser and return the trimmed output. */
  readonly psql: (sql: string) => Promise<string>;
  /** Run a statement as `factory_owner` — the role that owns the schema. */
  readonly psqlAsOwner: (sql: string) => Promise<string>;
  /** Run a statement as a role and return the trimmed output, errors included. */
  readonly psqlAs: (role: string, sql: string) => Promise<string>;
  /** Drop the database. */
  readonly destroy: () => Promise<void>;
}

/**
 * Run `psql` inside the container against a SQL file that was copied in.
 */
const containerPsql = async (
  database: string,
  sql: string,
  options: { readonly onErrorStop?: boolean } = {},
): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-ddl-'));
  const local = join(dir, 'statement.sql');
  const remote = `/tmp/factory-ddl-${process.pid}-${Date.now()}.sql`;
  writeFileSync(local, sql, 'utf8');

  try {
    await execFileAsync('docker', ['cp', local, `${CONTAINER}:${remote}`]);
    const args = [
      'exec',
      CONTAINER,
      'psql',
      '-U',
      SUPERUSER,
      '-d',
      database,
      '-tA',
      '-q',
      '-f',
      remote,
    ];
    if (options.onErrorStop === true) {
      args.splice(args.length - 2, 0, '-v', 'ON_ERROR_STOP=1');
    }
    const { stdout, stderr } = await execFileAsync('docker', args, { encoding: 'utf8' });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    // `psql` exits non-zero on a SQL error; the message is on stderr and is
    // the interesting part of the result.
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}${failure.message ?? ''}`.trim();
  } finally {
    await execFileAsync('docker', ['exec', CONTAINER, 'rm', '-f', remote]).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Create a throwaway database with the five runtime roles and the owner role.
 */
export const createPostgres = async (name: string): Promise<Postgres> => {
  if (!name.startsWith(DB_PREFIX)) {
    throw new Error(
      `refusing to create a database named "${name}" — the harness only creates names starting with "${DB_PREFIX}"`,
    );
  }

  // Roles are cluster-wide, so they are created once and reused.
  await containerPsql(
    HOST_DB,
    `DO $$
     DECLARE r text;
     BEGIN
       FOREACH r IN ARRAY ARRAY[${DDL_ROLES.map((role) => `'${role}'`).join(', ')}]
       LOOP
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
           EXECUTE format('CREATE ROLE %I NOLOGIN', r);
         END IF;
       END LOOP;
     END $$;`,
  );

  await containerPsql(HOST_DB, `DROP DATABASE IF EXISTS ${name}`);
  await containerPsql(HOST_DB, `CREATE DATABASE ${name} OWNER factory_owner`);

  const superuserUrl = `postgresql://${SUPERUSER}:${PASSWORD}@127.0.0.1:5432/${name}`;

  return {
    database: name,
    superuserUrl,
    urlFor: (role: string) => `postgresql://${role}:${PASSWORD}@127.0.0.1:5432/${name}`,
    psql: (sql: string) =>
      containerPsql(name, `SET search_path TO factory, public;\n${sql}`),
    psqlAsOwner: (sql: string) =>
      containerPsql(
        name,
        `SET search_path TO factory, public;\nSET ROLE factory_owner;\n${sql}`,
      ),
    psqlAs: (role: string, sql: string) =>
      containerPsql(
        name,
        `SET search_path TO factory, public;\nSET ROLE ${role};\n${sql}`,
      ),
    destroy: async () => {
      await containerPsql(HOST_DB, `DROP DATABASE IF EXISTS ${name}`);
    },
  };
};

/**
 * Whether a `psql` result reports an error.
 *
 * `psql` prints `ERROR:  <message>` on stderr for a SQL error. The check
 * matches that exact form so that a *notice* (which psql also prefixes with
 * `NOTICE:`) is not mistaken for a failure — the pack's DDL emits
 * `NOTICE: schema "factory" already exists, skipping` on a re-run, and that
 * is not an error.
 */
export const isError = (output: string): boolean => /\bERROR:/i.test(output);

/**
 * Whether a `psql` result reports a permission failure.
 */
export const isPermissionDenied = (output: string): boolean =>
  /permission denied/i.test(output);
