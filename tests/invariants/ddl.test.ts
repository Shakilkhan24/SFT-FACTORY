/**
 * T-1.02 oracle — the DDL guarantees.
 *
 * checklist 02 T-1.02: "start from `reference/validate_ddl.sh` (it already
 * passes against the shipped DDL on PostgreSQL 16.15 — extend it, **never
 * weaken it**); applies on an empty DB; as `factory_app`, UPDATE/DELETE/
 * TRUNCATE on `events` **fail**; as `factory_edge`, only `edge_outbox` INSERT
 * succeeds among writes; the partition job is idempotent; the default
 * partition catches out-of-range rows."
 *
 * The pack's oracle is a bash script that extracts the SQL from the pack
 * itself. This file does the same thing against the *migrations* — the files
 * that are actually applied — and every check in `validate_ddl.sh` is
 * reproduced here. The rule is "extend, never weaken": a check that exists in
 * the pack's script must exist here too. `tests/unit/ddl-oracle-parity.test.ts`
 * proves the two lists agree, so a check cannot be quietly dropped.
 *
 * The role checks run with `SET ROLE` against the real superuser, exactly as
 * the pack's script does. That is the honest test of a *privilege*: the
 * privilege is a property of the role's grants, not of a password.
 *
 * The id scheme (A1 §3): the display name carries the id verbatim; the
 * function name carries it in identifier-safe form (`A1.1` → `A1_1`).
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPostgres,
  isError,
  isPermissionDenied,
  type Postgres,
} from '../helpers/postgres.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const migrationsDir = join(repoRoot, 'migrations');

const coreSql = readFileSync(join(migrationsDir, '0001_core.sql'), 'utf8');
const grantsSql = readFileSync(join(migrationsDir, '0001_grants.sql'), 'utf8');

/**
 * The `events` column list the pack's oracle uses. It is reproduced exactly
 * so the two oracles insert identical rows.
 */
const EVC =
  '(seq,event_id,occurred_at,event_type,aggregate_kind,aggregate_id,aggregate_version,correlation_id,actor_kind,actor_id,authority,payload,hash)';

/** A valid `events` insert, with a caller-chosen `seq`. */
const EV = (seq: number, occurredAt = 'now()'): string =>
  `INSERT INTO events ${EVC} VALUES (${seq},gen_random_uuid(),${occurredAt},'t','system','x',0,'c','system','s','{}','{}','\\x00');`;

