/**
 * `projections` — the reducers (T-1.15).
 *
 * The reducers are **pure folds**. So the properties under test are the
 * three that make A0.6 possible:
 *
 * 1. **Purity** — the same event and the same current row give the same
 *    result, every time. No clock, no I/O.
 * 2. **Idempotence** — applying the same event twice gives the same row.
 *    This is the property that stops a replay from doubling a figure.
 * 3. **Order** — the fold's result depends on the events' order, and the
 *    *order-independent* parts (the identity fields, the bucket key) do
 *    not depend on it at all.
 */

import { describe, expect, it } from 'vitest';

import {
  PROJECTIONS,
  REDUCERS,
  belongsToTask,
  costBucketKey,
  costRowOf,
  dayOf,
  isTransitionEvent,
  reducerFor,
  reduceApprovalQueue,
  reduceCostAttribution,
  reduceTaskCurrent,
  taskIdOf,
  totalsOf,
  urgencyOf,
} from '@factory/projections';

import { InMemoryEventSource, envelopeOf } from '@factory/projections';

/**
 * Build an event envelope the reducers can read.
 */
const event = (
  overrides: {
    readonly eventType: string;
    readonly eventId?: string;
    readonly occurredAt?: string;
    readonly aggregate?: { readonly kind: string; readonly id: string; readonly version?: number };
    readonly subject?: Readonly<Record<string, unknown>>;
    readonly payload?: unknown;
  },
): ReturnType<typeof envelopeOf> => {
  const source = new InMemoryEventSource();
  const appended = source.appendEnvelope({
    eventId: overrides.eventId ?? `evt_${overrides.eventType}`,
    occurredAt: overrides.occurredAt ?? '2026-11-10T00:00:00.000Z',
    eventType: overrides.eventType,
    aggregate: {
      kind: overrides.aggregate?.kind ?? 'task',
      id: overrides.aggregate?.id ?? 'tsk_1',
      ...(overrides.aggregate?.version === undefined
        ? {}
        : { version: overrides.aggregate.version }),
    },
    subject: overrides.subject ?? {},
    payload: overrides.payload ?? {},
  });
  return envelopeOf(appended);
};

