/**
 * `api/stream` — the **event stream's** source and its vocabulary (T-1.16).
 *
 * ## What the pack asks for
 *
 * pack `04` §3, AP-4: "`GET /v1/stream` — **SSE**: `task.updated`,
 * `approval.requested`, `review.queued`, `health.changed`,
 * `cost.updated`, `killswitch.changed`; `id:` = event `seq` for
 * `Last-Event-ID` resume."
 *
 * So the stream carries **six classes**, and the sixth is
 * `killswitch.changed` — spelled in one word. The pack's spelling is
 * kept exactly, because a client that has to guess whether the class is
 * `kill-switch.changed` or `killswitch.changed` cannot subscribe to it.
 *
 * ## The mapping is the substance
 *
 * The log's vocabulary is `intent.recorded`, `stage.completed`,
 * `gate.failed`, `approval.requested` — **sixty-odd** types. The
 * stream's is six. So there must be a **mapping**, and the mapping is
 * where the meaning is.
 *
 * The mapping is **pure** and it is exported, so it can be tested
 * without a server, a log, or a browser. That is deliberate: a
 * classification rule that is only exercised through a live stream is a
 * rule nobody can review.
 *
 * ## The mapping is **many-to-one**, and that is the point
 *
 * `task.updated` covers eleven event types, because a human watching
 * the dashboard cares about "this task moved", not about which of the
 * eleven kinds of moving it was. The dashboard's regions are the ones
 * that care about the difference — and they read the **projections**,
 * not the stream. The stream is a *signal to go and look*, not a
 * substitute for looking.
 *
 * So: **the stream says "something changed"; the API says what.**
 *
 * ## No `LISTEN`
 *
 * blueprint `02` §4.18 says the projector is "woken by `LISTEN`", and
 * T-1.15's escalation recorded that the projector **polls** instead.
 * The stream polls too, at the cursor — the same mechanism. A `LISTEN`
 * needs a dedicated connection held open for the life of the process,
 * and that belongs to the worker's ticket, not this one.
 *
 * The polling is a **latency** property, not a correctness one: the
 * stream's `id:` is the log's `seq`, so a resume from `Last-Event-ID`
 * cannot miss an event even if the poll is late.
 */

/**
 * The six stream event classes.
 *
 * pack `04` §3's list, in the pack's order and the pack's spelling.
 */
export const STREAM_CLASSES = [
  'task.updated',
  'approval.requested',
  'review.queued',
  'health.changed',
  'cost.updated',
  'killswitch.changed',
] as const;

/**
 * A stream event class.
 */
export type StreamClass = (typeof STREAM_CLASSES)[number];

/**
 * Is this one of the six classes?
 */
export const isStreamClass = (value: string): value is StreamClass =>
  (STREAM_CLASSES as readonly string[]).includes(value);

/**
 * The event types that map to each class.
 *
 * ## The mapping, class by class
 *
 * **`task.updated`** — the task moved. The intake, the specification,
 * the plan, the execution and the integration types: everything that
 * changes what a task *is*. A dashboard watching a task wants to know
 * that it moved, not why.
 *
 * **`approval.requested`** — exactly one type. An approval is not a
 * task event; it is a request *to a human*, and the dashboard's "Needs
 * you" region is built from it. So it gets its own class rather than
 * being buried in `task.updated` — a human must be able to subscribe
 * to "things waiting for me" alone.
 *
 * **`review.queued`** — the review types. A review is the other request
 * to a human, and it has the same standing.
 *
 * **`health.changed`** — the gate, policy, budget and drift types. These
 * are the signals that say the factory is not working properly. They
 * are **not** task events: a failing gate is a property of the factory,
 * not of the task it happened to happen on.
 *
 * **`cost.updated`** — the cost-bearing types. The money is its own
 * class because it is read on a different clock (hourly, per blueprint
 * `15` §3.3) and a human watches it separately.
 *
 * **`killswitch.changed`** — the two kill-switch types. The switch is
 * the factory's own statement that it must not take work, so it is
 * **not** a task event and must be visible on its own.
 *
 * ## What is deliberately **not** mapped
 *
 * The types that are about the *factory's own configuration* rather
 * than its work: `definition.applied`, `definition.driftDetected`,
 * `environment.provisioned`, `environment.cleaned`,
 * `calibration.completed`, `run.replayed`, `harness.changeRolledBack`,
 * `proposal.*`, `autonomy.*`, `credential.*`, `net.egress.*`,
 * `webhook.*`, `oracle.*`, `patch.*`, `tool.*`, `model.*`,
 * `node.*`, `spec.*`, `plan.*`, `request.*`, `policy.*`,
 * `change.opened`, `change.updated`, `release.*`.
 *
 * Most of these are **high-volume** — every tool call and every model
 * request would flood the stream. blueprint `15` §3.2 samples
 * "high-volume operational signals"; the stream is the same idea. The
 * ones that are not high-volume are configuration changes, and a
 * configuration change is not something a dashboard region shows.
 */
