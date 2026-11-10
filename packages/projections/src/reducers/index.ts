/**
 * `projections/reducers` — the registry (T-1.15).
 *
 * ## Why a registry and not a switch at each call site
 *
 * There are three projections, and each has a different row shape and a
 * different key. So the projector loop cannot call one reducer — it has
 * to ask "which reducer owns this event, and what is the key?".
 *
 * Putting the answer in **one table** means:
 *
 * * an event type that no reducer claims is **not silently dropped** —
 *   the registry says which projections it reaches, and the projector
 *   can report the ones it does not;
 * * a new projection is added by adding a row, not by editing three
 *   call sites.
 *
 * ## The projection's **identity**
 *
 * Every projection has a name, and the name is the **cursor's** name. So
 * the cursor and the rows are addressed by the same string — the same
 * identifier means "this projection's rows" and "this projection's
 * position in the log".
 *
 * ## The `task_current` reducer is a fold over the task's events
 *
 * `task_current`'s reducer takes the **current row** and returns the
 * new row, so the projector must first find the row for the event's
 * task. That is what `keyOf` does.
 */

import type { EventEnvelope } from '@factory/contracts';

import type {
  ApprovalQueueRow,
  CostAttributionRow,
  ProjectionName,
  TaskCurrentRow,
} from '../types.js';

import {
  reduceApprovalQueue,
  type ApprovalQueueEffect,
} from './approval-queue.js';
import {
  costBucketKey,
  reduceCostAttribution,
  totalsOf,
  type CostContributions,
} from './cost-attribution.js';
import { reduceTaskCurrent, taskIdOf } from './task-current.js';

export { reduceApprovalQueue, urgencyOf, type ApprovalQueueEffect } from './approval-queue.js';
export {
  costBucketKey,
  costRowOf,
  dayOf,
  reduceCostAttribution,
  totalsOf,
  type CostContribution,
  type CostContributions,
} from './cost-attribution.js';
export {
  belongsToTask,
  isTransitionEvent,
  reduceTaskCurrent,
  taskIdOf,
} from './task-current.js';

/**
 * The projections this package maintains.
 */
export const PROJECTIONS: readonly ProjectionName[] = [
  'task_current',
  'approval_queue',
  'cost_attribution',
];

/**
 * The key of a row in a projection.
 *
 * A projection's key is what the store addresses a row by. For
 * `task_current` it is the task id; for `approval_queue` it is the
 * approval id; for `cost_attribution` it is the four-part bucket key.
 */
export type ProjectionKey = string;

/**
 * What one projection does with one event.
 *
 * The three shapes differ, so the effect is a **sum**: a projection
 * either does not touch the event, upserts a row, or removes one.
 *
 * ## Why an effect carries a `state`
 *
 * A reducer is a fold over the log, so it needs a **carried state** as
 * well as a row. For `task_current` and `approval_queue` the two are the
 * same thing — the row *is* the state, and the fold is `row' = f(row,
 * event)`.
 *
 * For `cost_attribution` they are not. The row holds the bucket's
 * **totals** (the pack's columns), but the fold needs the bucket's
 * **contributions** — the map from each contributing event's id to its
 * contribution. The totals are *derived* from the contributions, and
 * the contributions are what make the fold idempotent: a replayed
 * event overwrites its own entry instead of adding a second one.
 *
 * So the effect carries both: `row` is what is written, and `state` is
 * what the next event is folded onto. A reducer whose state and row are
 * the same returns the row as the state.
 *
 * The state is **not** written to the store's rows — it is the
 * reducer's own bookkeeping. So the projector keeps it, in memory, for
 * the life of the projection's process; and the **rebuild** recomputes
 * it from the log, which is why a rebuild produces the same rows.
 */
export type ProjectionEffect =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'upsert';
      readonly key: ProjectionKey;
      readonly row: unknown;
      /** The reducer's carried state for this key. */
      readonly state: unknown;
    }
  | { readonly kind: 'remove'; readonly key: ProjectionKey };

/**
 * A projection's state — the rows it holds, keyed.
 */
export type ProjectionState = Readonly<Record<ProjectionKey, unknown>>;

/**
 * One projection's reducer.
 *
 * A reducer is a **pure** function of the current row and the event. It
 * may not read a clock, touch I/O, or accumulate over the fold — the
 * rebuild guarantee depends on all three.
 */
export interface ProjectionReducer {
  /** The projection's name — the cursor's name. */
  readonly name: ProjectionName;

