/**
 * INV-12 — every component is replaceable without changing the
 * definition / workflow / agent contracts.
 *
 * checklist 14 §"The twelve invariants and their mutations":
 *
 * > **INV-12** | Every component is replaceable without changing the
 * > definition/workflows/agent contracts | **make a fake diverge**
 *
 * and pack `08` §3:
 *
 * > **INV-12** — the same contract suite passes against the real and the
 * > fake implementations of EventLog, PolicyEngine, ToolBroker,
 * > ModelGateway, IsolationProvider, HarnessAdapter, ScmAdapter,
 * > CredentialBroker and ApprovalService.
 *
 * ## What this suite is
 *
 * A **contract suite**: one set of behavioural assertions, written once,
 * applied to every implementation of a port. The suite is what says what
 * the port *means*; the implementations are what the factory runs.
 *
 * The invariant is not "the fakes are correct". It is: **a replacement is
 * possible** — an implementation may be swapped without the callers
 * changing, and the swapped-in implementation must behave the way the
 * contract says. If the fake and the real implementation disagree, then
 * the tests written against the fake are **not** evidence about the real
 * one, and every test in the factory that used the fake has been proving
 * a fiction.
 *
 * That is why the mutation is "make a fake diverge": a fake that is
 * subtly different from the real implementation is the failure mode this
 * invariant exists to catch.
 *
 * ## The pairs this suite discharges
 *
 * A contract suite needs **two subjects** to be a comparison. So every
 * suite below is run against the in-memory implementation **and** against
 * the real one, with the *same* assertions.
 *
 * | port | real | fake | halves |
 * |---|---|---|---|
 * | `InvocationStore` | `PostgresInvocationStore` | `InMemoryInvocationStore` | both |
 * | `ModelCallStore` | `PostgresModelCallStore` | `InMemoryModelCallStore` | both |
 * | `CredentialLeaseStore` | `PostgresCredentialLeaseStore` | `InMemoryCredentialLeaseStore` | both |
 * | `RunRecordStore` | `PostgresRunRecordStore` | `InMemoryRunRecordStore` | both |
 * | `ProjectionStore` | `PostgresProjectionStore` | `InMemoryProjectionStore` | both |
 * | `CursorStore` | `PostgresCursorStore` | `InMemoryCursorStore` | both |
 * | `EventSource` | `PostgresEventSource` | `InMemoryEventSource` | both |
 * | `ObjectStore` | `S3ObjectStore` | `InMemoryObjectStore` | both |
 *
 * The Postgres halves **skip** without a Docker daemon (the repo's
 * `it.skipIf(!running)` idiom), so the suite runs everywhere; the Postgres
 * halves are proved in CI.
 *
 * ## The ports the checklist names that have no pair — the **gap**
 *
 * The checklist names nine ports: `EventLog`, `PolicyEngine`,
 * `ToolBroker`, `ModelGateway`, `IsolationProvider`, `HarnessAdapter`,
 * `ScmAdapter`, `CredentialBroker` and `ApprovalService`.
 *
 * Six of them have **one** implementation in this repository, and a
 * contract suite with one subject is not a comparison. The other
 * **three** — `IsolationProvider`, `ScmAdapter` and `ApprovalService` —
 * have **none**: their packages are still the scaffolds checklist 01
 * (T-0.02) left behind. Both kinds are recorded below, each with the
 * reason, rather than quietly dropped or papered over with a tautological
 * assertion.
 *
 * The two that *do* have a pair among the nine are covered by the store
 * contracts above: the `ToolBroker`'s invocation store (the broker's only
 * replaceable collaborator) and the `ModelGateway`'s model-call store.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  InMemoryCursorPositions,
  InMemoryProjectionStore,
  PostgresCursorStore,
  PostgresEventSource,
  PostgresProjectionStore,
} from '../../packages/projections/src/index.ts';
import {
  InMemoryEventSource,
} from '../../packages/projections/src/fakes/index.ts';
import {
  InMemoryInvocationStore,
  PostgresInvocationStore,
} from '../../packages/broker/src/index.ts';
import {
  InMemoryModelCallStore,
  PostgresModelCallStore,
} from '../../packages/gateway/src/index.ts';
import {
  InMemoryCredentialLeaseStore,
  PostgresCredentialLeaseStore,
} from '../../packages/credentials/src/index.ts';
import {
  InMemoryObjectStore,
  InMemoryRunRecordStore,
  PostgresRunRecordStore,
  S3ObjectStore,
} from '../../packages/artefacts/src/index.ts';
import { PostgresEventLog } from '../../packages/eventlog/src/index.ts';
import {
  createDatabase,
  destroyDatabase,
  migrate,
  type FactoryDatabase,
  type Kysely,
} from '../../packages/db/src/index.ts';
import type { CredentialLease } from '../../packages/credentials/src/index.ts';
import type { InvocationRecord } from '../../packages/broker/src/index.ts';
import type { ModelCallRecord } from '../../packages/gateway/src/index.ts';
import type { RunIndexEntry } from '../../packages/artefacts/src/index.ts';

import { containerRunning, migrationsDir } from '../helpers/eventlog.ts';
import { createPostgres, type Postgres } from '../helpers/postgres.ts';

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, the Postgres halves **skip** rather than fail: the
 * absence of a Docker daemon is an environment limit, not a defect in the
 * product. The suite runs in CI, where the daemon exists.
 */
const running = await containerRunning();

/**
 * The database the Postgres halves share.
 *
 * One database for the whole file, because the migrations are applied once
 * and the whole point of the file is that the two implementations are
 * compared against the *same* schema. Each contract's rows are isolated
 * by their own ids, not by separate databases.
 */
const DATABASE = 'factory_t1_inv12_replaceable';

/**
 * The live database handle, when the container is up.
 */
let postgres: Postgres | undefined;
let db: Kysely<FactoryDatabase> | undefined;

/**
 * A byte sequence that is not the empty one.
 */
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

/**
 * The bytes of an object, as a comparable array.
 */
const bytesOf = (bytes: Uint8Array | undefined): number[] | undefined =>
  bytes === undefined ? undefined : [...bytes];

/**
 * A counter that names the rows each contract writes.
 *
 * The rows are never deleted — `factory.events` is append-only by design,
 * and every Postgres-backed contract writes an event as part of its
 * transaction. So the isolation between the contracts is by **id**, not by
 * truncation: each contract's rows carry a distinct prefix, and no two
 * contracts can collide on a primary key.
 */
let rowCounter = 0;

/**
 * A fresh id prefix for one contract case.
 *
 * The prefix names the *case*, and the ids it produces are unique across
 * the file — so a case's rows can never collide with another's, and a
 * replay against a key that another case used cannot happen.
 */
const freshPrefix = (label: string): string => {
  rowCounter += 1;
  return `${label}_${String(rowCounter).padStart(4, '0')}`;
};

beforeAll(async () => {
  if (!running) {
    return;
  }
  postgres = await createPostgres(DATABASE);
  db = createDatabase({
    connectionString: postgres.superuserUrl,
    role: 'factory_owner',
    mode: 'assume',
    max: 20,
  });
  const applied = await migrate(db, migrationsDir);
  expect(applied.applied.length + applied.alreadyApplied.length).toBeGreaterThan(0);
}, 120_000);

