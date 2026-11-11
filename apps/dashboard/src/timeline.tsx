/**
 * `dashboard/timeline` — the task timeline (T-1.16).
 *
 * ## What it shows
 *
 * One task's events, in order, with the event's type, its time, and —
 * for the ones that matter to a human — its actor and its correlation
 * id. The correlation id is what ties the timeline back to the log, so
 * an operator reading a timeline can go and read the chain.
 *
 * ## Why it is a component and not a function
 *
 * It is a component because it is **interactive**: clicking a task opens
 * its timeline. That is the second click of the ≤2-click promise (NFR-07)
 * — the first is recognising the item in "Needs you".
 *
 * ## The events are the API's
 *
 * `GET /v1/tasks/{id}/events` returns them. The dashboard does not
 * reconstruct them from the log — the log is behind the projections, and
 * the projections are not the dashboard's business.
 *
 * The **parse** lives in `timeline-events.ts`, because it is pure and
 * belongs where it can be unit-tested without a JSX transform.
 */

import { useEffect, useState } from 'react';

import type { ApiClient } from './api.js';
import { formatAge } from './api.js';
import { parseTimelineEvents, type TimelineEvent } from './timeline-events.js';

/**
 * The timeline's props.
 */
export interface TimelineProps {
  /** The task whose timeline to show. */
  readonly taskId: string;
  /** The client to read it with. */
  readonly client: ApiClient;
  /** The moment to measure ages against — injected. */
  readonly now: Date;
  /** Called when the timeline is closed. */
  readonly onClose: () => void;
}

/**
 * The task timeline.
 */
export const Timeline = (props: TimelineProps): React.JSX.Element => {
  const { taskId, client, now, onClose } = props;
  const [events, setEvents] = useState<readonly TimelineEvent[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .taskEvents(taskId)
      .then((items) => {
        if (!cancelled) {
          setEvents(parseTimelineEvents(items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, taskId]);

  return (
    <section className="timeline" data-testid="timeline" aria-label={`timeline for ${taskId}`}>
      <header className="timeline__header">
        <h2 className="timeline__title">{taskId}</h2>
        <button
          type="button"
          className="timeline__close"
          data-testid="timeline-close"
          onClick={onClose}
        >
          close
        </button>
      </header>
      {failed ? (
        <p className="timeline__empty" data-testid="timeline-failed">
          the timeline could not be read
        </p>
      ) : null}
      {!failed && events.length === 0 ? (
        <p className="timeline__empty" data-testid="timeline-empty">
          no events yet
        </p>
      ) : null}
      <ol className="timeline__events" data-testid="timeline-events">
        {events.map((event, index) => (
          <li className="timeline__event" key={`${String(event.seq ?? index)}`}>
            <span className="timeline__seq">{event.seq ?? ''}</span>
            <span className="timeline__type">{event.eventType ?? 'unknown'}</span>
            <span className="timeline__age">{formatAge(event.occurredAt, now)}</span>
            {event.actor === undefined ? null : (
              <span className="timeline__actor">{event.actor}</span>
            )}
            {event.correlationId === undefined ? null : (
              <span className="timeline__correlation">{event.correlationId}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};
