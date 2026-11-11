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

import type { PoolClient, PoolConfig } from 'pg';

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
 * The `pg-pool` options this module uses beyond `pg`'s own `PoolConfig`.
 *
 * `pg-pool` is the pool `pg` uses, and it supports an `onConnect` hook that
 * it **awaits** before releasing a client to a borrower. `@types/pg`
 * declares `PoolConfig` without it — `pg-pool` ships no types of its own,
 * so the option is real at runtime but invisible to the compiler.
 *
 * The declaration is a **widening**, not a replacement: the config type is
 * `pg`'s own, plus this one option. So a typo in any other option is still
 * a compile error, and only `onConnect` — the one option with no declared
 * type — is accepted.
 */
interface FactoryPoolConfig extends PoolConfig {
  /**
   * Called with each new client, before the pool releases it.
   *
   * The returned promise is awaited: if it rejects, the connection is
   * closed and the borrower receives the error.
   */
  readonly onConnect?: (client: PoolClient) => Promise<unknown>;
}

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
 *  1. `SET ROLE <role>` — only in `assume` mode.
 *  2. `SET search_path TO factory, public` — so unqualified names resolve to
 *     the factory schema, the same discipline the pack's own DDL uses.
 *
 * **The order matters, and it is the opposite of what it looks like.**
 * `SET ROLE` resets the session's `search_path` to the target role's
 * default (`"$user", public`). So a preamble that sets the search_path
 * *first* and the role *second* throws the search_path away: the session
 * ends up searching `"$user", public`, where the unqualified name `tasks`
 * does not resolve — and the failure reads as `relation "tasks" does not
 * exist`, which points at the schema rather than at the preamble.
 *
 * Setting the role first and the search_path second means the search_path
 * is the last thing written, so it is the state the session is left in.
 *
 * Both are issued on every pooled connection, because a pooled connection may
 * be handed to a different caller between uses.
 */
const sessionPreamble = (role: FactoryRole, mode: ConnectionMode): string =>
  mode === 'assume'
    ? `SET ROLE ${role}; SET search_path TO factory, public`
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
  const statement = sessionPreamble(config.role, mode);

  const poolConfig: FactoryPoolConfig = {
    connectionString: config.connectionString,
    max: config.max ?? DEFAULT_MAX,
    // `pg` retries a failed connection rather than giving up, so this is
    // what turns an unreachable host into an error instead of a hang.
    connectionTimeoutMillis: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    // The preamble is **awaited** before the client is handed to a
    // borrower.
    //
    // The obvious alternative — `pool.on('connect', client => void
    // client.query(statement))` — looks equivalent and is not. `pg`'s
    // `connect` event fires *before* the pool releases the client, but a
    // fire-and-forget `client.query` is only *queued* on that client; the
    // borrower's first query is issued on its own path and can overtake
    // it. The observable symptom is that the **first** query on a fresh
    // pool resolves unqualified names against `public` and fails with
    // `relation "tasks" does not exist`, while every later query on the
    // same pooled connection succeeds. That is a race, so it is not
    // reliably reproducible — it is a defect that would surface in
    // production as an intermittent "table does not exist" on a cold
    // start.
    //
    // `onConnect` is `pg-pool`'s own hook, and `pg-pool` awaits the
    // promise it returns before releasing the client. So the preamble is
    // guaranteed to have landed before any borrower sees the connection.
    onConnect: (client) => client.query(statement),
  };

  const pool = new Pool(poolConfig);

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