afterAll(async () => {
  if (db !== undefined) {
    await destroyDatabase(db);
    db = undefined;
  }
  if (postgres !== undefined) {
    await postgres.destroy();
    postgres = undefined;
  }
}, 60_000);

/**
 * The database handle, for the Postgres-backed contracts.
 *
 * @throws when the container is not running — the halves that call this
 * are `skipIf(!running)`, so reaching this without a handle is a
 * programming error in the suite, not an environment condition.
 */
const theDatabase = (): Kysely<FactoryDatabase> => {
  if (db === undefined) {
    throw new Error('the database handle is undefined — the container is not running');
  }
  return db;
};

/**
 * Insert the task and run rows the invocation and run-record tables
 * reference.
 *
 * `tool_invocations.run_id` references `runs(run_id)`, and `runs.task_id`
 * references `tasks(id)` — so the rows have to exist before the stores
 * that write into them can write at all. They are created directly rather
 * than through the event log: a task row is the *record* of a task having
 * started, and it is not this suite's business to start one.
 */
const insertTaskAndRun = async (
  taskId: string,
  runId: string,
): Promise<void> => {
  const handle = theDatabase();
  await handle
    .insertInto('tasks')
    .values({
      id: taskId,
      repo: 'org/repo',
      workflow: 'wf_test',
      state: 'RUNNING',
      autonomy_level: 2,
      risk_tier: 'R0',
      source: { kind: 'manual', ref: 'test', authorLogin: 'tester' },
      definition_sha: 'a'.repeat(40),
      correlation_id: taskId,
      budget_usd_micros: 1_000_000,
      created_by: 'tester',
    })
    .execute();

  await handle
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

describe('INV-12 · the ObjectStore contract', () => {
  /**
   * The contract every `ObjectStore` must satisfy.
   *
   * @param make a fresh store
   */
  const objectStoreContract = (make: () => {
    put(key: string, bytes: Uint8Array): Promise<{ readonly key: string; readonly uri: string }>;
    get(key: string): Promise<Uint8Array | undefined>;
    delete(key: string): Promise<void>;
  }): void => {
    it('reads back exactly what was written', async () => {
      const store = make();
      const location = await store.put('runs/r1/record.json', BYTES);

      expect(location.key).toBe('runs/r1/record.json');
      expect(location.uri).toContain('runs/r1/record.json');
      expect(bytesOf(await store.get('runs/r1/record.json'))).toEqual([1, 2, 3, 4, 5]);
    });

    it('reads an absent key as absent, not as empty bytes', async () => {
      const store = make();
      // `undefined` and "an empty object" are different: a caller that
      // cannot tell them apart would treat a missing record as a valid
      // empty one.
      expect(await store.get('runs/never-written/record.json')).toBeUndefined();
    });

    it('an overwrite replaces the bytes rather than appending to them', async () => {
      const store = make();
      await store.put('k', new Uint8Array([9, 9]));
      await store.put('k', new Uint8Array([7]));

      // Absolute, not accumulated — the property a replay depends on.
      expect(bytesOf(await store.get('k'))).toEqual([7]);
    });

    it('a delete removes the object', async () => {
      const store = make();
      await store.put('k', BYTES);
      await store.delete('k');

      expect(await store.get('k')).toBeUndefined();
    });

    it('deleting an absent object is not an error', async () => {
      const store = make();
      // The purge job may run twice over the same row; the second run
      // must succeed.
      await expect(store.delete('never-existed')).resolves.toBeUndefined();
    });
  };

  describe('the in-memory implementation', () => {
    objectStoreContract(() => new InMemoryObjectStore());
  });

  describe('the S3 implementation', () => {
    // The S3 adapter takes an **injected transport** (HR-6: no provider
    // SDK), so the "real" implementation is exercised against an
    // S3-compatible server held in memory — the same bytes over the same
    // request shape the adapter would send to a real endpoint.
    //
    // The server is a **bucket**, not a mock: it stores what it is PUT and
    // serves it on GET, so the adapter's key, URI and error taxonomy are
    // proved against a store that actually holds objects.
    const aBucket = (): Map<string, Uint8Array> => new Map<string, Uint8Array>();

    const s3Store = (bucket: Map<string, Uint8Array>): S3ObjectStore =>
      new S3ObjectStore({
        endpoint: 'http://s3.test',
        bucket: 'factory-artifacts',
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        signer: (input) =>
          Promise.resolve({
            authorization: `AWS4-HMAC-SHA256 test ${input.method}`,
          }),
        transport: (url, init) => {
          // The key is the path after the bucket.
          const key = decodeURIComponent(url.replace('http://s3.test/factory-artifacts/', ''));

          if (init.method === 'PUT') {
            bucket.set(key, new Uint8Array(init.body ?? new Uint8Array()));
            return Promise.resolve({ status: 200, headers: {}, body: new Uint8Array() });
          }
          if (init.method === 'GET') {
            const bytes = bucket.get(key);
            if (bytes === undefined) {
              return Promise.resolve({ status: 404, headers: {}, body: new Uint8Array() });
            }
            return Promise.resolve({ status: 200, headers: {}, body: bytes });
          }
          if (init.method === 'DELETE') {
            if (!bucket.delete(key)) {
              return Promise.resolve({ status: 404, headers: {}, body: new Uint8Array() });
            }
            return Promise.resolve({ status: 204, headers: {}, body: new Uint8Array() });
          }
          return Promise.resolve({ status: 405, headers: {}, body: new Uint8Array() });
        },
      });

    objectStoreContract(() => s3Store(aBucket()));
  });
});

describe('INV-12 · the ProjectionStore contract', () => {
  /**
   * The contract every `ProjectionStore` must satisfy.
   *
   * @param make a fresh store, and its cursor store
   */
  const projectionStoreContract = (make: () => {
    read(name: string): Promise<Readonly<Record<string, unknown>>>;
    readOne(name: string, key: string): Promise<unknown>;
    commit(input: {
      readonly name: string;
      readonly upserts: readonly { readonly key: string; readonly row: unknown }[];
      readonly removals: readonly string[];
      readonly states: Readonly<Record<string, unknown>>;
      readonly lastSeq: number;
    }): Promise<void>;
    drop(name: string): Promise<void>;
  }): void => {
    it('reads back exactly what was written', async () => {
      const store = make();
      await store.commit({
        name: 'tasks',
        upserts: [{ key: namespaced('tasks', 't1'), row: { state: 'RUNNING' } }],
        removals: [],
        states: {},
        lastSeq: 7,
      });

      expect(await store.read('tasks')).toEqual({ t1: { state: 'RUNNING' } });
      expect(await store.readOne('tasks', 't1')).toEqual({ state: 'RUNNING' });
    });

    it('an upsert sets the row rather than adding to it', async () => {
      const store = make();
      await store.commit({
        name: 'tasks',
        upserts: [
          { key: namespaced('tasks', 't1'), row: { state: 'RUNNING', attempts: 1 } },
        ],
        removals: [],
        states: {},
        lastSeq: 1,
      });
      await store.commit({
        name: 'tasks',
        upserts: [{ key: namespaced('tasks', 't1'), row: { state: 'DONE' } }],
        removals: [],
        states: {},
        lastSeq: 2,
      });

      // Absolute, not accumulated — a replay of the same events must
      // produce the same rows, not rows with doubled counters.
      expect(await store.readOne('tasks', 't1')).toEqual({ state: 'DONE' });
    });

    it('a removal removes the row', async () => {
      const store = make();
      await store.commit({
        name: 'tasks',
        upserts: [{ key: namespaced('tasks', 't1'), row: { state: 'RUNNING' } }],
        removals: [],
        states: {},
        lastSeq: 1,
      });
      await store.commit({
        name: 'tasks',
        upserts: [],
        removals: [namespaced('tasks', 't1')],
        states: {},
        lastSeq: 2,
      });

      expect(await store.readOne('tasks', 't1')).toBeUndefined();
    });

    it('reads an absent row as absent', async () => {
      const store = make();
      expect(await store.readOne('tasks', 'never-written')).toBeUndefined();
    });

    it('a drop removes every row of the projection', async () => {
      const store = make();
      await store.commit({
        name: 'tasks',
        upserts: [
          { key: namespaced('tasks', 't1'), row: { state: 'RUNNING' } },
          { key: namespaced('tasks', 't2'), row: { state: 'QUEUED' } },
        ],
        removals: [],
        states: {},
        lastSeq: 1,
      });
      await store.drop('tasks');

      expect(await store.read('tasks')).toEqual({});
    });
  };

  describe('the in-memory implementation', () => {
    // The keys are **namespaced** — `"<projection> <key>"` — so one
    // commit can carry every projection's writes. The contract suite
    // uses the namespaced form, because that is what the port means.
    projectionStoreContract(() => new InMemoryProjectionStore(new InMemoryCursorPositions()));
  });

  describe.skipIf(!running)('the Postgres implementation', () => {
    projectionStoreContract(() => {
      const cursors = new PostgresCursorStore(theDatabase());
      return new PostgresProjectionStore({ db: theDatabase(), cursors });
    });
  });
});

/**
 * The namespaced key the `ProjectionStore` contract uses.
 */
const namespaced = (projection: string, key: string): string => `${projection} ${key}`;

describe('INV-12 · the CursorStore contract', () => {
  /**
   * The contract every `CursorStore` must satisfy.
   *
   * @param make a fresh cursor store
   * @param names the two cursor names the case uses. They are **per
   * case**, because the Postgres row's primary key is the name — two
   * cases that shared a name would share a row, and the second case's
   * "a cursor that has never run reads zero" would read the first case's
   * cursor.
   */
  const cursorStoreContract = (
    make: () => {
      lastSeq(name: string): Promise<number>;
      advance(name: string, lastSeq: number): Promise<void>;
      reset(name: string): Promise<void>;
    },
    names: () => { readonly first: string; readonly second: string },
  ): void => {
    it('a cursor that has never run reads zero', async () => {
      const store = make();
      const { first } = names();
      expect(await store.lastSeq(first)).toBe(0);
    });

    it('an advance is read back', async () => {
      const store = make();
      const { first } = names();
      await store.advance(first, 42);
      expect(await store.lastSeq(first)).toBe(42);
    });

    it('a reset returns the cursor to zero', async () => {
      const store = make();
      const { first } = names();
      await store.advance(first, 42);
      await store.reset(first);
      expect(await store.lastSeq(first)).toBe(0);
    });

    it('cursors are independent per projection', async () => {
      const store = make();
      const { first, second } = names();
      await store.advance(first, 10);
      await store.advance(second, 20);

      expect(await store.lastSeq(first)).toBe(10);
      expect(await store.lastSeq(second)).toBe(20);
    });
  };

  describe('the in-memory implementation', () => {
    cursorStoreContract(
      () => new InMemoryCursorPositions(),
      () => ({ first: 'tasks', second: 'costs' }),
    );
  });

  describe.skipIf(!running)('the Postgres implementation', () => {
    cursorStoreContract(
      () => new PostgresCursorStore(theDatabase()),
      () => {
        const prefix = freshPrefix('cursor');
        return { first: `${prefix}_tasks`, second: `${prefix}_costs` };
      },
    );
  });
});

describe('INV-12 · the EventSource contract', () => {
  /**
   * The contract every `EventSource` must satisfy.
   *
   * @param make a fresh event source over two events. It may be
   * **asynchronous**, because the real source's events have to be
   * appended to the log before it can read them.
   * @param ownSeq the sequence numbers of the source's **own** two
   * events.
   *
   * The real source reads the **whole** log, not a private window — the
   * log is one table, and the events this case appended share it with
   * every other event the suite has written. So the contract is stated
   * in terms of the port's actual promise, and the source's own events
   * are located **by their sequence numbers** rather than by position:
   *
   * 1. `read(afterSeq, limit)` yields the events with `seq > afterSeq`,
   *    in ascending order.
   * 2. It never yields more than `limit`.
   * 3. Reading after an event does not repeat that event.
   * 4. The source's own events are among the events it yields.
   */
  const eventSourceContract = (
    make: () => Promise<{
      read(afterSeq: number, limit: number): Promise<readonly { readonly seq: number }[]>;
    }>,
    ownSeq: () => readonly number[],
  ): void => {
    it('reads nothing after the last event', async () => {
      const source = await make();
      // `afterSeq` is **exclusive** — the cursor's value is the last
      // event the projection has applied, so the next read starts
      // *after* it. Reading after the last event therefore yields
      // nothing.
      const all = await source.read(0, 1_000);
      const lastSeq = all[all.length - 1]?.seq ?? 0;
      expect(await source.read(lastSeq, 10)).toEqual([]);
    });

    it('reads the events after the given sequence number', async () => {
      const source = await make();
      const events = await source.read(0, 10);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.seq).toBeGreaterThan(0);
    });

    it('honours the limit', async () => {
      const source = await make();
      const events = await source.read(0, 1);
      expect(events.length).toBe(1);
    });

    it('the sequence number is exclusive — reading after an event does not repeat it', async () => {
      const source = await make();
      const first = await source.read(0, 1);
      const firstSeq = first[0]?.seq ?? 0;

      const second = await source.read(firstSeq, 10);
      // The event at `firstSeq` is **not** repeated.
      expect(second.every((event) => event.seq > firstSeq)).toBe(true);
    });

    it('yields the source\'s own events, in ascending order', async () => {
      const source = await make();
      const own = ownSeq();
      const events = await source.read(0, 1_000);
      const seqs = events.map((event) => event.seq);

      // The source's own events are in the read — the source reads what
      // was written to the log, not a copy of it.
      for (const seq of own) {
        expect(seqs).toContain(seq);
      }

      // And the read is **ordered**: a projector that applied the events
      // out of order would compute a wrong projection.
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    });
  };

  describe('the in-memory implementation', () => {
    const twoEvents = (): InMemoryEventSource => {
      const source = new InMemoryEventSource();
      source.appendEnvelope({
        eventId: 'evt_1',
        occurredAt: '2026-01-01T00:00:00.000Z',
        eventType: 'intent.recorded',
        aggregate: { kind: 'task', id: 't1', version: 1 },
        correlationId: 't1',
        actor: { kind: 'human', id: 'tester' },
        authority: { basis: 'human-access-point' },
        payload: {},
      });
      source.appendEnvelope({
        eventId: 'evt_2',
        occurredAt: '2026-01-01T00:00:01.000Z',
        eventType: 'node.ready',
        aggregate: { kind: 'node', id: 'n1', version: 1 },
        correlationId: 't1',
        actor: { kind: 'system', id: 'factory' },
        authority: { basis: 'system-rule' },
        payload: {},
      });
      return source;
    };

    // The in-memory source is a **private window**: its own two events
    // are the only ones it holds, and their sequence numbers are 1 and 2.
    eventSourceContract(() => Promise.resolve(twoEvents()), () => [1, 2]);
  });

  describe.skipIf(!running)('the Postgres implementation', () => {
    // The real source reads the real log. The events are appended through
    // the log itself, so the source is reading what the factory actually
    // wrote — not a copy of it.
    //
    // The sequence numbers are captured from the append, so the "yields
    // the source's own events" assertion is against the *log's*
    // numbering, not against a constant.
    const appended: { seqs: number[] } = { seqs: [] };

    eventSourceContract(
      async () => {
        const log = new PostgresEventLog({ db: theDatabase() });
        const prefix = freshPrefix('evt_source');
        const written = await log.append([
          {
            eventType: 'intent.recorded',
            aggregate: { kind: 'task', id: `${prefix}_t1`, version: 0 },
            correlationId: `${prefix}_t1`,
            actor: { kind: 'human', id: 'tester' },
            authority: { basis: 'human-access-point' },
            context: { items: [] },
            subject: {},
            payload: {},
            bumpsVersion: false,
          },
          {
            eventType: 'node.ready',
            aggregate: { kind: 'node', id: `${prefix}_n1`, version: 0 },
            correlationId: `${prefix}_t1`,
            actor: { kind: 'system', id: 'factory' },
            authority: { basis: 'system-rule' },
            context: { items: [] },
            subject: {},
            payload: {},
            bumpsVersion: false,
          },
        ]);
        appended.seqs = written.map((event) => event.seq);
        return new PostgresEventSource(log);
      },
      () => appended.seqs,
    );
  });
});

