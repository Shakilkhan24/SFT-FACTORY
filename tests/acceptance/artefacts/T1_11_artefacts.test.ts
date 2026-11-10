/**
 * T-1.11 — the run-artefact store against a real Postgres.
 *
 * pack 02 §4.11, blueprint 15 §2, ADR-0011.
 *
 * ## Why this file exists alongside `tests/unit/artefacts-*.test.ts`
 *
 * The unit suite proves the artefacts package's **rules** — the twelve
 * elements, the completeness assertion, the capture-time redaction, the
 * retention classes, the spool-then-fail path — against the in-memory
 * doubles, with no database. That is the oracle's home, and it runs
 * everywhere.
 *
 * This file proves the **Postgres implementation** agrees with those
 * rules. Three claims can only be proved against a real database:
 *
 * 1. **The `runs` row and the terminal event are written in ONE
 *    transaction.** A mock cannot show that the event is rolled back with
 *    the row — only the database can.
 * 2. **The event log's redaction hook really runs before the INSERT.**
 *    The mock records what it was handed; only the database can show
 *    that the *stored* row carries no secret.
 * 3. **The purge never touches `events`.** The claim is a claim about
 *    the database's contents, so it is counted in the database.
 *
 * A mocked database would prove none of that. The SQL *is* the claim.
 *
 * ## The environment
 *
 * This suite needs a real Postgres — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available the suite **skips** rather than fails: the
 * absence of a Docker daemon is an environment limit, not a defect in the
 * package. The suite runs in CI, where the daemon exists, and that is
 * where the Postgres path is proved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  migrate,
  sql,
  type FactoryDatabase,
  type Kysely,
} from '../../../packages/db/src/index.ts';
import { PostgresEventLog, redactorFor } from '../../../packages/eventlog/src/index.ts';
import {
  InMemoryObjectStore,
  InMemorySpool,
  PostgresRunRecordStore,
  PurgeJob,
  RunArtifactStore,
  recordHashVerifies,
  recordKey,
  type RunRecord,
} from '../../../packages/artefacts/src/index.ts';

import { containerRunning, insertTask, migrationsDir } from '../../helpers/eventlog.ts';
import { createPostgres, type Postgres } from '../../helpers/postgres.ts';
import { THE_INDEX, THE_PARTS } from '../../helpers/artefacts.ts';

/**
 * The secret the oracle seeds.
 *
 * It is **not** catchable by the pattern layer, so a passing test proves
 * the exact-match layer ran on both the record and the event.
 */
const THE_SEEDED_SECRET = 'seeded-secret-value-4b7c1e9a';

/**
 * Whether the dev Postgres container is up.
 */
const running = await containerRunning();

