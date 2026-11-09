/**
 * The state machine's errors.
 *
 * The ticket names three failure kinds — `ConcurrencyError`,
 * `IllegalTransition`, and a guard failure — and they are kept distinct
 * because they mean different things to a caller:
 *
 * * `ConcurrencyError` — someone else changed the task first. **Retry.**
 * * `IllegalTransition` — the edge is not in the table. **Do not retry**; the
 *   request is wrong.
 * * `GuardFailed` — the edge is legal but the preconditions are not met
 *   yet. **Do not retry blindly**; the facts must change.
 *
 * Collapsing them into one error would make it impossible to tell "someone
 * beat me to it" from "that is not allowed", and the first is the only one
 * worth retrying.
 */

/**
 * The error kinds the state machine reports.
 */
export type StateMachineErrorKind =
  | 'IllegalTransition'
  | 'GuardFailed'
  | 'ConcurrencyError'
  | 'NotFound';

/**
 * The state machine's error.
 */
export class StateMachineError extends Error {
  public readonly kind: StateMachineErrorKind;

  /** The state the task was in when the transition was refused. */
  public readonly from: string | undefined;

  /** The state the transition wanted to reach. */
  public readonly to: string | undefined;

  /** The guard that refused, when a guard did. */
  public readonly guard: string | undefined;

  /** Why the guard refused. */
  public readonly reason: string | undefined;

  public constructor(
    kind: StateMachineErrorKind,
    message: string,
    detail: {
      readonly from?: string;
      readonly to?: string;
      readonly guard?: string;
      readonly reason?: string;
    } = {},
  ) {
    super(message);
    this.name = 'StateMachineError';
    this.kind = kind;
    this.from = detail.from;
    this.to = detail.to;
    this.guard = detail.guard;
    this.reason = detail.reason;
  }
}

/**
 * The transition was refused: the edge is not in the table.
 *
 * No state changed and no event was written — except the
 * `policy.denied`-class event the ticket requires, which records the refusal.
 */
export class IllegalTransitionError extends StateMachineError {
  public constructor(from: string, to: string) {
    super(
      'IllegalTransition',
      `illegal transition ${from} → ${to}: the edge is not in the transition table`,
      { from, to },
    );
    this.name = 'IllegalTransitionError';
  }
}

/**
 * The transition was refused by its guard.
 */
export class GuardFailedError extends StateMachineError {
  public constructor(from: string, to: string, guard: string, reason: string) {
    super('GuardFailed', `guard ${guard} refused ${from} → ${to}: ${reason}`, {
      from,
      to,
      guard,
      reason,
    });
    this.name = 'GuardFailedError';
  }
}

/**
 * The task changed under us, or the caller's expected version was wrong.
 *
 * This mirrors the event log's `ConcurrencyError` — the same condition, seen
 * from the state machine's side.
 */
export class StateConcurrencyError extends StateMachineError {
  public readonly expectedVersion: number;
  public readonly actualVersion: number | undefined;

  public constructor(
    aggregateKind: string,
    aggregateId: string,
    expectedVersion: number,
    actualVersion: number | undefined,
  ) {
    super(
      'ConcurrencyError',
      `concurrency conflict on ${aggregateKind}:${aggregateId}: expected version ${String(
        expectedVersion,
      )}, found ${actualVersion === undefined ? 'no row' : String(actualVersion)}`,
      {},
    );
    this.name = 'StateConcurrencyError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}