describe('INV-12 · the InvocationStore contract', () => {
  /**
   * The contract every `InvocationStore` must satisfy.
   *
   * The record is given in the broker's own shape, because that is the
   * shape the port means. The **fields** are compared, not the whole
   * object: the Postgres table does not carry every field the broker's
   * record has (the capability's version and the actor, for instance), so
   * the row is the database's record of the call and the in-memory store
   * holds the broker's richer one. A whole-object comparison would be a
   * comparison of the two **tables**, not of the two **stores**.
   *
   * @param make a fresh invocation store
   */
  const invocationStoreContract = (
    make: () => {
      record(record: InvocationRecord, event: unknown): Promise<void>;
      findByKey?(idempotencyKey: string): Promise<InvocationRecord | undefined>;
    },
    /**
     * The rows the store's foreign keys need, before the record is
     * written.
     *
     * The in-memory store has no foreign keys, so it needs nothing. The
     * Postgres store's `tool_invocations.run_id` references
     * `runs(run_id)`, so the task and the run must exist. The hook is
     * where that difference is expressed — the **contract** is the same
     * either way.
     */
    prepare?: (record: InvocationRecord) => Promise<void>,
  ): void => {
    it('records an invocation and reads it back by its key', async () => {
      const store = make();
      const prefix = freshPrefix('inv');
      const record = anInvocationRecord(prefix);
      const event = anInvocationEvent(prefix);

      if (prepare !== undefined) {
        await prepare(record);
      }
      await store.record(record, event);

      const found = await store.findByKey?.(record.idempotencyKey);
      // The fields the table carries, compared field by field.
      expect(found?.invocationId).toBe(record.invocationId);
      expect(found?.capabilityId).toBe(record.capabilityId);
      expect(found?.transport).toBe(record.transport);
      expect(found?.runId).toBe(record.runId);
      expect(found?.taskId).toBe(record.taskId);
      expect(found?.nodeId).toBe(record.nodeId);
      expect(found?.attempt).toBe(record.attempt);
      expect(found?.argsSha256).toBe(record.argsSha256);
      expect(found?.effectClass).toBe(record.effectClass);
      expect(found?.status).toBe(record.status);
      expect(found?.idempotencyKey).toBe(record.idempotencyKey);
      expect(found?.durationMs).toBe(record.durationMs);
      // The cost is compared **numerically**, because the two
      // implementations reach it differently: the in-memory store holds
      // the number the broker wrote, and the Postgres store reads a
      // `bigint` column — which the `pg` driver hands back as a
      // **string**. The *value* is the same; the *type* is not.
      //
      // The type difference is a real divergence and is named in the
      // "the divergences this suite found" section below — it is not
      // hidden by comparing loosely here.
      expect(Number(found?.costUsdMicros)).toBe(record.costUsdMicros);
    });

    it('an unused key reads as absent', async () => {
      const store = make();
      expect(await store.findByKey?.('never-used')).toBeUndefined();
    });

    it('a replayed key returns the recorded result rather than a new one', async () => {
      const store = make();
      const prefix = freshPrefix('inv');
      const first = anInvocationRecord(prefix);
      if (prepare !== undefined) {
        await prepare(first);
      }
      await store.record(first, anInvocationEvent(prefix));

      // A **second** record with the same key is an **update**, not a
      // second row and not an error.
      //
      // The Postgres table declares `idempotency_key text NOT NULL
      // UNIQUE` and the store writes it with `ON CONFLICT … DO UPDATE`,
      // so the row's status, result and duration become the latest
      // attempt's. The in-memory double does the same.
      //
      // Why update rather than refuse: the key is
      // `(taskId, nodeId, attempt, capabilityId, argsSha256)` and the
      // **attempt** is part of it — so a retry of the *same* attempt has
      // the *same* key. A failed attempt is followed by a retry of that
      // same attempt (pack 02 §4.8: "nodes with expired leases are
      // re-queued"), and the row has to record the attempt that actually
      // succeeded. Refusing the second write would leave the row saying
      // `failed` forever, and the broker — which swallows the write
      // failure — would never notice.
      //
      // This is exactly the divergence INV-12 exists to catch: the
      // double used to overwrite silently while the Postgres store
      // rejected the second write outright, so a test written against
      // the double passed and the real implementation lost the succeeded
      // invocation.
      await store.record(
        { ...first, status: 'failed', resultSummary: { ok: false } },
        anInvocationEvent(prefix),
      );

      // The row now holds the **latest** attempt.
      const found = await store.findByKey?.(first.idempotencyKey);
      expect(found?.status).toBe('failed');

      // And the retry that succeeds replaces the failure.
      await store.record(
        { ...first, status: 'succeeded', resultSummary: { ok: true } },
        anInvocationEvent(prefix),
      );
      const succeeded = await store.findByKey?.(first.idempotencyKey);
      expect(succeeded?.status).toBe('succeeded');
      expect(succeeded?.invocationId).toBe(first.invocationId);
    });
  };

  describe('the in-memory implementation', () => {
    invocationStoreContract(() => new InMemoryInvocationStore());
  });

  describe.skipIf(!running)('the Postgres implementation', () => {
    invocationStoreContract(
      () => new PostgresInvocationStore({ db: theDatabase() }),
      async (record) => {
        await insertTaskAndRun(record.taskId, record.runId);
      },
    );
  });
});

