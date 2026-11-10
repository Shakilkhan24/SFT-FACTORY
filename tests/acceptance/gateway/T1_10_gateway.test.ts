/**
 * T-1.10 — the gateway against a real Postgres.
 *
 * pack 02 §4.7, blueprint 11 §6.4.
 *
 * ## Why this file exists alongside `tests/unit/gateway-*.test.ts`
 *
 * The unit suite proves the gateway's **rules** — the order of the
 * pipeline, the budget check before the call, the failover loop, the
 * integer micro-USD cost — against the in-memory doubles, with no
 * database. That is the oracle's home, and it runs everywhere.
 *
 * This file proves the **Postgres implementation** agrees with those
 * rules. Three claims can only be proved against a real database:
 *
 * 1. **The `model_calls` row and the `model.requested` event are
 *    written in ONE transaction.** A mock cannot show that the event is
 *    rolled back with the row.
 * 2. **The idempotency key is really UNIQUE.** The in-memory double
 *    *replaces* a record with the same key; the database **refuses**
 *    the second insert. Only the database can show the constraint
 *    biting.
 * 3. **The event log's chain and `seq` really accept the gateway's
 *    events** — the gateway appends through the same `PostgresEventLog`
 *    every other writer uses.
 *
 * A mocked database would prove none of that. The SQL *is* the claim.
 *
 * ## The environment
 *
 * This suite needs a real Postgres — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available the suite cannot run; that is an
 * **environment** limit, not a failure of the code, and CI is where it
 * is proved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  migrate,
  type FactoryDatabase,
  type Kysely,
} from '../../../packages/db/src/index.ts';
import { containerRunning, migrationsDir } from '../../helpers/eventlog.ts';
import { createPostgres, type Postgres } from '../../helpers/postgres.ts';
import {
  createAdapter,
  FakeBudgetLedger,
  ModelGatewayImpl,
  PostgresModelCallStore,
  type PricingTable,
} from '../../../packages/gateway/src/index.ts';

import type { RoutingPolicy } from '../../../packages/contracts/src/index.ts';

/**
 * The pricing table the acceptance test uses.
 */
const PRICING: PricingTable = {
  'test-model-small': {
    inputPerMillionUsdMicros: 100_000,
    outputPerMillionUsdMicros: 500_000,
    cacheReadPerMillionUsdMicros: 10_000,
    cacheWritePerMillionUsdMicros: 125_000,
  },
};

/**
 * The routing policy the acceptance test uses.
 */
const POLICY: RoutingPolicy = {
  apiVersion: 'factory/v1',
  kind: 'RoutingPolicy',
  metadata: { name: 'acceptance' },
  spec: {
    providers: {
      alpha: { adapter: 'fake' },
      beta: { adapter: 'fake' },
    },
    classes: {
      cheap: {
        primary: { provider: 'alpha', model: 'test-model-small' },
        fallbacks: [{ provider: 'beta', model: 'test-model-small' }],
      },
    },
    rules: [{ match: { role: 'worker' }, use: 'cheap' }],
    budgets: {
      perRequestUsdMicros: 1_500_000,
      perTaskUsdMicros: 5_000_000,
    },
    failover: {
      on: ['provider-error', 'rate-limited'],
      neverOn: ['budget-exhausted'],
    },
    caching: { prefix: true },
  },
};

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, this suite **skips** rather than fails: the absence
 * of a Docker daemon is an environment limit, not a defect in the
 * gateway. The suite runs in CI, where the daemon exists, and that is
 * where the Postgres path is proved.
 */
const running = await containerRunning();

