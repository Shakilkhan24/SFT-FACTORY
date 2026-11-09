/**
 * `state` — the state machines (checklist 02, T-1.04).
 *
 * pack 03 §6 (the machine-readable tables), blueprint `09` §2–§3.
 *
 * The package holds:
 *
 * * the **transition tables** — re-exported from `@factory/contracts`, which
 *   carries them **verbatim** from the pack. There is one table, not two
 *   that can drift;
 * * the **pure guards** — one implementation per guard name in the table,
 *   each a pure function of a snapshot and a set of facts;
 * * `transition()` — the machine itself, over the event log;
 * * the **replay** projection — the state rebuilt from the log alone.
 *
 * ## Nineteen task states, not twenty
 *
 * The roadmap says "20 states"; blueprint `09` §2.1 lists 19 and **is
 * authoritative** (checklist 02 trap 6). The twentieth state was not
 * invented to make the numbers agree. See `packages/contracts/src/state.ts`.
 */

export {
  TASK_STATES,
  TERMINAL,
  NODE_STATES,
  NON_TERMINAL,
  TASK_TRANSITIONS,
  NODE_TRANSITIONS,
  TASK_GUARDS,
  ESCALATION_TRIGGERS,
  isTerminal,
  type TaskState,
  type NodeState,
  type TaskGuard,
  type TaskTransitionRow,
  type EscalationTrigger,
} from '@factory/contracts';

export {
  evaluateGuard,
  evaluateNodeGuard,
  TASK_GUARD_IMPLEMENTATIONS,
  NODE_GUARDS,
  TERMINAL_NODE_STATES,
  type Guard,
  type GuardFacts,
  type GuardFailure,
  type GuardVerdict,
} from './guards.js';

export {
  allTaskTransitions,
  checkGuard,
  checkNodeGuard,
  guardFor,
  isAllowedNodeTransition,
  isAllowedTransition,
  isTerminalNodeState,
  nodeTransitionsFrom,
  transitionsFrom,
  type TaskTransition,
} from './table.js';

export {
  GuardFailedError,
  IllegalTransitionError,
  StateConcurrencyError,
  StateMachineError,
  type StateMachineErrorKind,
} from './errors.js';

export {
  StateMachine,
  type LockedTaskContext,
  type StateMachineStore,
  type TransitionOutcome,
  type TransitionRequest,
} from './transition.js';

export {
  isTransitionEvent,
  replayTask,
  replayTaskFrom,
  type ReplayedTask,
  type TransitionPayload,
} from './replay.js';
