/**
 * `projections/postgres-event-source` — reading the log (T-1.15).
 *
 * ## The adapter is thin on purpose
 *
 * `packages/eventlog`'s `PostgresEventLog.read` already does what the
 * projector needs: it takes an **exclusive** `afterSeq`, orders by
 * `seq`, and yields the envelopes. So the adapter is a loop, not a
 * re-implementation.
 *
 * The port returns a plain array rather than an async iterable,
 * because the projector needs the **whole batch** before it commits —
 * a batch is committed in one transaction, so it must be in hand.
 *
 * ## The projector reads through the **projector** role
 *
 * pack `03` §2: "GRANT SELECT ON events TO factory_projector; --
 * projector reads the log, never writes it". So the connection the
 * projector uses carries that role, and this adapter can only read.
 */

import type { PostgresEventLog } from '@factory/eventlog';

import type { EventSource, LogEvent } from './ports.js';

/**
 * The event source backed by the real log.
 */
export class PostgresEventSource implements EventSource {
  private readonly log: PostgresEventLog;

  public constructor(log: PostgresEventLog) {
    this.log = log;
  }

  public async read(afterSeq: number, limit: number): Promise<readonly LogEvent[]> {
    const events: LogEvent[] = [];

    for await (const event of this.log.read({ afterSeq, limit })) {
      events.push({
        seq: event.seq,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        eventType: event.eventType,
        aggregate: {
          kind: event.aggregate.kind,
          id: event.aggregate.id,
          version: event.aggregate.version,
        },
        correlationId: event.correlationId,
        actor: { kind: event.actor.kind, id: event.actor.id },
        authority: event.authority as Readonly<Record<string, unknown>>,
        subject: event.subject as Readonly<Record<string, unknown>>,
        payload: event.payload,
        context: event.context as Readonly<Record<string, unknown>>,
        redaction: { applied: event.redaction.applied },
        ...(event.costUsdMicros === undefined ? {} : { costUsdMicros: event.costUsdMicros }),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      });
    }

    return events;
  }
}
