/**
 * `dashboard-react` — the React layer's own logic (T-1.16).
 *
 * ## What this file covers
 *
 * The React layer is thin — it renders what `regions.ts` returns — so
 * there is little of it to test under Vitest. Two pieces have logic
 * worth pinning:
 *
 * * `parseTimelineEvents` — the timeline's parse. It is **total**: a
 *   field of the wrong type is dropped, not crashed on, and the actor
 *   is flattened to `kind:id` so "a human approved this" and "the
 *   scheduler approved this" read differently.
 * * `openStream` — the live channel. It subscribes to exactly the
 *   pack's six classes, and it hands back a `close` that really closes
 *   the source — a stream that outlived its component would keep the
 *   page alive.
 *
 * ## Why the browser is not here
 *
 * The React rendering is proved by the **Playwright** oracle
 * (`tests/e2e/dashboard.spec.ts`), which is the only thing that can
 * prove "the browser reaches an item in two clicks". This file proves
 * the logic underneath it, which a browser test would only prove
 * indirectly.
 */

import { describe, expect, it } from 'vitest';

import { decideKillSwitch, killSwitchMessage } from '../../apps/dashboard/src/kill-switch.ts';
import { parseTimelineEvents } from '../../apps/dashboard/src/timeline-events.ts';
import { openStream, STREAM_CLASSES, type EventSourceLike } from '../../apps/dashboard/src/stream.ts';

describe('the timeline parse', () => {
  it('reads an event', () => {
    const events = parseTimelineEvents([
      {
        seq: 41,
        eventType: 'stage.completed',
        occurredAt: '2026-01-01T00:00:00.000Z',
        actor: { kind: 'human', id: 'alice' },
        correlationId: 'corr-1',
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(41);
    expect(events[0]?.eventType).toBe('stage.completed');
    expect(events[0]?.actor).toBe('human:alice');
    expect(events[0]?.correlationId).toBe('corr-1');
  });

  it('reads the event type from the type field too', () => {
    // The projections may spell it either way; the timeline must not
    // care.
    const events = parseTimelineEvents([{ type: 'stage.completed' }]);
    expect(events[0]?.eventType).toBe('stage.completed');
  });

  it('drops a field of the wrong type', () => {
    const events = parseTimelineEvents([{ seq: 'not a number', eventType: 'x' }]);
    expect(events[0]?.seq).toBeUndefined();
    expect(events[0]?.eventType).toBe('x');
  });

  it('reads an actor that is a plain string', () => {
    const events = parseTimelineEvents([{ actor: 'alice' }]);
    expect(events[0]?.actor).toBe('alice');
  });

  it('reads an actor that has no kind', () => {
    const events = parseTimelineEvents([{ actor: { id: 'alice' } }]);
    expect(events[0]?.actor).toBe('alice');
  });

  it('drops an actor with no id', () => {
    const events = parseTimelineEvents([{ actor: { kind: 'human' } }]);
    expect(events[0]?.actor).toBeUndefined();
  });

  it('never throws on a hostile payload', () => {
    expect(() => parseTimelineEvents([{ actor: 42 }, { seq: null }])).not.toThrow();
    expect(parseTimelineEvents([])).toEqual([]);
  });
});

describe('the kill switch\'s decision', () => {
  it('engages a released switch with a reason', () => {
    const decision = decideKillSwitch('the gateway is flapping', false);
    expect(decision).toEqual({
      kind: 'proceed',
      engage: true,
      reason: 'the gateway is flapping',
    });
  });

  it('releases an engaged switch with a reason', () => {
    const decision = decideKillSwitch('the gateway recovered', true);
    expect(decision).toEqual({
      kind: 'proceed',
      engage: false,
      reason: 'the gateway recovered',
    });
  });

  it('refuses a blank reason', () => {
    // A switch engaged without a reason cannot be released by whoever
    // finds it — so a blank reason is refused, and the refusal names
    // itself so it is distinguishable from an API refusal.
    const decision = decideKillSwitch('   ', false);
    expect(decision).toEqual({
      kind: 'refused',
      message: 'the kill switch needs a reason',
    });
  });

  it('refuses an empty reason', () => {
    expect(decideKillSwitch('', false).kind).toBe('refused');
  });

  it('says nothing when the prompt is dismissed', () => {
    // A human changing their mind is not an error, so it is not
    // reported as one.
    expect(decideKillSwitch(null, false)).toEqual({ kind: 'cancelled' });
  });

  it('refuses an unwired switch', () => {
    expect(decideKillSwitch('a reason', false, false)).toEqual({
      kind: 'refused',
      message: 'the kill switch is not wired',
    });
  });

  it('refuses an unwired switch before it asks about the reason', () => {
    // The order matters: an unwired switch is refused whatever the
    // reason is, so a blank reason must not change the message.
    expect(decideKillSwitch('', false, false)).toEqual({
      kind: 'refused',
      message: 'the kill switch is not wired',
    });
  });

  it('names the state it reached', () => {
    expect(killSwitchMessage(true)).toBe('the kill switch is engaged');
    expect(killSwitchMessage(false)).toBe('the kill switch is released');
  });
});

describe('the live channel', () => {
  /**
   * A recording `EventSource`.
   */
  const recordingSource = (): {
    readonly source: EventSourceLike;
    readonly listeners: Map<string, (event: unknown) => void>;
    readonly closed: { value: boolean };
  } => {
    const listeners = new Map<string, (event: unknown) => void>();
    const closed = { value: false };
    const source: EventSourceLike = {
      addEventListener: (type, listener) => {
        listeners.set(type, listener);
      },
      close: () => {
        closed.value = true;
      },
    };
    return { source, listeners, closed };
  };

  it('subscribes to exactly the pack\'s six classes', () => {
    // pack `04` §3's list — and no others.
    const { source, listeners } = recordingSource();
    openStream(() => undefined, { createEventSource: () => source });
    expect([...listeners.keys()].sort()).toEqual([...STREAM_CLASSES].sort());
  });

  it('names the six classes the pack names', () => {
    expect(STREAM_CLASSES).toEqual([
      'task.updated',
      'approval.requested',
      'review.queued',
      'health.changed',
      'cost.updated',
      'killswitch.changed',
    ]);
  });

  it('opens the stream on the API\'s base path', () => {
    const seen: string[] = [];
    openStream(() => undefined, {
      base: '/v1',
      createEventSource: (url) => {
        seen.push(url);
        return recordingSource().source;
      },
    });
    expect(seen[0]).toBe('/v1/stream');
  });

  it('calls back when an event arrives', () => {
    const { source, listeners } = recordingSource();
    const seen: string[] = [];
    openStream((eventType) => seen.push(eventType), {
      createEventSource: () => source,
    });
    listeners.get('approval.requested')?.({});
    expect(seen).toEqual(['approval.requested']);
  });

  it('closes the source when the channel is closed', () => {
    // A stream that outlived its component would keep the page alive.
    const { source, closed } = recordingSource();
    const channel = openStream(() => undefined, { createEventSource: () => source });
    expect(closed.value).toBe(false);
    channel.close();
    expect(closed.value).toBe(true);
  });

  it('ignores an event it did not subscribe to', () => {
    const { source, listeners } = recordingSource();
    const seen: string[] = [];
    openStream((eventType) => seen.push(eventType), {
      createEventSource: () => source,
    });
    expect(listeners.has('task.exploded')).toBe(false);
  });
});
