/**
 * `hello-run` — run the `H.hello` workflow against a **real** event log.
 *
 * ## Why this tool exists
 *
 * CL-G1-12 says:
 *
 * > **CL-G1-12** | Event hash chain verifies on the hello-task run |
 * > `factory audit chain <taskId>` exit 0 | agent
 *
 * Two things have to be true for that row to be ticked, and neither of
 * them is true of the unit suite:
 *
 * 1. a hello-task run must have happened, and its events must be in the
 *    **real** `factory.events` table — the unit suite runs against an
 *    in-memory log, so there is nothing for the CLI to verify;
 * 2. the `factory` command must exist — it did not, until T-1.17 added
 *    `apps/cli/src/bin.ts`.
 *
 * So this tool is the missing middle: it runs the **same** workflow the
 * factory runs (`runHello` from `@factory/orchestrator`), with the same
 * fake provider and the same in-memory artefact store the unit suite
 * uses, but with a `StateSink` that appends **real** events to the
 * Postgres event log.
 *
 * ## What it does **not** do
 *
 * It does not re-implement the workflow. `runHello` is the workflow; this
 * tool supplies the collaborators and prints the outcome. If the workflow
 * changed, this tool's output changes with it — that is the point.
 *
 * ## The `StateSink`
 *
 * The orchestrator's transitions go through the `StateSink` port. The
 * in-memory sink swallows them; this one writes them to the event log as
 * `task` aggregate events, which is what gives the run a hash chain.
 *
 * The events are chained under the **task** aggregate, because that is
 * what `factory audit chain <taskId>` looks up — the command verifies
 * `{ kind: 'task', id: <taskId> }`.
 *
 * ## The provider is **fake**, on purpose
 *
 * The Phase-0 exit criterion is about the **spine**: FakeProvider →
 * artefact → record. A real provider needs a real key, and HR-9 forbids
 * real secrets in this repo. The nightly run is what exercises a real
 * provider.
 *
 * ## Usage
 *
 * ```
 * FACTORY_OWNER_DATABASE_URL=postgresql://… \
 *   node --import ./tools/compiled-resolver.mjs ./tools/hello-run.ts <taskId>
 * ```
 *
 * The `--import` flag installs the workspace resolution hook, which maps
 * `@factory/<name>` onto the **compiled** `packages/<name>/dist/index.js`.
 * Without it Node resolves `@factory/db` to the package's TypeScript
 * source, whose own `.js` specifiers it does not rewrite — and the run
 * dies with `ERR_MODULE_NOT_FOUND` on `packages/db/src/connection.js`. See
 * `tools/compiled-resolver.mjs` for why the packages point at source.
 *
 * The database must already be migrated (`factory db migrate`).
 */

import { createDatabase, destroyDatabase, sql } from '@factory/db';
import { PostgresEventLog } from '@factory/eventlog';
import {
  InMemoryObjectStore,
  InMemoryRunRecordStore,
  InMemorySpool,
  RunArtifactStore,
} from '@factory/artefacts';
import { type RoutingPolicy } from '@factory/contracts';
import {
  FakeBudgetLedger,
  InMemoryModelCallStore,
  ModelGatewayImpl,
  createAdapter,
  type PricingTable,
} from '@factory/gateway';
import {
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  InMemoryRunStore,
  runHello,
  type HelloContext,
  type StateSink,
} from '@factory/orchestrator';

/**
 * The routing policy the run runs under.
 *
 * The gateway **refuses** a request that matches no rule — it does not
 * fall back to a default model — so the policy has to route the roles
 * `H.hello` uses: `refinement` (the `specify` stage) and `worker` (the
 * `implement` stage).
 */
const ROUTING_POLICY: RoutingPolicy = {
  apiVersion: 'factory/v1',
  kind: 'RoutingPolicy',
  metadata: { name: 'hello-run' },
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
      strong: {
        primary: { provider: 'alpha', model: 'test-model-large' },
        fallbacks: [{ provider: 'beta', model: 'test-model-large' }],
      },
    },
    rules: [
      { match: { role: 'worker' }, use: 'cheap' },
      { match: { role: 'refinement' }, use: 'cheap' },
      { match: { role: 'planner' }, use: 'cheap' },
    ],
    budgets: {
      perRequestUsdMicros: 1_500_000,
      perTaskUsdMicros: 5_000_000,
      perWorkflowDayUsdMicros: 50_000_000,
    },
    failover: {
      on: ['provider-error', 'rate-limited', 'schema-invalid-twice'],
      neverOn: ['budget-exhausted'],
    },
    caching: { prefix: true },
  },
};

