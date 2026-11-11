/**
 * `dashboard/stream` — the live update channel (T-1.16).
 *
 * ## What the dashboard listens to
 *
 * pack `04` §3: "`GET /v1/stream` — SSE: `task.updated`,
 * `approval.requested`, `review.queued`, `health.changed`,
 * `cost.updated`, `killswitch.changed`; `id:` = event `seq` for
 * `Last-Event-ID` resume."
 *
 * So the dashboard opens one `EventSource` on `/v1/stream` and listens
 * for those six event names.
 *
 * ## Why the resume is the browser's job
 *
 * The `id:` on each frame is the log's `seq`, and the browser's
 * `EventSource` sends the last id it saw back as `Last-Event-ID` when
 * it reconnects. So the resume needs no code here — the browser does it
 * — and this module only has to **not** break it. The one thing that
 * would break it is a proxy that buffers the stream, which is why the
 * API sends `x-accel-buffering: no`.
 *
 * ## The channel is a value, not a subscription
 *
 * `openStream` returns a **channel** — an object with a `close`. The
 * React layer holds it in a ref and closes it on unmount. A subscription
 * with a hidden `unsubscribe` would be a leak every time the component
 * re-rendered.
 *
 * ## The events are re-fetched, not patched
 *
 * An event says *something changed*; it does not carry the new state.
 * So the handler asks the API for the overview again. That is one extra
 * request per change, and it is the right trade: a patch protocol would
 * have to keep the projection's row shapes in the dashboard, and those
 * are the projections' business, not the dashboard's.
 */

import { API_BASE } from './api.js';

/**
 * The six event classes the stream carries.
 *
 * pack `04` §3's list, in the pack's order.
 */
export const STREAM_CLASSES: readonly string[] = [
  'task.updated',
  'approval.requested',
  'review.queued',
  'health.changed',
  'cost.updated',
  'killswitch.changed',
];

/**
 * The channel a live stream hands back.
 */
export interface StreamChannel {
  /** Close the stream. */
  readonly close: () => void;
}

/**
 * The `EventSource`-shaped constructor.
 *
 * Declared structurally so the browser's `EventSource` satisfies it
 * without a cast, and so a test can supply one.
 */
export type EventSourceLike = {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  close(): void;
  readonly readyState?: number;
};

/**
 * The `EventSource` constructor.
 */
export type EventSourceFactory = (url: string) => EventSourceLike;

/**
 * Open the live stream.
 *
 * @param onChange called when any of the six classes arrives
 * @param options the options
 */
export const openStream = (
  onChange: (eventType: string) => void,
  options: {
    readonly base?: string;
    readonly createEventSource?: EventSourceFactory;
  } = {},
): StreamChannel => {
  const base = options.base ?? API_BASE;
  const create =
    options.createEventSource ??
    ((url: string): EventSourceLike => new EventSource(url) as unknown as EventSourceLike);

  const source = create(`${base}/stream`);

  for (const eventType of STREAM_CLASSES) {
    source.addEventListener(eventType, () => {
      onChange(eventType);
    });
  }

  return {
    close: () => {
      source.close();
    },
  };
};
