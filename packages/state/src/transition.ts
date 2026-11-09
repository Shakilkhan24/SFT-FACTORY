/**
 * `transition(cmd)` — the state machine over the event log (pack 03 §3,
 * blueprint `09` §2–§3).
 *
 * The ticket states the algorithm precisely:
 *
 * > `transition(cmd)`: lock the aggregate row → check `(from,to)` is allowed →
 * > evaluate the named guard (a pure function over the snapshot + policy
 * > decision) → update state and version → append event(s) → return.
 *
 * ## Why the lock comes first
 *
 * The row lock is `SELECT ... FOR UPDATE` on the task row, taken before the
 * edge is checked. That ordering matters: if the edge were checked before
 * the lock, two writers could both read `DRAFT`, both find `DRAFT → TRIAGED`
 * legal, and both write it. The lock serialises the read-check-write, so the
 * second writer sees the *new* state and the new version, and the caller's
 * `expectedVersion` catches it.
 *
 * ## Why the state change and the event are one transaction
 *
 * blueprint `09` §6: "No silent task loss | State transitions and their
 * events are written in one transaction."
 *
 * checklist 02 trap 4: "Putting state changes and event appends in separate
 * transactions. They must be one. Otherwise I-3 … is false under crash."
 *
 * So the `UPDATE tasks` and the `append` share one transaction. If the append
 * fails, the state change rolls back with it — there is no state with no
 * event, and no event with no state.
 *
 * ## The refusal path
 *
 * "An illegal transition ⇒ `ConcurrencyError | IllegalTransition`, **no state
 * change**, and a `policy.denied`-class event."
 *
 * The refusal event is written in its **own** transaction, after the refused
 * transaction has rolled back. It records that the attempt happened; it does
 * not change the state. This is why the refusal is a separate write rather
 * than a row in the same transaction: the state must not change, so there is
 * nothing to roll back *to* — the event has to be committed on its own.
 */

import {
  type Actor,
  type Authority,
  type EventEnvelope,
  type EventType,
  type NewEvent,
  type TaskState,
} from '@factory/contracts';

import {
  GuardFailedError,
  IllegalTransitionError,
  StateConcurrencyError,
  type StateMachineErrorKind,
} from './errors.js';
import { type GuardFacts } from './guards.js';
import { checkGuard, guardFor, isAllowedTransition } from './table.js';

/**
 * The transition command (pack 03 §3).
 *
 * `TransitionCommand` in `@factory/contracts` carries the required fields;
 * this adds the optional guard facts, which the guard needs and which the
 * caller supplies.
 */
export interface TransitionRequest {
  readonly taskId: string;
  readonly to: TaskState;
  /** The trigger — what caused the transition. */
  readonly trigger: string;
  readonly actor: Actor;
  readonly authority: Authority;
  /** The version the caller believes the task is at. */
  readonly expectedVersion: number;
  /** The event type to record. */
  readonly eventType: EventType;
  /** The payload of the event. */
  readonly payload?: unknown;
  /** The facts the guard evaluates. */
  readonly facts?: GuardFacts;
  /** The correlation id; defaults to the task id. */
  readonly correlationId?: string;
  /** The subject of the event. */
  readonly subject?: Record<string, string>;
}

/**
 * The result of a transition.
 *
 * A failure carries the error *kind* the ticket names, plus enough detail
 * for a human to see what happened.
 */
export type TransitionOutcome =
  | {
      readonly ok: true;
      readonly snapshot: {
        readonly taskId: string;
        readonly state: TaskState;
        readonly version: number;
      };
      readonly events: readonly EventEnvelope[];
    }
  | {
      readonly ok: false;
      readonly error: StateMachineErrorKind;
      readonly message: string;
      readonly guard: string | undefined;
      readonly reason: string | undefined;
      readonly from: TaskState | undefined;
      readonly to: TaskState | undefined;
    };

/**
 * The persistence the state machine needs.
 *
 * It is an interface rather than a concrete class so the machine can be
 * driven against Postgres (the real thing) and against a stub (for tests
 * that do not need a database), and so `packages/state` does not depend on
 * `@factory/db` — which keeps it out of the "pure" bucket but keeps its
 * dependency surface honest.
 */
export interface StateMachineStore {
  /**
   * Run `body` in a transaction that has the task row locked.
   *
   * The lock is taken by the store, not by the caller, so every caller gets
   * it by construction.
   */
  withLockedTask<T>(
    taskId: string,
    body: (context: LockedTaskContext) => Promise<T>,
  ): Promise<T>;

  /**
   * Append events in their own transaction, used for the refusal event.
   */
  appendRefusal(events: readonly NewEvent[]): Promise<void>;
}

/**
 * The context handed to the body of a locked transaction.
 */
export interface LockedTaskContext {
  /** The task's current state. */
  readonly state: TaskState;
  /** The task's current version. */
  readonly version: number;
  /** The task's autonomy level. */
  readonly autonomyLevel: number;
  /** Update the task's state and version. */
  updateState(to: TaskState): Promise<void>;
  /** Append the transition's events in the same transaction. */
  append(events: readonly NewEvent[]): Promise<readonly EventEnvelope[]>;
}