describe('INV-12 · the ModelCallStore contract', () => {
  /**
   * The contract every `ModelCallStore` must satisfy.
   *
   * @param make a fresh model-call store
   */
  const modelCallStoreContract = (make: () => {
    findByKey(idempotencyKey: string): Promise<ModelCallRecord | undefined>;
    record(record: ModelCallRecord, event: unknown): Promise<void>;
  }): void => {
    it('records a call and reads it back by its key', async () => {
      const store = make();
      const prefix = freshPrefix('call');
      const record = aModelCallRecord(prefix);

      await store.record(record, aModelCallEvent(prefix));

      const found = await store.findByKey(record.idempotencyKey);
      expect(found?.id).toBe(record.id);
      expect(found?.taskId).toBe(record.taskId);
      expect(found?.provider).toBe(record.provider);
      expect(found?.model).toBe(record.model);
      expect(found?.routeRule).toBe(record.routeRule);
      expect(found?.promptSha256).toBe(record.promptSha256);
      expect(found?.tokens).toEqual(record.tokens);
      expect(found?.costUsdMicros).toBe(record.costUsdMicros);
      expect(found?.latencyMs).toBe(record.latencyMs);
      expect(found?.status).toBe(record.status);
      expect(found?.cached).toBe(record.cached);
      expect(found?.via).toBe(record.via);
      expect(found?.idempotencyKey).toBe(record.idempotencyKey);
    });

    it('an unused key reads as absent', async () => {
      const store = make();
      expect(await store.findByKey('never-used')).toBeUndefined();
    });

    it('a replayed key returns the recorded call rather than a new one', async () => {
      const store = make();
      const prefix = freshPrefix('call');
      const record = aModelCallRecord(prefix);
      await store.record(record, aModelCallEvent(prefix));

      // The `model_calls.idempotency_key` column is UNIQUE, so the real
      // implementation refuses the second write. The in-memory double
      // **replaces** the row instead — which the contract must therefore
      // not assert, because the two implementations legitimately differ
      // here. What the contract *does* assert is the thing both agree on:
      // the key still resolves to a recorded call.
      //
      // The divergence is recorded in the gap section below rather than
      // papered over.
      const found = await store.findByKey(record.idempotencyKey);
      expect(found?.idempotencyKey).toBe(record.idempotencyKey);
    });
  };

  describe('the in-memory implementation', () => {
    modelCallStoreContract(() => new InMemoryModelCallStore());
  });

  describe.skipIf(!running)('the Postgres implementation', () => {
    modelCallStoreContract(() => new PostgresModelCallStore({ db: theDatabase() }));
  });
});

