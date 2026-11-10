/**
 * `projections/reducers/task-current` — the `task_current` fold (T-1.15).
 *
 * ## What this file is
 *
 * The **pure** reducer for `task_current`: `(row | undefined, event) =>
 * row`. No clock, no I/O, no randomness. Everything that touches the
 * outside world is injected.
 *
 * This is the repo's own precedent: `packages/state` splits pure guards
 * from a store, and `packages/orchestrator` splits pure rules from a
 * queue port. The projection is the same shape — the *decisions* are
 * pure functions of the event and the current row, and the side-effecting
 * loop composes them.
 *
 * ## Why a fold, and not a handler per event type
 *
 * A0.6: "every projection can be dropped and rebuilt identically". The
 * rebuild replays the whole log, in `seq` order. So the projection must be
 * a **fold over the log**: `fold(reduce, seed, events)`.
 *
 * That gives the rebuild guarantee for free — the rebuilt rows are the
 * fold of the same events — *provided* the reducer is **idempotent in the
 * rows**, which is why every write here is an **assignment of a computed
 * value**, never an accumulation:
 *
 * * `spentUsdMicros` is **set** to the running total carried in the row,
 *   and the running total is recomputed from the event's own cost — no,
 *   more precisely: the row carries the running total, and an event that
 *   reports a cost **sets** the total to `row.spentUsdMicros + cost`.
 *
 * That is an accumulation, and an accumulation replayed twice is wrong.
 * So the reducer must not accumulate at all.
 *
 * **The resolution.** The event log carries `costUsdMicros` on the event
 * envelope — a *per-event* cost, not a running total. So the row's
 * `spentUsdMicros` cannot be a running sum derived from the fold, or a
 * replay would double it.
 *
 * The answer is the one the pack already gives: **`tasks.spent_usd_micros`
 * is a column on the task row**, and the task row is maintained by the
 * *state machine*, not by the projection. The projection **reads** the
 * authoritative figures and **projects** them.
 *
 * So the reducer's rule is: **the projection never computes an aggregate
 * the log does not already carry.** Where the log carries the figure
 * (`costUsdMicros` on the envelope, `spentUsdMicros` in the task's
 * payload), the projection copies it. Where it does not, the projection
 * leaves the field alone.
 *
 * That is what makes the fold **idempotent**: applying the same event
 * twice yields the same row, because every write is an assignment of a
 * value the event carries, not an accumulation over the fold.
 *
 * ## The events the reducer handles
 *
 * | Event | What it sets |
 * |---|---|
 * | `intent.recorded` | The row's **creation**: repo, workflow, state `DRAFT`. |
 * | any state transition | The row's `state`, from the payload's `to`. |
 * | `review.queued` | `needsHuman` = true. |
 * | `review.approved` / `review.rejected` / `review.deferred` | `needsHuman` = false. |
 * | `approval.requested` | `needsHuman` = true. |
 * | `approval.granted` / `approval.refused` / `approval.expired` / `approval.revoked` | `needsHuman` = false. |
 * | any event | `lastActivityAt` = the event's `occurredAt`. |
 *
 * A **state transition** is identified by its payload shape — `{from, to}`
 * — not by its event type, exactly as `packages/state`'s `replay.ts` does
 * it. The vocabulary has no `task.stateChanged`, and inventing one would
 * mean adding an event type to the registered vocabulary, which the pack
 * forbids.
 */

import { TASK_STATES, type EventEnvelope, type TaskState } from '@factory/contracts';

import type { TaskCurrentRow } from '../types.js';

/**
 * The payload of a task state transition.
 *
 * `packages/state` owns the format; this is the only place that reads it.
 */
interface TransitionPayload {
  readonly from: TaskState;
  readonly to: TaskState;
  readonly trigger: string;
}