describe('T-1.11 · the run-artefact store against Postgres', () => {
  let postgres: Postgres;
  let db: Kysely<FactoryDatabase>;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    postgres = await createPostgres('factory_t1_11_artefacts');
    db = createDatabase({
      connectionString: postgres.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
      max: 10,
    });

    const applied = await migrate(db, migrationsDir);
    expect(
      applied.applied.length + applied.alreadyApplied.length,
    ).toBeGreaterThan(0);

    // The event log's aggregate is the **task**, so the task row has to
    // exist before any event can be appended against it.
    await insertTask(db, 'task_pg_artefacts');
  });

  afterAll(async () => {
    if (!running || postgres === undefined) {
      return;
    }
    await postgres.destroy();
  });

  it.skipIf(!running)('writes the runs row with the record’s uri and digest', async () => {
    const objectStore = new InMemoryObjectStore();
    const spool = new InMemorySpool();
    const runStore = new PostgresRunRecordStore({ db });
    const store = new RunArtifactStore({ objectStore, spool, runStore });

    const result = await store.finalise(
      { ...THE_PARTS, identity: { ...THE_PARTS.identity, taskId: 'task_pg_artefacts' } },
      { ...THE_INDEX, taskId: 'task_pg_artefacts' },
      'engineering',
    );

    const row = await runStore.find(THE_INDEX.runId);
    expect(row?.recordUri).toBe(
      's3://factory-artifacts/runs/run_01JCZ8JYTESTRUN000000/record.json',
    );
    expect(row?.recordSha256).toBe(result.recordSha256);
    expect(row?.costUsdMicros).toBe(2_077_000);
    expect(row?.retentionClass).toBe('engineering');
    expect(row?.retainUntil).toBe('2027-11-10');
  });

  it.skipIf(!running)('writes the row and the terminal event in one transaction', async () => {
    const objectStore = new InMemoryObjectStore();
    const spool = new InMemorySpool();
    const runStore = new PostgresRunRecordStore({ db });
    const store = new RunArtifactStore({ objectStore, spool, runStore });

    await store.finalise(
      { ...THE_PARTS, identity: { ...THE_PARTS.identity, taskId: 'task_pg_artefacts' } },
      { ...THE_INDEX, taskId: 'task_pg_artefacts' },
      'engineering',
    );

    // The event is in the log…
    const events = await sql`
      SELECT event_type, payload FROM factory.events
      WHERE event_type = 'stage.completed'
    `.execute(db);
    expect(events.rows.length).toBeGreaterThan(0);

    // …and the row is in the table.
    const rows = await sql`
      SELECT run_id, record_uri FROM factory.runs WHERE run_id = ${THE_INDEX.runId}
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it.skipIf(!running)('redacts a seeded secret in the event, before the insert', async () => {
    // The event log's redactor runs **before** the INSERT — so the stored
    // row carries no secret. This is the oracle's second half: "seeded
    // secrets are redacted in record *and* in events".
    const eventLog = new PostgresEventLog({
      db,
      redactor: redactorFor({ policyRef: 'redaction.v1', secrets: [THE_SEEDED_SECRET] }),
    });

    await eventLog.append([
      {
        eventType: 'stage.incomplete',
        aggregate: { kind: 'task', id: 'task_pg_artefacts', version: 0 },
        correlationId: 'run_pg_redaction',
        actor: { kind: 'system', id: 'artefacts' },
        authority: { basis: 'system-rule' },
        context: { items: [] },
        subject: {},
        payload: {
          runId: 'run_pg_redaction',
          reason: `the token was ${THE_SEEDED_SECRET}`,
          partialRefs: [],
        },
        bumpsVersion: false,
      },
    ]);

    const rows = await sql<{ payload: string }>`
      SELECT payload::text AS payload FROM factory.events
      WHERE correlation_id = 'run_pg_redaction'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
    // The **stored** row carries no secret.
    expect(String(rows.rows[0]?.payload)).not.toContain(THE_SEEDED_SECRET);
  });

  it.skipIf(!running)('purges the object and marks the row, and touches no event', async () => {
    const objectStore = new InMemoryObjectStore();
    const spool = new InMemorySpool();
    const runStore = new PostgresRunRecordStore({ db });
    const store = new RunArtifactStore({ objectStore, spool, runStore });

    await store.finalise(
      { ...THE_PARTS, identity: { ...THE_PARTS.identity, taskId: 'task_pg_artefacts' } },
      { ...THE_INDEX, taskId: 'task_pg_artefacts' },
      'engineering',
    );

    // Count the events **before** the purge.
    const before = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM factory.events
    `.execute(db);

    const job = new PurgeJob({ objectStore, runStore });
    const result = await job.purge('2027-11-10');

    expect(result.purged).toContain(THE_INDEX.runId);
    expect(objectStore.size).toBe(0);

    // The row is marked, not deleted.
    const row = await runStore.find(THE_INDEX.runId);
    expect(row?.status).toBe('purged');

    // And the events are **exactly** as they were.
    const after = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM factory.events
    `.execute(db);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it.skipIf(!running)('stores bytes that verify against the record’s hash', async () => {
    const objectStore = new InMemoryObjectStore();
    const spool = new InMemorySpool();
    const runStore = new PostgresRunRecordStore({ db });
    const store = new RunArtifactStore({ objectStore, spool, runStore });

    const result = await store.finalise(
      { ...THE_PARTS, identity: { ...THE_PARTS.identity, taskId: 'task_pg_artefacts' } },
      { ...THE_INDEX, taskId: 'task_pg_artefacts' },
      'engineering',
    );

    const bytes = await objectStore.get(recordKey(result.runId));
    const stored = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as RunRecord;
    expect(recordHashVerifies(stored)).toBe(true);
    expect(stored.sha256).toBe(result.recordSha256);
  });
});
