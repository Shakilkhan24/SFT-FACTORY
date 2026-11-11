/**
 * T-1.09 — the credential broker against a real Postgres.
 *
 * pack 02 §4.6; pack 04 §2.2.
 *
 * ## Why this file exists alongside the unit suite
 *
 * The unit suite proves the broker's **rules** — the intersection, the
 * lease's shape, the revocation, the redaction — against the in-memory
 * store, with no database. That is the oracle's home, and it runs
 * everywhere.
 *
 * This file proves the **Postgres implementation** agrees with those
 * rules. Two things in particular cannot be proved against a double:
 *
 * * **The row never holds the material.** `credential_leases` says so in
 *   its own comment — *"NEVER stores secret material"* — and this file
 *   reads the row back out of the database and scans it, so the claim is
 *   checked against the **stored bytes**, not against the code that wrote
 *   them.
 * * **The revocation is idempotent.** The `revoked_at IS NULL` predicate
 *   is what makes a second revocation a no-op. A double that overwrote
 *   the timestamp would look correct and disagree with the real thing.
 *
 * ## The environment
 *
 * This suite needs a real Postgres — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available the suite **skips**; that is an environment
 * limit, not a failure of the code, and CI is where it is proved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  destroyDatabase,
  migrate,
  type FactoryDatabase,
  type Kysely,
  sql,
} from '../../../packages/db/src/index.ts';
import {
  CredentialBroker,
  FakeCredentialProvider,
  PostgresCredentialLeaseStore,
  type CredentialLease,
} from '../../../packages/credentials/src/index.ts';
import { containerRunning, migrationsDir } from '../../helpers/eventlog.ts';
import { createPostgres, type Postgres } from '../../helpers/postgres.ts';
import { THE_CLOCK } from '../../helpers/credentials.ts';

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, this suite **skips** rather than fails: the absence of a
 * Docker daemon is an environment limit, not a defect in the broker. The
 * suite runs in CI, where the daemon exists, and that is where the Postgres
 * path is proved.
 */
const running = await containerRunning();

/**
 * The lease the tests write.
 */
const aLease = (overrides: Partial<CredentialLease> = {}): CredentialLease => ({
  id: 'crd_000001',
  taskId: 'task_1',
  provider: 'github',
  scope: {
    scopes: ['repo:write:pr'],
    permissions: { pull_requests: 'write' },
    repositories: ['org/repo'],
  },
  mintedAt: '2026-11-10T00:00:00.000Z',
  expiresAt: '2026-11-10T01:00:00.000Z',
  ...overrides,
});