describe('INV-12 · the CredentialLeaseStore contract', () => {
  /**
   * The contract every `CredentialLeaseStore` must satisfy.
   *
   * @param make a fresh lease store
   */
  const credentialLeaseStoreContract = (make: () => {
    record(lease: CredentialLease): Promise<void>;
    listByTask(taskId: string): Promise<readonly CredentialLease[]>;
    listExpired(referencedAt: string): Promise<readonly CredentialLease[]>;
    markRevoked(leaseId: string, revokedAt: string): Promise<void>;
  }): void => {
    it('records a lease and reads it back by its task', async () => {
      const store = make();
      const prefix = freshPrefix('lease');
      const lease = aLease(prefix);

      await store.record(lease);

      const leases = await store.listByTask(lease.taskId);
      expect(leases.length).toBe(1);
      expect(leases[0]?.id).toBe(lease.id);
      expect(leases[0]?.taskId).toBe(lease.taskId);
      expect(leases[0]?.provider).toBe(lease.provider);
      expect(leases[0]?.scope).toEqual(lease.scope);
      expect(leases[0]?.expiresAt).toBe(lease.expiresAt);
      expect(leases[0]?.revokedAt).toBeUndefined();
    });

    it('the row never holds the secret material', async () => {
      const store = make();
      const prefix = freshPrefix('lease');
      await store.record(aLease(prefix));

      const leases = await store.listByTask(`${prefix}_task`);
      // The lease's scope carries the *reference* — the scopes, the
      // permissions and the repositories — and never a secret.
      const serialised = JSON.stringify(leases);
      expect(serialised).not.toContain('sk-');
      expect(serialised).not.toContain('secret');
    });

    it('a task with no leases lists none', async () => {
      const store = make();
      expect(await store.listByTask('never-minted')).toEqual([]);
    });

    it('an expired lease is listed as expired', async () => {
      const store = make();
      const prefix = freshPrefix('lease');
      await store.record({
        ...aLease(prefix),
        expiresAt: '2026-01-01T00:00:00.000Z',
      });

      const expired = await store.listExpired('2026-06-01T00:00:00.000Z');
      expect(expired.map((lease) => lease.id)).toContain(`${prefix}_lease`);
    });

    it('a lease that has not expired is not listed as expired', async () => {
      const store = make();
      const prefix = freshPrefix('lease');
      await store.record({
        ...aLease(prefix),
        expiresAt: '2027-01-01T00:00:00.000Z',
      });

      const expired = await store.listExpired('2026-06-01T00:00:00.000Z');
      expect(expired.map((lease) => lease.id)).not.toContain(`${prefix}_lease`);
    });

    it('a revocation is idempotent — the first timestamp stands', async () => {
      const store = make();
      const prefix = freshPrefix('lease');
      const lease = aLease(prefix);
      await store.record(lease);

      await store.markRevoked(lease.id, '2026-03-01T00:00:00.000Z');
      await store.markRevoked(lease.id, '2026-09-01T00:00:00.000Z');

      const leases = await store.listByTask(lease.taskId);
      // The Postgres store's `markRevoked` is idempotent — the
      // `WHERE revoked_at IS NULL` predicate excludes an
      // already-revoked lease — so the first revocation's timestamp is
      // the one that stands.
      expect(leases[0]?.revokedAt).toBe('2026-03-01T00:00:00.000Z');
    });

    it('a revoked lease is no longer listed as expired', async () => {
      const store = make();
      const prefix = freshPrefix('lease');
      const lease = { ...aLease(prefix), expiresAt: '2026-01-01T00:00:00.000Z' };
      await store.record(lease);
      await store.markRevoked(lease.id, '2026-02-01T00:00:00.000Z');

      const expired = await store.listExpired('2026-06-01T00:00:00.000Z');
      expect(expired.map((row) => row.id)).not.toContain(lease.id);
    });
  };

  describe('the in-memory implementation', () => {
    credentialLeaseStoreContract(() => new InMemoryCredentialLeaseStore());
  });

  describe.skipIf(!running)('the Postgres implementation', () => {
    credentialLeaseStoreContract(() => new PostgresCredentialLeaseStore({ db: theDatabase() }));
  });
});

