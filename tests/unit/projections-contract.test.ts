/**
 * `projections` — the store contract (T-1.15).
 *
 * AGENTS.md §4: "fakes live in the package's own `fakes` directory and
 * must pass the **same contract tests** as the real thing (I-12)."
 *
 * So this file runs **one** suite against **two** stores: the in-memory
 * one and the Postgres one. The suite is written once, in the
 * `describe.each` below, so a behaviour cannot be checked for the fake
 * and forgotten for the real store — which is the whole point of I-12.
 *
 * ## Each test gets its own store
 *
 * The suite is written against a **factory**, not a single store. A test
 * that drops the rows must not leave the next test a store whose rows are
 * gone — the suite would then be testing the order the tests happen to
 * run in, and a failure would point at the wrong cause. So every test
 * builds a fresh store, and the Postgres half builds a fresh **database**.
 *
 * ## The Postgres half skips when there is no container
 *
 * The Postgres half needs a real server. When the dev container is not
 * running the suite **skips**, loudly — because a silently-skipped
 * contract test is a weakened one. The in-memory half always runs.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryCursorStore,
  InMemoryEventSource,
  InMemoryProjectionStore,
  PROJECTOR_CURSOR,
  PostgresCursorStore,
  PostgresProjectionStore,
  Projector,
  rebuild,
  rowsDigest,
} from '@factory/projections';

import type { CursorStore, ProjectionStore } from '@factory/projections';

import { createEventLogHarness, containerRunning } from '../helpers/eventlog.ts';

/**
 * The log the contract suite projects.
 *
 * It exercises every projection: a task's creation and a transition, an
 * approval that is asked for, and a model call.
 */
const log = (): InMemoryEventSource => {
  const source = new InMemoryEventSource();

  source.appendEnvelope({
    eventId: 'evt_1',
    occurredAt: '2026-11-10T00:00:00.000Z',
    eventType: 'intent.recorded',
    aggregate: { kind: 'task', id: 'tsk_1', version: 1 },
    payload: { repo: 'acme/widgets', workflow: 'feature', riskTier: 'R1' },
  });

  source.appendEnvelope({
    eventId: 'evt_2',
    occurredAt: '2026-11-10T00:01:00.000Z',
    eventType: 'stage.completed',
    aggregate: { kind: 'node', id: 'tsk_1/n1-build', version: 1 },
    payload: { from: 'RUNNING', to: 'VERIFYING', spentUsdMicros: 1200 },
  });

  source.appendEnvelope({
    eventId: 'evt_3',
    occurredAt: '2026-11-10T00:02:00.000Z',
    eventType: 'approval.requested',
    aggregate: { kind: 'approval', id: 'apr_1', version: 1 },
    subject: { taskId: 'tsk_1' },
    payload: {
      approvalId: 'apr_1',
      type: 'merge',
      taskId: 'tsk_1',
      expiresAt: '2026-11-10T01:00:00.000Z',
    },
  });

  source.appendEnvelope({
    eventId: 'evt_4',
    occurredAt: '2026-11-10T00:03:00.000Z',
    eventType: 'model.requested',
    aggregate: { kind: 'run', id: 'run_1', version: 1 },
    subject: { taskId: 'tsk_1' },
    payload: {
      workflow: 'feature',
      role: 'worker',
      model: 'opus',
      tokens: { in: 900, out: 120 },
      costUsdMicros: 3400,
    },
  });

  return source;
};

/**
 * A store, and the way to throw it away.
 *
 * The Postgres half's `destroy` drops the throwaway database, so each
 * test gets a database of its own.
 */
interface StoreFixture {
  readonly store: ProjectionStore;
  readonly cursors: CursorStore;
  readonly destroy: () => Promise<void>;
}

/**
 * The suite, run against one store.
 *
 * @param make builds a **fresh** store. It is called once per test.
 */
