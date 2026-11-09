/**
 * State-machine contracts — pack 03 §6 (the machine-readable tables).
 *
 * ```ts
 * export const TASK_STATES = ['DRAFT','TRIAGED','REFINED','PLANNED','QUEUED','RUNNING','VERIFYING','AWAITING_REVIEW',
 *   'AWAITING_APPROVAL','APPROVED','MERGING','MERGED','DEPLOYING','DEPLOYED','REJECTED','FAILED','ABANDONED','INCOMPLETE','ESCALATED'] as const; // 19
 * export const TERMINAL = ['MERGED','DEPLOYED','REJECTED','FAILED','ABANDONED','INCOMPLETE'] as const;                              // ESCALATED is resumable
 * export const NODE_STATES = ['PENDING','READY','LEASED','RUNNING','SUCCEEDED','FAILED','INCOMPLETE','BLOCKED'] as const;                         // 8
 * ```
 *
 * **Nineteen, not twenty.** blueprint `16` (the roadmap) says "20 states";
 * blueprint `09` §2.1 lists 19 and **is authoritative** (checklist 02 trap
 * 6: "Implementing the 20th task state because the roadmap says 20. `09`
 * §2.1 lists 19 and is authoritative. Inventing a state breaks the table.").
 *
 * The pack's inline annotation on `MERGED` — "code path" — is reproduced as
 * prose here: a nested block comment would close this doc comment early.
 * It means `MERGED` is terminal *for the code path*; a deployment workflow
 * continues from it to `DEPLOYING`.
 */

import { z } from 'zod';

import { Actor, Authority } from './shared.js';

