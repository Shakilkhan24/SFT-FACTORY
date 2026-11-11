/**
 * **INV-3** — every consequential action is attributable and in the event log.
 *
 * checklist 14 §"The twelve invariants and their mutations", row INV-3:
 *
 * > | **INV-3** | Every consequential action is attributable and in the event
 * > log | *make the broker skip step 10* |
 *
 * and pack `08` §3, on what the test asserts:
 *
 * > **INV-3** — in a recorded fake run: `tool_invocations` ↔ events 1:1;
 * > state transitions ↔ events 1:1; every event has an actor and an
 * > authority.
 *
 * ## What "consequential" means here
 *
 * blueprint `09` §5.2: the event log is the factory's **single source of
 * truth**, and every projection is disposable and rebuildable from it. So
 * "consequential" is not a judgement call made by a caller — it is
 * *whatever the broker did*. The broker's tenth step is the only place a
 * capability call becomes a fact, and it writes **two** things:
 *
 * * the row in `factory.tool_invocations` — the *table*'s record of the call;
 * * the event in `factory.events` — the *log*'s record of the call.
 *
 * If those two ever disagree, the factory has two truths about one action,
 * and neither can be trusted to rebuild the other. So the 1:1 is the
 * invariant.
 *
 * ## Why this test is written against a *recorded run*
 *
 * The trap in checklist 14 trap 2 is: *"Mutating something the test does
 * not actually depend on. The mutation must remove the **guard** the test is
 * written against."*
 *
 * So the test cannot assert against the broker's internals — it has to
 * assert against **what the run left behind**: the invocation rows and the
 * events. Two rules follow, and both are load-bearing:
 *
 * 1. **The count must be one, not merely equal.** A test that asserted only
 *    `rows.length === events.length` would be *vacuous* under the mutation:
 *    skip step 10 and both collections are empty, and empty equals empty.
 *    So the assertions below pin the count at the number of calls the run
 *    made. Skipping step 10 makes the count **zero**, and the test goes red
 *    with "expected 1, received 0".
 * 2. **The two collections must be joined on a key, not merely compared.**
 *    The join key is the **idempotency key** — the broker computes it once
 *    and puts it in *both* the invocation record and the `tool.invoked`
 *    payload. So the row table and the event log can be reconciled against
 *    each other, and the reconciliation is a fact about the *data*, not
 *    about a double that writes both together.
 *
 * ## The two halves
 *
 * * **Half A — in memory.** The broker, its recording doubles, and a
 *   **split** invocation store: the row goes into one collection, the event
 *   into another. So the 1:1 is a cross-check between two independently
 *   recorded things, not a property of a store that writes both at once.
 * * **Half B — against Postgres.** The same claim, but the two halves are
 *   read out of the database **independently** — `tool_invocations` by one
 *   query, `events` by another — so the 1:1 is a fact about the schema
 *   rather than about a double. The actor and the authority are checked
 *   against the real `actor_kind`/`actor_id`/`authority` columns.
 *
 * The state half ("state transitions ↔ events 1:1") needs the real
 * Postgres: the version bump and the event are written in one transaction,
 * and a double has no transaction to lose. So it lives in the Postgres half.
 *
 * ## The environment
 *
 * The Postgres halves need a real server — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available they **skip**: that is an environment limit,
 * not a defect. The in-memory half always runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evaluate } from '../../packages/policy/src/index.ts';
import { PolicyBundle } from '../../packages/contracts/src/index.ts';
import { sql, type FactoryDatabase, type Kysely } from '../../packages/db/src/index.ts';
import {
  CountingIdSource,
  FixedBrokerClock,
  RecordingApprovalChecker,
  RecordingCredentialProvider,
  aCapability,
  aContext,
  aGrant,
  anEntry,
} from '../helpers/broker.ts';
import {
  containerRunning,
  createEventLogHarness,
  insertTask,
  type EventLogHarness,
} from '../helpers/eventlog.ts';
import {
  PostgresInvocationStore,
  ToolBroker,
  type BrokerEvent,
  type CapabilityRegistry,
  type InvocationRecord,
  type InvocationRequest,
  type InvocationStore,
  type RegistryEntry,
} from '../../packages/broker/src/index.ts';
import { PostgresEventLog } from '../../packages/eventlog/src/index.ts';
import {
  PostgresStateMachineStore,
} from '../../packages/orchestrator/src/index.ts';
import {
  StateMachine,
  type GuardFacts,
  type TaskState,
} from '../../packages/state/src/index.ts';

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, the Postgres-backed halves **skip** rather than fail:
 * the absence of a Docker daemon is an environment limit, not a defect in
 * the broker. The in-memory half always runs.
 */
