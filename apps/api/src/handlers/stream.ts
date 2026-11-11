/**
 * `api/handlers/stream` — the **real** `GET /v1/stream` (T-1.16).
 *
 * ## What this replaces
 *
 * T-1.14 shipped a **stub** for `/v1/stream` that refused with `501`.
 * The stub's own comment said its event classes "come from the
 * projections" — and T-1.15 has now built the projections. So the
 * stream is implementable, and this ticket implements it.
 *
 * ## The SSE framing
 *
 * pack `04` §3: "`id:` = event `seq` for `Last-Event-ID` resume."
 *
 * So each event is framed as:
 *
 * ```text
 * id: 42
 * event: task.updated
 * data: {"seq":42,"eventType":"stage.completed",...}
 *
 * ```
 *
 * The **blank line** terminates the event. It is part of the format, not
 * decoration: a client that does not see it keeps reading the previous
 * event's data.
 *
 * ## The framing is **pure**
 *
 * `frameEvent` takes an event and returns a string. So the framing can
 * be tested without a server — and the framing is where the two
 * load-bearing rules live:
 *
 * 1. **`id:` is the `seq`** — so a resume from `Last-Event-ID` cannot
 *    miss an event. If the `id:` were the timestamp or the event's id,
 *    a resume would be meaningless.
 * 2. **`event:` is the class** — so a client can subscribe to one
 *    class with `addEventListener('approval.requested', …)` and not
 *    parse the payload to find out what it is.
 *
 * ## The resume
 *
 * `Last-Event-ID` is the browser's header; the `?lastEventId=` query
 * parameter is the same thing for a client that cannot set a header
 * (`EventSource` cannot set headers, so a browser's `EventSource`
 * relies on the browser's own `Last-Event-ID` — which the browser
 * does send automatically on reconnect).
 *
 * The header wins over the query parameter: the header is what the
 * browser sends, and it is the more specific statement.
 *
 * ## The loop
 *
 * The handler polls the source at the cursor and writes each event as
 * it arrives. The poll interval is **injected** — AGENTS.md §4: "Time
 * via an injected `Clock`" — so a test does not have to wait a second
 * to see an event.
 *
 * The loop ends when the connection closes. Fastify's `reply.raw` is the
 * Node response, and its `close` event is the signal.
 */

import type { RouteHandler } from '../app.js';
import type { ApiDeps } from '../ports.js';
import { hijacked } from '../ports.js';
import type { ClassifiedEvent, StreamSource } from '../stream.js';
import { STREAM_CLASSES } from '../stream.js';

/**
 * The header a browser sends when it resumes a stream.
 */
export const LAST_EVENT_ID_HEADER = 'last-event-id';

/**
 * The query parameter a client that cannot set a header uses.
 */
export const LAST_EVENT_ID_QUERY = 'lastEventId';

/**
 * The default poll interval, in milliseconds.
 *
 * One second. The stream is a **notification** channel, not the source
 * of truth — the client re-reads the API when it is told something
 * changed. So the interval is a latency budget, not a correctness
 * bound, and it is injected anyway so a test need not wait for it.
 */
export const DEFAULT_POLL_INTERVAL_MS = 1_000;

/**
 * The options for the stream.
 */
export interface StreamOptions {
  /**
   * The source the events come from.
   *
   * Optional: it defaults to the app's own `stream` port. The option
   * exists so a test can hand the handler a source of its own without
   * replacing the port on the dependencies.
   */
  readonly source?: StreamSource;
  /** How long to wait between polls, in milliseconds. */
  readonly pollIntervalMs?: number;
  /** The classes to carry. Defaults to all six. */
  readonly classes?: readonly string[];
}

/**
 * Frame one event as an SSE message.
 *
 * The `data:` payload is the event's JSON. The JSON is produced with
 * `JSON.stringify` on a **fixed** shape — the same fields every time —
 * so a client can rely on it.
 *
 * The payload's own data is **not** escaped by hand: `JSON.stringify`
 * handles it, and a hand-rolled escape is the classic way to break an
 * SSE stream.
 */
