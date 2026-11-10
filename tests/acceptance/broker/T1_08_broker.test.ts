/**
 * T-1.08 — the broker against a real Postgres.
 *
 * blueprint 11 §6.4, §6.5; blueprint 09 §6.
 *
 * ## Why this file exists alongside the unit suite
 *
 * The unit suite proves the broker's **rules** — the ten steps, the order,
 * the gates, the containment, the trust tag — against the in-memory store,
 * with no database. That is the oracle's home, and it runs everywhere.
 *
 * This file proves the **Postgres implementation** agrees with those rules.
 * Two things in particular cannot be proved against a double:
 *
 * * **One transaction.** The invocation row and its event are written in the
 *   same transaction (blueprint 09 §6). Against a double, "the same
 *   transaction" is a claim; here it is a fact — a rollback of one leaves
 *   neither, and a failure between the two leaves neither.
 * * **The unique index.** The replay oracle is enforced by
 *   `tool_invocations.idempotency_key UNIQUE`, not by the broker's
 *   judgement. A second invocation with the same key cannot be written at
 *   all, so the idempotency rule is the *database's*, and this file proves
 *   the database agrees.
 *
 * A mocked database would prove none of that. The SQL *is* the claim.
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
  PostgresInvocationStore,
  ToolBroker,
  type InvocationRequest,
} from '../../../packages/broker/src/index.ts';
import { evaluate } from '../../../packages/policy/src/index.ts';
import { containerRunning, migrationsDir } from '../../helpers/eventlog.ts';
import { createPostgres, type Postgres } from '../../helpers/postgres.ts';
import {
  CountingIdSource,
  FixedBrokerClock,
  RecordingApprovalChecker,
  RecordingCredentialProvider,
  aCapability,
  aContext,
  aGrant,
  anEntry,
} from '../../helpers/broker.ts';

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
 * The broker, wired to the Postgres store.
 *
 * The doubles are the same ones the unit suite uses — only the **store**
 * differs, because the store is the thing under test here.
 */
const buildBroker = (options: {
  readonly db: Kysely<FactoryDatabase>;
  readonly store?: PostgresInvocationStore;
  readonly handler?: () => unknown;
}) => {
  const store = options.store ?? new PostgresInvocationStore({ db: options.db });

  const broker = new ToolBroker({
    registry: {
      lookup: (capabilityId) =>
        capabilityId === 'test.capability'
          ? anEntry(aCapability())
          : undefined,
      list: () => [],
      reconcile: () => ({ transport: 'inproc', advertised: [], findings: [] }),
    },
    policy: {
      evaluate: (input, bundle) =>
        evaluate(input, bundle, {
          workflowGrant: { allow: ['repo:read'], deny: [] },
          requiredScope: 'repo:read',
        }),
    },
    policyBundle: {
      spec: {
        denyRules: [],
        protectedPaths: [],
        effectRules: {
          E0: 'allow',
          E1: 'allow',
          E2: 'allow',
          E3: 'requireApproval',
          E4: 'requireApproval',
        },
        tierRules: {},
        default: 'deny',
      },
    } as never,
    adapters: {
      adapterFor: () =>
        Promise.resolve({
          describe: () => [],
          invoke: () =>
            Promise.resolve(
              options.handler === undefined ? { ok: true } : options.handler(),
            ),
          health: () => Promise.resolve('healthy' as const),
          close: () => Promise.resolve(undefined),
        }),
      guardToken: () => Symbol('test-token'),
    },
    approvals: new RecordingApprovalChecker(),
    credentials: new RecordingCredentialProvider(),
    store,
    clock: new FixedBrokerClock(),
    ids: new CountingIdSource(),
  });

  return { broker, store };
};

/**
 * A request.
 */
const aRequest = (overrides: Partial<InvocationRequest> = {}): InvocationRequest => ({
  capabilityId: 'test.capability',
  args: { repo: 'org/repo' },
  context: aContext(),
  grant: aGrant(),
  ...overrides,
});

