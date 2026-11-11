/**
 * `api-stream` — the real `GET /v1/stream` (T-1.16).
 *
 * ## What this file covers
 *
 * pack `04` §3: "`GET /v1/stream` — **SSE**: `task.updated`,
 * `approval.requested`, `review.queued`, `health.changed`,
 * `cost.updated`, `killswitch.changed`; `id:` = event `seq` for
 * `Last-Event-ID` resume."
 *
 * So the four obligations are:
 *
 * 1. the **six classes** — the stream carries exactly the pack's six,
 *    and nothing else;
 * 2. the **`id:` is the `seq`** — so a resume cannot miss an event;
 * 3. the **resume** — `Last-Event-ID` (header) and `lastEventId`
 *    (query), the header winning;
 * 4. the **scope gate** — the route is `inspect`-scoped, so a token
 *    without it gets no stream.
 *
 * ## The framing is tested as a **pure function**
 *
 * `frameEvent` is exported and pure, so the SSE format is asserted
 * without a server. That is deliberate: the format's two load-bearing
 * rules — the `id:` and the `event:` — are the things a client
 * depends on, and they are worth pinning exactly.
 *
 * ## The live route is tested too
 *
 * The route itself is exercised through the harness, because the
 * route's behaviour is not only its framing: it is the **headers**
 * (`text/event-stream`, `x-accel-buffering: no`), the **class
 * filter**, and the **cursor** advancing past an event it did not
 * carry.
 */

import { describe, expect, it } from 'vitest';

import {
  CLASS_BY_EVENT_TYPE,
  STREAM_CLASSES,
  classFor,
  classify,
  isStreamClass,
} from '../../apps/api/src/stream.js';
import type { ClassifiedEvent } from '../../apps/api/src/stream.js';
import {
  LAST_EVENT_ID_HEADER,
  LAST_EVENT_ID_QUERY,
  OPEN_COMMENT,
  carriedClasses,
  frameEvent,
  readRequestedClasses,
  resumeFrom,
} from '../../apps/api/src/handlers/stream.js';
import {
  browserHeaders,
  buildHarness,
  cliHeaders,
} from '../../apps/api/src/harness.js';
import type { Harness } from '../../apps/api/src/harness.js';

/**
 * A raw log event.
 */
const rawEvent = (
  seq: number,
  eventType: string,
  overrides: Partial<{
    aggregateKind: string;
    aggregateId: string;
    occurredAt: string;
    payload: unknown;
  }> = {},
): {
  readonly seq: number;
  readonly eventType: string;
  readonly aggregate: { readonly kind: string; readonly id: string };
  readonly occurredAt: string;
  readonly payload: unknown;
} => ({
  seq,
  eventType,
  aggregate: {
    kind: overrides.aggregateKind ?? 'task',
    id: overrides.aggregateId ?? `task-${seq}`,
  },
  occurredAt: overrides.occurredAt ?? '2026-01-01T00:00:00.000Z',
  payload: overrides.payload ?? { note: `event ${seq}` },
});

/**
 * A classified event, for the framing tests.
 */
const classified = (
  seq: number,
  eventType: string,
  cls: (typeof STREAM_CLASSES)[number],
): ClassifiedEvent => ({
  seq,
  eventType,
  class: cls,
  aggregate: { kind: 'task', id: `task-${seq}` },
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: { note: `event ${seq}` },
});

// ---------------------------------------------------------------------------
// The six classes
// ---------------------------------------------------------------------------

