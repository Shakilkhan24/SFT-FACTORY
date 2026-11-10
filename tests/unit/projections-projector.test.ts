/**
 * `projections` — the projector loop (T-1.15).
 *
 * The loop's load-bearing properties:
 *
 * 1. **It resumes from the cursor** — a second pass reads only what is
 *    left, not the whole log.
 * 2. **The cursor advances past every event it *read*** — not only the
 *    ones a projection claimed. Otherwise the projector re-reads the
 *    skipped events forever.
 * 3. **The rows and the cursor commit together** — one transaction.
 * 4. **A crash mid-batch does not duplicate** — the rows come out the
 *    same, because every write is absolute.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryCursorStore,
  InMemoryEventSource,
  InMemoryProjectionStore,
  PROJECTOR_CURSOR,
  Projector,
  ReplayingEventSource,
  rowsDigest,
} from '@factory/projections';

/**
 * A log with a task's life in it.
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

describe('projections · the projector', () => {
  it('reads from the cursor, not from the start', async () => {
    const source = log();
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    const projector = new Projector({ events: source, store, cursors });
    await projector.catchUp();

    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(4);

    // A second catch-up reads nothing, because the cursor is at the end.
    const before = source.reads;
    await projector.catchUp();
    expect(source.reads).toBe(before + 1);
    expect(source.handedOut.filter((seq) => seq === 1)).toHaveLength(1);
  });

  it('projects the events into the three projections', async () => {
    const source = log();
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    await new Projector({ events: source, store, cursors }).catchUp();

    const task = (await store.read('task_current'))['tsk_1'] as {
      state: string;
      spentUsdMicros: number;
      needsHuman: boolean;
    };
    expect(task.state).toBe('VERIFYING');
    expect(task.spentUsdMicros).toBe(1200);
    expect(task.needsHuman).toBe(true);

    const approvals = await store.read('approval_queue');
    expect(Object.keys(approvals)).toEqual(['apr_1']);

    const cost = await store.read('cost_attribution');
    expect(Object.keys(cost)).toEqual(['2026-11-10 feature worker opus']);
  });

  it('advances the cursor past every event it read, claimed or not', async () => {
    // An event that belongs to no projection still moves the cursor.
    const source = new InMemoryEventSource();
    source.appendEnvelope({
      eventId: 'evt_sys',
      occurredAt: '2026-11-10T00:00:00.000Z',
      eventType: 'system.heartbeat',
      aggregate: { kind: 'system', id: 'sys_1', version: 1 },
    });

    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    await new Projector({ events: source, store, cursors }).catchUp();

    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(1);
    expect(Object.keys(await store.read('task_current'))).toHaveLength(0);
  });

  it('commits the rows and the cursor in one transaction', async () => {
    const source = log();
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    await new Projector({ events: source, store, cursors }).catchUp();

    // The in-memory store counts its commits, and the cursor it records
    // is the one the commit carried — so a commit that did not carry the
    // cursor would leave the two out of step.
    expect(store.commits).toBe(1);
    expect(store.cursorOf(PROJECTOR_CURSOR)).toBe(4);
  });

  it('does not duplicate the rows when the log is replayed', async () => {
    const source = log();
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    const projector = new Projector({ events: source, store, cursors });
    await projector.catchUp();

    const before = rowsDigest(await store.read('task_current'));
    const costBefore = rowsDigest(await store.read('cost_attribution'));

    // The cursor goes back — a crash between "rows written" and "cursor
    // advanced" would leave exactly this state.
    await cursors.reset(PROJECTOR_CURSOR);
    await projector.catchUp();

    expect(rowsDigest(await store.read('task_current'))).toBe(before);
    expect(rowsDigest(await store.read('cost_attribution'))).toBe(costBefore);
  });

  it('re-reads the events it had already applied when the cursor is behind', async () => {
    // The replaying source counts the re-reads, so the assertion cannot be
    // vacuous: it proves the projector really did read the same events
    // twice, and the rows still came out the same.
    const inner = log();
    const source = new ReplayingEventSource(inner);
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    const projector = new Projector({ events: source, store, cursors });
    await projector.catchUp();
    const before = rowsDigest(await store.read('task_current'));

    await cursors.reset(PROJECTOR_CURSOR);
    await projector.catchUp();

    expect(source.replays).toBeGreaterThan(0);
    expect(rowsDigest(await store.read('task_current'))).toBe(before);
  });

  it('reads in batches and commits each batch', async () => {
    const source = log();
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    const projector = new Projector({ events: source, store, cursors }, 2);
    const passes = await projector.catchUp();

    // Four events in batches of two: two passes that read, one that did
    // not.
    expect(passes.filter((pass) => pass.read > 0)).toHaveLength(2);
    expect(store.commits).toBe(2);
    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(4);
  });

  it('removes an approval row when the approval is answered', async () => {
    const source = log();
    source.appendEnvelope({
      eventId: 'evt_5',
      occurredAt: '2026-11-10T00:04:00.000Z',
      eventType: 'approval.granted',
      aggregate: { kind: 'approval', id: 'apr_1', version: 2 },
      subject: { taskId: 'tsk_1' },
      payload: { approvalId: 'apr_1' },
    });

    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    await new Projector({ events: source, store, cursors }).catchUp();

    expect(Object.keys(await store.read('approval_queue'))).toHaveLength(0);
  });
});