const storeContract = (
  name: string,
  make: () => Promise<StoreFixture>,
  skip: boolean,
): void => {
  describe(name, () => {
    it.skipIf(skip)('projects the events into the rows', async () => {
      const { store, cursors, destroy } = await make();
      try {
        const source = log();
        await new Projector({ events: source, store, cursors }).catchUp();

        const rows = await store.read('task_current');
        expect(Object.keys(rows)).toEqual(['tsk_1']);

        const row = rows['tsk_1'] as {
          repo: string;
          workflow: string;
          state: string;
          riskTier: string | null;
          needsHuman: boolean;
          lastActivityAt: string;
          spentUsdMicros: number;
        };
        expect(row.repo).toBe('acme/widgets');
        expect(row.workflow).toBe('feature');
        expect(row.state).toBe('VERIFYING');
        expect(row.riskTier).toBe('R1');
        expect(row.needsHuman).toBe(true);
        expect(row.spentUsdMicros).toBe(1200);
      } finally {
        await destroy();
      }
    });

    it.skipIf(skip)('reads one row', async () => {
      const { store, cursors, destroy } = await make();
      try {
        const source = log();
        await new Projector({ events: source, store, cursors }).catchUp();

        const row = (await store.readOne('task_current', 'tsk_1')) as { state: string };
        expect(row.state).toBe('VERIFYING');
        expect(await store.readOne('task_current', 'nope')).toBeUndefined();
      } finally {
        await destroy();
      }
    });

    it.skipIf(skip)('advances the cursor with the rows', async () => {
      const { store, cursors, destroy } = await make();
      try {
        const source = log();
        await new Projector({ events: source, store, cursors }).catchUp();

        expect(await cursors.lastSeq(PROJECTOR_CURSOR)).toBe(4);
      } finally {
        await destroy();
      }
    });

    it.skipIf(skip)('drops a projection’s rows', async () => {
      const { store, cursors, destroy } = await make();
      try {
        const source = log();
        await new Projector({ events: source, store, cursors }).catchUp();

        await store.drop('task_current');

        expect(Object.keys(await store.read('task_current'))).toHaveLength(0);
      } finally {
        await destroy();
      }
    });

    it.skipIf(skip)('rebuilds identical rows', async () => {
      const { store, cursors, destroy } = await make();
      try {
        const source = log();
        await new Projector({ events: source, store, cursors }).catchUp();

        const before = rowsDigest(await store.read('task_current'));

        const report = await rebuild({ events: source, store, cursors }, { drop: true });

        expect(report.identical).toBe(true);
        expect(rowsDigest(await store.read('task_current'))).toBe(before);
      } finally {
        await destroy();
      }
    });

    it.skipIf(skip)('the safe rebuild changes nothing', async () => {
      const { store, cursors, destroy } = await make();
      try {
        const source = log();
        await new Projector({ events: source, store, cursors }).catchUp();

        const before = rowsDigest(await store.read('task_current'));

        const report = await rebuild({ events: source, store, cursors }, { drop: false });

        expect(report.identical).toBe(true);
        expect(rowsDigest(await store.read('task_current'))).toBe(before);
      } finally {
        await destroy();
      }
    });
  });
};

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, the Postgres half **skips** rather than fails: the
 * absence of a Docker daemon is an environment limit, not a defect in the
 * store. The suite runs in CI, where the daemon exists, and that is where
 * the Postgres path is proved.
 */
const running = await containerRunning();

// The in-memory half always runs.
storeContract(
  'the projection store contract · in memory',
  () => {
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);
    return Promise.resolve({
      store,
      cursors,
      destroy: () => Promise.resolve(),
    });
  },
  false,
);

// The Postgres half needs a real server.
storeContract(
  'the projection store contract · postgres',
  async () => {
    const harness = await createEventLogHarness('factory_t1_15_projections');
    const cursors = new PostgresCursorStore(harness.db);
    const store = new PostgresProjectionStore({ db: harness.db, cursors });

    return {
      store,
      cursors,
      destroy: async () => {
        await harness.destroy();
      },
    };
  },
  !running,
);