export const frameEvent = (event: ClassifiedEvent): string => {
  const data = JSON.stringify({
    seq: event.seq,
    eventType: event.eventType,
    class: event.class,
    aggregate: event.aggregate,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
  return `id: ${String(event.seq)}\nevent: ${event.class}\ndata: ${data}\n\n`;
};

/**
 * The comment that opens a stream.
 *
 * A comment frame — it tells the client the connection is live without
 * carrying an event. Some clients wait for the first byte before they
 * consider the connection established, so the comment is what makes a
 * quiet stream look alive.
 */
export const OPEN_COMMENT = `: factory stream open\n\n`;

/**
 * The sequence to resume from.
 *
 * The header wins over the query parameter, and both are parsed
 * leniently: a `Last-Event-ID` that is not a number is treated as
 * **no** resume rather than as a fatal error, because a malformed
 * resume must not break the stream — it must start from the beginning.
 */
export const resumeFrom = (
  headerValue: string | undefined,
  queryValue: unknown,
): number => {
  const raw = headerValue ?? (typeof queryValue === 'string' ? queryValue : undefined);
  if (raw === undefined) {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

/**
 * The classes the stream carries.
 *
 * An unknown class in the request is **refused by omission** — the
 * stream carries the six the pack names, and a class nobody knows is
 * not carried. The alternative — refusing the request — would let a
 * typo take down a dashboard's live view.
 */
export const carriedClasses = (
  requested: readonly string[] | undefined,
): readonly string[] => {
  if (requested === undefined || requested.length === 0) {
    return STREAM_CLASSES;
  }
  const carried = STREAM_CLASSES.filter((cls) => requested.includes(cls));
  return carried.length === 0 ? STREAM_CLASSES : carried;
};

/**
 * Read a requested class list from the query.
 *
 * `?classes=task.updated,approval.requested` — a comma-separated
 * list. An absent query means all six.
 */
export const readRequestedClasses = (
  query: Readonly<Record<string, unknown>>,
): readonly string[] | undefined => {
  const raw = query['classes'];
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

/**
 * Build the stream handler.
 *
 * The handler writes to `reply.raw` — Fastify's reply is built for a
 * single body, and an SSE stream is a sequence of frames over a
 * long-lived connection. So the handler **hijacks** the reply: it
 * writes the headers itself, starts the poll loop, and returns
 * immediately. Fastify then sends no body and does not wait for the
 * loop — which is exactly what a long-lived connection needs.
 *
 * ## Why the loop is detached
 *
 * If the handler awaited the loop, Fastify would wait for the stream
 * to finish — and the stream only finishes when the client goes away.
 * So the reply would never be considered sent, and the connection
 * would be held in a way that no client can use. The loop therefore
 * runs **after** the handler has returned, and stops when the raw
 * response emits `close`.
 *
 * ## The write is guarded
 *
 * A write to a closed socket throws. So the loop checks `closed`
 * before each write, and the write itself is guarded — a stream that
 * throws on a dead socket would take down the process.
 *
 * @param deps the app's dependencies
 * @param options the stream's options
 */
export const streamEvents = (
  deps: ApiDeps,
  options: StreamOptions = {},
): RouteHandler => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const source = options.source ?? deps.stream;

  return (ctx): ReturnType<typeof hijacked> => {
    const response = ctx.reply.raw;

    // The hijack. Fastify is told that the reply is the handler's
    // own, so it sends no body and waits for nothing.
    ctx.reply.hijack();

    // ---- the headers ------------------------------------------------
    //
    // `text/event-stream` is what makes the browser's `EventSource`
    // work at all — it is the content type that says "this is a
    // stream, not a document".
    //
    // `X-Accel-Buffering: no` tells a reverse proxy not to buffer the
    // response. Without it, a proxy that batches would hold the events
    // until the connection closed — and the stream would deliver every
    // event at once, at the end. That is the classic SSE-behind-a-proxy
    // failure.
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const classes = carriedClasses(options.classes ?? readRequestedClasses(ctx.query));
    const afterSeq = resumeFrom(
      headerValueOf(ctx.request.headers, LAST_EVENT_ID_HEADER),
      ctx.query[LAST_EVENT_ID_QUERY],
    );

    response.write(OPEN_COMMENT);

    let cursor = afterSeq;
    let closed = false;

    const onClose = (): void => {
      closed = true;
    };
    response.on('close', onClose);

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    /**
     * Write a frame, unless the connection is gone.
     *
     * A write to a closed socket throws — `ERR_STREAM_DESTROYED` — and
     * an unhandled throw in a detached loop would take the process
     * down. So the write is guarded, and a failed write ends the
     * stream.
     */
    const write = (chunk: string): boolean => {
      if (closed) {
        return false;
      }
      try {
        response.write(chunk);
        return true;
      } catch {
        closed = true;
        return false;
      }
    };

    /**
     * The poll loop.
     *
     * It ends when the connection closes. Each pass reads the source
     * from the cursor, writes the events it carries, and advances the
     * cursor to the last one written — so the next pass reads only
     * what is new.
     */
    const pump = async (): Promise<void> => {
      try {
        while (!closed) {
          let wrote = false;
          for await (const event of source.subscribe(cursor)) {
            if (closed) {
              break;
            }
            if (!classes.includes(event.class)) {
              // A class nobody asked for. The cursor still advances —
              // the event is behind the cursor whether or not it was
              // carried, and re-reading it would deliver it later.
              cursor = Math.max(cursor, event.seq);
              continue;
            }
            if (!write(frameEvent(event))) {
              break;
            }
            cursor = Math.max(cursor, event.seq);
            wrote = true;
          }
          if (closed) {
            break;
          }
          if (!wrote) {
            // Nothing new. Wait before asking again — a tight loop
            // would spin the CPU for a quiet factory.
            await sleep(pollIntervalMs);
          }
        }
      } finally {
        response.off('close', onClose);
      }
    };

    // The loop is detached. The handler returns now; the loop stops
    // when the connection closes.
    void pump();

    // Fastify must not try to send a body.
    return hijacked(undefined, 200);
  };
};

/**
 * A header's value, or `undefined`.
 *
 * A header may arrive as a list — `set-cookie` does — so the first
 * entry is taken when it does.
 */
const headerValueOf = (
  headers: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined => {
  const value = headers[name];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
};

/**
 * The stream source for the app.
 *
 * The port is **injected** through the app's dependencies, so the API
 * does not reach into the event log on its own — and a test can hand
 * it a source of its own.
 *
 * The `ApiDeps` type is extended by T-1.16 with the `stream` port.
 */
export const streamDeps = (deps: ApiDeps): StreamSource => deps.stream;