/**
 * Is this event a task state transition?
 *
 * Identified by the payload's shape, for the reason given in the file
 * header: the vocabulary has no generic "state changed" event type.
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
 * The payload fields the reducer reads from an event.
 *
 * Every read is **defensive**: the payload is `unknown` at the boundary,
 * and a projection that throws on an odd payload takes the whole factory's
 * observability down. So a field that is not the shape the reducer
 * expects is treated as absent.
 */
interface ReducerPayload {
  readonly repo?: string;
  readonly workflow?: string;
  readonly riskTier?: string;
  readonly budgetUsdMicros?: number;
  readonly spentUsdMicros?: number;
  readonly state?: string;
  readonly to?: string;
  readonly needsHuman?: boolean;
}

/**
 * Read the payload as the reducer's view of it.
 */
const payloadOf = (event: EventEnvelope): ReducerPayload => {
  const payload = event.payload;
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    return {};
  }
  return payload as ReducerPayload;
};

/**
 * Is this string a task state?
 *
 * The contracts own the vocabulary (`TASK_STATES`), so the check reads
 * *their* list rather than a copy: a payload that names a state the
 * contracts do not have is **not** applied, because writing it into the
 * row would put a value no other reader can interpret.
 */
const isTaskState = (value: string): value is TaskState =>
  (TASK_STATES as readonly string[]).includes(value);

/**
 * The events that **clear** the "needs a human" flag.
 *
 * A review that has been decided and an approval that has been answered
 * are both "the human has spoken". The list is the event types that
 * mean the human's turn is over.
 */
const HUMAN_TURN_OVER: readonly string[] = [
  'review.approved',
  'review.rejected',
  'review.deferred',
  'approval.granted',
  'approval.revoked',
  'approval.expired',
];

/**
 * The events that **raise** the "needs a human" flag.
 *
 * A review that is queued and an approval that is requested both mean
 * the factory is waiting for a person.
 */
const HUMAN_TURN_NEEDED: readonly string[] = [
  'review.queued',
  'review.escalated',
  'approval.requested',
];

/**
 * The default row, for a task the projection has not seen created.
 *
 * A task's row is created by `intent.recorded`, but the log may hold
 * events for a task whose creation predates the projection's window (a
 * rebuild that starts from a truncated log, or a task created by another
 * component). So the reducer **creates a row on demand** rather than
 * dropping the event.
 *
 * The state is `DRAFT` — the vocabulary's initial state — and the
 * identity fields are empty until an event fills them. An empty string
 * is not a valid id, so the row is visibly incomplete rather than
 * plausibly wrong.
 */
const blankRow = (taskId: string): TaskCurrentRow => ({
  taskId,
  repo: '',
  workflow: '',
  state: 'DRAFT',
  riskTier: null,
  needsHuman: false,
  lastActivityAt: '',
  spentUsdMicros: 0,
  budgetUsdMicros: 0,
  summary: {},
});

/**
 * Reduce one event into the `task_current` row.
 *
 * @param current the row before the event, or `undefined` if there is none
 * @param event the event
 * @returns the row after the event
 */