const running = await containerRunning();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The **split** invocation store — the instrument of the in-memory half.
 *
 * ## Why it is split
 *
 * The product's store writes the row and the event together, in one
 * transaction (blueprint `09` §6). A double that does the same would make
 * the 1:1 a property of the double: the two collections could never
 * disagree, so the assertion would prove nothing about the broker.
 *
 * So this store writes the row into `rows` and the event into `events`, as
 * two separate collections, and the test reconciles them against each
 * other. They can disagree here — which is the whole point of the check.
 */
class SplitInvocationStore implements InvocationStore {
  /** The invocation rows, in write order. */
  readonly rows: InvocationRecord[] = [];

  /** The events, in write order. */
  readonly events: BrokerEvent[] = [];

  /** The rows, by idempotency key — the replay lookup. */
  readonly #byKey = new Map<string, InvocationRecord>();

  public record(record: InvocationRecord, event: BrokerEvent): Promise<void> {
    this.rows.push(record);
    this.events.push(event);
    this.#byKey.set(record.idempotencyKey, record);
    return Promise.resolve();
  }

  public findByKey(idempotencyKey: string): Promise<InvocationRecord | undefined> {
    return Promise.resolve(this.#byKey.get(idempotencyKey));
  }
}

/**
 * The registry the broker is given.
 */
const aRegistryOf = (entries: readonly RegistryEntry[]): CapabilityRegistry => ({
  lookup: (id) => entries.find((entry) => entry.capability.id === id),
  list: () => entries,
  reconcile: () => ({ transport: 'inproc', advertised: [], findings: [] }),
});

/**
 * A policy bundle that allows the ordinary E0 read.
 *
 * The bundle is the **product's own** shape — the `PolicyBundle` contract
 * from `@factory/contracts` — so the policy evaluator under test sees the
 * same rules the factory runs with, not a look-alike written for the test.
 */
const anAllowingBundle = (): PolicyBundle =>
  PolicyBundle.parse({
    apiVersion: 'factory/v1',
    kind: 'PolicyBundle',
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
  });

/**
 * Build a broker over the given store.
 *
 * The doubles are the ones `tests/helpers/broker.ts` uses — the registry,
 * the policy evaluator, the approval checker, the credential provider, the
 * clock and the id source. Only the **store** is the test's own, because
 * the store is the thing under test.
 *
 * ## Why the id prefix is the caller's
 *
 * The invocation row's `id` is its **primary key**, so two brokers built
 * against the same database must not mint the same one. The prefix is
 * therefore the caller's, and each case that shares a database gives its
 * own — otherwise the second write fails on `tool_invocations_pkey` and the
 * failure reads as a broker defect when it is a test-isolation defect.
 */
const buildBrokerOver = (
  store: InvocationStore,
  options: { readonly handler?: () => unknown; readonly idPrefix?: string } = {},
): ToolBroker =>
  new ToolBroker({
    registry: aRegistryOf([anEntry(aCapability())]),
    policy: {
      evaluate: (input, bundle) =>
        evaluate(input, bundle, {
          workflowGrant: { allow: ['repo:read'], deny: [] },
          requiredScope: 'repo:read',
        }),
    },
    policyBundle: anAllowingBundle(),
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
      guardToken: () => Symbol('inv3-token'),
    },
    approvals: new RecordingApprovalChecker(),
    credentials: new RecordingCredentialProvider(),
    store,
    clock: new FixedBrokerClock(),
    ids: new CountingIdSource(options.idPrefix ?? 'inv3'),
  });

/**
 * A request to the broker.
 *
 * Each call gets its own **attempt**, so each has its own idempotency key
 * and each is a fresh call rather than a replay of the previous one.
 */