describe('T-1.09 — the credential leases, against Postgres', () => {
  let postgres: Postgres;
  let db: Kysely<FactoryDatabase>;
  let store: PostgresCredentialLeaseStore;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    postgres = await createPostgres('factory_t1_09_credentials');
    db = createDatabase({
      connectionString: postgres.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
      max: 20,
    });
    await migrate(db, migrationsDir);
    store = new PostgresCredentialLeaseStore({ db });
  });

  afterAll(async () => {
    if (!running) {
      return;
    }
    await destroyDatabase(db);
    await postgres.destroy();
  });

  describe('the row', () => {
    it.skipIf(!running)('stores the reference and NEVER the material', async () => {
      await store.record(aLease());

      // Read the **raw** row, not the store's own reconstruction of it.
      const rows = await sql`
        SELECT * FROM factory.credential_leases WHERE id = 'crd_000001'
      `.execute(db);

      const raw = JSON.stringify(rows.rows[0]);
      expect(raw).toContain('repo:write:pr');
      expect(raw).toContain('pull_requests');
      expect(raw).toContain('org/repo');
      // No field of the row carries anything that looks like a token.
      expect(raw).not.toContain('ghs_');
      expect(raw).not.toContain('secret');
      expect(raw).not.toContain('material');
    });

    it.skipIf(!running)('reads the lease back with its scope intact', async () => {
      await store.record(aLease({ id: 'crd_000002' }));

      const leases = await store.listByTask('task_1');
      const lease = leases.find((entry) => entry.id === 'crd_000002');

      expect(lease?.scope.scopes).toEqual(['repo:write:pr']);
      expect(lease?.scope.permissions['pull_requests']).toBe('write');
      expect(lease?.scope.repositories).toEqual(['org/repo']);
      expect(lease?.mintedAt).toBe('2026-11-10T00:00:00.000Z');
      expect(lease?.expiresAt).toBe('2026-11-10T01:00:00.000Z');
      expect(lease?.revokedAt).toBeUndefined();
    });

    it.skipIf(!running)('lists by task and by nothing else', async () => {
      await store.record(aLease({ id: 'crd_000003', taskId: 'task_2' }));

      const forTask1 = await store.listByTask('task_1');
      const forTask2 = await store.listByTask('task_2');

      expect(forTask1.map((entry) => entry.id)).not.toContain('crd_000003');
      expect(forTask2.map((entry) => entry.id)).toContain('crd_000003');
    });
  });

  describe('the revocation', () => {
    it.skipIf(!running)('marks the lease revoked', async () => {
      await store.record(aLease({ id: 'crd_000004' }));

      await store.markRevoked('crd_000004', '2026-11-10T00:30:00.000Z');

      const leases = await store.listByTask('task_1');
      const lease = leases.find((entry) => entry.id === 'crd_000004');
      expect(lease?.revokedAt).toBe('2026-11-10T00:30:00.000Z');
    });

    it.skipIf(!running)('is IDEMPOTENT — the first revocation stands', async () => {
      await store.record(aLease({ id: 'crd_000005' }));

      await store.markRevoked('crd_000005', '2026-11-10T00:30:00.000Z');
      await store.markRevoked('crd_000005', '2026-11-10T00:40:00.000Z');

      const leases = await store.listByTask('task_1');
      const lease = leases.find((entry) => entry.id === 'crd_000005');
      // A reaper that runs twice must not make the revocation look later
      // than it was.
      expect(lease?.revokedAt).toBe('2026-11-10T00:30:00.000Z');
    });

    it.skipIf(!running)('does NOT delete the row', async () => {
      await store.record(aLease({ id: 'crd_000006' }));

      await store.markRevoked('crd_000006', '2026-11-10T00:30:00.000Z');

      const rows = await sql`
        SELECT count(*)::int AS n FROM factory.credential_leases WHERE id = 'crd_000006'
      `.execute(db);
      // The lease is a record of something that happened. Deleting it
      // would erase the evidence that a credential existed at all.
      expect((rows.rows[0] as { n: number }).n).toBe(1);
    });
  });

  describe('the reaper’s query', () => {
    it.skipIf(!running)('lists the expired and UNREVOKED leases', async () => {
      await store.record(
        aLease({
          id: 'crd_000007',
          expiresAt: '2026-11-10T01:00:00.000Z',
        }),
      );
      await store.record(
        aLease({
          id: 'crd_000008',
          expiresAt: '2026-11-10T03:00:00.000Z',
        }),
      );

      const expired = await store.listExpired('2026-11-10T02:00:00.000Z');
      const ids = expired.map((entry) => entry.id);

      expect(ids).toContain('crd_000007');
      expect(ids).not.toContain('crd_000008');
    });

    it.skipIf(!running)('does NOT list a lease that was already revoked', async () => {
      await store.record(
        aLease({
          id: 'crd_000009',
          expiresAt: '2026-11-10T01:00:00.000Z',
        }),
      );
      await store.markRevoked('crd_000009', '2026-11-10T00:30:00.000Z');

      const expired = await store.listExpired('2026-11-10T02:00:00.000Z');

      expect(expired.map((entry) => entry.id)).not.toContain('crd_000009');
    });
  });

  describe('the broker against the database', () => {
    it.skipIf(!running)('mints, records the lease, and revokes it', async () => {
      const provider = new FakeCredentialProvider({ clock: THE_CLOCK });
      let counter = 0;
      const broker = new CredentialBroker({
        leases: store,
        provider,
        clock: THE_CLOCK,
        nextId: () => {
          counter += 1;
          return `crd_pg_${String(counter).padStart(6, '0')}`;
        },
      });

      const minted = await broker.mint({
        taskId: 'task_pg',
        requiredScopes: ['repo:write:pr'],
        allowedScopes: ['repo:write:pr'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(minted.ok).toBe(true);
      const credId = minted.ok ? minted.value.credId : '';

      const leases = await store.listByTask('task_pg');
      expect(leases.map((entry) => entry.id)).toContain(credId);
      expect(leases[0]?.scope.permissions['pull_requests']).toBe('write');

      // The material is not in the row.
      const rows = await sql`
        SELECT * FROM factory.credential_leases WHERE task_id = 'task_pg'
      `.execute(db);
      expect(JSON.stringify(rows.rows)).not.toContain(
        minted.ok ? minted.value.secret : '',
      );

      const failures = await broker.revokeAll('task_pg');
      expect(failures).toEqual([]);
      expect(provider.isRevoked(credId)).toBe(true);

      const after = await store.listByTask('task_pg');
      expect(after[0]?.revokedAt).toBeDefined();
    });
  });
});