/**
 * The pricing table the fake models are priced by.
 */
const PRICING: PricingTable = {
  'test-model-small': {
    inputPerMillionUsdMicros: 100_000,
    outputPerMillionUsdMicros: 500_000,
    cacheReadPerMillionUsdMicros: 10_000,
    cacheWritePerMillionUsdMicros: 125_000,
  },
  'test-model-large': {
    inputPerMillionUsdMicros: 1_500_000,
    outputPerMillionUsdMicros: 7_500_000,
    cacheReadPerMillionUsdMicros: 150_000,
    cacheWritePerMillionUsdMicros: 1_875_000,
  },
};

/**
 * The registered event type for each node transition.
 *
 * The event log checks `eventType` against the **registered vocabulary**
 * (pack 03 §5) and rejects anything that is not in it. So the
 * orchestrator's node transitions are mapped onto the registered node
 * events rather than onto a free-form name.
 */
const TRANSITION_EVENT_TYPES: Readonly<Record<string, string>> = {
  READY: 'node.ready',
  LEASED: 'node.leased',
  RUNNING: 'node.executionStarted',
  SUCCEEDED: 'stage.completed',
  FAILED: 'stage.failed',
  INCOMPLETE: 'stage.incomplete',
};

/**
 * The context the run's stages see.
 *
 * A **real** manifest — an envelope id, a resolved digest, one item and
 * one gap — because the manifest is element 2 of the run record and the
 * record must carry it verbatim (A0.3).
 */
const CONTEXT: HelloContext = {
  manifest: {
    envelopeId: 'ctx_hello_g1',
    resolvedContextSha256: `sha256:${'a'.repeat(64)}`,
    items: [
      {
        id: 'skill.hello',
        version: '1',
        sha256: `sha256:${'b'.repeat(64)}`,
        trust: 'trusted',
      },
    ],
    gaps: [
      {
        expected: 'skill.missing',
        reason: 'not published',
      },
    ],
  },
  body: 'Say hello, and nothing else.',
};

/**
 * Run the workflow.
 */
