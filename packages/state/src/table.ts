/**
 * The transition tables and the pure "is this edge allowed" question
 * (pack 03 §6).
 *
 * The tables themselves live in `@factory/contracts` — they are **verbatim**
 * from the pack and were delivered with T-1.01. This module adds the lookup
 * and the wildcard handling, so there is one table and one interpretation of
 * it.
 *
 * ## The wildcard row
 *
 * The pack's table has one row whose `from` is `'*nonTerminal*'`:
 *
 * ```
 * ['*nonTerminal*','ABANDONED','cancelledByHumanOrSuperseded'],
 * ```
 *
 * The pack annotates it: "ABANDONED has no incoming edge in the blueprint
 * diagram; 'cancelled or superseded' implies". So the row means "from every
 * non-terminal state", and it is **not** a state itself. `'*nonTerminal*'` is
 * not in `TASK_STATES`, and a transition *from* it is illegal.
 */

import {
  NODE_TRANSITIONS,
  NON_TERMINAL,
  TASK_STATES,
  TASK_TRANSITIONS,
  isTerminal,
  type NodeState,
  type TaskState,
} from '@factory/contracts';

import { evaluateGuard, evaluateNodeGuard, type GuardFacts } from './guards.js';

/**
 * A task transition, resolved against a concrete `from` state.
 */
export interface TaskTransition {
  readonly from: TaskState;
  readonly to: TaskState;
  /** The guard name, or `null` for an unconditional transition. */
  readonly guard: string | null;
  /** Whether the row came from the wildcard `*nonTerminal*` row. */
  readonly wildcard: boolean;
}

/**
 * The transitions out of a state, in table order.
 *
 * The wildcard row is expanded here, so `DRAFT` reports the wildcard row's
 * `ABANDONED` transition alongside its own rows.
 */
export const transitionsFrom = (state: TaskState): readonly TaskTransition[] => {
  const concrete: TaskTransition[] = [];
  const wildcard: TaskTransition[] = [];

  for (const [from, to, guard] of TASK_TRANSITIONS) {
    if (from === NON_TERMINAL) {
      if (!isTerminal(state)) {
        wildcard.push({ from: state, to, guard, wildcard: true });
      }
      continue;
    }
    if (from === state) {
      concrete.push({ from, to, guard, wildcard: false });
    }
  }

  return [...concrete, ...wildcard];
};

/**
 * Every transition in the table, with the wildcard row expanded against every
 * non-terminal state.
 *
 * This is the full edge set of the machine, and it is what the property
 * tests enumerate: "only table transitions succeed" is checked by asserting
 * that this set is exactly the set of transitions the machine accepts.
 */
export const allTaskTransitions = (): readonly TaskTransition[] => {
  const expanded: TaskTransition[] = [];
  for (const state of TASK_STATES) {
    expanded.push(...transitionsFrom(state));
  }
  return expanded;
};

/**
 * The guard for a specific edge, or `null`.
 *
 * A pair may have more than one row in principle; the first wins, and the
 * pack's table has no duplicate pairs.
 */
export const guardFor = (from: TaskState, to: TaskState): string | null => {
  for (const transition of transitionsFrom(from)) {
    if (transition.to === to) {
      return transition.guard;
    }
  }
  return null;
};

/**
 * Is the edge `(from, to)` in the table?
 *
 * This is the question the ticket calls "only table transitions succeed" —
 * the machine accepts an edge if and only if the table says so.
 */
export const isAllowedTransition = (from: TaskState, to: TaskState): boolean =>
  transitionsFrom(from).some((transition) => transition.to === to);

/**
 * Evaluate the guard on an edge.
 *
 * A transition with no guard always passes. An edge that is not in the table
 * has no guard, and evaluating it here is meaningless — the caller must
 * check `isAllowedTransition` first. For safety the function returns `false`
 * for an edge that is not in the table, so a caller that forgets the check
 * fails closed rather than open.
 */
export const checkGuard = (
  from: TaskState,
  to: TaskState,
  facts: GuardFacts,
): boolean => {
  if (!isAllowedTransition(from, to)) {
    return false;
  }
  return evaluateGuard(guardFor(from, to), facts);
};

/* -------------------------------------------------------------------------- */
/* The node machine                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The node transitions out of a state, in table order.
 */
export const nodeTransitionsFrom = (state: NodeState): readonly NodeState[] =>
  NODE_TRANSITIONS.filter(([from]) => from === state).map(([, to]) => to);

/**
 * Is the node edge `(from, to)` in the table?
 */
export const isAllowedNodeTransition = (from: NodeState, to: NodeState): boolean =>
  NODE_TRANSITIONS.some(([f, t]) => f === from && t === to);

/**
 * Evaluate the node edge's guard.
 *
 * An edge that is not in the table fails closed.
 */
export const checkNodeGuard = (
  from: NodeState,
  to: NodeState,
  facts: GuardFacts,
): boolean => {
  if (!isAllowedNodeTransition(from, to)) {
    return false;
  }
  return evaluateNodeGuard(from, to, facts);
};

/**
 * The node states that are terminal (blueprint `09` §3).
 */
export const isTerminalNodeState = (state: NodeState): boolean =>
  state === 'SUCCEEDED' || state === 'FAILED' || state === 'INCOMPLETE' || state === 'BLOCKED';
