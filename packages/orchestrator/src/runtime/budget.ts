/**
 * `runtime/budget` — **the stage budget** (T-1.13).
 *
 * ## What a budget is
 *
 * blueprint `08` §4.3 lists `budget.exhausted` as "A turn, wall-clock, token,
 * or cost budget was reached", and pack `02` §4.9 says:
 *
 * > Budget exhaustion ⇒ stage outcome `incomplete` with partial artefacts
 * > preserved and labelled (FR-32).
 *
 * So there are **four** dimensions — turns, wall-clock, tokens, cost — and
 * reaching any of them ends the stage as `incomplete`, **not** `failed`.
 * The difference is not cosmetic: an `incomplete` stage keeps its partial
 * artefacts, and a `failed` stage does not. Throwing away a nearly-finished
 * run because it ran out of tokens is the thing FR-32 forbids.
 *
 * ## The check is *before* the work
 *
 * The budget is checked **before** each step, not after it. A check after
 * the step would let the step that broke the budget finish — and for a
 * harness node that means code executed past its allowance. The check
 * before the step is the only one that bounds the work.
 *
 * ## The verdict is a *reason*, not a boolean
 *
 * A budget exhaustion must say **which** dimension ran out, because the
 * remedy differs: a turn budget needs a smaller decomposition, a cost budget
 * needs a cheaper model, a wall-clock budget needs a faster environment. A
 * boolean would collapse them into one indistinguishable refusal.
 */

import type { FailureClass } from '@factory/contracts';

import type { StageArtefact } from './ports.js';

/**
 * The budget dimensions.
 *
 * The order is the order they are checked in, and it is the order of
 * increasing "expensiveness of the mistake": a turn budget is the cheapest
 * thing to blow, a cost budget is the most expensive.
 */
export const BUDGET_DIMENSIONS = ['turns', 'wallClockMs', 'tokens', 'costUsdMicros'] as const;

export type BudgetDimension = (typeof BUDGET_DIMENSIONS)[number];

/**
 * A stage's budget — the limits and the spend so far.
 *
 * A limit that is `undefined` is **not a cap**: it means the dimension is
 * unbounded. This is the repo's convention for optional budgets
 * (`maxConcurrentTasks` and `maxConcurrent` are both optional in the
 * contracts, and "absent" is not "zero").
 */
export interface StageBudget {
  /** The maximum number of turns (model round-trips) the stage may take. */
  readonly maxTurns?: number;
  /** The maximum wall-clock time, in milliseconds. */
  readonly maxWallClockMs?: number;
  /** The maximum number of tokens the stage may spend. */
  readonly maxTokens?: number;
  /** The maximum cost, in integer micro-USD. */
  readonly maxCostUsdMicros?: number;
  /** The turns taken so far. */
  readonly turns?: number;
  /** The wall-clock time spent so far, in milliseconds. */
  readonly wallClockMs?: number;
  /** The tokens spent so far. */
  readonly tokens?: number;
  /** The cost spent so far, in integer micro-USD. */
  readonly spentUsdMicros?: number;
}

/**
 * The verdict of a budget check.
 */
export type BudgetVerdict =
  | { readonly exhausted: false }
  | {
      readonly exhausted: true;
      readonly dimension: BudgetDimension;
      readonly limit: number;
      readonly spent: number;
      readonly reason: string;
    };

/**
 * The failure class a budget exhaustion carries.
 *
 * It is the contracts' own `budget.exhausted` — not a new class. A budget
 * exhaustion is not a `model.reasoning` failure and not a
 * `verification.failure`; it is its own class, and the run record must say
 * so.
 */
export const BUDGET_FAILURE_CLASS: FailureClass = 'budget.exhausted';

/**
 * Check a budget.
 *
 * The dimensions are checked in the order of {@link BUDGET_DIMENSIONS}, and
 * the **first** exhausted one is reported. The first is the one that
 * actually stopped the stage; reporting a later one would name a limit the
 * stage never reached.
 *
 * @param budget the budget and the spend so far
 */
export const checkBudget = (budget: StageBudget): BudgetVerdict => {
  const turns = budget.turns ?? 0;
  if (budget.maxTurns !== undefined && turns >= budget.maxTurns) {
    return {
      exhausted: true,
      dimension: 'turns',
      limit: budget.maxTurns,
      spent: turns,
      reason: `the stage used ${turns} turns, which reaches its budget of ${budget.maxTurns}`,
    };
  }

  const wallClockMs = budget.wallClockMs ?? 0;
  if (budget.maxWallClockMs !== undefined && wallClockMs >= budget.maxWallClockMs) {
    return {
      exhausted: true,
      dimension: 'wallClockMs',
      limit: budget.maxWallClockMs,
      spent: wallClockMs,
      reason: `the stage spent ${wallClockMs}ms of wall-clock time, which reaches its budget of ${budget.maxWallClockMs}ms`,
    };
  }

  const tokens = budget.tokens ?? 0;
  if (budget.maxTokens !== undefined && tokens >= budget.maxTokens) {
    return {
      exhausted: true,
      dimension: 'tokens',
      limit: budget.maxTokens,
      spent: tokens,
      reason: `the stage spent ${tokens} tokens, which reaches its budget of ${budget.maxTokens}`,
    };
  }

  const spentUsdMicros = budget.spentUsdMicros ?? 0;
  if (budget.maxCostUsdMicros !== undefined && spentUsdMicros >= budget.maxCostUsdMicros) {
    return {
      exhausted: true,
      dimension: 'costUsdMicros',
      limit: budget.maxCostUsdMicros,
      spent: spentUsdMicros,
      reason: `the stage spent ${spentUsdMicros} micro-USD, which reaches its budget of ${budget.maxCostUsdMicros} micro-USD`,
    };
  }

  return { exhausted: false };
};

/**
 * The **label** a partial artefact carries when the stage ended incomplete.
 *
 * FR-32: "partial artefacts preserved and labelled". The label is what makes
 * a partial artefact distinguishable from a finished one — a consumer that
 * reads an artefact without checking the label would otherwise treat a
 * half-written file as a result.
 */
export const INCOMPLETE_ARTEFACT_LABEL = 'incomplete';

/**
 * An artefact a stage produced.
 *
 * Re-exported from `ports.ts`, which owns the shape — the type is a port's
 * data, not a budget rule. The *label* is what makes FR-32's promise
 * checkable: a partial artefact is **preserved** and **labelled**
 * `incomplete`, so a consumer can tell a finished artefact from a fragment
 * of one without asking the stage that produced it.
 */
export type { StageArtefact } from './ports.js';

/**
 * Label a set of partial artefacts as incomplete.
 *
 * The label is applied to **every** artefact, not just some: a consumer
 * cannot tell which half of a stage's output is trustworthy, so the whole
 * set carries the label.
 */
export const labelIncomplete = (
  artefacts: readonly StageArtefact[],
): readonly StageArtefact[] =>
  artefacts.map((artefact) => ({
    ref: artefact.ref,
    sha256: artefact.sha256,
    label: INCOMPLETE_ARTEFACT_LABEL,
  }));

/**
 * Is this artefact a labelled partial?
 */
export const isIncompleteArtefact = (artefact: StageArtefact): boolean =>
  artefact.label === INCOMPLETE_ARTEFACT_LABEL;
