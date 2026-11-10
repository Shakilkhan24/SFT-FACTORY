/**
 * `projections/fakes` — the doubles (T-1.15).
 *
 * AGENTS.md §4: "fakes live in the package's own `fakes` directory and must
 * pass the same contract tests as the real thing (I-12)".
 *
 * So the doubles here are not stubs that return `undefined` — they are
 * working implementations, and the **contract test** in
 * `tests/unit/projections-contract.test.ts` runs the *same* suite
 * against the in-memory store and the Postgres store, so the two cannot
 * drift.
 *
 * ## The event source's `read` is **exclusive** of `afterSeq**
 *
 * That is the one behaviour the projector depends on, and it is the
 * behaviour a naive double gets wrong: a double that returns the event
 * at `afterSeq` would make the projector apply the same event twice —
 * and, with an accumulating projection, double its figures.
 *
 * So the fake **records** what it handed out, and the crash test uses
 * that record to prove the projector really did re-read the events it
 * had already applied. A double that hid the replay would make the
 * crash test vacuous.
 */

import type { EventEnvelope } from '@factory/contracts';

import type { EventSource, LogEvent } from '../ports.js';
import { InMemoryCursorPositions } from '../scratch-store.js';

/**
 * An in-memory event source.
 *
 * The events are the ones the test appends. `read` returns them in
 * `seq` order, starting **after** `afterSeq`.
 */
export class InMemoryEventSource implements EventSource {
  private readonly events: LogEvent[] = [];

  /**
   * How many events have been handed out.
   *
   * A test asserts that the projector read the log **once** — the
   * projector resumes from the cursor, so a second full read would mean
   * the cursor was not honoured.
   */
  public reads = 0;

  /**
   * The sequence numbers handed out, in order.
   */
  public readonly handedOut: number[] = [];

  /**
   * Append an event.
   *
   * The event's `seq` is assigned by the source — the log's sequence is
   * gapless and increasing, and the fake reproduces that.
   */
  public append(event: Omit<LogEvent, 'seq'> & { readonly seq?: number }): LogEvent {
    const seq = event.seq ?? this.events.length + 1;
    const row: LogEvent = { ...event, seq };
    this.events.push(row);
    // The events are kept in `seq` order, whatever order they were
    // appended in — the log's sequence is the order.
    this.events.sort((left, right) => left.seq - right.seq);
    return row;
  }

  /**
   * Append an event built from the contracts' envelope shape.
   *
   * The convenience the tests use: it fills in the fields the projector
   * does not read, so a test says only what it means.
   */
  public appendEnvelope(event: {
    readonly eventId: string;
    readonly occurredAt: string;
    readonly eventType: string;
    readonly aggregate?: { readonly kind: string; readonly id: string; readonly version?: number };
    readonly correlationId?: string;
    readonly actor?: { readonly kind: string; readonly id: string };
    readonly authority?: Readonly<Record<string, unknown>>;
    readonly subject?: Readonly<Record<string, unknown>>;
    readonly payload?: unknown;
    readonly costUsdMicros?: number;
  }): LogEvent {
    return this.append({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      aggregate: {
        kind: event.aggregate?.kind ?? 'task',
        id: event.aggregate?.id ?? 'tsk_unknown',
        version: event.aggregate?.version ?? 0,
      },
      correlationId: event.correlationId ?? 'corr_unknown',
      actor: event.actor ?? { kind: 'system', id: 'projector-test' },
      authority: event.authority ?? { basis: 'system-rule' },
      subject: event.subject ?? {},
      payload: event.payload ?? {},
      context: { items: [] },
      redaction: { applied: [] },
      ...(event.costUsdMicros === undefined ? {} : { costUsdMicros: event.costUsdMicros }),
    });
  }

  public read(afterSeq: number, limit: number): Promise<readonly LogEvent[]> {
    this.reads += 1;

    const page = this.events
      .filter((event) => event.seq > afterSeq)
      .slice(0, limit);

    for (const event of page) {
      this.handedOut.push(event.seq);
    }

    return Promise.resolve(page);
  }

  /**
   * Every event the source holds.
   */
  public all(): readonly LogEvent[] {
    return this.events;
  }
}

/**
 * An in-memory cursor store.
 *
 * It is the package's own `InMemoryCursorPositions` under the name the
 * fakes use — one implementation, so a test that hands this to a store
 * and a test that hands the package's version to a store are running
 * the same code.
 */
export class InMemoryCursorStore extends InMemoryCursorPositions {}

/**
 * An event source that **fails** on the `afterSeq` it is given.
 *
 * The double for the crash test: the projector resumes from a cursor
 * that is **behind** the rows it already wrote, so it re-reads the
 * events it already applied. The rows must come out the same.
 */
export class ReplayingEventSource implements EventSource {
  private readonly inner: InMemoryEventSource;

  /**
   * How many times the same sequence was handed out.
   */
  public replays = 0;

  public constructor(inner: InMemoryEventSource) {
    this.inner = inner;
  }

  public async read(afterSeq: number, limit: number): Promise<readonly LogEvent[]> {
    const page = await this.inner.read(afterSeq, limit);
    for (const event of page) {
      if (this.inner.handedOut.filter((seq) => seq === event.seq).length > 1) {
        this.replays += 1;
      }
    }
    return page;
  }
}

/**
 * A helper that builds an `EventEnvelope` from a log row.
 *
 * The doubles speak in `LogEvent`s; the reducers speak in envelopes. The
 * projector does the conversion, so the tests do not need this — it is
 * here for a test that wants to call a reducer directly.
 */
export const envelopeOf = (event: LogEvent): EventEnvelope =>
  event as unknown as EventEnvelope;