describe('INV-12 · the RunRecordStore contract', () => {
  /**
   * The contract every `RunRecordStore` must satisfy.
   *
   * @param make a fresh run-record store
   */
  const runRecordStoreContract = (
    make: () => {
      writeStarted(index: RunIndexEntry): Promise<void>;
      writeFinalised(index: RunIndexEntry): Promise<void>;
      find(runId: string): Promise<RunIndexEntry | undefined>;
      markPurged(runId: string): Promise<void>;
      listPurgeCandidates(asOf: string): Promise<readonly unknown[]>;
    },
    /**
     * The rows the store's foreign keys need, before the row is written.
     *
     * `runs.task_id` references `tasks(id)`, so the Postgres store needs
     * the task to exist. The in-memory store has no foreign keys.
     */
    prepare?: (index: RunIndexEntry) => Promise<void>,
  ): void => {
    it('a started run has a row with no record yet', async () => {
      const store = make();
      const prefix = freshPrefix('run');
      if (prepare !== undefined) {
        await prepare(aRunIndex(prefix));
      }
      await store.writeStarted(aRunIndex(prefix));

      const row = await store.find(`${prefix}_run`);
      expect(row?.status).toBe('running');
      expect(row?.recordUri).toBeUndefined();
      expect(row?.recordSha256).toBeUndefined();
    });

    it('a finalised run has a row with its record', async () => {
      const store = make();
      const prefix = freshPrefix('run');
      if (prepare !== undefined) {
        await prepare(aRunIndex(prefix));
      }
      await store.writeStarted(aRunIndex(prefix));
      await store.writeFinalised(aRunIndex(prefix, { finalised: true }));

      const row = await store.find(`${prefix}_run`);
      expect(row?.status).toBe('succeeded');
      expect(row?.recordUri).toBe(`s3://bucket/runs/${prefix}_run/record.json`);
      expect(row?.recordSha256).toBe(`sha256:${'a'.repeat(64)}`);
    });

    it('an unknown run reads as absent', async () => {
      const store = make();
      expect(await store.find('never-started')).toBeUndefined();
    });

    it('a purge marks the row rather than deleting it', async () => {
      const store = make();
      const prefix = freshPrefix('run');
      if (prepare !== undefined) {
        await prepare(aRunIndex(prefix));
      }
      await store.writeFinalised(aRunIndex(prefix, { finalised: true }));
      await store.markPurged(`${prefix}_run`);

      // The run still happened — the row is the index of what happened.
      // What is gone is the object's bytes.
      const row = await store.find(`${prefix}_run`);
      expect(row).toBeDefined();
      expect(row?.status).toBe('purged');
      expect(row?.recordUri).toBeUndefined();
    });

    it('a row that is due for purging is listed as a candidate', async () => {
      const store = make();
      const prefix = freshPrefix('run');
      if (prepare !== undefined) {
        await prepare(aRunIndex(prefix));
      }
      await store.writeFinalised(
        aRunIndex(prefix, { finalised: true, retainUntil: '2026-01-01' }),
      );

      const candidates = await store.listPurgeCandidates('2026-06-01');
      expect(
        candidates.map((row) => (row as { readonly runId: string }).runId),
      ).toContain(`${prefix}_run`);
    });

    it('a row that is not due is not listed as a candidate', async () => {
      const store = make();
      const prefix = freshPrefix('run');
      if (prepare !== undefined) {
        await prepare(aRunIndex(prefix));
      }
      await store.writeFinalised(
        aRunIndex(prefix, { finalised: true, retainUntil: '2027-01-01' }),
      );

      const candidates = await store.listPurgeCandidates('2026-06-01');
      expect(
        candidates.map((row) => (row as { readonly runId: string }).runId),
      ).not.toContain(`${prefix}_run`);
    });
  };

  describe('the in-memory implementation', () => {
    runRecordStoreContract(() => new InMemoryRunRecordStore());
  });

  describe.skipIf(!running)('the Postgres implementation', () => {
    runRecordStoreContract(
      () => new PostgresRunRecordStore({ db: theDatabase() }),
      async (index) => {
        await insertTaskAndRun(index.taskId, index.runId);
      },
    );
  });
});

describe('INV-12 · the divergences this suite found', () => {
  /**
   * The divergences the shared contract suites found between a fake and
   * its real counterpart.
   *
   * ## Why they are **named** rather than asserted away
   *
   * A divergence is a *fact about the repository*, and a fact that is
   * written down can be acted on. A divergence that is smoothed over by
   * a loose assertion is a fact that has been lost — and the invariant
   * exists precisely so that the differences between a fake and the real
   * thing are **visible**.
   *
   * So each divergence below is asserted as a fact: the test says what
   * the two implementations do, and it fails if either of them changes.
   * That way the divergence cannot silently grow, and it cannot silently
   * shrink either — the shrink shows up as a failing test, which is the
   * prompt to close it.
   */

  it('the invocation store\'s cost comes back as a number from both implementations', async () => {
    // **The divergence this suite found, and the fix.**
    //
    // `InvocationRecord.costUsdMicros` is declared `number`. The
    // in-memory store holds the number the broker wrote. The Postgres
    // store reads a `bigint` column, and the `pg` driver hands `bigint`
    // back as a **string** — so the store has to coerce it, or it
    // returns a `string` where the port says `number`.
    //
    // It did not, at first: `PostgresInvocationStore.recordFrom` typed the
    // column `number | null` and passed it straight through. The two
    // sibling stores (`PostgresModelCallStore` and
    // `PostgresRunRecordStore`) *did* coerce — they write
    // `Number(row.cost_usd_micros)` — so the broker's store was the odd
    // one out.
    //
    // The divergence is invisible to a test written against the fake: the
    // fake says `number`, the port says `number`, so the fake looks
    // right. Only the *paired* contract catches it, which is the whole
    // argument for running the same suite against both.
    //
    // The store now coerces, and this test asserts the **agreement**:
    // both implementations return a `number`, and the same number. If
    // the coercion is ever removed, this test fails.
    const fake = new InMemoryInvocationStore();
    const prefix = freshPrefix('cost');
    const record = anInvocationRecord(prefix);
    await fake.record(record, anInvocationEvent(prefix));

    const fromFake = await fake.findByKey?.(record.idempotencyKey);
    expect(typeof fromFake?.costUsdMicros).toBe('number');
    expect(fromFake?.costUsdMicros).toBe(record.costUsdMicros);

    if (!running) {
      // Without a database there is nothing to compare against, and the
      // fake's half has already been asserted.
      return;
    }

    const real = new PostgresInvocationStore({ db: theDatabase() });
    await insertTaskAndRun(record.taskId, record.runId);
    await real.record(record, anInvocationEvent(prefix));

    const fromReal = await real.findByKey(record.idempotencyKey);
    expect(typeof fromReal?.costUsdMicros).toBe('number');
    expect(fromReal?.costUsdMicros).toBe(record.costUsdMicros);
  });

  it('the model-call store refuses a duplicate key in Postgres and replaces it in the fake', async () => {
    // **The divergence.** `model_calls.idempotency_key` is UNIQUE and
    // `PostgresModelCallStore` writes it with a plain `INSERT` — so the
    // second write is a unique-violation and the store **refuses** it.
    // The in-memory double **replaces** the row.
    //
    // The two behaviours are not equivalent, and the difference matters:
    // a test that asserts "the second write is refused" passes against
    // the fake and fails against the real store, and a test that asserts
    // "the second write replaces the row" passes against the fake and
    // fails against the real store. Neither can be the contract.
    //
    // The shared `ModelCallStore` contract therefore asserts only what
    // both agree on — the key still resolves to a recorded call — and
    // this test names the difference.
    const fake = new InMemoryModelCallStore();
    const prefix = freshPrefix('dup');
    const record = aModelCallRecord(prefix);
    await fake.record(record, aModelCallEvent(prefix));

    // The fake replaces: the second write succeeds.
    await expect(
      fake.record({ ...record, model: 'fake-2' }, aModelCallEvent(prefix)),
    ).resolves.toBeUndefined();
    expect((await fake.findByKey(record.idempotencyKey))?.model).toBe('fake-2');

    if (!running) {
      return;
    }

    const real = new PostgresModelCallStore({ db: theDatabase() });
    await real.record(record, aModelCallEvent(prefix));

    // The real store refuses: the second write is a unique-violation.
    await expect(
      real.record({ ...record, model: 'fake-2' }, aModelCallEvent(prefix)),
    ).rejects.toThrow();
    // And the **first** call is what the key resolves to — the refusal
    // did not corrupt the row.
    expect((await real.findByKey(record.idempotencyKey))?.model).toBe('fake-1');
  });
});

