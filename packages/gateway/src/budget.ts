/**
 * `gateway` — the budget check.
 *
 * ## The rule
 *
 * blueprint 11 §9.5:
 *
 * | Rule | Detail |
 * |---|---|
 * | Per-request budget | Declared by the role specification. |
 * | Per-task budget | The sum of requests' budgets, plus the cost of tool calls. |
 * | Per-workflow budget | A ceiling across all tasks of that workflow. |
 * | Enforcement | A request whose projected cost exceeds the remaining budget is **refused before the call**, and the task halts with `budget.exhausted`. |
 *
 * **"Before the call" is the whole point.** A budget checked after the
 * call is a report, not a control — the money is already spent. So the
 * gateway computes the **projected** cost and compares it to the
 * **remaining** budget *before* it reaches a provider.
 *
 * ## The remaining amount, not the limit
 *
 * The check compares the projection against `limit - spent`, never
 * against `limit` alone. A task that has already spent 90% of its
 * budget still has 10% left, and a request that fits in that 10% must
 * be allowed. Comparing against the limit would make the budget a
 * per-request cap and not a budget at all.
 *
 * ## The effective ceiling is the minimum
 *
 * A request is bounded by **all three** scopes at once — the request's
 * own limit, the task's, and the workflow-day's. The tightest one
 * wins. A per-request limit of 1.50 USD does not license a request
 * that the task's remaining 0.20 USD cannot pay for.
 *
 * ## A breach is an outcome, not a failure
 *
 * blueprint 11 §9.5: *"A budget breach is a first-class outcome, not a
 * failure. The task returns `incomplete` with partial artefacts
 * preserved and labelled."*
 *
 * So the gateway's refusal is a `budget.exhausted` **failure class**
 * (it is the class the contracts define for it) and the *orchestrator*
 * (T-1.13) turns it into `incomplete`. The gateway classifies the
 * refusal; it does not decide the task's outcome.
 *
 * ## Budget exhaustion never fails over
 *
 * pack 03 §4.6: `failover: { on: [provider-error, rate-limited, schema-invalid-twice], neverOn: [budget-exhausted] }`.
 *
 * The budget check happens **before** the call, so its refusal never
 * reaches the failover loop. That is not an accident of ordering — it
 * is the rule, and the ordering is what enforces it.
 */

import { factoryError, type FactoryError } from '@factory/core';

import type { BudgetScope } from './types.js';

/**
 * A budget's limit and what has been spent against it.
 */
export interface BudgetAmount {
  /** The ceiling, in integer micro-USD. */
  readonly limitUsdMicros: number;
  /** What has already been spent, in integer micro-USD. */
  readonly spentUsdMicros: number;
}

/**
 * The remaining budget at one scope.
 *
 * `undefined` means **no limit at this scope** — which is not the same
 * as a limit of zero. A policy that declares no per-task budget has not
 * capped the task; it has said nothing about it.
 */
export type Remaining = BudgetAmount | undefined;

/**
 * The remaining budget at each scope.
 */
export interface BudgetState {
  /** The request's own limit. */
  readonly request: Remaining;
  /** The task's limit. */
  readonly task: Remaining;
  /** The workflow-day's limit. */
  readonly workflowDay: Remaining;
}

/**
 * The outcome of a budget check.
 */
export type BudgetCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: FactoryError;
      readonly scope: BudgetScope;
      readonly limitUsdMicros: number;
      readonly spentUsdMicros: number;
    };

/**
 * The remaining amount at one scope.
 *
 * A negative remainder is zero: a task that has overrun its budget has
 * no budget left, not a negative one to compare against.
 */
export const remainingOf = (amount: Remaining): number => {
  if (amount === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, amount.limitUsdMicros - amount.spentUsdMicros);
};

/**
 * The tightest scope, and what is left at it.
 *
 * The scopes are considered in the order `request`, `task`,
 * `workflow-day` — the tightest first — and the **first** one that
 * refuses is the one reported. Reporting the tightest scope rather than
 * an arbitrary one makes the refusal actionable: the operator learns
 * which limit to raise.
 */
const tightest = (
  state: BudgetState,
  projectedUsdMicros: number,
):
  | { readonly scope: BudgetScope; readonly amount: BudgetAmount }
  | undefined => {
  const scopes: readonly (readonly [BudgetScope, Remaining])[] = [
    ['request', state.request],
    ['task', state.task],
    ['workflow-day', state.workflowDay],
  ];

  for (const [scope, amount] of scopes) {
    if (amount === undefined) {
      continue;
    }
    if (projectedUsdMicros > remainingOf(amount)) {
      return { scope, amount };
    }
  }

  return undefined;
};

/**
 * Check a projected cost against the budget.
 *
 * @param state the remaining budget at each scope.
 * @param projectedUsdMicros the projected cost of the request, in micro-USD.
 */
export const checkBudget = (
  state: BudgetState,
  projectedUsdMicros: number,
): BudgetCheck => {
  const breach = tightest(state, projectedUsdMicros);

  if (breach === undefined) {
    return { ok: true };
  }

  return {
    ok: false,
    scope: breach.scope,
    limitUsdMicros: breach.amount.limitUsdMicros,
    spentUsdMicros: breach.amount.spentUsdMicros,
    error: factoryError(
      'budget.exhausted',
      `the projected cost of ${String(projectedUsdMicros)} micro-USD exceeds the ${breach.scope} budget`,
      false,
      {
        scope: breach.scope,
        limitUsdMicros: breach.amount.limitUsdMicros,
        spentUsdMicros: breach.amount.spentUsdMicros,
      },
    ),
  };
};