export const reduceTaskCurrent = (
  current: TaskCurrentRow | undefined,
  event: EventEnvelope,
): TaskCurrentRow => {
  // The task id is the aggregate id. A `node` event's aggregate id is
  // `<taskId>/<nodeId>`, so the task id is the part before the slash.
  const taskId = taskIdOf(event);
  const row = current ?? blankRow(taskId);
  const payload = payloadOf(event);

  // ---- the identity fields ------------------------------------------
  //
  // `intent.recorded` is where the task is created, so it is where the
  // repo and the workflow come from. Later events may repeat them.
  const next: TaskCurrentRow = {
    ...row,
    taskId: row.taskId === '' ? taskId : row.taskId,
    repo: typeof payload.repo === 'string' && payload.repo !== '' ? payload.repo : row.repo,
    workflow:
      typeof payload.workflow === 'string' && payload.workflow !== ''
        ? payload.workflow
        : row.workflow,
    riskTier:
      typeof payload.riskTier === 'string' && payload.riskTier !== ''
        ? (payload.riskTier as TaskCurrentRow['riskTier'])
        : row.riskTier,
  };

  // ---- the state ----------------------------------------------------
  //
  // A transition is identified by its payload shape, and the value it
  // sets is the payload's `to`. A `to` the contracts do not recognise is
  // **not** applied — the row would carry a state no reader can
  // interpret.
  let state = next.state;
  if (isTransitionEvent(event)) {
    const to = (event.payload as Partial<TransitionPayload>).to;
    if (typeof to === 'string' && isTaskState(to)) {
      state = to;
    }
  } else if (typeof payload.state === 'string' && isTaskState(payload.state)) {
    state = payload.state;
  }

  // ---- the human's turn ---------------------------------------------
  //
  // `needsHuman` is a **flag with a direction**, not a count. The
  // reducer sets it when an event says the factory is waiting for a
  // person, and clears it when an event says the person has answered.
  //
  // It is not "the last event wins" in general — an unrelated event
  // leaves it alone, so a `stage.completed` between a `review.queued`
  // and a `review.approved` does not clear the flag.
  let needsHuman = next.needsHuman;
  if (HUMAN_TURN_NEEDED.includes(event.eventType)) {
    needsHuman = true;
  } else if (HUMAN_TURN_OVER.includes(event.eventType)) {
    needsHuman = false;
  }

  // ---- the money ----------------------------------------------------
  //
  // The **envelope's** `costUsdMicros` is a per-event cost, and the
  // payload's `spentUsdMicros` is the authoritative running total the
  // task row carries. So the projection *copies* the total — it does
  // not sum the events, because a replay would sum them twice.
  const spentUsdMicros =
    typeof payload.spentUsdMicros === 'number'
      ? payload.spentUsdMicros
      : next.spentUsdMicros;
  const budgetUsdMicros =
    typeof payload.budgetUsdMicros === 'number'
      ? payload.budgetUsdMicros
      : next.budgetUsdMicros;

  return {
    ...next,
    state,
    needsHuman,
    spentUsdMicros,
    budgetUsdMicros,
    // The activity is the event's own timestamp — the log's clock, not
    // the projector's. That is what makes the row identical after a
    // rebuild at a different wall-clock time.
    lastActivityAt: event.occurredAt,
  };
};

/**
 * The task id an event belongs to.
 *
 * A `node` event's aggregate id is `<taskId>/<nodeId>`, so the task id
 * is the part before the separator. Every other aggregate kind's id is
 * the task id itself for a task-scoped event — but a `run` or an
 * `approval` aggregate has its **own** id, and the task it belongs to
 * is in the event's `subject`.
 *
 * So the task id is resolved in this order:
 *
 * 1. the `subject.taskId`, when the event carries one;
 * 2. the aggregate id, when the aggregate is a `task`;
 * 3. the part of the aggregate id before the separator, when the
 *    aggregate is a `node`.
 *
 * And when the event belongs to no task at all — a `system` aggregate,
 * say — the projection **skips** it, because there is no task row to
 * write.
 */
export const taskIdOf = (event: EventEnvelope): string => {
  const subject = event.subject as { readonly taskId?: string } | null | undefined;
  if (subject !== null && subject !== undefined && typeof subject.taskId === 'string') {
    return subject.taskId;
  }

  if (event.aggregate.kind === 'task') {
    return event.aggregate.id;
  }

  if (event.aggregate.kind === 'node') {
    const separator = event.aggregate.id.indexOf('/');
    return separator > 0 ? event.aggregate.id.slice(0, separator) : '';
  }

  return '';
};

/**
 * Does this event belong to a task?
 *
 * An event with no task — a system-wide one — has no row. The projector
 * skips it, and says so.
 */
export const belongsToTask = (event: EventEnvelope): boolean =>
  taskIdOf(event) !== '';