describe('projections · task_current', () => {
  it('creates the row on intent.recorded, with the repo and the workflow', () => {
    const row = reduceTaskCurrent(
      undefined,
      event({
        eventType: 'intent.recorded',
        payload: { repo: 'acme/widgets', workflow: 'feature', riskTier: 'R2' },
      }),
    );

    expect(row.taskId).toBe('tsk_1');
    expect(row.repo).toBe('acme/widgets');
    expect(row.workflow).toBe('feature');
    expect(row.riskTier).toBe('R2');
    expect(row.state).toBe('DRAFT');
  });

  it('takes the state from a transition payload, not from an event type', () => {
    // The vocabulary has no `task.stateChanged`, so the transition is
    // identified by its payload shape — exactly as packages/state does it.
    const row = reduceTaskCurrent(
      undefined,
      event({
        eventType: 'stage.completed',
        payload: { from: 'RUNNING', to: 'VERIFYING', trigger: 'stage.ok' },
      }),
    );

    expect(row.state).toBe('VERIFYING');
    expect(isTransitionEvent(event({ eventType: 'x', payload: { from: 'RUNNING', to: 'DRAFT' } }))).toBe(
      true,
    );
    expect(isTransitionEvent(event({ eventType: 'x', payload: { foo: 1 } }))).toBe(false);
  });

  it('refuses a state the contracts do not have', () => {
    // Writing an unknown state into the row would put a value no reader
    // can interpret.
    const row = reduceTaskCurrent(
      undefined,
      event({ eventType: 'stage.completed', payload: { from: 'RUNNING', to: 'NOT_A_STATE' } }),
    );

    expect(row.state).toBe('DRAFT');
  });

  it('raises and clears the needsHuman flag, and leaves it alone otherwise', () => {
    const queued = reduceTaskCurrent(
      undefined,
      event({ eventType: 'review.queued', subject: { taskId: 'tsk_1' } }),
    );
    expect(queued.needsHuman).toBe(true);

    const unrelated = reduceTaskCurrent(
      queued,
      event({ eventType: 'stage.completed', subject: { taskId: 'tsk_1' } }),
    );
    expect(unrelated.needsHuman).toBe(true);

    const approved = reduceTaskCurrent(
      unrelated,
      event({ eventType: 'review.approved', subject: { taskId: 'tsk_1' } }),
    );
    expect(approved.needsHuman).toBe(false);
  });

  it('copies the authoritative spent total rather than summing the events', () => {
    // The sum would double on a replay. The copy cannot.
    const first = reduceTaskCurrent(
      undefined,
      event({ eventType: 'stage.completed', payload: { spentUsdMicros: 1000 } }),
    );
    const second = reduceTaskCurrent(
      first,
      event({ eventType: 'stage.completed', payload: { spentUsdMicros: 2500 } }),
    );

    expect(second.spentUsdMicros).toBe(2500);

    // Replaying the second event over the same row gives the same row.
    const replayed = reduceTaskCurrent(first, event({
      eventType: 'stage.completed',
      payload: { spentUsdMicros: 2500 },
    }));
    expect(replayed.spentUsdMicros).toBe(2500);
  });

  it('uses the log’s clock for lastActivityAt, not the projector’s', () => {
    const row = reduceTaskCurrent(
      undefined,
      event({ eventType: 'stage.completed', occurredAt: '2026-01-02T03:04:05.000Z' }),
    );
    expect(row.lastActivityAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('resolves the task id from the subject, the task aggregate or the node aggregate', () => {
    expect(taskIdOf(event({ eventType: 'x', subject: { taskId: 'tsk_subject' } }))).toBe(
      'tsk_subject',
    );
    expect(taskIdOf(event({ eventType: 'x', aggregate: { kind: 'task', id: 'tsk_agg' } }))).toBe(
      'tsk_agg',
    );
    expect(
      taskIdOf(event({ eventType: 'x', aggregate: { kind: 'node', id: 'tsk_1/n1-build' } })),
    ).toBe('tsk_1');
    expect(taskIdOf(event({ eventType: 'x', aggregate: { kind: 'system', id: 'sys_1' } }))).toBe('');
    expect(belongsToTask(event({ eventType: 'x', aggregate: { kind: 'system', id: 'sys_1' } }))).toBe(
      false,
    );
  });
});

describe('projections · approval_queue', () => {
  it('creates a row on approval.requested and removes it when it is answered', () => {
    const requested = reduceApprovalQueue(
      undefined,
      event({
        eventType: 'approval.requested',
        payload: {
          approvalId: 'apr_1',
          type: 'merge',
          taskId: 'tsk_1',
          expiresAt: '2026-11-10T01:00:00.000Z',
        },
      }),
    );

    expect(requested.kind).toBe('upsert');
    if (requested.kind !== 'upsert') {
      throw new Error('expected an upsert');
    }
    expect(requested.row.approvalId).toBe('apr_1');
    expect(requested.row.type).toBe('merge');
    expect(requested.row.urgency).toBe('high');

    const granted = reduceApprovalQueue(
      requested.row,
      event({ eventType: 'approval.granted', payload: { approvalId: 'apr_1' } }),
    );
    expect(granted.kind).toBe('remove');
    if (granted.kind !== 'remove') {
      throw new Error('expected a removal');
    }
    expect(granted.approvalId).toBe('apr_1');
  });

  it('ignores an approval with no id', () => {
    const effect = reduceApprovalQueue(undefined, event({ eventType: 'approval.requested' }));
    expect(effect.kind).toBe('none');
  });

  it('ignores an event that concerns neither the queue nor an approval', () => {
    const effect = reduceApprovalQueue(undefined, event({ eventType: 'stage.completed' }));
    expect(effect.kind).toBe('none');
  });

  it('classifies the urgency from the approval’s own window', () => {
    expect(urgencyOf('2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z')).toBe('critical');
    expect(urgencyOf('2026-01-01T00:00:00Z', '2026-01-01T00:30:00Z')).toBe('high');
    expect(urgencyOf('2026-01-01T00:00:00Z', '2026-01-01T12:00:00Z')).toBe('normal');
    expect(urgencyOf('2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z')).toBe('low');
    expect(urgencyOf('2026-01-01T00:00:00Z', '2025-12-31T00:00:00Z')).toBe('expired');
    expect(urgencyOf('not a date', 'also not a date')).toBe('unknown');
  });
});

describe('projections · cost_attribution', () => {
  it('keys the contributions by the event id, so a replay overwrites its own', () => {
    const first = reduceCostAttribution(
      undefined,
      event({
        eventType: 'model.requested',
        eventId: 'evt_a',
        payload: { tokens: { in: 100, out: 20 }, costUsdMicros: 500 },
      }),
    );
    const second = reduceCostAttribution(
      first,
      event({
        eventType: 'model.requested',
        eventId: 'evt_b',
        payload: { tokens: { in: 50, out: 10 }, costUsdMicros: 250 },
      }),
    );

    expect(totalsOf(second)).toEqual({
      tokensIn: 150,
      tokensOut: 30,
      usdMicros: 750,
      acceptedChangeCount: 0,
    });

    // Replaying `evt_a` must not add a second contribution.
    const replayed = reduceCostAttribution(
      second,
      event({
        eventType: 'model.requested',
        eventId: 'evt_a',
        payload: { tokens: { in: 100, out: 20 }, costUsdMicros: 500 },
      }),
    );

    expect(totalsOf(replayed)).toEqual(totalsOf(second));
    expect(Object.keys(replayed)).toEqual(['evt_a', 'evt_b']);
  });

  it('counts an accepted change', () => {
    const contributions = reduceCostAttribution(
      undefined,
      event({ eventType: 'change.merged', eventId: 'evt_c' }),
    );
    expect(totalsOf(contributions).acceptedChangeCount).toBe(1);
  });

  it('ignores an event that carries no cost', () => {
    const contributions = reduceCostAttribution(undefined, event({ eventType: 'stage.completed' }));
    expect(Object.keys(contributions)).toHaveLength(0);
  });

  it('builds the bucket key from the day, the workflow, the role and the model', () => {
    const key = costBucketKey(
      event({
        eventType: 'model.requested',
        occurredAt: '2026-11-10T05:00:00.000Z',
        payload: { workflow: 'feature', role: 'worker', model: 'opus' },
      }),
    );
    expect(key).toBe('2026-11-10 feature worker opus');
    expect(dayOf('2026-11-10T05:00:00.000Z')).toBe('2026-11-10');
    expect(dayOf('not a date')).toBe('');
  });

  it('builds the row from the totals', () => {
    const contributions = reduceCostAttribution(
      undefined,
      event({
        eventType: 'model.requested',
        eventId: 'evt_a',
        payload: { tokens: { in: 100, out: 20 }, costUsdMicros: 500 },
      }),
    );
    const row = costRowOf('2026-11-10', 'feature', 'worker', 'opus', contributions);
    expect(row).toEqual({
      day: '2026-11-10',
      workflow: 'feature',
      role: 'worker',
      model: 'opus',
      tokensIn: 100,
      tokensOut: 20,
      usdMicros: 500,
      acceptedChangeCount: 0,
    });
  });
});

describe('projections · the registry', () => {
  it('names every projection exactly once', () => {
    expect(PROJECTIONS).toEqual(['task_current', 'approval_queue', 'cost_attribution']);
    for (const name of PROJECTIONS) {
      expect(REDUCERS[name]).toBeDefined();
      expect(reducerFor(name).name).toBe(name);
    }
  });

  it('refuses an unknown projection', () => {
    expect(() => reducerFor('nope' as never)).toThrow(/unknown projection/);
  });

  it('claims only the events that belong to it', () => {
    const transition = event({
      eventType: 'stage.completed',
      payload: { from: 'RUNNING', to: 'VERIFYING' },
    });
    expect(reducerFor('task_current').keyOf(transition)).toBe('tsk_1');

    const approval = event({
      eventType: 'approval.requested',
      payload: { approvalId: 'apr_1' },
    });
    expect(reducerFor('approval_queue').keyOf(approval)).toBe('apr_1');
    expect(reducerFor('task_current').keyOf(approval)).toBe('tsk_1');
    expect(reducerFor('cost_attribution').keyOf(approval)).toBeUndefined();
  });
});
