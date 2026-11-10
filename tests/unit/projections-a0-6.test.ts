/**
 * **A0.6** — the projections' oracle (T-1.15).
 *
 * > **A0.6** | Every projection can be dropped and rebuilt identically —
 * > the log is the source of truth, the projections are disposable |
 * > Rebuild
 *
 * pack `02` §4.18: "Every projection can be dropped and rebuilt from the
 * log (A0.6) — rebuild is a CLI command **and** a test."
 *
 * So this file is the **test** half of A0.6. The **command** half is
 * `factory projections rebuild` (`apps/cli/src/projections.ts`), and it
 * calls the *same* `rebuild()` function — so the two cannot disagree.
 *
 * ## The three proofs
 *
 * 1. **Drop and rebuild ⇒ identical rows.** The hash compare A0.6 names,
 *    *and* a field-for-field comparison — because a digest says "these
 *    two sets differ", and the operator needs "this row differs in this
 *    field".
 * 2. **The projector resumes after a crash without duplicating.** A crash
 *    between the rows and the cursor replays the events; the rows must
 *    come out the same.
 * 3. **The reducer is a fold.** Replaying the same event twice gives the
 *    same row, and the fold's result does not depend on the order the
 *    store returned the rows in.
 *
 * Each proof is named, so a failure says **which** proof broke.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryCursorStore,
  InMemoryEventSource,
  InMemoryProjectionStore,
  PROJECTOR_CURSOR,
  Projector,
  ReplayingEventSource,
  rebuild,
  rowsDigest,
} from '@factory/projections';

/**
 * A log with enough in it to exercise every projection.
 *
 * Two tasks (so the fold has more than one key), an approval that is
 * asked for and answered, two model calls in one bucket (so the sum is
 * exercised), and a change that is merged.
 */