const main = async (): Promise<void> => {
  const taskId = process.argv[2];
  if (taskId === undefined || taskId === '') {
    console.error('usage: hello-run <taskId>');
    process.exitCode = 2;
    return;
  }

  const connectionString = process.env['FACTORY_OWNER_DATABASE_URL'];
  if (connectionString === undefined) {
    console.error('FACTORY_OWNER_DATABASE_URL is not set.');
    process.exitCode = 2;
    return;
  }

  const db = createDatabase({
    connectionString,
    role: 'factory_owner',
    mode: 'assume',
  });

  try {
    const log = new PostgresEventLog({ db });

    // The task row. The event log versions its events against the
    // **aggregate's** row — for a `task` aggregate that row is
    // `factory.tasks` — so the task has to exist before the run writes
    // anything. Without it the log's CAS finds no row and refuses.
    //
    // The row is inserted with `version = 0`, and each transition bumps
    // it by one, so the version sequence the log checks against is the
    // transition count.
    await sql`
      INSERT INTO factory.tasks (
        id, repo, workflow, state, version, autonomy_level, risk_tier,
        source, definition_sha, correlation_id, budget_usd_micros,
        spent_usd_micros, created_by
      )
      VALUES (
        ${taskId}, 'software-factory', 'H.hello', 'RUNNING', 0, 2, 'R1',
        ${JSON.stringify({ kind: 'manual', ref: 'hello-run', authorLogin: 'evidence' })},
        'def_hello_g1', ${taskId}, 1000000, 0, 'factory.orchestrator'
      )
      ON CONFLICT (id) DO NOTHING
    `.execute(db);

    // How many transitions the run has made. The event log's CAS checks
    // the aggregate's version, so the counter is what keeps the version
    // sequence honest.
    let transitionCount = 0;

    // The `StateSink` that writes the run's transitions to the **real**
    // event log. Each transition is one event under the `task`
    // aggregate, so the run leaves a hash chain behind — the chain
    // `factory audit chain <taskId>` verifies.
    const state: StateSink = {
      transition: async (input) => {
        // The event type must be in the **registered vocabulary** (pack
        // 03 §5) — the log rejects anything else. The orchestrator's
        // node transitions map onto the registered node events.
        const eventType = TRANSITION_EVENT_TYPES[input.to];
        if (eventType === undefined) {
          // A transition with no registered event is a gap, not a
          // silently-dropped fact. Saying so is the difference between
          // "the log does not have that" and "the log lost it".
          throw new Error(
            `no registered event type for the transition to ${JSON.stringify(input.to)}`,
          );
        }

        await log.append([
          {
            eventType,
            // The aggregate's `version` is the **expected** version the
            // log's CAS checks. The first event for an aggregate is
            // version 0, so each transition bumps it by one — which is
            // what makes the chain's version check meaningful.
            aggregate: { kind: 'task', id: input.taskId, version: transitionCount },
            correlationId: input.taskId,
            actor: { kind: 'system', id: 'factory.orchestrator' },
            authority: {
              basis: 'system-rule',
              autonomyLevel: 2,
            },
            subject: { nodeId: input.nodeId, to: input.to },
            payload: { trigger: input.trigger, facts: input.facts ?? null },
            context: { items: [] },
          },
        ]);
        transitionCount += 1;
        return { ok: true };
      },
    };

    // The gateway, with the **fake** providers built through the
    // factory — the same path a real adapter takes, so the runtime
    // guard is exercised here too.
    const alpha = createAdapter('fake', 'alpha', {
      models: ['test-model-small', 'test-model-large'],
    });
    const beta = createAdapter('fake', 'beta', {
      models: ['test-model-small', 'test-model-large'],
    });

    const calls = new InMemoryModelCallStore();
    let callCounter = 0;
    let stageCounter = 0;

    const gateway = new ModelGatewayImpl({
      policy: ROUTING_POLICY,
      pricing: PRICING,
      providers: { alpha, beta },
      ledger: new FakeBudgetLedger({ calls }),
      calls,
      clock: {
        now: () => new Date(),
        nowIso: () => new Date().toISOString(),
      },
      nextId: () => {
        callCounter += 1;
        return `mcl_${String(callCounter).padStart(6, '0')}`;
      },
    });

    // The artefact store, assembled the way the artefacts package
    // expects: the object store holds the bytes, the spool holds the
    // writes in flight, the index holds the rows, and the
    // `RunArtifactStore` is the writer that ties them together — and
    // that is the `RecordSink` the record stage writes through.
    const objectStore = new InMemoryObjectStore();
    const spool = new InMemorySpool();
    const runStore = new InMemoryRunRecordStore();
    const artefactStore = new RunArtifactStore({ objectStore, spool, runStore });

    const outcome = await runHello({
      gateway,
      artefacts: objectStore,
      records: artefactStore,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
      state,
      context: CONTEXT,
      taskId,
      runId: `run_hello_${taskId}`,
      clock: { now: () => new Date().toISOString() },
      nextRunId: () => {
        stageCounter += 1;
        return `run_hello_stage_${String(stageCounter)}`;
      },
      configuration: {
        definitionRevision: 'def_hello_g1',
        harnessVersion: 'harness@1.0.0',
        routingPolicy: 'policy@1.0.0',
        toolRegistryRevision: 'tools@1.0.0',
      },
      budgetUsdMicros: 1_000_000,
    });

    console.log(`task:     ${outcome.taskId}`);
    console.log(`run:      ${outcome.runId}`);
    console.log(`ok:       ${String(outcome.ok)}`);
    console.log(
      `stages:   ${outcome.stages.map((s) => `${s.stage}=${s.status}`).join(' ')}`,
    );
    console.log(`cost:     ${String(outcome.costUsdMicros)} micro-USD`);
    for (const artefact of outcome.artefacts) {
      console.log(`artefact: ${artefact.kind} ${artefact.sha256}`);
    }

    if (!outcome.ok) {
      console.error(`failed: ${outcome.failure ?? 'unknown'}`);
      process.exitCode = 1;
    }
  } finally {
    await destroyDatabase(db);
  }
};

await main();