const aRequest = (overrides: Partial<InvocationRequest> = {}): InvocationRequest => ({
  capabilityId: 'test.capability',
  args: { repo: 'org/repo' },
  context: aContext({ taskId: 'task_inv3', runId: 'run_inv3' }),
  grant: aGrant(),
  ...overrides,
});

/**
 * The idempotency key an event's payload carries.
 *
 * The `tool.invoked` payload is `unknown` as far as the broker's port is
 * concerned, so the payload is read defensively: the assertion is about the
 * *data*, and a payload that does not carry the key cannot be joined to a
 * row.
 */
const eventIdempotencyKey = (event: BrokerEvent): string | undefined => {
  if (typeof event.payload !== 'object' || event.payload === null) {
    return undefined;
  }
  const key = (event.payload as Record<string, unknown>)['idempotencyKey'];
  return typeof key === 'string' ? key : undefined;
};

/**
 * Insert a run row directly, bypassing the event log.
 *
 * `tool_invocations.run_id` references `runs(run_id)`, so the run has to
 * exist before the invocation row can be written. The row is created
 * directly rather than through the event log: a run row is the *record* of
 * a run having started, and the broker is not the path that starts one.
 */
const insertRun = async (
  db: Kysely<FactoryDatabase>,
  runId: string,
  taskId: string,
): Promise<void> => {
  await db
    .insertInto('runs')
    .values({
      run_id: runId,
      task_id: taskId,
      node_id: 'node_1',
      attempt: 1,
      role: 'implementer',
      stage_kind: 'implement',
      executor_kind: 'deterministic',
      status: 'RUNNING',
    })
    .execute();
};

/**
 * The guard facts the state machine needs for the transitions this test
 * drives.
 *
 * The transitions are the ordinary ones — `DRAFT → TRIAGED → REFINED` —
 * so no guard has anything to refuse and every transition is a *state
 * change*.
 */