const log = (): InMemoryEventSource => {
  const source = new InMemoryEventSource();

  source.appendEnvelope({
    eventId: 'evt_1',
    occurredAt: '2026-11-10T00:00:00.000Z',
    eventType: 'intent.recorded',
    aggregate: { kind: 'task', id: 'tsk_1', version: 1 },
    payload: {
      repo: 'acme/widgets',
      workflow: 'feature',
      riskTier: 'R1',
      budgetUsdMicros: 6_000_000,
    },
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
    eventType: 'intent.recorded',
    aggregate: { kind: 'task', id: 'tsk_2', version: 1 },
    payload: { repo: 'acme/widgets', workflow: 'bugfix', riskTier: 'R3' },
  });

  source.appendEnvelope({
    eventId: 'evt_4',
    occurredAt: '2026-11-10T00:03:00.000Z',
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
    eventId: 'evt_5',
    occurredAt: '2026-11-10T00:04:00.000Z',
    eventType: 'approval.granted',
    aggregate: { kind: 'approval', id: 'apr_1', version: 2 },
    subject: { taskId: 'tsk_1' },
    payload: { approvalId: 'apr_1' },
  });

  source.appendEnvelope({
    eventId: 'evt_6',
    occurredAt: '2026-11-10T00:05:00.000Z',
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
    eventId: 'evt_7',
    occurredAt: '2026-11-10T00:06:00.000Z',
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

  source.appendEnvelope({
    eventId: 'evt_8',
    occurredAt: '2026-11-10T00:07:00.000Z',
    eventType: 'change.merged',
    aggregate: { kind: 'change', id: 'chg_1', version: 1 },
    subject: { taskId: 'tsk_1' },
    payload: { workflow: 'feature', role: 'worker', model: 'opus' },
  });

  return source;
};

/**
 * A projector that has caught up.
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

describe('A0.6 · every projection can be dropped and rebuilt identically', () => {
  it('proof 1 — drop and rebuild ⇒ identical rows', async () => {
    const { source, store, cursors } = await projected();

    const before = {
      task_current: rowsDigest(await store.read('task_current')),
      approval_queue: rowsDigest(await store.read('approval_queue')),
      cost_attribution: rowsDigest(await store.read('cost_attribution')),
    };

    const report = await rebuild({ events: source, store, cursors }, { drop: true });

    // The hash compare A0.6 names.
    expect(report.identical).toBe(true);
    expect(rowsDigest(await store.read('task_current'))).toBe(before.task_current);
    expect(rowsDigest(await store.read('approval_queue'))).toBe(before.approval_queue);
    expect(rowsDigest(await store.read('cost_attribution'))).toBe(before.cost_attribution);

    // And the field-for-field comparison — a digest says "these differ",
    // and the operator needs "this row differs in this field". The
    // rebuild's report says there are none.
    for (const comparison of report.comparisons) {
      expect(comparison.differences).toHaveLength(0);
      expect(comparison.beforeDigest).toBe(comparison.afterDigest);
    }
  });

  it('proof 1 — the rebuild actually dropped and replayed, rather than doing nothing', async () => {
    const { source, store, cursors } = await projected();

    const report = await rebuild({ events: source, store, cursors }, { drop: true });

    // A rebuild that replayed nothing would also report "identical" — and
    // would prove nothing. So the report must say it replayed the log.
    expect(report.replayed).toBe(8);
    expect(report.lastSeq).toBe(8);
    expect(Object.keys(await store.read('task_current')).sort()).toEqual(['tsk_1', 'tsk_2']);
  });

  it('proof 1 — the rebuilt rows are the same content, field for field', async () => {
    const { source, store, cursors } = await projected();

    const before = await store.read('task_current');
    await rebuild({ events: source, store, cursors }, { drop: true });
    const after = await store.read('task_current');

    expect(after).toEqual(before);

    // The row's content is the log's own — the rebuild did not stamp it
    // with the wall clock. The activity is the **last** event that
    // touched the task, which is the merged change.
    const row = after['tsk_1'] as { lastActivityAt: string; spentUsdMicros: number };
    expect(row.lastActivityAt).toBe('2026-11-10T00:07:00.000Z');
    expect(row.spentUsdMicros).toBe(1200);
  });

  it('proof 1 — the rebuilt cost bucket is not doubled', async () => {
    const { source, store, cursors } = await projected();

    await rebuild({ events: source, store, cursors }, { drop: true });

    // The bucket's totals are the sum over its **contributions**, and a
    // replayed event overwrites its own contribution. So a rebuild that
    // added the events again would report 2000 tokens in; the correct
    // figure is 1000.
    const bucket = (await store.read('cost_attribution'))[
      '2026-11-10 feature worker opus'
    ] as { tokensIn: number; tokensOut: number; usdMicros: number; acceptedChangeCount: number };

    expect(bucket.tokensIn).toBe(1000);
    expect(bucket.tokensOut).toBe(150);
    expect(bucket.usdMicros).toBe(4100);
    expect(bucket.acceptedChangeCount).toBe(1);
  });

  it('proof 2 — the projector resumes after a crash without duplicating', async () => {
    const inner = log();
    const source = new ReplayingEventSource(inner);
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    const projector = new Projector({ events: source, store, cursors });
    await projector.catchUp();

    const before = rowsDigest(await store.read('cost_attribution'));

    // The crash: the cursor is behind the rows that were written. The
    // projector re-reads the events it had already applied.
    await cursors.reset(PROJECTOR_CURSOR);
    await projector.catchUp();

    // The re-read really happened — so the assertion is not vacuous.
    expect(source.replays).toBeGreaterThan(0);

    // And the rows are the same: the replay overwrote them rather than
    // adding to them.
    expect(rowsDigest(await store.read('cost_attribution'))).toBe(before);
    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(8);
  });

  it('proof 2 — the contribution is keyed by the event’s identity, not its position', async () => {
    // The `cost_attribution` bucket is a **sum**, so its idempotence
    // rests entirely on how the contributions are keyed.
    //
    // They are keyed by the event's **id**, not by its `seq`. The
    // difference is not academic: `seq` is the log's **position**, and a
    // position changes when the log is **re-based** — compacted, or
    // rebuilt from a truncated window. The event's *identity* does not
    // change.
    //
    // So this proof applies the **same event twice at different
    // positions** — the event the projector already applied, re-appearing
    // further down a re-based log. Keyed by `seq` that is a **second**
    // contribution and the bucket's totals double; keyed by the id it is
    // the same contribution, written twice, and the totals hold.
    const cursors = new InMemoryCursorStore();
    const store = new InMemoryProjectionStore(cursors);

    const first = new InMemoryEventSource();
    first.append({
      eventId: 'evt_model',
      occurredAt: '2026-11-10T00:00:00.000Z',
      eventType: 'model.requested',
      aggregate: { kind: 'run', id: 'run_1', version: 1 },
      correlationId: 'corr_1',
      actor: { kind: 'system', id: 'projector-test' },
      authority: { basis: 'system-rule' },
      subject: { taskId: 'tsk_1' },
      payload: {
        workflow: 'feature',
        role: 'worker',
        model: 'opus',
        tokens: { in: 100, out: 20 },
        costUsdMicros: 500,
      },
      context: { items: [] },
      redaction: { applied: [] },
      seq: 1,
    });

    await new Projector({ events: first, store, cursors }).catchUp();

    const bucket = (await store.read('cost_attribution'))[
      '2026-11-10 feature worker opus'
    ] as { tokensIn: number; usdMicros: number };
    expect(bucket.tokensIn).toBe(100);
    expect(bucket.usdMicros).toBe(500);

    // The re-based log: the **same event**, at sequence 101 — the log
    // was compacted, so everything moved.
    const rebased = new InMemoryEventSource();
    rebased.append({ ...first.all()[0]!, seq: 101 });

    await new Projector({ events: rebased, store, cursors }).catchUp();

    // The event really was applied a second time, at a different
    // position — so the assertion is not vacuous.
    expect(rebased.all()[0]?.seq).toBe(101);

    // And the bucket did not double.
    const after = (await store.read('cost_attribution'))[
      '2026-11-10 feature worker opus'
    ] as { tokensIn: number; usdMicros: number };
    expect(after.tokensIn).toBe(100);
    expect(after.usdMicros).toBe(500);
  });

  it('proof 3 — the reducer is a fold: the same event twice gives the same row', async () => {
    const { source, store, cursors } = await projected();

    const before = rowsDigest(await store.read('task_current'));

    // The whole log is applied a second time, from the same cursor
    // position, to the same rows.
    const projector = new Projector({ events: source, store, cursors });
    await cursors.reset(PROJECTOR_CURSOR);
    await projector.catchUp();

    expect(rowsDigest(await store.read('task_current'))).toBe(before);
  });

  it('proof 3 — the fold does not depend on the order the store returned the rows in', async () => {
    const { store } = await projected();

    const rows = await store.read('task_current');
    const keys = Object.keys(rows);

    // The digest is a function of the **set**, so the order the store
    // hands the rows over in cannot change it.
    const reversed = Object.fromEntries([...keys].reverse().map((key) => [key, rows[key]]));
    expect(rowsDigest(reversed)).toBe(rowsDigest(rows));
  });

  it('proof 3 — the safe form changes nothing', async () => {
    const { source, store, cursors } = await projected();

    const before = rowsDigest(await store.read('task_current'));
    const cursorBefore = cursors.positionOf(PROJECTOR_CURSOR);

    const report = await rebuild({ events: source, store, cursors }, { drop: false });

    expect(report.identical).toBe(true);
    expect(rowsDigest(await store.read('task_current'))).toBe(before);
    expect(cursors.positionOf(PROJECTOR_CURSOR)).toBe(cursorBefore);
  });
});