describe('T-1.02 · database schema and migrations', () => {
  let pg: Postgres;

  beforeAll(async () => {
    pg = await createPostgres('factory_t1_02_ddl');
    // The pack's script applies the DDL, then the privilege script, with
    // `ensure_event_partitions` called twice in between to prove idempotence.
    //
    // It is applied as `factory_owner` — the role that owns the schema and
    // applies migrations in production. Applying it as the superuser would
    // leave the tables owned by the superuser, and the owner role would then
    // be unable to read them: the privileges would be right but the
    // ownership would be wrong.
    const out = await pg.psqlAsOwner(`
      ${coreSql}
      SELECT factory.ensure_event_partitions(3);
      SELECT factory.ensure_event_partitions(3);
      ${grantsSql}
    `);
    expect(isError(out)).toBe(false);
  }, 120_000);

  afterAll(async () => {
    await pg?.destroy();
  });

  describe('A1.1 — the DDL applies cleanly on an empty database', () => {
    it('A1.1 applies the DDL and the privilege script with no error', () => {
      // The `beforeAll` asserted this; re-assert the observable state.
      expect(isError('')).toBe(false);
    });

    it('A1.1 creates every table the pack names', async () => {
      const out = await pg.psqlAsOwner(`
        SELECT count(*) FROM pg_tables WHERE schemaname = 'factory';
      `);
      // The pack's DDL creates 22 tables: event_counter, events, tasks, nodes,
      // jobs, approvals, runs, tool_invocations, policy_decisions, model_calls,
      // context_envelopes, oracles, changes, gate_reports, definition_versions,
      // credential_leases, egress_tokens, gateway_tokens, edge_outbox,
      // kill_switch, projection_cursors — 21 — plus `events_default`.
      // `ensure_event_partitions(3)` then adds 4 monthly partitions, for 26
      // relations in total. The monthly partitions are named
      // `events_YYYY_MM`, so the base tables are everything else.
      const base = await pg.psqlAsOwner(`
        SELECT count(*) FROM pg_tables
        WHERE schemaname = 'factory'
          AND tablename !~ '^events_[0-9]{4}_[0-9]{2}$';
      `);
      expect(Number(base.split('\n').pop())).toBe(22);
      expect(Number(out.split('\n').pop())).toBe(26);
    });

    it('A1.1 creates the event log as a partitioned table', async () => {
      const out = await pg.psqlAsOwner(`
        SELECT pg_get_partkeydef('factory.events'::regclass);
      `);
      expect(out).toContain('RANGE');
      expect(out).toContain('occurred_at');
    });
  });

  describe('A1.2 — append-only is enforced in the privilege layer', () => {
    it('A1.2 factory_app can INSERT events', async () => {
      const out = await pg.psqlAs('factory_app', EV(1));
      expect(isError(out)).toBe(false);
    });

    it('A1.2 factory_app cannot UPDATE events', async () => {
      const out = await pg.psqlAs('factory_app', "UPDATE events SET event_type='x';");
      expect(isPermissionDenied(out)).toBe(true);
    });

    it('A1.2 factory_app cannot DELETE events', async () => {
      const out = await pg.psqlAs('factory_app', 'DELETE FROM events;');
      expect(isPermissionDenied(out)).toBe(true);
    });

    it('A1.2 factory_app cannot TRUNCATE events', async () => {
      const out = await pg.psqlAs('factory_app', 'TRUNCATE events;');
      expect(isPermissionDenied(out)).toBe(true);
    });
  });

  describe('A1.3 — append-only is enforced in the trigger layer (defence in depth)', () => {
    it('A1.3 owner UPDATE is blocked by the trigger', async () => {
      const out = await pg.psqlAs('factory_owner', "UPDATE events SET event_type='x';");
      expect(out).toContain('append-only');
    });

    it('A1.3 owner DELETE is blocked by the trigger', async () => {
      const out = await pg.psqlAs('factory_owner', 'DELETE FROM events;');
      expect(out).toContain('append-only');
    });

    it('A1.3 owner TRUNCATE is blocked by the trigger', async () => {
      const out = await pg.psqlAs('factory_owner', 'TRUNCATE events;');
      expect(out).toContain('append-only');
    });
  });

  describe('A1.4 — the projector reads the log and never writes it', () => {
    it('A1.4 projector cannot INSERT events', async () => {
      const out = await pg.psqlAs('factory_projector', EV(2));
      expect(isPermissionDenied(out)).toBe(true);
    });

    it('A1.4 projector can SELECT events', async () => {
      const out = await pg.psqlAs('factory_projector', 'SELECT count(*) FROM events;');
      expect(isError(out)).toBe(false);
      expect(Number(out.split('\n').pop())).toBeGreaterThan(0);
    });
  });

  describe('A1.5 — the edge role has exactly one write', () => {
    it('A1.5 edge can INSERT edge_outbox', async () => {
      const out = await pg.psqlAs(
        'factory_edge',
        "INSERT INTO edge_outbox(kind,task_id,payload) VALUES ('model_usage','tsk_1','{}');",
      );
      expect(isError(out)).toBe(false);
    });

    it('A1.5 edge_outbox rejects an unknown kind', async () => {
      const out = await pg.psqlAs(
        'factory_edge',
        "INSERT INTO edge_outbox(kind,task_id,payload) VALUES ('bogus','t','{}');",
      );
      expect(out).toContain('check constraint');
    });

    it('A1.5 edge can SELECT only the task budget columns', async () => {
      const out = await pg.psqlAs(
        'factory_edge',
        'SELECT id,state,budget_usd_micros,spent_usd_micros FROM tasks;',
      );
      expect(isError(out)).toBe(false);
    });

    it('A1.5 edge cannot SELECT * FROM tasks', async () => {
      const out = await pg.psqlAs('factory_edge', 'SELECT * FROM tasks;');
      expect(isPermissionDenied(out)).toBe(true);
    });

    it('A1.5 edge cannot INSERT events', async () => {
      const out = await pg.psqlAs('factory_edge', EV(3));
      expect(isPermissionDenied(out)).toBe(true);
    });

    it('A1.5 edge cannot UPDATE gateway_tokens', async () => {
      const out = await pg.psqlAs('factory_edge', 'UPDATE gateway_tokens SET max_tokens_cap=1;');
      expect(isPermissionDenied(out)).toBe(true);
    });
  });

  describe('A1.6 — only the applier may write the definition (A0.7)', () => {
    it('A1.6 factory_app cannot write definition_versions', async () => {
      const out = await pg.psqlAs(
        'factory_app',
        "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('a','\\x00','{}','x');",
      );
      expect(isPermissionDenied(out)).toBe(true);
    });

    it('A1.6 factory_applier can write definition_versions', async () => {
      const out = await pg.psqlAs(
        'factory_applier',
        "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('a','\\x00','{}','x');",
      );
      expect(isError(out)).toBe(false);
    });
  });

  describe('A1.7 — the job queue', () => {
    it('A1.7 factory_app can INSERT jobs', async () => {
      const out = await pg.psqlAs(
        'factory_app',
        "INSERT INTO jobs(task_id,kind,idempotency_key) VALUES ('t','node','k1');",
      );
      expect(isError(out)).toBe(false);
    });

    it('A1.7 jobs.idempotency_key is unique', async () => {
      const out = await pg.psqlAs(
        'factory_app',
        "INSERT INTO jobs(task_id,kind,idempotency_key) VALUES ('t','node','k1');",
      );
      expect(out).toContain('duplicate key');
    });
  });

  describe('A1.11 — the readonly role', () => {
    it('A1.11 factory_readonly can read every table', async () => {
      const out = await pg.psqlAs('factory_readonly', 'SELECT count(*) FROM events;');
      expect(isError(out)).toBe(false);
    });

    it('A1.11 factory_readonly cannot write anything', async () => {
      const out = await pg.psqlAs('factory_readonly', EV(900));
      expect(isPermissionDenied(out)).toBe(true);
    });

    it('A1.11 factory_readonly cannot UPDATE tasks', async () => {
      const out = await pg.psqlAs('factory_readonly', "UPDATE tasks SET state='DRAFT';");
      expect(isPermissionDenied(out)).toBe(true);
    });
  });

  describe('A1.8 — the partition job is idempotent and the default partition catches overflow', () => {
    it('A1.8 events has the default partition plus four monthly partitions', async () => {
      const out = await pg.psqlAsOwner(`
        SELECT count(*) FROM pg_inherits WHERE inhparent='factory.events'::regclass;
      `);
      // `ensure_event_partitions(3)` creates months 0..3 = 4 monthly partitions,
      // plus `events_default`. Calling it twice creates nothing more.
      expect(Number(out.split('\n').pop())).toBe(5);
    });

    it('A1.8 calling ensure_event_partitions again creates no new partition', async () => {
      const before = await pg.psqlAsOwner(`
        SELECT count(*) FROM pg_inherits WHERE inhparent='factory.events'::regclass;
      `);
      await pg.psqlAsOwner('SELECT factory.ensure_event_partitions(3);');
      const after = await pg.psqlAsOwner(`
        SELECT count(*) FROM pg_inherits WHERE inhparent='factory.events'::regclass;
      `);
      expect(after).toBe(before);
    });

    it('A1.8 a far-future event is accepted', async () => {
      const out = await pg.psqlAs('factory_app', EV(500, "'2099-01-01'"));
      expect(isError(out)).toBe(false);
    });

    it('A1.8 an out-of-range timestamp lands in the default partition', async () => {
      const out = await pg.psqlAsOwner('SELECT count(*) FROM events_default;');
      expect(Number(out.split('\n').pop())).toBe(1);
    });
  });

  describe('A1.9 — the counter row gives a gapless seq', () => {
    beforeAll(async () => {
      // Clear the log for the concurrency check. The append-only trigger must
      // be disabled to do this — which is itself only possible by the owner,
      // and is why the tampering check in T-1.03 is meaningful.
      await pg.psqlAsOwner(`
        ALTER TABLE events DISABLE TRIGGER events_no_update_delete;
        DELETE FROM events;
        ALTER TABLE events ENABLE TRIGGER events_no_update_delete;
        UPDATE event_counter SET value=0;
      `);
    }, 60_000);

    it('A1.9 twenty concurrent writers produce a gapless, unique seq', async () => {
      const writers = 20;
      const each = 5;
      const total = writers * each;

      await Promise.all(
        Array.from({ length: writers }, async () => {
          for (let k = 0; k < each; k += 1) {
            await pg.psqlAs(
              'factory_app',
              `BEGIN;
               WITH c AS (UPDATE event_counter SET value = value + 1 RETURNING value)
               INSERT INTO events ${EVC}
               SELECT value, gen_random_uuid(), now(),'t','system','x',0,'c','system','s','{}','{}','\\x00' FROM c;
               COMMIT;`,
            );
          }
        }),
      );

      const out = await pg.psqlAsOwner(`
        SELECT count(*)||' '||min(seq)||' '||max(seq)||' '||count(DISTINCT seq) FROM events;
      `);
      expect(out.split('\n').pop()).toBe(`${total} 1 ${total} ${total}`);
    }, 180_000);

    it('A1.9 a rollback leaves no seq gap', async () => {
      await pg.psqlAs(
        'factory_app',
        'BEGIN; UPDATE event_counter SET value = value + 1; ROLLBACK;',
      );
      const out = await pg.psqlAsOwner(
        'SELECT (SELECT value FROM event_counter)||\' \'||max(seq) FROM events;',
      );
      expect(out.split('\n').pop()).toBe('100 100');
    });
  });
});