export const CLASS_BY_EVENT_TYPE: Readonly<Record<string, StreamClass>> = {
  // ---- task.updated -------------------------------------------------
  'intent.recorded': 'task.updated',
  'intent.rejected': 'task.updated',
  'request.triaged': 'task.updated',
  'request.classified': 'task.updated',
  'spec.refined': 'task.updated',
  'spec.accepted': 'task.updated',
  'spec.escalated': 'task.updated',
  'spec.criteriaAdded': 'task.updated',
  'plan.produced': 'task.updated',
  'plan.validated': 'task.updated',
  'plan.rejected': 'task.updated',
  'plan.replanned': 'task.updated',
  'node.ready': 'task.updated',
  'node.leased': 'task.updated',
  'node.executionStarted': 'task.updated',
  'stage.completed': 'task.updated',
  'stage.failed': 'task.updated',
  'stage.incomplete': 'task.updated',
  'node.duplicateExecution': 'task.updated',
  'change.merged': 'task.updated',
  'change.mergeFailed': 'task.updated',
  'release.deployed': 'task.updated',
  'release.failed': 'task.updated',
  'release.rolledBack': 'task.updated',

  // ---- approval.requested -------------------------------------------
  'approval.requested': 'approval.requested',

  // ---- review.queued -------------------------------------------------
  'review.queued': 'review.queued',
  'review.opened': 'review.queued',
  'review.escalated': 'review.queued',
  'review.commentAdded': 'review.queued',
  'review.approved': 'review.queued',
  'review.rejected': 'review.queued',
  'review.deferred': 'review.queued',

  // ---- health.changed -------------------------------------------------
  'gate.started': 'health.changed',
  'gate.passed': 'health.changed',
  'gate.failed': 'health.changed',
  'gate.weakeningDetected': 'health.changed',
  'verification.blocked': 'health.changed',
  'policy.allowed': 'health.changed',
  'policy.denied': 'health.changed',
  'policy.escalated': 'health.changed',
  'budget.exhausted': 'health.changed',
  'approval.expired': 'health.changed',
  'approval.revoked': 'health.changed',
  'approval.granted': 'health.changed',

  // ---- cost.updated ---------------------------------------------------
  'model.requested': 'cost.updated',
  'model.failed': 'cost.updated',
  'model.failedOver': 'cost.updated',

  // ---- killswitch.changed ---------------------------------------------
  'kill.switch.engaged': 'killswitch.changed',
  'kill.switch.released': 'killswitch.changed',
};

/**
 * The class an event type maps to.
 *
 * `undefined` for an event type the stream does not carry — and that is
 * a **decision**, not an oversight. The stream carries the classes a
 * dashboard acts on; it does not carry every event. An unmapped event
 * is skipped, and the stream says so by not emitting it.
 */
export const classFor = (eventType: string): StreamClass | undefined =>
  CLASS_BY_EVENT_TYPE[eventType];

/**
 * The event type's class, or `undefined`.
 */
export type ClassifiedEvent = {
  /** The event's sequence in the log — the SSE `id:`. */
  readonly seq: number;
  /** The event's type. */
  readonly eventType: string;
  /** The class it maps to. */
  readonly class: StreamClass;
  /** The aggregate it belongs to. */
  readonly aggregate: { readonly kind: string; readonly id: string };
  /** When it happened. */
  readonly occurredAt: string;
  /** Its payload. */
  readonly payload: unknown;
};

/**
 * Classify an event into a stream event.
 *
 * `undefined` when the event's type is not carried by the stream — so
 * the caller skips it.
 */
export const classify = (
  event: {
    readonly seq: number;
    readonly eventType: string;
    readonly aggregate: { readonly kind: string; readonly id: string };
    readonly occurredAt: string;
    readonly payload: unknown;
  },
): ClassifiedEvent | undefined => {
  const cls = classFor(event.eventType);
  if (cls === undefined) {
    return undefined;
  }
  return {
    seq: event.seq,
    eventType: event.eventType,
    class: cls,
    aggregate: event.aggregate,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };
};

/**
 * The source the stream reads from.
 *
 * The port is **one method**: `subscribe(afterSeq)` yields the events
 * after a sequence. The caller owns the cursor, so a resume from
 * `Last-Event-ID` is the caller's business — and the port cannot
 * express a "send me everything" that is not a resume.
 */
export interface StreamSource {
  /**
   * The events after `afterSeq`.
   *
   * The iterable ends when the source has nothing more **for now** — the
   * source is asked again. It is not an error for it to end.
   */
  subscribe(afterSeq: number): AsyncIterable<ClassifiedEvent>;
}

/**
 * The in-memory stream source.
 *
 * The double holds the events it was given and yields them in
 * sequence order, from the first one after `afterSeq`.
 *
 * The **sort** is by `seq`, not by insertion order — because a resume
 * is defined by the sequence, and a source that yielded them out of
 * order would break the `id:` contract.
 */
export class InMemoryStreamSource implements StreamSource {
  private readonly events: ClassifiedEvent[];

  /**
   * @param events the events the source holds
   */
  constructor(events: readonly ClassifiedEvent[]) {
    this.events = [...events].sort((left, right) => left.seq - right.seq);
  }

  /**
   * Build a source from raw events, classifying each one.
   *
   * The unmapped events are **dropped** — that is the mapping, applied
   * at the boundary rather than in the reader.
   */
  public static fromEvents(
    events: readonly {
      readonly seq: number;
      readonly eventType: string;
      readonly aggregate: { readonly kind: string; readonly id: string };
      readonly occurredAt: string;
      readonly payload: unknown;
    }[],
  ): InMemoryStreamSource {
    const classified = events
      .map((event) => classify(event))
      .filter((event): event is ClassifiedEvent => event !== undefined);
    return new InMemoryStreamSource(classified);
  }

  /**
   * The events after `afterSeq`.
   *
   * The `await` on the yielded value is what makes this an async
   * generator rather than a plain one — and it is what the
   * `AsyncIterable` contract asks for. Each yield is a suspension point,
   * so a consumer that stops iterating does not have the source
   * blocking.
   */
  public async *subscribe(afterSeq: number): AsyncIterable<ClassifiedEvent> {
    for (const event of this.events) {
      if (event.seq > afterSeq) {
        yield await Promise.resolve(event);
      }
    }
  }
}
