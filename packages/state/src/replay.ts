/**
 * Replay — rebuilding a task's state from its events.
 *
 * blueprint `09` §5.2: "Projections are disposable and rebuildable from the
 * log; the log is the single source of truth."
 *
 * §5.3 (the rebuild guarantee): a projection can be discarded and rebuilt
 * from the log alone, and the rebuilt projection is identical to the one
 * that was discarded.
 *
 * So the replay function is not a convenience — it is the *check* on the
 * whole design. If replaying the events gives a different state than the
 * row says, then the row and the log have drifted, and one of them is
 * lying. The property test asserts they agree.
 */

import { type EventEnvelope, type TaskState } from '@factory/contracts';

/**
 * The transition payload the state machine writes.
 *
 * The payload is `{from, to, trigger, detail?}` — the state machine owns
 * the format, and this is the only place that reads it.
 */
export interface TransitionPayload {
  readonly from: TaskState;
  readonly to: TaskState;
  readonly trigger: string;
  readonly detail?: unknown;
}

/**
 * Is this event a task state transition?
 *
 * The state machine's events are identified by their payload shape rather
 * than by their event type, because the event type is a *domain* event
 * (`request.triaged`, `spec.refined`, …) and not a generic "state changed"
 * marker. The vocabulary has no `task.stateChanged`, and inventing one
 * would mean adding an event type to the registered vocabulary — which the
 * pack forbids without an entry in `packages/contracts/events.md`.
 */
export const isTransitionEvent = (event: EventEnvelope): boolean => {
  const payload = event.payload as Partial<TransitionPayload> | null | undefined;
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === 'object' &&
    typeof payload.from === 'string' &&
    typeof payload.to === 'string'
  );
};

/**
 * The replayed state of a task.
 */
export interface ReplayedTask {
  readonly taskId: string;
  readonly state: TaskState;
  readonly version: number;
  /** The number of transition events seen. */
  readonly transitions: number;
}

/**
 * Replay a task's events into its state.
 *
 * The events must be in `seq` order — the log's `read` returns them that
 * way.
 *
 * The replayed version is the **highest** aggregate version among the
 * transition events, not the count of them. The count and the version are
 * usually the same, but they differ when the task has events that do not
 * change its state, and the version is the number the row actually holds.
 */
export const replayTask = (
  taskId: string,
  events: readonly EventEnvelope[],
): ReplayedTask => {
  let state: TaskState = 'DRAFT';
  let version = 0;
  let transitions = 0;

  for (const event of events) {
    if (!isTransitionEvent(event)) {
      continue;
    }
    const payload = event.payload as TransitionPayload;
    state = payload.to;
    version = Math.max(version, event.aggregate.version);
    transitions += 1;
  }

  return { taskId, state, version, transitions };
};

/**
 * Replay a task's state from an async iterable of events.
 */
export const replayTaskFrom = async (
  taskId: string,
  events: AsyncIterable<EventEnvelope>,
): Promise<ReplayedTask> => {
  const collected: EventEnvelope[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return replayTask(taskId, collected);
};