/**
 * The state machine.
 *
 * It is pure: it depends on a {@link StateMachineStore} for storage and on
 * nothing else. The Postgres implementation of that interface lives in
 * `@factory/orchestrator`, because pack 02 §3 makes `state` a pure package.
 */
export class StateMachine {
  private readonly store: StateMachineStore;

  public constructor(store: StateMachineStore) {
    this.store = store;
  }

  /**
   * Attempt a transition.
   *
   * The returned outcome is a `Result`, not an exception, for the *expected*
   * failures — an illegal edge and a guard refusal are ordinary outcomes of
   * asking for something, and the caller wants to handle them, not catch
   * them. A `ConcurrencyError` is also returned rather than thrown, for the
   * same reason: it is an expected outcome of a concurrent write.
   */
  public async transition(request: TransitionRequest): Promise<TransitionOutcome> {
    try {
      return await this.store.withLockedTask(request.taskId, async (context) =>
        this.applyTransition(request, context),
      );
    } catch (error) {
      if (error instanceof StateConcurrencyError) {
        return {
          ok: false,
          error: 'ConcurrencyError',
          message: error.message,
          guard: undefined,
          reason: undefined,
          from: undefined,
          to: undefined,
        };
      }
      throw error;
    }
  }

  /**
   * The body of the transition, run with the task row locked.
   */
  private async applyTransition(
    request: TransitionRequest,
    context: LockedTaskContext,
  ): Promise<TransitionOutcome> {
    const from = context.state;

    // 1. The caller's expected version must match. The lock guarantees no
    //    one else is writing, so a mismatch means the caller's view is
    //    stale.
    if (context.version !== request.expectedVersion) {
      throw new StateConcurrencyError(
        'task',
        request.taskId,
        request.expectedVersion,
        context.version,
      );
    }

    // 2. The edge must be in the table.
    if (!isAllowedTransition(from, request.to)) {
      await this.recordRefusal(request, from, 'IllegalTransition', undefined);
      return {
        ok: false,
        error: 'IllegalTransition',
        message: `illegal transition ${from} → ${request.to}: the edge is not in the transition table`,
        guard: undefined,
        reason: undefined,
        from,
        to: request.to,
      };
    }

    // 3. The guard must pass.
    const facts: GuardFacts = {
      ...request.facts,
      autonomyLevel: request.facts?.autonomyLevel ?? context.autonomyLevel,
    };
    if (!checkGuard(from, request.to, facts)) {
      const guard = guardFor(from, request.to) ?? undefined;
      await this.recordRefusal(request, from, 'GuardFailed', guard);
      return {
        ok: false,
        error: 'GuardFailed',
        message: `guard ${guard ?? '(none)'} refused ${from} → ${request.to}`,
        guard,
        reason: undefined,
        from,
        to: request.to,
      };
    }

    // 4. Update the state and version, and append the event — in the same
    //    transaction, so the state and the event cannot be separated.
    await context.updateState(request.to);

    const events = await context.append([
      {
        eventType: request.eventType,
        aggregate: { kind: 'task', id: request.taskId, version: 0 },
        correlationId: request.correlationId ?? request.taskId,
        actor: request.actor,
        authority: request.authority,
        subject: request.subject ?? {},
        payload: {
          from,
          to: request.to,
          trigger: request.trigger,
          ...(request.payload === undefined ? {} : { detail: request.payload }),
        },
        context: { items: [] },
        bumpsVersion: true,
      },
    ]);

    // The version comes from the event the log wrote: the log's CAS is what
    // actually bumped the row, so its envelope carries the authoritative
    // post-transition version. Reading it from the event rather than
    // computing `context.version + 1` means the snapshot and the log cannot
    // disagree.
    const version =
      events[0]?.aggregate.version ?? context.version + 1;

    return {
      ok: true,
      snapshot: {
        taskId: request.taskId,
        state: request.to,
        version,
      },
      events,
    };
  }

  /**
   * Record a refusal.
   *
   * The event is a `policy.denied` — the pack's security-event class for
   * "something was refused" (pack 03 §5). It is committed on its own, after
   * the refused transaction rolled back, so the refusal is durable and the
   * state is untouched.
   */
  private async recordRefusal(
    request: TransitionRequest,
    from: TaskState,
    reason: 'IllegalTransition' | 'GuardFailed',
    guard: string | undefined,
  ): Promise<void> {
    await this.store.appendRefusal([
      {
        eventType: 'policy.denied',
        aggregate: { kind: 'task', id: request.taskId, version: 0 },
        correlationId: request.correlationId ?? request.taskId,
        actor: request.actor,
        authority: request.authority,
        subject: {},
        payload: {
          action: 'task.transition',
          reason,
          from,
          to: request.to,
          trigger: request.trigger,
          ...(guard === undefined ? {} : { guard }),
        },
        context: { items: [] },
        // A refusal does not change the task's state, so it must not consume
        // a version number.
        bumpsVersion: false,
      },
    ]);
  }
}

export { GuardFailedError, IllegalTransitionError, StateConcurrencyError };
