/**
 * `dashboard/timeline-events` — the timeline's parse (T-1.16).
 *
 * ## Why this is a separate module
 *
 * The parse is **pure** — it maps the API's events onto the timeline's
 * shape and touches no React. So it lives in a `.ts` module, where it
 * can be unit-tested without a JSX transform, and `timeline.tsx` holds
 * only the component.
 *
 * ## The parse is total
 *
 * A field of the wrong type is **dropped**, not crashed on. The API's
 * events are the projections' rows, and the projections' shapes are not
 * the dashboard's business — so the dashboard reads what is there and
 * renders what it can.
 *
 * ## The actor is flattened
 *
 * The actor is `{kind, id}` — a human's id, a service's id. The kind
 * is worth showing, because "a human approved this" and "the scheduler
 * approved this" are very different things, and the timeline is where
 * an operator looks to find out which happened.
 */

/**
 * One event on the timeline.
 */
export interface TimelineEvent {
  /** The log's sequence number. */
  readonly seq?: number;
  /** The event's type. */
  readonly eventType?: string;
  /** When it happened. */
  readonly occurredAt?: string;
  /** Who did it. */
  readonly actor?: string;
  /** The correlation id — what ties it back to the log. */
  readonly correlationId?: string;
  /** A one-line summary. */
  readonly detail?: string;
}

/**
 * Read a string out of an unknown value.
 */
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Read a number out of an unknown value.
 */
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * The actor, as a string.
 *
 * The actor is `{kind, id}` — a human's id, a service's id. The kind is
 * worth showing, because "a human approved this" and "the scheduler
 * approved this" are very different things.
 */
export const actorOf = (value: unknown): string | undefined => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Readonly<Record<string, unknown>>;
    const id = str(record['id']);
    const kind = str(record['kind']);
    if (id === undefined) {
      return undefined;
    }
    return kind === undefined ? id : `${kind}:${id}`;
  }
  return str(value);
};

/**
 * Parse the API's events into the timeline's shape.
 */
export const parseTimelineEvents = (
  items: readonly Readonly<Record<string, unknown>>[],
): readonly TimelineEvent[] =>
  items.map((item) => {
    const eventType =
      str(item['eventType']) ?? str(item['type']) ?? str(item['event_type']);
    const actor = actorOf(item['actor']);
    return {
      ...(num(item['seq']) === undefined ? {} : { seq: num(item['seq']) as number }),
      ...(eventType === undefined ? {} : { eventType }),
      ...(str(item['occurredAt']) === undefined
        ? {}
        : { occurredAt: str(item['occurredAt']) as string }),
      ...(actor === undefined ? {} : { actor }),
      ...(str(item['correlationId']) === undefined
        ? {}
        : { correlationId: str(item['correlationId']) as string }),
      ...(str(item['detail']) === undefined ? {} : { detail: str(item['detail']) as string }),
    };
  });
