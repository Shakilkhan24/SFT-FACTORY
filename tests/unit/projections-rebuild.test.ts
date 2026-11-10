/**
 * `projections` — the rebuild (T-1.15).
 *
 * pack `02` §4.18: "Every projection can be dropped and rebuilt from the
 * log (A0.6) — rebuild is a CLI command **and** a test."
 *
 * This file is the rebuild's own tests; the **oracle** is in
 * `tests/unit/projections-a0-6.test.ts`.
 *
 * The properties here:
 *
 * 1. The rebuild replays from **zero**, whatever the cursor said.
 * 2. The rebuild's **safe form** (`drop: false`) changes nothing.
 * 3. The report says **which** projection and **which** row differ — a
 *    digest on its own would leave the operator with nothing to act on.
 * 4. The rebuild does not disturb the running projector's cursor.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryCursorStore,
  InMemoryEventSource,
  InMemoryProjectionStore,
  PROJECTOR_CURSOR,
  Projector,
  rebuild,
  rowsDigest,
} from '@factory/projections';

/**
 * A log with a task's life, an approval and a model call in it.
 */
const log = (): InMemoryEventSource => {
  const source = new InMemoryEventSource();

  source.appendEnvelope({
    eventId: 'evt_1',
    occurredAt: '2026-11-10T00:00:00.000Z',
    eventType: 'intent.recorded',
    aggregate: { kind: 'task', id: 'tsk_1', version: 1 },
    payload: { repo: 'acme/widgets', workflow: 'feature', riskTier: 'R1', budgetUsdMicros: 6000000 },
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

  source.appendEnvelope({
    eventId: 'evt_5',
    occurredAt: '2026-11-10T00:04:00.000Z',
    eventType: 'model.requested',
    aggregate: { kind: 'run', id: 'run_2', version: 1 },
    subject: { taskId: 'tsk_1' },
    payload: {
      workflow: 'feature',
      role: 'worker',
      model: 'opus',
      tokens: { in: 100, out: 30 },
      costUsdMicros: 700,
    },
  });

  return source;
};

/**
 * A projector that has caught up, with its store and cursor.
 */
const projected = async (): Promise<{
  source: InMemoryEventSource;
  store: InMemoryProjectionStore;
  cursors: InMemoryCursorStore;
}> => {
  const source = log();
  const cursors = new InMemoryCursorStore();
  const store = new InMemoryProjectionStore(cursors);
  await new Projector({ events: source, store, cursors }).catchUp();
  return { source, store, cursors };
};

describe('projections · the rebuild', () => {
  it('rebuilds identical rows', async () => {
    const { source, store, cursors } = await projected();

    const report = await rebuild({ events: source, store, cursors }, { drop: true });

    expect(report.identical).toBe(true);
    expect(report.replayed).toBe(5);
    expect(report.comparisons).toHaveLength(3);
    for (const comparison of report.comparisons) {
      expect(comparison.differences).toHaveLength(0);
      expect(comparison.beforeDigest).toBe(comparison.afterDigest);
    }
  });

  it('replays from zero, whatever the cursor said', async () => {
    const { source, store, cursors } = await projected();

    // The cursor is at the end of the log — a rebuild that resumed from
    // it would replay nothing and produce empty rows.
    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(5);

    const report = await rebuild({ events: source, store, cursors }, { drop: true });

    expect(report.replayed).toBe(5);
    expect(Object.keys(await store.read('task_current'))).toEqual(['tsk_1']);
  });

  it('changes nothing in the safe form', async () => {
    const { source, store, cursors } = await projected();

    const before = rowsDigest(await store.read('task_current'));
    const costBefore = rowsDigest(await store.read('cost_attribution'));
    const cursorBefore = cursors.positionOf(PROJECTOR_CURSOR);

    const report = await rebuild({ events: source, store, cursors }, { drop: false });

    expect(report.identical).toBe(true);
    expect(rowsDigest(await store.read('task_current'))).toBe(before);
    expect(rowsDigest(await store.read('cost_attribution'))).toBe(costBefore);
    // The safe form does not move the running projector's cursor.
    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(cursorBefore);
  });

  it('reports which row and which field differ', async () => {
    const { source, store, cursors } = await projected();

    // Corrupt one row, so the rebuild has something to find.
    const rows = { ...(await store.read('task_current')) };
    const row = rows['tsk_1'] as Record<string, unknown>;
    rows['tsk_1'] = { ...row, state: 'MERGED' };
    await store.commit({
      name: PROJECTOR_CURSOR,
      upserts: [{ key: 'task_current tsk_1', row: rows['tsk_1'] }],
      removals: [],
      states: {},
      lastSeq: 5,
    });

    const report = await rebuild({ events: source, store, cursors }, { drop: false });

    expect(report.identical).toBe(false);

    const task = report.comparisons.find((c) => c.projection === 'task_current');
    expect(task).toBeDefined();
    expect(task?.differences).toHaveLength(1);
    expect(task?.differences[0]?.key).toBe('tsk_1');
    expect(task?.differences[0]?.fields).toEqual([
      { field: 'state', before: 'MERGED', after: 'VERIFYING' },
    ]);
  });

  it('does not disturb the running projector’s cursor', async () => {
    const { source, store, cursors } = await projected();

    await rebuild({ events: source, store, cursors }, { drop: false });

    // The rebuild reads from zero into its own isolated cursor store; the
    // running projector's position is where it was.
    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(5);
  });

  it('produces the same cost totals after a rebuild', async () => {
    const { source, store, cursors } = await projected();

    const before = await store.read('cost_attribution');
    await rebuild({ events: source, store, cursors }, { drop: true });
    const after = await store.read('cost_attribution');

    // The two model calls land in one bucket, and the bucket's totals
    // are the sum over its contributions — not the sum over the events
    // as they arrive, which a replay would double.
    const bucket = after['2026-11-10 feature worker opus'] as {
      tokensIn: number;
      tokensOut: number;
      usdMicros: number;
    };
    expect(bucket.tokensIn).toBe(1000);
    expect(bucket.tokensOut).toBe(150);
    expect(bucket.usdMicros).toBe(4100);
    expect(rowsDigest(after)).toBe(rowsDigest(before));
  });
});