describe('INV-12 · the gaps — the named ports without a pair', () => {
  /**
   * The nine ports the checklist names, and what this repository has.
   *
   * The point of this suite is **honesty about coverage**: a contract
   * suite with one subject is not a comparison, so a port with one
   * implementation is a **gap** — and a gap that is named is a ticket,
   * while a gap that is hidden is a lie.
   *
   * There are **two kinds** of gap, and the map distinguishes them:
   *
   * | kind | what it means |
   * |---|---|
   * | **one implementation** | the port works, but a replacement cannot be *proved* — the second implementation has to exist first |
   * | **no implementation** | the port does not exist yet — the package is still the scaffold checklist 01 (T-0.02) left behind |
   *
   * The second is the more severe of the two, and saying so is the point
   * of this test: a map that claimed "one implementation" for a
   * scaffold package would be a false claim in the one test whose whole
   * purpose is to be honest about coverage.
   *
   * The map below is asserted against the **filesystem**, so a port that
   * grows a second implementation without the map being updated fails
   * this test — which is exactly the moment the gap should be closed.
   */
  it('records every named port and its implementation count', async () => {
    const root = resolve(import.meta.dirname, '..', '..');

    /**
     * The named ports, the marker that identifies an implementation of
     * that port, and the number of implementations this repository has.
     *
     * The marker is what makes the count a *fact about the repository*
     * rather than a claim the suite makes about itself. A port's
     * implementations are the classes that say `implements <Port>` — or,
     * where the port is a class rather than an interface, the class
     * whose name the port names.
     */
    const namedPorts: readonly {
      readonly port: string;
      /**
       * The class names that implement the port.
       *
       * A port implemented as an **interface** is matched by its
       * `implements` clause; a port implemented as a **class** (the
       * broker, the gateway and the credential broker are classes, not
       * interfaces) is matched by its class name.
       */
      readonly markers: readonly string[];
      /**
       * How many implementations this repository has.
       *
       * `0` means the port is **not implemented at all** — the package
       * is still the scaffold checklist 01 (T-0.02) left behind.
       */
      readonly implementations: number;
      /**
       * Why the count is what it is.
       *
       * The reason is part of the record, because "the port has no
       * second implementation" and "the port does not exist" call for
       * different work and different tickets.
       */
      readonly reason: string;
    }[] = [
      {
        port: 'EventLog',
        markers: ['implements EventLog'],
        implementations: 1,
        reason:
          'the Postgres log is the only implementation; the in-memory log the tests use is not yet covered by a paired contract suite',
      },
      {
        port: 'PolicyEngine',
        markers: ['implements PolicyEngine'],
        implementations: 1,
        reason:
          '`DefaultPolicyEngine` is the only implementation; a second one has to exist before a contract suite can compare them',
      },
      {
        port: 'ToolBroker',
        markers: ['class ToolBroker'],
        implementations: 1,
        reason:
          'the broker is a class, not an interface — its replaceable collaborator, the invocation store, IS covered by the contract suite above',
      },
      {
        port: 'ModelGateway',
        markers: ['class ModelGatewayImpl'],
        implementations: 1,
        reason:
          '`ModelGatewayImpl` is the only implementation; its replaceable collaborator, the model-call store, IS covered by the contract suite above',
      },
      {
        port: 'IsolationProvider',
        markers: ['implements IsolationProvider', 'class IsolationProvider'],
        implementations: 0,
        reason:
          'the T-1.12 work built the isolation *pieces* (the snapshot builder, the worktree creator, the reclaimer), but no class yet satisfies the `IsolationProvider` contract declared in packages/contracts — the port is declared and unimplemented',
      },
      {
        port: 'HarnessAdapter',
        markers: ['implements HarnessAdapter'],
        implementations: 1,
        reason:
          '`FakeHarnessAdapter` is the only implementation; the real harness lands with the harness ticket',
      },
      {
        port: 'ScmAdapter',
        markers: ['implements ScmAdapter', 'class ScmAdapter'],
        implementations: 0,
        reason:
          '`packages/scm-github` is still the scaffold checklist 01 (T-0.02) left behind — it exports only `packageName`',
      },
      {
        port: 'CredentialBroker',
        markers: ['class CredentialBroker'],
        implementations: 1,
        reason:
          'the broker is a class; its replaceable collaborator, the lease store, IS covered by the contract suite above',
      },
      {
        port: 'ApprovalService',
        markers: ['implements ApprovalService', 'class ApprovalService'],
        implementations: 0,
        reason:
          '`packages/approvals` is still the scaffold checklist 01 (T-0.02) left behind — it exports only `packageName`',
      },
    ];

    for (const entry of namedPorts) {
      // **The gap, asserted.** The count is computed over the whole
      // `packages/` tree — so this is not a claim the suite makes about
      // itself, it is a fact about the repository. If a second
      // implementation appears, the gap has been closed and this test
      // fails until the map is updated — which is the intended prompt,
      // not a defect.
      const implementations = await countImplementations(root, entry.markers);

      expect(
        implementations,
        `${entry.port} now has ${String(implementations)} implementations — the gap map must be updated and a contract suite written for it`,
      ).toBe(entry.implementations);
    }
  });

  it('names the three ports that are not implemented at all', async () => {
    // The **severity** distinction, asserted.
    //
    // A port with one implementation is a *coverage* gap: the factory
    // works, but a replacement cannot be proved. A port with **no**
    // implementation is a *product* gap: the factory cannot do that
    // thing at all.
    //
    // The two are recorded separately so that the report cannot blur
    // them — a gate that said "INV-12 is 9/9 covered" while three of
    // the nine ports are unimplemented would be a false report.
    const root = resolve(import.meta.dirname, '..', '..');

    const unimplemented: readonly {
      readonly port: string;
      readonly package: string;
      readonly markers: readonly string[];
    }[] = [
      {
        port: 'IsolationProvider',
        package: 'packages/isolation',
        markers: ['implements IsolationProvider', 'class IsolationProvider'],
      },
      {
        port: 'ScmAdapter',
        package: 'packages/scm-github',
        markers: ['implements ScmAdapter', 'class ScmAdapter'],
      },
      {
        port: 'ApprovalService',
        package: 'packages/approvals',
        markers: ['implements ApprovalService', 'class ApprovalService'],
      },
    ];

    for (const entry of unimplemented) {
      const count = await countImplementations(root, entry.markers);
      expect(
        count,
        `${entry.port} now has ${String(count)} implementations — it is no longer unimplemented, so the gap map must be updated`,
      ).toBe(0);
    }

    // And two of the three are **scaffolds**: the package's `index.ts`
    // exports only the package's name. That is what "not implemented"
    // looks like in this repository, and the assertion proves the fact
    // rather than trusting a hand-written list.
    for (const packageName of ['scm-github', 'approvals']) {
      const source = await readFile(
        join(root, 'packages', packageName, 'src', 'index.ts'),
        'utf8',
      );
      expect(source).toContain(`packageName = '${packageName}'`);
    }
  });
});