describe('the stream classes', () => {
  it('carries exactly the pack\'s six classes, in the pack\'s order', () => {
    expect(STREAM_CLASSES).toEqual([
      'task.updated',
      'approval.requested',
      'review.queued',
      'health.changed',
      'cost.updated',
      'killswitch.changed',
    ]);
  });

  it('spells the sixth class in one word, as the pack does', () => {
    // The pack says `killswitch.changed`. A client that has to guess
    // whether it is `kill-switch.changed` cannot subscribe to it.
    expect(STREAM_CLASSES).toContain('killswitch.changed');
    expect(STREAM_CLASSES).not.toContain('kill-switch.changed');
  });

  it('recognises a class it carries and rejects one it does not', () => {
    expect(isStreamClass('task.updated')).toBe(true);
    expect(isStreamClass('killswitch.changed')).toBe(true);
    expect(isStreamClass('kill-switch.changed')).toBe(false);
    expect(isStreamClass('task.exploded')).toBe(false);
  });

  it('maps every carried class to at least one event type', () => {
    const mapped = new Set(Object.values(CLASS_BY_EVENT_TYPE));
    for (const cls of STREAM_CLASSES) {
      expect(mapped.has(cls)).toBe(true);
    }
  });

  it('maps an approval request to its own class, not to task.updated', () => {
    // A human must be able to subscribe to "things waiting for me"
    // alone — so an approval is not buried in the task class.
    expect(classFor('approval.requested')).toBe('approval.requested');
    expect(classFor('approval.requested')).not.toBe('task.updated');
  });

  it('maps the kill-switch types to the killswitch class', () => {
    expect(classFor('kill.switch.engaged')).toBe('killswitch.changed');
    expect(classFor('kill.switch.released')).toBe('killswitch.changed');
  });

  it('maps the gate and policy types to the health class', () => {
    expect(classFor('gate.failed')).toBe('health.changed');
    expect(classFor('policy.denied')).toBe('health.changed');
    expect(classFor('budget.exhausted')).toBe('health.changed');
  });

  it('maps the model types to the cost class', () => {
    expect(classFor('model.requested')).toBe('cost.updated');
    expect(classFor('model.failedOver')).toBe('cost.updated');
  });

  it('does not carry the high-volume operational types', () => {
    // Every tool call and every model request would flood the stream.
    // The cost-bearing model types are the deliberate exception.
    expect(classFor('tool.invoked')).toBeUndefined();
    expect(classFor('node.leased')).toBe('task.updated');
  });

  it('does not carry the factory-configuration types', () => {
    expect(classFor('definition.applied')).toBeUndefined();
    expect(classFor('environment.provisioned')).toBeUndefined();
  });

  it('returns undefined for an event type nobody knows', () => {
    expect(classFor('not.a.real.type')).toBeUndefined();
  });

  it('classifies an event into a stream event', () => {
    const result = classify(rawEvent(7, 'stage.completed'));
    expect(result).toBeDefined();
    expect(result?.seq).toBe(7);
    expect(result?.eventType).toBe('stage.completed');
    expect(result?.class).toBe('task.updated');
  });

  it('refuses to classify an event it does not carry', () => {
    expect(classify(rawEvent(7, 'not.a.real.type'))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The framing
// ---------------------------------------------------------------------------

describe('the SSE framing', () => {
  it('frames the id as the seq, so a resume cannot miss an event', () => {
    const frame = frameEvent(classified(42, 'stage.completed', 'task.updated'));
    expect(frame).toContain('id: 42\n');
  });

  it('frames the event as the class, so a client can subscribe to one class', () => {
    const frame = frameEvent(classified(42, 'approval.requested', 'approval.requested'));
    expect(frame).toContain('event: approval.requested\n');
  });

  it('terminates the event with a blank line', () => {
    // The blank line is part of the format: a client that does not
    // see it keeps reading the previous event's data.
    const frame = frameEvent(classified(1, 'stage.completed', 'task.updated'));
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('frames the payload as one JSON line with a fixed shape', () => {
    const frame = frameEvent(classified(42, 'stage.completed', 'task.updated'));
    const dataLine = frame
      .split('\n')
      .find((line) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse((dataLine as string).slice('data: '.length)) as Record<string, unknown>;
    expect(parsed['seq']).toBe(42);
    expect(parsed['eventType']).toBe('stage.completed');
    expect(parsed['class']).toBe('task.updated');
    expect(parsed['aggregate']).toEqual({ kind: 'task', id: 'task-42' });
    expect(parsed['occurredAt']).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed['payload']).toEqual({ note: 'event 42' });
  });

  it('does not let a newline in the payload break the framing', () => {
    // The payload is escaped by JSON.stringify, not by hand — a
    // hand-rolled escape is the classic way to break an SSE stream.
    const frame = frameEvent(
      classified(1, 'stage.completed', 'task.updated'),
    );
    expect(frame.split('\n').filter((line) => line.startsWith('data: '))).toHaveLength(1);
  });

  it('escapes a payload that contains a newline', () => {
    const event = classified(1, 'stage.completed', 'task.updated');
    const withNewline: ClassifiedEvent = {
      ...event,
      payload: { text: 'first\nsecond' },
    };
    const frame = frameEvent(withNewline);
    expect(frame.split('\n').filter((line) => line.startsWith('data: '))).toHaveLength(1);
    const dataLine = frame
      .split('\n')
      .find((line) => line.startsWith('data: ')) as string;
    const parsed = JSON.parse(dataLine.slice('data: '.length)) as { payload: { text: string } };
    expect(parsed.payload.text).toBe('first\nsecond');
  });

  it('opens a stream with a comment frame, so a quiet stream looks alive', () => {
    expect(OPEN_COMMENT.startsWith(':')).toBe(true);
    expect(OPEN_COMMENT.endsWith('\n\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The resume
// ---------------------------------------------------------------------------

describe('the resume', () => {
  it('starts from the beginning when nothing is asked for', () => {
    expect(resumeFrom(undefined, undefined)).toBe(0);
  });

  it('resumes from the header', () => {
    expect(resumeFrom('42', undefined)).toBe(42);
  });

  it('resumes from the query parameter when there is no header', () => {
    expect(resumeFrom(undefined, '42')).toBe(42);
  });

  it('lets the header win over the query parameter', () => {
    // The header is what the browser sends, and it is the more
    // specific statement.
    expect(resumeFrom('10', '20')).toBe(10);
  });

  it('treats a malformed resume as no resume, rather than as a fatal error', () => {
    // A malformed resume must not break the stream — it must start
    // from the beginning.
    expect(resumeFrom('not-a-number', undefined)).toBe(0);
    expect(resumeFrom('-1', undefined)).toBe(0);
    expect(resumeFrom('1.5', undefined)).toBe(0);
  });

  it('ignores a query value that is not a string', () => {
    expect(resumeFrom(undefined, 42)).toBe(0);
    expect(resumeFrom(undefined, ['42'])).toBe(0);
  });

  it('names the header and the query the way the pack does', () => {
    expect(LAST_EVENT_ID_HEADER).toBe('last-event-id');
    expect(LAST_EVENT_ID_QUERY).toBe('lastEventId');
  });
});

// ---------------------------------------------------------------------------
// The class filter
// ---------------------------------------------------------------------------

describe('the class filter', () => {
  it('carries all six when nothing is asked for', () => {
    expect(carriedClasses(undefined)).toEqual(STREAM_CLASSES);
  });

  it('carries all six when the requested list is empty', () => {
    expect(carriedClasses([])).toEqual(STREAM_CLASSES);
  });

  it('carries only the classes that were asked for', () => {
    expect(carriedClasses(['task.updated', 'approval.requested'])).toEqual([
      'task.updated',
      'approval.requested',
    ]);
  });

  it('refuses an unknown class by omission, not by refusing the request', () => {
    // A typo must not take down a dashboard's live view.
    expect(carriedClasses(['task.updated', 'not.a.class'])).toEqual(['task.updated']);
  });

  it('carries all six when the request names only unknown classes', () => {
    // Refusing the request would be worse than carrying the default.
    expect(carriedClasses(['not.a.class'])).toEqual(STREAM_CLASSES);
  });

  it('reads a comma-separated class list from the query', () => {
    expect(readRequestedClasses({ classes: 'task.updated,approval.requested' })).toEqual([
      'task.updated',
      'approval.requested',
    ]);
  });

  it('trims the entries and drops the empty ones', () => {
    expect(readRequestedClasses({ classes: ' task.updated , , review.queued ' })).toEqual([
      'task.updated',
      'review.queued',
    ]);
  });

  it('reads no classes when the query carries none', () => {
    expect(readRequestedClasses({})).toBeUndefined();
    expect(readRequestedClasses({ classes: '' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The live route
// ---------------------------------------------------------------------------

/**
 * The frames a live stream produced.
 */
interface StreamReading {
  /** The status the stream answered with. */
  readonly status: number;
  /** The response's headers. */
  readonly headers: Record<string, string | string[] | undefined>;
  /** The body, up to the moment the client hung up. */
  readonly body: string;
}

/**
 * Read a live SSE stream over a **real socket**.
 *
 * ## Why a real socket, and not `inject`
 *
 * `inject` waits for the response to **complete**. The stream's whole
 * purpose is that it does not complete — it holds the connection for as
 * long as the client is there. So `inject` would wait for ever, and a
 * test built on it would prove nothing about the stream.
 *
 * So the test listens for real, reads the frames as they arrive, and
 * hangs up when it has seen enough. The hang-up is also what proves
 * the route's own termination: the server's loop must stop when the
 * client goes away, or the process would leak a poller per client.
 */
const readStream = async (
  harness: Harness,
  options: {
    readonly headers?: Record<string, string>;
    readonly query?: Record<string, string>;
    readonly expectFrames: number;
    readonly expectStatus?: number;
  },
): Promise<StreamReading> => {
  const base = await harness.listen();
  const url = new URL('/v1/stream', base);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const response = await fetch(url, {
    headers: options.headers ?? cliHeaders(harness),
    signal: controller.signal,
  });

  if (options.expectStatus !== undefined) {
    // A refusal has a body and ends by itself.
    const body = await response.text();
    await harness.close();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }

  // The frames, as they arrive.
  const reader = response.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  expect(reader).toBeDefined();
  const decoder = new TextDecoder();
  let body = '';
  let seen = 0;

  try {
    while (seen < options.expectFrames) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) {
        break;
      }
      body += decoder.decode(chunk.value, { stream: true });
      seen = body.split('data: ').length - 1;
    }
  } finally {
    // Hang up. The server's loop must stop on its own.
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }

  const headers = Object.fromEntries(response.headers.entries());
  await harness.close();
  return { status: response.status, headers, body };
};

describe('GET /v1/stream — the live route', () => {
  it('answers with the text/event-stream content type', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    const result = await readStream(harness, { expectFrames: 1 });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('text/event-stream');
  });

  it('tells a proxy not to buffer the response', async () => {
    // Without this, a batching proxy would hold every event until the
    // connection closed — the classic SSE-behind-a-proxy failure.
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    const result = await readStream(harness, { expectFrames: 1 });
    expect(result.headers['x-accel-buffering']).toBe('no');
  });

  it('carries the six classes with the id as the seq', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    harness.stream.push(rawEvent(2, 'approval.requested'));
    harness.stream.push(rawEvent(3, 'review.queued'));
    harness.stream.push(rawEvent(4, 'gate.failed'));
    harness.stream.push(rawEvent(5, 'model.requested'));
    harness.stream.push(rawEvent(6, 'kill.switch.engaged'));
    const result = await readStream(harness, { expectFrames: 6 });
    expect(result.body).toContain('id: 1\n');
    expect(result.body).toContain('event: task.updated\n');
    expect(result.body).toContain('event: approval.requested\n');
    expect(result.body).toContain('event: review.queued\n');
    expect(result.body).toContain('event: health.changed\n');
    expect(result.body).toContain('event: cost.updated\n');
    expect(result.body).toContain('event: killswitch.changed\n');
  });

  it('opens the stream with the comment frame', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    const result = await readStream(harness, { expectFrames: 1 });
    expect(result.body.startsWith(OPEN_COMMENT)).toBe(true);
  });

  it('does not carry an event type the stream does not map', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'tool.invoked'));
    harness.stream.push(rawEvent(2, 'stage.completed'));
    const result = await readStream(harness, { expectFrames: 1 });
    expect(result.body).not.toContain('tool.invoked');
    expect(result.body).toContain('id: 2\n');
  });

  it('resumes from the Last-Event-ID header and does not replay', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    harness.stream.push(rawEvent(2, 'stage.completed'));
    harness.stream.push(rawEvent(3, 'stage.completed'));
    const result = await readStream(harness, {
      headers: { ...cliHeaders(harness), 'last-event-id': '2' },
      expectFrames: 1,
    });
    expect(result.body).toContain('id: 3\n');
    expect(result.body).not.toContain('id: 1\n');
    expect(result.body).not.toContain('id: 2\n');
  });

  it('resumes from the lastEventId query parameter', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    harness.stream.push(rawEvent(2, 'stage.completed'));
    const result = await readStream(harness, {
      query: { lastEventId: '1' },
      expectFrames: 1,
    });
    expect(result.body).toContain('id: 2\n');
    expect(result.body).not.toContain('id: 1\n');
  });

  it('lets the header win over the query parameter', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    harness.stream.push(rawEvent(2, 'stage.completed'));
    harness.stream.push(rawEvent(3, 'stage.completed'));
    const result = await readStream(harness, {
      headers: { ...cliHeaders(harness), 'last-event-id': '2' },
      query: { lastEventId: '1' },
      expectFrames: 1,
    });
    expect(result.body).toContain('id: 3\n');
    expect(result.body).not.toContain('id: 1\n');
  });

  it('carries only the classes the request asked for', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    harness.stream.push(rawEvent(2, 'approval.requested'));
    const result = await readStream(harness, {
      query: { classes: 'approval.requested' },
      expectFrames: 1,
    });
    expect(result.body).toContain('event: approval.requested\n');
    expect(result.body).not.toContain('event: task.updated\n');
  });

  it('serves a browser session as well as a CLI token', async () => {
    const harness = await buildHarness();
    harness.stream.push(rawEvent(1, 'stage.completed'));
    const result = await readStream(harness, {
      headers: browserHeaders(harness),
      expectFrames: 1,
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('id: 1\n');
  });

  it('refuses an unauthenticated caller', async () => {
    const harness = await buildHarness();
    const result = await readStream(harness, {
      headers: {},
      expectFrames: 0,
      expectStatus: 401,
    });
    expect(result.status).toBe(401);
  });

  it('refuses a token without the inspect scope', async () => {
    // The route is inspect-scoped — a token without it gets no stream.
    const harness = await buildHarness({ scopes: ['define-intent'] });
    harness.stream.push(rawEvent(1, 'stage.completed'));
    const result = await readStream(harness, {
      expectFrames: 0,
      expectStatus: 403,
    });
    expect(result.status).toBe(403);
  });
});
