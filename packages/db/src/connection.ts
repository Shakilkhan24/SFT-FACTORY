/**
 * `db` — the PostgreSQL access layer (checklist 02, T-1.02).
 *
 * Two connection kinds, and the difference matters:
 *
 * * **Owner** — `factory_owner`. Owns the schema, applies migrations and runs
 *   `ensure_event_partitions()` (which needs CREATE on the schema). It is the
 *   only role that may mutate `events`, and even it is stopped by the
 *   append-only trigger. This is the defence-in-depth layer.
 * * **Application** — `factory_app` and the other least-privilege roles. These
 *   are the roles the running system uses.
 *
 * The application role cannot UPDATE/DELETE/TRUNCATE `events` at all — that is
 * enforced by the privilege layer (pack 03 §2 grants) and, independently, by
 * the `events_reject_mutation` trigger. Neither layer is optional.
 */

import { Kysely, PostgresDialect } from 'kysely';
// `pg` is CommonJS. Node's named-export detection does not reliably expose
// `Pool` from it, so the default export is used and `Pool` is taken from
// there. (An ESM `import { Pool } from 'pg'` fails at runtime with
// "does not provide an export named 'Pool'".)
import pg from 'pg';

const { Pool } = pg;

import type { FactoryDatabase } from './types.js';

/**
 * The roles the factory uses. `factory_owner` is the migration role; the rest
 * are the runtime roles (pack 03 §2: "Roles and privileges (normative)").
 */
export const FACTORY_ROLES = [
  'factory_owner',
  'factory_app',
  'factory_projector',
  'factory_applier',
  'factory_edge',
  'factory_readonly',
] as const;

export type FactoryRole = (typeof FACTORY_ROLES)[number];

export const isFactoryRole = (value: string): value is FactoryRole =>
  (FACTORY_ROLES as readonly string[]).includes(value);

/**
 * How a connection authenticates.
 *
 * `direct` — connect as the role itself (the role has LOGIN and a password).
 *   This is what production looks like.
 * `assume` — connect as a superuser and `SET ROLE` to the target role. This is
 *   what the dev cluster and the DDL oracle use, where the five runtime roles
 *   are NOLOGIN group roles.
 */
export type ConnectionMode = 'direct' | 'assume';

/**
 * A connection description. Nothing here is read from the ambient
 * environment implicitly — the caller decides, so a test can point at a
 * throwaway database.
 */
export interface ConnectionConfig {
  /** The connection string. */
  readonly connectionString: string;
  /** Which factory role the session acts as. */
  readonly role: FactoryRole;
  /** How the role is assumed. Defaults to `direct`. */
  readonly mode?: ConnectionMode;
  /** Maximum pool size. Defaults to 10. */
  readonly max?: number;
  /**
   * How long a connection attempt may take, in milliseconds.
   *
   * `pg`'s pool **retries** a failed connection rather than giving up, so
   * without this a client pointed at an unreachable host waits forever
   * instead of failing. A CLI is the case that matters: an operator who
   * mistyped a host needs an error, not a hang.
   *
   * Defaults to 10 seconds.
   */
  readonly connectTimeoutMs?: number;
}

const DEFAULT_MAX = 10;

/**
 * The default connection timeout.
 *
 * Ten seconds is long enough for a slow TLS handshake on a real cluster
 * and short enough that an operator does not think the command has hung.
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/**
 * The session preamble for a pooled connection.
 *
 * Two statements, in this order:
 *
 *  1. `SET search_path TO factory, public` — so unqualified names resolve to
 *     the factory schema, the same discipline the pack's own DDL uses.
 *  2. `SET ROLE <role>` — only in `assume` mode. It comes *after* the
 *     search_path because `SET ROLE` resets the session's search_path to the
 *     role's default.
 *
 * Both are issued on every pooled connection, because a pooled connection may
 * be handed to a different caller between uses.
 */
const sessionPreamble = (role: FactoryRole, mode: ConnectionMode): string =>
  mode === 'assume'
    ? `SET search_path TO factory, public; SET ROLE ${role}`
    : 'SET search_path TO factory, public';

/**
 * Open a Kysely instance against the `factory` schema.
 *
 * The `search_path` is set on every connection so that unqualified names
 * resolve to `factory` — the same discipline the pack's own DDL uses
 * (`SET search_path TO factory, public`).
 */
export const createDatabase = (config: ConnectionConfig): Kysely<FactoryDatabase> => {
  const mode: ConnectionMode = config.mode ?? 'direct';
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.max ?? DEFAULT_MAX,
    // `pg` retries a failed connection rather than giving up, so this is
    // what turns an unreachable host into an error instead of a hang.
    connectionTimeoutMillis: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  });

  const statement = sessionPreamble(config.role, mode);
  pool.on('connect', (client) => {
    // `pg` emits `connect` before the connection is handed to a borrower, and
    // `pg` serialises queries on a single client — so this preamble runs
    // before any borrower query on the same connection. The `void` is safe:
    // the client's internal query queue keeps the ordering.
    void client.query(statement);
  });

  return new Kysely<FactoryDatabase>({
    dialect: new PostgresDialect({ pool }),
  });
};

/**
 * The connection string for a role, read from the environment.
 *
 * The environment variable name is per role — `FACTORY_OWNER_DATABASE_URL`,
 * `FACTORY_APP_DATABASE_URL`, and so on — so a process can hold exactly the
 * credentials its role needs and no others (the data plane has no database
 * role; I-1).
 */
export const connectionStringFor = (
  role: FactoryRole,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined => environment[`FACTORY_${role.toUpperCase()}_DATABASE_URL`];

/**
 * Close a Kysely instance and its pool.
 */
export const destroyDatabase = async (db: Kysely<FactoryDatabase>): Promise<void> => {
  await db.destroy();
};
