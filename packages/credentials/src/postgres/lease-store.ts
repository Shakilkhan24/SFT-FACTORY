/**
 * `credentials` — the Postgres-backed lease store.
 *
 * ## The row never holds the material
 *
 * `credential_leases` says so in its own comment: *"NEVER stores secret
 * material"*. The store enforces that — there is no code path that puts
 * the secret into the row, and the row's `scope` column carries the
 * **reference** (the scopes, the permissions, the repositories), not the
 * credential.
 *
 * ## Why the row is append-then-mark, not update
 *
 * `credential_leases` has a `revoked_at` column, so a revocation is an
 * **update**, not a delete. The lease is a record of something that
 * happened: it was minted, and then it was revoked. Deleting the row
 * would erase the evidence that a credential existed at all — and the
 * audit trail needs to say which credential was used.
 *
 * The revoke is idempotent: marking an already-revoked lease again
 * leaves it as it is rather than moving the timestamp, so a reaper that
 * runs twice does not make the revocation look later than it was.
 *
 * ## Why raw SQL rather than the query builder
 *
 * The `scope` column is `jsonb` and the timestamps are `timestamptz`.
 * The builder's inference over both is more ceremony than it is worth
 * here, and a hand-written statement says exactly what is written. The
 * row is small and the statements are three.
 */

import { type FactoryDatabase, type Kysely, sql } from '@factory/db';

import type { CredentialLease, CredentialLeaseStore } from '../broker.js';
import type { PermissionLevel } from '../scope.js';

/**
 * The Postgres lease store.
 */
export class PostgresCredentialLeaseStore implements CredentialLeaseStore {
  readonly #db: Kysely<FactoryDatabase>;

  public constructor(options: { readonly db: Kysely<FactoryDatabase> }) {
    this.#db = options.db;
  }

  /**
   * Record a minted lease.
   */
  public async record(lease: CredentialLease): Promise<void> {
    await sql`
      INSERT INTO factory.credential_leases (
        id, task_id, provider, scope, minted_at, expires_at, revoked_at
      ) VALUES (
        ${lease.id},
        ${lease.taskId},
        ${lease.provider},
        ${JSON.stringify({
          scopes: [...lease.scope.scopes],
          permissions: { ...lease.scope.permissions },
          repositories: [...lease.scope.repositories],
        })}::jsonb,
        ${lease.mintedAt},
        ${lease.expiresAt},
        ${lease.revokedAt ?? null}
      )
    `.execute(this.#db);
  }

  /**
   * The leases for a task.
   */
  public async listByTask(taskId: string): Promise<readonly CredentialLease[]> {
    const rows = await sql`
      SELECT id, task_id, provider, scope, minted_at, expires_at, revoked_at
      FROM factory.credential_leases
      WHERE task_id = ${taskId}
      ORDER BY minted_at ASC
    `.execute(this.#db);

    return rows.rows.map((row) => toLease(row as LeaseRow));
  }

  /**
   * The leases that have expired and have not been revoked.
   *
   * The reaper's query.
   */
  public async listExpired(
    referencedAt: string,
  ): Promise<readonly CredentialLease[]> {
    const rows = await sql`
      SELECT id, task_id, provider, scope, minted_at, expires_at, revoked_at
      FROM factory.credential_leases
      WHERE revoked_at IS NULL AND expires_at <= ${referencedAt}
      ORDER BY expires_at ASC
    `.execute(this.#db);

    return rows.rows.map((row) => toLease(row as LeaseRow));
  }

  /**
   * Mark a lease revoked.
   *
   * Idempotent: a lease that is already revoked keeps its original
   * revocation timestamp, because the `revoked_at IS NULL` predicate
   * excludes it.
   */
  public async markRevoked(
    leaseId: string,
    revokedAt: string,
  ): Promise<void> {
    await sql`
      UPDATE factory.credential_leases
      SET revoked_at = ${revokedAt}
      WHERE id = ${leaseId} AND revoked_at IS NULL
    `.execute(this.#db);
  }
}

/**
 * A row of `credential_leases`.
 */
interface LeaseRow {
  readonly id: string;
  readonly task_id: string;
  readonly provider: string;
  readonly scope: unknown;
  readonly minted_at: Date | string;
  readonly expires_at: Date | string;
  readonly revoked_at: Date | string | null;
}

/**
 * The lease as the row holds it.
 *
 * The `scope` column is `jsonb`, so it comes back parsed. The shape is
 * re-established here rather than trusted, because a row that was
 * written by an older version of the code — or by hand — must not be
 * believed as-is.
 */
const toLease = (row: LeaseRow): CredentialLease => {
  const scope = parseScope(row.scope);

  return {
    id: row.id,
    taskId: row.task_id,
    provider: row.provider,
    scope,
    mintedAt: toIso(row.minted_at),
    expiresAt: toIso(row.expires_at),
    ...(row.revoked_at === null || row.revoked_at === undefined
      ? {}
      : { revokedAt: toIso(row.revoked_at) }),
  };
};

/**
 * The scope as the row holds it.
 *
 * A malformed `scope` reads as an **empty** scope rather than throwing:
 * an unreadable scope must not be able to widen a credential, and an
 * empty scope is the narrowest one.
 */
const parseScope = (
  raw: unknown,
): {
  readonly scopes: readonly string[];
  readonly permissions: Readonly<Record<string, PermissionLevel>>;
  readonly repositories: readonly string[];
} => {
  if (typeof raw !== 'object' || raw === null) {
    return { scopes: [], permissions: {}, repositories: [] };
  }

  const record = raw as Record<string, unknown>;

  const scopes = Array.isArray(record['scopes'])
    ? record['scopes'].filter(
        (value): value is string => typeof value === 'string',
      )
    : [];

  const repositories = Array.isArray(record['repositories'])
    ? record['repositories'].filter(
        (value): value is string => typeof value === 'string',
      )
    : [];

  const rawPermissions =
    typeof record['permissions'] === 'object' && record['permissions'] !== null
      ? (record['permissions'] as Record<string, unknown>)
      : {};

  const permissions: Record<string, PermissionLevel> = {};
  for (const [name, level] of Object.entries(rawPermissions)) {
    if (level === 'read' || level === 'write') {
      permissions[name] = level;
    }
  }

  return { scopes, permissions, repositories };
};

/**
 * A timestamp as an ISO string.
 *
 * `pg` returns a `timestamptz` as a `Date`; a row that was written by
 * another tool may come back as a string, so both are accepted.
 */
const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