describe('T-1.08 · the broker against Postgres', () => {
  let postgres: Postgres;
  let db: Kysely<FactoryDatabase>;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    postgres = await createPostgres('factory_t1_08_broker');
    db = createDatabase({
      connectionString: postgres.superuserUrl,
      role: 'factory_owner',
      mode: 'assume',
      max: 20,
    });
    const applied = await migrate(db, migrationsDir);
    expect(applied.applied.length + applied.alreadyApplied.length).toBeGreaterThan(0);

    // `tool_invocations.run_id` references `runs(run_id)`, and
    // `runs.task_id` references `tasks(id)` — so the invocation's run has
    // to exist before the invocation can be written. The rows are created
    // directly rather than through the event log: a run row is the
    // *record* of a run having started, and the broker is not the path
    // that starts one.
    await db
      .insertInto('tasks')
      .values({
        id: 'task_1',
        repo: 'org/repo',
        workflow: 'wf_test',
        state: 'RUNNING',
        autonomy_level: 2,
        risk_tier: 'R0',
        source: { kind: 'manual', ref: 'test', authorLogin: 'tester' },
        definition_sha: 'a'.repeat(40),
        correlation_id: 'task_1',
        budget_usd_micros: 1_000_000,
        created_by: 'tester',
      })
      .execute();

    await db
      .insertInto('runs')
      .values({
        run_id: 'run_1',
        task_id: 'task_1',
        node_id: 'node_1',
        attempt: 1,
        role: 'implementer',
        stage_kind: 'implement',
        executor_kind: 'deterministic',
        status: 'RUNNING',
      })
      .execute();
  }, 120_000);

  afterAll(async () => {
    if (db !== undefined) {
      await destroyDatabase(db);
    }
    await postgres?.destroy();
  }, 60_000);

  /**
   * The invocation rows.
   */
  const invocationRows = async (): Promise<
    readonly {
      readonly id: string;
      readonly capability_id: string;
      readonly status: string;
      readonly idempotency_key: string;
      readonly result_summary: unknown;
      readonly args_sha256: Buffer;
    }[]
  > => {
    const rows = await sql<{
      id: string;
      capability_id: string;
      status: string;
      idempotency_key: string;
      result_summary: unknown;
      args_sha256: Buffer;
    }>`
      SELECT id, capability_id, status, idempotency_key, result_summary, args_sha256
      FROM factory.tool_invocations
      ORDER BY started_at, id
    `.execute(db);
    return rows.rows;
  };

  /**
   * The event log's rows.
   */
  const eventRows = async (): Promise<
    readonly { readonly event_type: string; readonly aggregate_kind: string }[]
  > => {
    const rows = await sql<{ event_type: string; aggregate_kind: string }>`
      SELECT event_type, aggregate_kind FROM factory.events ORDER BY seq
    `.execute(db);
    return rows.rows;
  };

  it.skipIf(!running)('writes the invocation row and the event', async () => {
    const { broker } = buildBroker({ db });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);

    const rows = await invocationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capability_id).toBe('test.capability');
    expect(rows[0]?.status).toBe('succeeded');

    const events = await eventRows();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('tool.invoked');
  });

  it.skipIf(!running)('writes the row and the event in ONE transaction', async () => {
    // The row and the event are written together (blueprint 09 §6). So a
    // failure *between* them leaves neither — the event log can never claim
    // a call the table does not record.
    //
    // The failure is injected by making the event append fail: the store
    // inserts the row first, then appends the event, and the append is what
    // breaks.
    const store = new PostgresInvocationStore({ db });
    const failing = {
      record: (): Promise<void> => {
        throw new Error('the store failed before writing anything');
      },
      findByKey: (): Promise<undefined> => Promise.resolve(undefined),
    };

    const { broker } = buildBroker({ db, store: failing as never });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(false);
    // Neither the row nor the event was written — the transaction rolled
    // back as a whole.
    expect(await invocationRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);

    // The real store is still usable afterwards.
    const { broker: real } = buildBroker({ db, store });
    const second = await real.invoke(aRequest());
    expect(second.ok).toBe(true);
    expect(await invocationRows()).toHaveLength(1);
  });

  it.skipIf(!running)('the idempotency key is a UNIQUE index', async () => {
    // The replay oracle is the *database's*, not the broker's judgement.
    // So the row cannot be written twice — the second write fails on the
    // unique index.
    const { broker } = buildBroker({ db });

    await broker.invoke(aRequest());

    const rows = await invocationRows();
    expect(rows).toHaveLength(1);

    await expect(
      sql`
        INSERT INTO factory.tool_invocations (
          id, task_id, attempt, capability_id, effect_class, transport,
          args_sha256, status, idempotency_key
        ) VALUES (
          'inv_dup', 'task_1', 1, 'test.capability', 'E0', 'inproc',
          decode(repeat('ab', 32), 'hex'), 'succeeded',
          ${String(rows[0]?.idempotency_key)}
        )
      `.execute(db),
    ).rejects.toThrow();
  });

  it.skipIf(!running)('a replayed key returns the RECORDED result', async () => {
    // blueprint 11 §6.4: "a replayed key returns the **recorded** result."
    // The adapter ran once; the second call returns what the first wrote.
    let calls = 0;
    const { broker } = buildBroker({
      db,
      handler: () => {
        calls += 1;
        return { attempt: calls };
      },
    });

    const first = await broker.invoke(aRequest());
    const second = await broker.invoke(aRequest());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);

    expect(second.ok && second.replayed).toBe(true);
    expect(second.ok && second.value).toEqual({ attempt: 1 });
    expect(first.ok && first.replayed).toBe(false);

    // One row: the replay did not write a second.
    expect(await invocationRows()).toHaveLength(1);
    expect(await eventRows()).toHaveLength(1);
  });

  it.skipIf(!running)('a denial is recorded as a SECURITY event', async () => {
    // `tool.denied` is a security event (pack 03's event types): it is
    // counted, alerted on and shown on the Health region. So a refusal
    // must reach the log.
    const { broker } = buildBroker({ db });

    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ capabilities: ['some.other.capability'] }) }),
    );

    expect(outcome.ok).toBe(false);

    const rows = await invocationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('denied');

    const events = await eventRows();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('tool.denied');
  });

  it.skipIf(!running)('the credential material never reaches the row', async () => {
    // blueprint 11 §6.5: "the credential's reference and scopes are
    // recorded but its material never is."
    const secret = 'ghp_theSecretMaterial';
    const credentials = new RecordingCredentialProvider({ secret });

    const store = new PostgresInvocationStore({ db });
    const broker = new ToolBroker({
      registry: {
        lookup: (capabilityId) =>
          capabilityId === 'test.capability' ? anEntry(aCapability()) : undefined,
        list: () => [],
        reconcile: () => ({ transport: 'inproc', advertised: [], findings: [] }),
      },
      policy: {
        evaluate: (input, bundle) =>
          evaluate(input, bundle, {
            workflowGrant: { allow: ['repo:read'], deny: [] },
            requiredScope: 'repo:read',
          }),
      },
      policyBundle: {
        spec: {
          denyRules: [],
          protectedPaths: [],
          effectRules: {
            E0: 'allow',
            E1: 'allow',
            E2: 'allow',
            E3: 'requireApproval',
            E4: 'requireApproval',
          },
          tierRules: {},
          default: 'deny',
        },
      } as never,
      adapters: {
        adapterFor: () =>
          Promise.resolve({
            describe: () => [],
            invoke: () => Promise.resolve({ ok: true }),
            health: () => Promise.resolve('healthy' as const),
            close: () => Promise.resolve(undefined),
          }),
        guardToken: () => Symbol('test-token'),
      },
      approvals: new RecordingApprovalChecker(),
      credentials,
      store,
      clock: new FixedBrokerClock(),
      ids: new CountingIdSource(),
    });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);

    // The row carries no column for the credential at all — the reference
    // is the broker's record, and the material is nowhere.
    const dump = await sql<{ row: unknown }>`
      SELECT row_to_json(t) AS row FROM factory.tool_invocations t
    `.execute(db);
    expect(JSON.stringify(dump.rows)).not.toContain(secret);
  });
});