/** The 19 task states (pack 03 §6). */
export const TASK_STATES = [
  'DRAFT',
  'TRIAGED',
  'REFINED',
  'PLANNED',
  'QUEUED',
  'RUNNING',
  'VERIFYING',
  'AWAITING_REVIEW',
  'AWAITING_APPROVAL',
  'APPROVED',
  'MERGING',
  'MERGED',
  'DEPLOYING',
  'DEPLOYED',
  'REJECTED',
  'FAILED',
  'ABANDONED',
  'INCOMPLETE',
  'ESCALATED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TaskState = z.enum(TASK_STATES);

/**
 * The terminal states (pack 03 §6).
 *
 * "`ESCALATED` is resumable" — it is deliberately **not** terminal, even
 * though it means "requires human intervention".
 */
export const TERMINAL = [
  'MERGED',
  'DEPLOYED',
  'REJECTED',
  'FAILED',
  'ABANDONED',
  'INCOMPLETE',
] as const;

export type TerminalState = (typeof TERMINAL)[number];

export const TerminalState = z.enum(TERMINAL);

export const isTerminal = (state: TaskState): boolean =>
  (TERMINAL as readonly string[]).includes(state);

/** The 8 node states (pack 03 §6). */
export const NODE_STATES = [
  'PENDING',
  'READY',
  'LEASED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'INCOMPLETE',
  'BLOCKED',
] as const;

export type NodeState = (typeof NODE_STATES)[number];

export const NodeState = z.enum(NODE_STATES);

/**
 * The wildcard source used by the `ABANDONED` row.
 *
 * It is not a real state — it matches every non-terminal state.
 */
export const NON_TERMINAL = '*nonTerminal*';

/**
 * A transition row: `[from, to, guard]`.
 *
 * A `null` guard means the transition is unconditional. The `from` may be the
 * wildcard `'*nonTerminal*'` (see `NON_TERMINAL`), which matches every
 * non-terminal state — it is not itself a state.
 */
export type TaskTransitionRow = readonly [TaskState | typeof NON_TERMINAL, TaskState, string | null];

/**
 * The task transition table (pack 03 §6) — **verbatim**.
 *
 * The `[PACK]` rows and comments are reproduced because they carry
 * normative meaning: the wildcard `ABANDONED` row and the comment about
 * `DEPLOYING` being hard-false in v1.
 */
export const TASK_TRANSITIONS: readonly TaskTransitionRow[] = [
  ['DRAFT', 'TRIAGED', null],
  ['DRAFT', 'REJECTED', null],
  ['TRIAGED', 'REFINED', 'specHasCheckableCriterionAndOracleRef'],
  ['TRIAGED', 'FAILED', null],
  ['REFINED', 'PLANNED', null],
  ['REFINED', 'ESCALATED', null],
  [
    'PLANNED',
    'QUEUED',
    'graphAdmissible+oracleAdmitted+planApprovalValid',
  ],
  ['PLANNED', 'ESCALATED', null],
  ['QUEUED', 'RUNNING', null],
  ['RUNNING', 'QUEUED', null],
  ['RUNNING', 'VERIFYING', 'allNodesTerminal'],
  ['RUNNING', 'ESCALATED', null],
  ['RUNNING', 'INCOMPLETE', null],
  ['VERIFYING', 'AWAITING_REVIEW', 'allApplicableGatesPassedIncludingOracle'],
  ['VERIFYING', 'RUNNING', 'iterationBudgetRemains'],
  ['VERIFYING', 'FAILED', 'iterationBudgetExhausted'],
  ['AWAITING_REVIEW', 'AWAITING_APPROVAL', 'requiredApprovalClassIdentified'],
  ['AWAITING_REVIEW', 'REJECTED', null],
  ['AWAITING_REVIEW', 'ESCALATED', 'reviewFatigueThreshold'],
  ['AWAITING_APPROVAL', 'APPROVED', 'approvalValidUnexpiredBound'],
  ['AWAITING_APPROVAL', 'REJECTED', null],
  ['APPROVED', 'MERGING', 'autonomyPermitsOrHumanInitiated'],
  ['MERGING', 'MERGED', null],
  ['MERGING', 'FAILED', null],
  ['MERGED', 'DEPLOYING', 'deploymentTargetInRunbookSet'],
  ['DEPLOYING', 'DEPLOYED', null],
  ['DEPLOYING', 'FAILED', null],
  ['ESCALATED', 'QUEUED', null],
  ['ESCALATED', 'REJECTED', null],
  ['INCOMPLETE', 'ESCALATED', null],
  ['*nonTerminal*', 'ABANDONED', 'cancelledByHumanOrSuperseded'],
] as const;

/**
 * The node transition table (pack 03 §6) — **verbatim**.
 *
 * The comment "retry only if policy permits" is attached to `FAILED → READY`
 * and is load-bearing: the retry guard is the policy decision, not the table.
 */
export const NODE_TRANSITIONS: readonly (readonly [NodeState, NodeState])[] = [
  ['PENDING', 'READY'],
  ['PENDING', 'BLOCKED'],
  ['READY', 'LEASED'],
  ['LEASED', 'RUNNING'],
  ['LEASED', 'READY'],
  ['RUNNING', 'SUCCEEDED'],
  ['RUNNING', 'FAILED'],
  ['RUNNING', 'INCOMPLETE'],
  ['RUNNING', 'BLOCKED'],
  ['FAILED', 'READY'],
] as const;

/**
 * The named guards (pack 03 §6, third element of each row).
 *
 * The guard *names* are normative; their implementations live in
 * `packages/state` (T-1.04).
 */
export const TASK_GUARDS = [
  'specHasCheckableCriterionAndOracleRef',
  'graphAdmissible+oracleAdmitted+planApprovalValid',
  'allNodesTerminal',
  'allApplicableGatesPassedIncludingOracle',
  'iterationBudgetRemains',
  'iterationBudgetExhausted',
  'requiredApprovalClassIdentified',
  'reviewFatigueThreshold',
  'approvalValidUnexpiredBound',
  'autonomyPermitsOrHumanInitiated',
  'deploymentTargetInRunbookSet',
  'cancelledByHumanOrSuperseded',
] as const;

export type TaskGuard = (typeof TASK_GUARDS)[number];

export const TaskGuard = z.enum(TASK_GUARDS);

/**
 * The escalation triggers (pack 03 §6).
 *
 * "Escalation triggers (any → `ESCALATED`): review-fatigue threshold,
 * unresolvable conflict, policy escalation, repeated classification,
 * `resume_failed`, `not_reproducible`."
 */
export const ESCALATION_TRIGGERS = [
  'review-fatigue',
  'unresolvable-conflict',
  'policy-escalation',
  'repeated-classification',
  'resume_failed',
  'not_reproducible',
] as const;

export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export const EscalationTrigger = z.enum(ESCALATION_TRIGGERS);

/**
 * The transition command (pack 03 §3, `StateMachine.transition`).
 */
export const TransitionCommand = z
  .object({
    taskId: z.string().min(1),
    to: TaskState,
    trigger: z.string().min(1),
    actor: Actor,
    authority: Authority,
    expectedVersion: z.number().int().nonnegative(),
    payload: z.unknown().optional(),
  })
  .strict();

export type TransitionCommand = z.infer<typeof TransitionCommand>;

/**
 * The snapshot a transition returns.
 */
export const TaskSnapshot = z
  .object({
    taskId: z.string().min(1),
    state: TaskState,
    version: z.number().int().nonnegative(),
  })
  .strict();

export type TaskSnapshot = z.infer<typeof TaskSnapshot>;

/**
 * The state-machine interface (pack 03 §3).
 *
 * ```ts
 * export interface StateMachine {
 *   transition(cmd: { taskId: string; to: TaskState; trigger: string; actor: Actor; authority: Authority;
 *     expectedVersion: number; payload?: unknown }): Promise<Result<TaskSnapshot, 'IllegalTransition'|'GuardFailed'|'ConcurrencyError'>>;
 * }
 * ```
 */
export interface StateMachine {
  transition(cmd: TransitionCommand): Promise<
    | { readonly ok: true; readonly value: TaskSnapshot }
    | {
        readonly ok: false;
        readonly error: 'IllegalTransition' | 'GuardFailed' | 'ConcurrencyError';
      }
  >;
}