  /**
   * The key the event's row is addressed by.
   *
   * `undefined` means the event does not belong to this projection.
   */
  readonly keyOf: (event: EventEnvelope) => ProjectionKey | undefined;

  /**
   * Reduce the event into the row.
   *
   * The reducer returns the **whole** effect, so a reducer that removes
   * a row says so — the projector does not infer it.
   */
  readonly reduce: (
    current: unknown,
    event: EventEnvelope,
  ) => ProjectionEffect;
};

/**
 * The `task_current` reducer.
 */
const taskCurrentReducer: ProjectionReducer = {
  name: 'task_current',
  keyOf: (event) => {
    const taskId = taskIdOf(event);
    return taskId === '' ? undefined : taskId;
  },
  reduce: (current, event) => {
    const row = reduceTaskCurrent(current as TaskCurrentRow | undefined, event);
    // The row **is** the state for this projection — the fold is
    // `row' = f(row, event)`.
    return { kind: 'upsert', key: row.taskId, row, state: row };
  },
};

/**
 * The `approval_queue` reducer.
 */
const approvalQueueReducer: ProjectionReducer = {
  name: 'approval_queue',
  keyOf: (event) => {
    // The queue's key is the approval id. The event that **creates** the
    // row is `approval.requested`, and the event that **removes** it is
    // the one that answers it — so the reducer must claim both.
    //
    // A reducer that claimed only the creating event would leave the
    // answered approvals in the queue forever: the projector skips the
    // events a reducer does not claim.
    if (
      event.eventType !== 'approval.requested' &&
      event.eventType !== 'approval.granted' &&
      event.eventType !== 'approval.expired' &&
      event.eventType !== 'approval.revoked'
    ) {
      return undefined;
    }
    const payload = event.payload as { readonly approvalId?: string } | null;
    const approvalId =
      payload !== null && payload !== undefined && typeof payload.approvalId === 'string'
        ? payload.approvalId
        : '';
    return approvalId === '' ? undefined : approvalId;
  },
  reduce: (current, event) => {
    const effect: ApprovalQueueEffect = reduceApprovalQueue(
      current as ApprovalQueueRow | undefined,
      event,
    );
    if (effect.kind === 'none') {
      return { kind: 'none' };
    }
    if (effect.kind === 'remove') {
      return { kind: 'remove', key: effect.approvalId };
    }
    // The row **is** the state for this projection.
    return {
      kind: 'upsert',
      key: effect.row.approvalId,
      row: effect.row,
      state: effect.row,
    };
  },
};

/**
 * The `cost_attribution` reducer.
 */
const costAttributionReducer: ProjectionReducer = {
  name: 'cost_attribution',
  keyOf: (event) => {
    if (event.eventType !== 'model.requested' && event.eventType !== 'change.merged') {
      return undefined;
    }
    return costBucketKey(event);
  },
  reduce: (current, event) => {
    const contributions = reduceCostAttribution(
      current as CostContributions | undefined,
      event,
    );
    const key = costBucketKey(event);
    const parts = key.split(' ');
    const [day, workflow, role, model] = parts;
    const totals = totalsOf(contributions);
    const row: CostAttributionRow = {
      day: day ?? '',
      workflow: workflow ?? '',
      role: role ?? '',
      model: model ?? '',
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      usdMicros: totals.usdMicros,
      acceptedChangeCount: totals.acceptedChangeCount,
    };
    // The state is the **contributions**, not the row: the row holds the
    // totals, and the totals are derived from the contributions. A
    // replayed event overwrites its own contribution, so the totals are
    // unchanged — which is what makes the fold idempotent.
    return { kind: 'upsert', key, row, state: contributions };
  },
};

/**
 * Every reducer, by name.
 */
export const REDUCERS: Readonly<Record<ProjectionName, ProjectionReducer>> = {
  task_current: taskCurrentReducer,
  approval_queue: approvalQueueReducer,
  cost_attribution: costAttributionReducer,
};

/**
 * The reducer for a projection.
 *
 * @throws {Error} when the name is not one of the three.
 */
export const reducerFor = (name: ProjectionName): ProjectionReducer => {
  const reducer = REDUCERS[name];
  if (reducer === undefined) {
    throw new Error(
      `unknown projection ${JSON.stringify(name)}; expected one of ${PROJECTIONS.join(', ')}`,
    );
  }
  return reducer;
};