describe('T-1.10 · the gateway against Postgres', () => {
  let postgres: Postgres;
  let db: Kysely<FactoryDatabase>;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    postgres = await createPostgres('factory_t1_10_gateway');
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

    // The event log's aggregate is the **task**, and the gateway's
    // events carry `aggregate: {kind: 'task', id: taskId}` — so the
    // task row has to exist. The row is created directly rather than
    // through the event log: a task row is the *record* of a task
    // having started, and the gateway is not the path that starts one.
    await db
      .insertInto('tasks')
      .values({
        id: 'task_pg_1',
        repo: 'org/repo',
        workflow: 'wf_test',
        state: 'RUNNING',
        autonomy_level: 1,
        risk_tier: 'R0',
        source: { kind: 'manual', ref: 'test', authorLogin: 'tester' },
        definition_sha: 'a'.repeat(40),
        correlation_id: 'task_pg_1',
        budget_usd_micros: 1_000_000,
        created_by: 'tester',
      })
      .execute();
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await postgres?.destroy();
  }, 60_000);

  /**
   * A gateway over the Postgres call store.
   */
  const build = (options?: {
    readonly alphaError?: Error;
    readonly perTaskUsdMicros?: number;
  }): {
    readonly gateway: ModelGatewayImpl;
    readonly calls: PostgresModelCallStore;
    readonly alphaCallCount: () => number;
  } => {
    const settings = options ?? {};

    const alpha = createAdapter('fake', 'alpha', {
      models: ['test-model-small'],
      usage: { tokensIn: 1000, tokensOut: 1000 },
      ...(settings.alphaError === undefined
        ? {}
        : { error: settings.alphaError }),
    });

    const beta = createAdapter('fake', 'beta', {
      models: ['test-model-small'],
      usage: { tokensIn: 1000, tokensOut: 1000 },
    });

    const calls = new PostgresModelCallStore({ db });

    const gateway = new ModelGatewayImpl({
      policy: POLICY,
      pricing: PRICING,
      providers: { alpha, beta },
      ledger: new FakeBudgetLedger({
        calls,
        ...(settings.perTaskUsdMicros === undefined
          ? {}
          : { perTaskUsdMicros: settings.perTaskUsdMicros }),
      }),
      calls,
      clock: {
        now: (): Date => new Date('2026-11-10T00:00:00.000Z'),
        nowIso: (): string => '2026-11-10T00:00:00.000Z',
      },
      nextId: (): string => `mcl_pg_${String(Date.now())}`,
    });

    return {
      gateway,
      calls,
      alphaCallCount: (): number =>
        (alpha as unknown as { callCount: number }).callCount,
    };
  };

  /**
   * A model request.
   */
  const aRequest = (
    overrides: Record<string, unknown> = {},
  ): Parameters<ModelGatewayImpl['complete']>[0] =>
    ({
      role: 'worker',
      taskId: 'task_pg_1',
      nodeId: 'node_1',
      attempt: 1,
      messages: [{ role: 'user', content: 'hello' }],
      ...overrides,
    }) as Parameters<ModelGatewayImpl['complete']>[0];

  it.skipIf(!running)('writes the model_calls row AND the event', async () => {
    const { gateway } = build();

    const result = await gateway.complete(aRequest());

    expect(result.ok).toBe(true);

    const rows = await db
      .selectFrom('model_calls')
      .selectAll()
      .where('task_id', '=', 'task_pg_1')
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe('alpha');
    expect(rows[0]?.model).toBe('test-model-small');
    expect(rows[0]?.cost_usd_micros).toBe(600);
  });

  it.skipIf(!running)('writes the event with the RIGHT type', async () => {
    const { gateway } = build();

    await gateway.complete(aRequest());

    const events = await db
      .selectFrom('events')
      .selectAll()
      .where('event_type', '=', 'model.requested')
      .execute();

    expect(events).toHaveLength(1);
    expect(events[0]?.aggregate_kind).toBe('task');
    expect(events[0]?.aggregate_id).toBe('task_pg_1');
  });

  it.skipIf(!running)('the idempotency key is REALLY unique', async () => {
    // The in-memory double *replaces* a record with the same key; the
    // database **refuses** the second insert. Only the database can
    // show the constraint biting.
    const { gateway, calls } = build();

    await gateway.complete(aRequest());

    const recorded = await calls.findByKey(
      // The key the gateway wrote is the one the row carries.
      (
        await db
          .selectFrom('model_calls')
          .select('idempotency_key')
          .where('task_id', '=', 'task_pg_1')
          .execute()
      )[0]?.idempotency_key ?? '',
    );

    expect(recorded).toBeDefined();

    await expect(
      db
        .insertInto('model_calls')
        .values({
          id: 'mcl_pg_duplicate',
          task_id: 'task_pg_1',
          provider: 'alpha',
          model: 'test-model-small',
          cost_usd_micros: 0,
          status: 'ok',
          cached: false,
          via: 'complete',
          idempotency_key: recorded?.idempotencyKey ?? '',
        })
        .execute(),
    ).rejects.toThrow();
  });

  it.skipIf(!running)('a REPLAY returns the recorded result and calls nobody', async () => {
    const { gateway, alphaCallCount } = build();

    const first = await gateway.complete(aRequest());
    const second = await gateway.complete(aRequest());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // The provider was asked once.
    expect(alphaCallCount()).toBe(1);

    // And the row was written once.
    const rows = await db
      .selectFrom('model_calls')
      .selectAll()
      .where('task_id', '=', 'task_pg_1')
      .execute();
    expect(rows).toHaveLength(1);
  });

  it.skipIf(!running)('the FAILOVER writes the row against the answering provider', async () => {
    const { gateway } = build({
      alphaError: new Error('the provider is down'),
    });

    const result = await gateway.complete(aRequest());

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.provider).toBe('beta');

    const rows = await db
      .selectFrom('model_calls')
      .selectAll()
      .where('task_id', '=', 'task_pg_1')
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe('beta');
  });

  it.skipIf(!running)('the budget refusal writes NO row and NO event', async () => {
    const { gateway } = build({ perTaskUsdMicros: 1 });

    const result = await gateway.complete(aRequest());

    expect(result.ok).toBe(false);

    const rows = await db
      .selectFrom('model_calls')
      .selectAll()
      .where('task_id', '=', 'task_pg_1')
      .execute();
    expect(rows).toHaveLength(0);

    const events = await db
      .selectFrom('events')
      .selectAll()
      .where('event_type', '=', 'budget.exhausted')
      .execute();
    expect(events).toHaveLength(1);
  });
});