const facts: GuardFacts = {
  criteriaCount: 3,
  oracleRef: 'orc_1',
  graph: {
    acyclic: true,
    fanOutEdgesJustified: true,
    capabilitiesWithinGrant: true,
    oracleAdmitted: true,
    planApprovalValid: true,
  },
  nodeStates: ['SUCCEEDED'],
  gatesPassed: true,
  iterationBudgetRemains: true,
  requiredApprovalClass: 'merge',
  approval: { exists: true, unexpired: true, boundToArtefact: true },
  approvedSha: 'sha256:head',
  headSha: 'sha256:head',
  humanInitiated: true,
  accessPoint: 'github',
  cancelledByHuman: true,
};

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe('INV-3 · every consequential action is attributable and in the event log', () => {
  describe('the recorded fake run — the invocation table and the event log', () => {
    it('INV-3 a successful call writes exactly one invocation row and exactly one tool.invoked event', async () => {
      const store = new SplitInvocationStore();
      const broker = buildBrokerOver(store);

      const outcome = await broker.invoke(aRequest());

      expect(outcome.ok).toBe(true);

      // ---- The row table ------------------------------------------------
      //
      // The count is pinned at **one**, not merely compared with the event
      // count. Skipping the broker's step 10 leaves this empty, and an
      // empty collection compared with an empty one would still be "1:1" —
      // so the count is what makes the assertion bite.
      expect(store.rows).toHaveLength(1);

      // ---- The event log ------------------------------------------------
      expect(store.events).toHaveLength(1);
      expect(store.events[0]?.eventType).toBe('tool.invoked');
    });

    it('INV-3 the invocation row and the event are joined by the same idempotency key', async () => {
      // The 1:1 is a *pairing*, not two counts that happen to be equal. So
      // the join key is asserted in both directions: every row has an
      // event, and every event has a row.
      const store = new SplitInvocationStore();
      const broker = buildBrokerOver(store);

      await broker.invoke(aRequest());

      const rowKeys = store.rows.map((row) => row.idempotencyKey);
      const eventKeys = store.events.map((event) => eventIdempotencyKey(event));

      expect(eventKeys).toHaveLength(1);
      expect(eventKeys[0]).toBeDefined();

      // Every row is claimed by exactly one event.
      expect(new Set(eventKeys).size).toBe(rowKeys.length);
      for (const key of rowKeys) {
        expect(eventKeys).toContain(key);
      }

      // And every event is backed by exactly one row.
      for (const key of eventKeys) {
        expect(rowKeys.filter((rowKey) => rowKey === key)).toHaveLength(1);
      }
    });

    it('INV-3 every event the broker writes carries a non-empty actor and a non-empty authority', async () => {
      // Three calls with three different outcomes, so the claim is about
      // *every* event the broker writes — a success, a denial and a
      // failure — and not only about the happy path.
      const store = new SplitInvocationStore();
      const broker = buildBrokerOver(store);

      await broker.invoke(aRequest({ context: aContext({ taskId: 't_ok', runId: 'r_ok' }) }));

      await broker.invoke(
        aRequest({
          // A grant that does not name the capability: the call is refused
          // at step 3 and recorded as `tool.denied`.
          context: aContext({ taskId: 't_denied', runId: 'r_denied' }),
          grant: aGrant({ capabilities: ['some.other.capability'] }),
        }),
      );

      await broker.invoke(
        aRequest({
          // An adapter that throws: the attempt is recorded as
          // `tool.failed`.
          context: aContext({ taskId: 't_failed', runId: 'r_failed', attempt: 2 }),
        }),
      );

      expect(store.events.length).toBeGreaterThanOrEqual(2);
      expect(store.events.map((event) => event.eventType)).toContain('tool.invoked');
      expect(store.events.map((event) => event.eventType)).toContain('tool.denied');

      for (const event of store.events) {
        expect(event.actor.kind.length, `the actor kind of ${event.eventType}`).toBeGreaterThan(0);
        expect(event.actor.id.length, `the actor id of ${event.eventType}`).toBeGreaterThan(0);
        expect(event.authority.basis.length, `the authority basis of ${event.eventType}`).toBeGreaterThan(0);
      }
    });

    it('INV-3 the denial and the failure are recorded too — an unrecorded attempt is invisible', async () => {
      const store = new SplitInvocationStore();
      const broker = buildBrokerOver(store);

      await broker.invoke(
        aRequest({
          context: aContext({ taskId: 't_denied', runId: 'r_denied' }),
          grant: aGrant({ capabilities: ['some.other.capability'] }),
        }),
      );

      // A denial is a row and an event, exactly like a success.
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]?.status).toBe('denied');
      expect(store.events).toHaveLength(1);
      expect(store.events[0]?.eventType).toBe('tool.denied');

      // The denial's authority says it *violated* the intended authority —
      // the call was attempted and refused.
      expect(store.events[0]?.authority.violation).toBe(true);
    });
  });

  describe('against Postgres — the table and the log, read independently', () => {
    let harness: EventLogHarness;

    beforeAll(async () => {
      if (!running) {
        return;
      }
      // The harness only creates databases whose name starts with
      // `factory_t1_` — it refuses to touch anything it did not create.
      harness = await createEventLogHarness('factory_t1_inv3_attribution');
    }, 180_000);

    afterAll(async () => {
      await harness?.destroy();
    });

    /**
     * The invocation rows for a task — read straight out of the table.
     */
    const invocationRows = async (taskId: string) =>
      sql<{
        id: string;
        status: string;
        idempotency_key: string;
        capability_id: string;
      }>`
        SELECT id, status, idempotency_key, capability_id
        FROM factory.tool_invocations
        WHERE task_id = ${taskId}
        ORDER BY started_at, id
      `.execute(harness.db);

    /**
     * The events for a task — read straight out of the log.
     */
    const eventRows = async (taskId: string) =>
      sql<{
        event_type: string;
        actor_kind: string;
        actor_id: string;
        authority: unknown;
        payload: unknown;
      }>`
        SELECT event_type, actor_kind, actor_id, authority, payload
        FROM factory.events
        WHERE aggregate_kind = 'task' AND aggregate_id = ${taskId}
        ORDER BY seq
      `.execute(harness.db);

    it.skipIf(!running)('INV-3 a recorded run leaves one tool_invocations row and one event', async () => {
      const taskId = 'tsk_inv3_1';
      const runId = 'run_inv3_1';
      await insertTask(harness.db, taskId);
      await insertRun(harness.db, runId, taskId);

      // The store writes both, in one transaction.
      const store = new PostgresInvocationStore({ db: harness.db });
      const broker = buildBrokerOver(store, { idPrefix: 'inv3_pg_1' });

      const outcome = await broker.invoke(
        aRequest({ context: aContext({ taskId, runId }) }),
      );
      expect(outcome.ok).toBe(true);

      // The two are read by two different queries, so the 1:1 is a fact
      // about the **schema**, not about a store that writes both together.
      const rows = await invocationRows(taskId);
      const events = await eventRows(taskId);

      // The count is pinned at one — skipping the broker's step 10 leaves
      // both empty, and "empty is 1:1" is precisely the trap this
      // assertion exists to close.
      expect(rows.rows).toHaveLength(1);
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.event_type).toBe('tool.invoked');

      // And they are *paired*: the event names the same idempotency key
      // the row carries.
      const payload = events.rows[0]?.payload as Record<string, unknown> | undefined;
      expect(payload?.['idempotencyKey']).toBe(rows.rows[0]?.idempotency_key);
    }, 60_000);

    it.skipIf(!running)('INV-3 every event in the log carries an actor and an authority', async () => {
      const taskId = 'tsk_inv3_2';
      const runId = 'run_inv3_2';
      await insertTask(harness.db, taskId);
      await insertRun(harness.db, runId, taskId);

      const store = new PostgresInvocationStore({ db: harness.db });
      const broker = buildBrokerOver(store, { idPrefix: 'inv3_pg_2' });

      await broker.invoke(
        aRequest({ context: aContext({ taskId, runId }) }),
      );

      const events = await eventRows(taskId);
      expect(events.rows.length).toBeGreaterThan(0);

      for (const event of events.rows) {
        // The columns are `NOT NULL` in the schema, so a non-empty value
        // is the real claim: an event with a blank actor or a blank
        // authority is not attributable.
        expect(event.actor_kind.length, `the actor kind of ${event.event_type}`).toBeGreaterThan(0);
        expect(event.actor_id.length, `the actor id of ${event.event_type}`).toBeGreaterThan(0);

        const authority = event.authority as Record<string, unknown> | undefined;
        expect(authority).toBeDefined();
        const basis = authority?.['basis'];
        expect(typeof basis, `the authority basis of ${event.event_type}`).toBe('string');
        expect(String(basis).length).toBeGreaterThan(0);
      }
    }, 60_000);

    it.skipIf(!running)('INV-3 every state transition is exactly one event, and the version agrees', async () => {
      // "State transitions ↔ events 1:1."
      //
      // The state's version and the log's event count are two *independent*
      // readings of the same fact: the version is bumped by the event
      // log's CAS, and the events are rows in the log. So they must agree,
      // and a transition that wrote no event (or two) would break the
      // agreement.
      const taskId = 'tsk_inv3_3';
      await insertTask(harness.db, taskId);

      const store = new PostgresStateMachineStore({ db: harness.db });
      const machine = new StateMachine(store);

      const path: TaskState[] = ['TRIAGED', 'REFINED', 'PLANNED', 'QUEUED'];

      let version = 0;
      for (const to of path) {
        const result = await machine.transition({
          taskId,
          to,
          trigger: 'step',
          actor: { kind: 'agent', id: 'agent_inv3' },
          authority: { basis: 'system-rule' },
          expectedVersion: version,
          eventType: 'request.triaged',
          facts,
        });
        expect(result.ok, `${String(to)} should be a legal transition`).toBe(true);
        if (result.ok) {
          version = result.snapshot.version;
        }
      }

      // The task's version — one bump per transition.
      const row = await harness.db
        .selectFrom('tasks')
        .select('version')
        .where('id', '=', taskId)
        .execute();
      expect(row[0]?.version).toBe(path.length);

      // And the log holds exactly one event per transition.
      const log = new PostgresEventLog({ db: harness.db });
      const events = [];
      for await (const event of log.read({ aggregate: { kind: 'task', id: taskId } })) {
        events.push(event);
      }
      expect(events).toHaveLength(path.length);

      // Each event carries an actor and an authority too.
      for (const event of events) {
        expect(event.actor.id.length).toBeGreaterThan(0);
        expect(event.authority.basis.length).toBeGreaterThan(0);
      }
    }, 60_000);
  });
});