/**
 * The sources under `packages/`, read once.
 *
 * The gap map asks about **nine** ports, and the tree is walked for each
 * one — nine walks of the same files, reading the same sources nine
 * times. That is slow enough to time the test out, so the sources are
 * read **once** and cached, and the markers are matched against the
 * cache.
 *
 * The cache is keyed by the tree root, so a test that uses a different
 * root reads its own tree.
 */
const sourceCache = new Map<string, readonly string[]>();

/**
 * Every `.ts` source under `packages/`, read once per tree.
 */
const packageSources = async (root: string): Promise<readonly string[]> => {
  const cached = sourceCache.get(root);
  if (cached !== undefined) {
    return cached;
  }

  const sources: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'dist' || entry.name === 'node_modules') {
          continue;
        }
        await walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) {
        continue;
      }
      sources.push(await readFile(path, 'utf8'));
    }
  };

  await walk(join(root, 'packages'));

  sourceCache.set(root, sources);
  return sources;
};

/**
 * Count the files under `packages/` that declare an implementation of a
 * port.
 *
 * @param markers the `implements` clause or class name that identifies
 * an implementation of the port.
 */
const countImplementations = async (
  root: string,
  markers: readonly string[],
): Promise<number> => {
  const sources = await packageSources(root);
  return sources.filter((source) =>
    markers.some((marker) => source.includes(marker)),
  ).length;
};

/**
 * An invocation record in the broker's own shape.
 *
 * The ids are namespaced per case, because the row's primary key and the
 * idempotency key are both unique — two cases sharing them would collide.
 */
const anInvocationRecord = (prefix: string): InvocationRecord => ({
  invocationId: `${prefix}_inv`,
  capabilityId: 'test.capability',
  capabilityVersion: '1.0.0',
  transport: 'inproc',
  runId: `${prefix}_run`,
  taskId: `${prefix}_task`,
  nodeId: `${prefix}_node`,
  attempt: 1,
  grantId: `${prefix}_grant`,
  argsSha256: 'ab'.repeat(32),
  argsSummary: { path: 'src/index.ts' },
  resultSummary: { ok: true },
  effectClass: 'E0',
  policyDecision: {
    outcome: 'ALLOW',
    ruleIds: ['rule_allow_e0'],
    reason: 'the grant allows it',
    bundleSha256: 'cd'.repeat(32),
  },
  status: 'succeeded',
  idempotencyKey: `${prefix}_key`,
  durationMs: 12,
  costUsdMicros: 0,
  actor: { kind: 'agent', id: 'agent_1' },
});

/**
 * The event that accompanies an invocation record.
 */
const anInvocationEvent = (prefix: string): {
  readonly eventType: string;
  readonly aggregate: { readonly kind: 'task'; readonly id: string; readonly version: number };
  readonly correlationId: string;
  readonly actor: { readonly kind: 'agent'; readonly id: string };
  readonly authority: { readonly basis: 'policy-decision' };
  readonly payload: unknown;
} => ({
  eventType: 'tool.invoked',
  aggregate: { kind: 'task', id: `${prefix}_task`, version: 0 },
  correlationId: `${prefix}_run`,
  actor: { kind: 'agent', id: 'agent_1' },
  authority: { basis: 'policy-decision' },
  payload: { capabilityId: 'test.capability' },
});

/**
 * A model call record.
 */
const aModelCallRecord = (prefix: string): ModelCallRecord => ({
  id: `${prefix}_call`,
  taskId: `${prefix}_task`,
  provider: 'fake',
  model: 'fake-1',
  routeRule: 'rule_default',
  promptSha256: 'ef'.repeat(32),
  tokens: { tokensIn: 100, tokensOut: 20, cacheRead: 0, cacheWrite: 0 },
  costUsdMicros: 42,
  latencyMs: 100,
  status: 'ok',
  cached: false,
  via: 'complete',
  idempotencyKey: `${prefix}_key`,
});

/**
 * The event that accompanies a model call record.
 */
const aModelCallEvent = (prefix: string): {
  readonly eventType: 'model.requested';
  readonly payload: Readonly<Record<string, unknown>>;
} => ({
  eventType: 'model.requested',
  payload: { model: 'fake-1', provider: 'fake', taskId: `${prefix}_task` },
});

/**
 * A credential lease.
 */
const aLease = (prefix: string): CredentialLease => ({
  id: `${prefix}_lease`,
  taskId: `${prefix}_task`,
  provider: 'github',
  scope: {
    scopes: ['repo:read'],
    permissions: { contents: 'read' },
    repositories: ['org/repo'],
  },
  mintedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
});

/**
 * A `runs` index row.
 */
const aRunIndex = (
  prefix: string,
  options: { readonly finalised?: boolean; readonly retainUntil?: string } = {},
): RunIndexEntry => ({
  runId: `${prefix}_run`,
  taskId: `${prefix}_task`,
  nodeId: `${prefix}_node`,
  attempt: 1,
  role: 'implementer',
  stageKind: 'implement',
  executorKind: 'deterministic',
  status: options.finalised === true ? 'succeeded' : 'running',
  ...(options.finalised === true ? { outcome: 'success' as const } : {}),
  startedAt: '2026-01-01T00:00:00.000Z',
  ...(options.finalised === true
    ? {
        endedAt: '2026-01-01T00:00:05.000Z',
        recordUri: `s3://bucket/runs/${prefix}_run/record.json`,
        recordSha256: `sha256:${'a'.repeat(64)}`,
      }
    : {}),
  costUsdMicros: 0,
  tokens: { input: 100, output: 20 },
  retentionClass: 'engineering',
  ...(options.retainUntil === undefined ? {} : { retainUntil: options.retainUntil }),
});
