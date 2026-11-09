/**
 * The transition guards (pack 03 §6, blueprint `09` §2.3).
 *
 * A guard is a **pure function** over the current snapshot and the facts the
 * transition carries. It reads no database, calls no clock, and makes no
 * network call. That is what makes the state machine testable: the same
 * snapshot and the same facts always give the same verdict, so a guard
 * failure is reproducible rather than a thing that happened once.
 *
 * blueprint `09` §2.3: "Every transition is guarded. A guard is evaluated
 * against current state plus the policy decision for the action."
 *
 * The guard *names* are normative and come from the pack's table verbatim.
 * This file supplies their implementations.
 */

import {
  NODE_STATES,
  NODE_TRANSITIONS,
  TASK_GUARDS,
  TASK_STATES,
  type NodeState,
  type TaskGuard,
} from '@factory/contracts';

/**
 * The facts a guard may look at.
 *
 * Everything here is *input*, not something the guard fetches. A guard that
 * needed to read the database would not be pure, and a guard that needed the
 * current time would not be reproducible — so both are passed in.
 */
export interface GuardFacts {
  /**
   * The task's autonomy level (L0–L4).
   *
   * blueprint `09` §2.3: "the autonomy level permits merging (≥ L3), or the
   * merge is a human-initiated action through an access point."
   */
  readonly autonomyLevel?: number;

  /**
   * The policy decision for the action, when one was made.
   *
   * The decision is an *input* to the guard, not something the guard
   * produces — the policy engine is T-1.05 and runs separately. A decision
   * of `DENY` always fails a guard.
   */
  readonly policyDecision?: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

  /** The number of checkable acceptance criteria in the specification. */
  readonly criteriaCount?: number;

  /** The specification's oracle reference, when it has one. */
  readonly oracleRef?: string | null;

  /** The task graph, for the admissibility guard. */
  readonly graph?: {
    readonly acyclic?: boolean;
    readonly fanOutEdgesJustified?: boolean;
    readonly capabilitiesWithinGrant?: boolean;
    readonly oracleAdmitted?: boolean;
    readonly planApprovalValid?: boolean;
  } | null;

  /** The node states of the task, for the "all nodes terminal" guard. */
  readonly nodeStates?: readonly NodeState[];

  /** Whether every applicable gate passed, including the acceptance oracle. */
  readonly gatesPassed?: boolean;

  /** Whether the iteration budget still has room. */
  readonly iterationBudgetRemains?: boolean;

  /** The approval class required for the task's blast-radius tier. */
  readonly requiredApprovalClass?: string | null;

  /** The approval backing the task, when there is one. */
  readonly approval?: {
    readonly exists?: boolean;
    readonly unexpired?: boolean;
    readonly boundToArtefact?: boolean;
    readonly artefactSha256?: string | null;
  } | null;

  /** The SHA the approval was granted against. */
  readonly approvedSha?: string | null;

  /**
   * The PR head SHA observed at merge time.
   *
   * ADR-0003: the merge may only proceed if the head still equals the
   * approved SHA. A PR whose head has moved is not the PR that was approved.
   */
  readonly headSha?: string | null;

  /** The review-fatigue threshold: how many reviews the task has had. */
  readonly reviewCount?: number;

  /** The review-fatigue threshold above which the task escalates. */
  readonly reviewFatigueThreshold?: number;

  /** The deployment target, and whether it is in the workflow's runbook set. */
  readonly deploymentTarget?: string | null;
  readonly deploymentTargetInRunbookSet?: boolean;

  /** Whether a human cancelled the task, or superseded it. */
  readonly cancelledByHuman?: boolean;
  readonly superseded?: boolean;

  /**
   * Whether the action arrived through a **human access point**.
   *
   * blueprint `09` §2.3: "or the merge is a human-initiated action through
   * an access point." This is the L2 escape hatch, and it is deliberately
   * narrow: it says *who initiated*, not *who authorised*.
   */
  readonly humanInitiated?: boolean;

  /** The access point through which a human initiated the action, if any. */
  readonly accessPoint?: string | null;

  /** The trigger that fired, for escalation transitions. */
  readonly escalationTrigger?: string | null;

  /** Whether a policy decision permitted the node retry. */
  readonly retryPermittedByPolicy?: boolean;

  /** Whether the node's lease has expired. */
  readonly leaseExpired?: boolean;
}

/**
 * The result of evaluating a guard.
 *
 * A guard that returns `false` does not say *why* it failed, because the
 * reason is often useful to a human and useless to a machine. The reason is
 * carried separately in {@link GuardFailure}.
 */
export type GuardVerdict = boolean;

export interface GuardFailure {
  readonly guard: string;
  readonly reason: string;
}

/**
 * The evaluator signature.
 *
 * `facts` is optional so a guard can be evaluated against a snapshot alone
 * when the transition carries no extra facts — but the transition table
 * names a guard precisely when the transition needs facts, so in practice a
 * named guard that receives no facts should fail closed.
 */
export type Guard = (facts: GuardFacts) => GuardVerdict;

/**
 * The terminal node states (blueprint `09` §3).
 *
 * "Every node is in a terminal state (`succeeded`, `failed`, or `skipped`)".
 * `SKIPPED` is not one of the 8 node states in v1 — a skipped node is
 * recorded as `SUCCEEDED` with a reason — so the terminal set is the three
 * that the 8 states provide.
 */
export const TERMINAL_NODE_STATES: readonly NodeState[] = ['SUCCEEDED', 'FAILED', 'INCOMPLETE'];

/**
 * The node transition table (pack 03 §6) — **verbatim**.
 *
 * Re-exported from `@factory/contracts` rather than copied, so there is one
 * table and not two that can drift.
 */
export const NODE_TRANSITION_ROWS = NODE_TRANSITIONS;

/* -------------------------------------------------------------------------- */
/* The task guards                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `TRIAGED → REFINED` — "The specification contains at least one checkable
 * acceptance criterion and an oracle reference."
 */
const specHasCheckableCriterionAndOracleRef: Guard = (facts) => {
  const criteria = facts.criteriaCount ?? 0;
  const oracle = facts.oracleRef;
  return criteria > 0 && typeof oracle === 'string' && oracle.length > 0;
};

/**
 * `PLANNED → QUEUED` — "The graph is acyclic; every fan-out edge carries a
 * valid chunkability justification; every node's required capabilities are
 * within the workflow's grant."
 *
 * The pack names the guard `graphAdmissible+oracleAdmitted+planApprovalValid`
 * — a conjunction of three checks, so all three must hold.
 */
const graphAdmissibleAndOracleAdmittedAndPlanApprovalValid: Guard = (facts) => {
  const graph = facts.graph;
  if (graph === null || graph === undefined) {
    return false;
  }
  return (
    graph.acyclic === true &&
    graph.fanOutEdgesJustified === true &&
    graph.capabilitiesWithinGrant === true &&
    graph.oracleAdmitted === true &&
    graph.planApprovalValid === true
  );
};

/**
 * `RUNNING → VERIFYING` — "Every node is in a terminal state (`succeeded`,
 * `failed`, or `skipped`); skipped nodes carry a reason."
 */
const allNodesTerminal: Guard = (facts) => {
  const states = facts.nodeStates;
  if (states === undefined || states.length === 0) {
    return false;
  }
  return states.every((state) => TERMINAL_NODE_STATES.includes(state));
};

/**
 * `VERIFYING → AWAITING_REVIEW` — "Every applicable gate passed, including
 * the acceptance oracle (FR-51)."
 */
const allApplicableGatesPassedIncludingOracle: Guard = (facts) =>
  facts.gatesPassed === true;

/**
 * `VERIFYING → RUNNING` — the iteration budget still has room.
 */
const iterationBudgetRemains: Guard = (facts) => facts.iterationBudgetRemains === true;

/**
 * `VERIFYING → FAILED` — the iteration budget is exhausted.
 */
const iterationBudgetExhausted: Guard = (facts) => facts.iterationBudgetRemains === false;

/**
 * `AWAITING_REVIEW → AWAITING_APPROVAL` — "The required approval class for
 * the blast-radius tier is identified."
 */
const requiredApprovalClassIdentified: Guard = (facts) => {
  const approvalClass = facts.requiredApprovalClass;
  return typeof approvalClass === 'string' && approvalClass.length > 0;
};

/**
 * `AWAITING_REVIEW → ESCALATED` — the review-fatigue threshold fires.
 */
const reviewFatigueThreshold: Guard = (facts) => {
  const count = facts.reviewCount;
  const threshold = facts.reviewFatigueThreshold;
  if (count === undefined || threshold === undefined) {
    return false;
  }
  return count >= threshold;
};

/**
 * `AWAITING_APPROVAL → APPROVED` — "An approval exists, is unexpired, and is
 * bound to this artefact's hash (FR-74)."
 */
const approvalValidUnexpiredBound: Guard = (facts) => {
  const approval = facts.approval;
  if (approval === null || approval === undefined) {
    return false;
  }
  return (
    approval.exists === true &&
    approval.unexpired === true &&
    approval.boundToArtefact === true
  );
};

/**
 * `APPROVED → MERGING` — **the autonomy ladder, enforced mechanically.**
 *
 * blueprint `09` §2.3: "The policy engine authorises the merge at the
 * workflow's autonomy level; the autonomy level permits merging (≥ L3), or
 * the merge is a human-initiated action through an access point."
 *
 * ADR-0003's FR-04: a workflow at **L2 cannot merge autonomously** — the
 * merge must arrive via a human access point, and the PR head SHA must still
 * equal the approved SHA.
 *
 * The two routes are:
 *
 * 1. **Autonomy permits it.** The task's autonomy level is ≥ L3 *and* the
 *    policy engine allowed the merge. At L2 this route is closed, always —
 *    there is no policy decision that opens it, because the ladder is a
 *    property of the level, not of the decision.
 * 2. **A human initiated it.** The action arrived through a human access
 *    point, and the observed PR head SHA equals the SHA that was approved.
 *    A moved head means a different code was approved than the code being
 *    merged, so the SHA comparison is mandatory — a human-initiated merge
 *    with a stale head is refused.
 *
 * A `DENY` policy decision fails both routes. The decision is the policy
 * engine's verdict; the guard does not second-guess it.
 */
const autonomyPermitsOrHumanInitiated: Guard = (facts) => {
  // A policy decision of DENY is fatal to every route. REQUIRE_APPROVAL is
  // not a DENY, but it is not an ALLOW either, so it cannot authorise the
  // autonomy route.
  const decision = facts.policyDecision;
  if (decision === 'DENY') {
    return false;
  }

  // Route 1: autonomy ≥ L3 with an allowing policy decision.
  const level = facts.autonomyLevel;
  if (level !== undefined && level >= 3 && decision === 'ALLOW') {
    return true;
  }

  // Route 2: a human-initiated merge through an access point, whose head SHA
  // still matches the approved SHA.
  if (facts.humanInitiated !== true) {
    return false;
  }
  if (typeof facts.accessPoint !== 'string' || facts.accessPoint.length === 0) {
    return false;
  }
  const approved = facts.approvedSha;
  const head = facts.headSha;
  if (approved === null || approved === undefined || approved.length === 0) {
    return false;
  }
  if (head === null || head === undefined || head.length === 0) {
    return false;
  }
  return approved === head;
};

/**
 * `MERGED → DEPLOYING` — "The deployment target is in the enumerated runbook
 * set for the workflow's level; production access is permitted."
 *
 * The pack annotates this row: "v1: guard is hard-false (no deploy
 * capability exists)". The annotation is load-bearing — v1 registers no
 * `prod.read|write` scope (pack 03 §7), so the deployment target set is
 * empty and the guard can never pass. It is implemented as hard-false rather
 * than as "an empty runbook set", because an empty set and a missing set are
 * different failures and only one of them is true in v1.
 */
const deploymentTargetInRunbookSet: Guard = () => false;

/**
 * `*nonTerminal* → ABANDONED` — "cancelled or superseded".
 */
const cancelledByHumanOrSuperseded: Guard = (facts) =>
  facts.cancelledByHuman === true || facts.superseded === true;

/**
 * The task guards, keyed by the pack's guard names.
 *
 * Every name in `TASK_GUARDS` has an entry here — that completeness is
 * asserted by a test, because a guard name in the table with no
 * implementation would silently become "always false" (or, worse, always
 * true).
 */
export const TASK_GUARD_IMPLEMENTATIONS: Readonly<Record<TaskGuard, Guard>> = {
  specHasCheckableCriterionAndOracleRef,
  // The pack names this guard with `+` separators, so the key is quoted.
  'graphAdmissible+oracleAdmitted+planApprovalValid':
    graphAdmissibleAndOracleAdmittedAndPlanApprovalValid,
  allNodesTerminal,
  allApplicableGatesPassedIncludingOracle,
  iterationBudgetRemains,
  iterationBudgetExhausted,
  requiredApprovalClassIdentified,
  reviewFatigueThreshold,
  approvalValidUnexpiredBound,
  autonomyPermitsOrHumanInitiated,
  deploymentTargetInRunbookSet,
  cancelledByHumanOrSuperseded,
};

/**
 * Evaluate a named guard.
 *
 * An unknown guard name **fails closed**. A typo in the transition table, or
 * a guard that has not been implemented yet, must not open a transition.
 */
export const evaluateGuard = (
  guard: string | null,
  facts: GuardFacts,
): GuardVerdict => {
  if (guard === null) {
    return true;
  }
  const implementation = TASK_GUARD_IMPLEMENTATIONS[guard as TaskGuard];
  if (implementation === undefined) {
    return false;
  }
  return implementation(facts);
};

/**
 * The node transition guards.
 *
 * The pack's node table has no third column, but two of its rows carry
 * conditions in prose:
 *
 * * `LEASED → READY` — "lease expired, re-lequeued" (blueprint `09` §3).
 *   Without this, a node could be released back to the queue while its
 *   lease is still live, and two workers could run it.
 * * `FAILED → READY` — "retry only if policy permits".
 *
 * They are named here rather than invented into the table, because the table
 * is **verbatim** from the pack and must not be edited.
 */
export const NODE_GUARDS: Readonly<
  Record<string, (facts: GuardFacts) => GuardVerdict>
> = {
  /** `LEASED → READY`: the lease expired. */
  'LEASED->READY': (facts) => facts.leaseExpired === true,
  /** `FAILED → READY`: policy permits the retry. */
  'FAILED->READY': (facts) => facts.retryPermittedByPolicy === true,
};

/**
 * Evaluate a node transition's guard, if it has one.
 *
 * The guard is named by the edge, so the table stays verbatim.
 */
export const evaluateNodeGuard = (
  from: NodeState,
  to: NodeState,
  facts: GuardFacts,
): GuardVerdict => {
  const guard = NODE_GUARDS[`${from}->${to}`];
  if (guard === undefined) {
    return true;
  }
  return guard(facts);
};

/**
 * The states that exist, re-exported for convenience.
 */
export const ALL_TASK_STATES = TASK_STATES;
export const ALL_NODE_STATES = NODE_STATES;

/**
 * A compile-time check that every guard name in the pack's list has an
 * implementation.
 *
 * This is a *type* check, not a runtime one: if the pack ever adds a guard
 * name without an implementation, this line stops compiling. The runtime
 * counterpart lives in the tests, because the two fail differently — the
 * type check catches a missing implementation at build time, the runtime
 * check catches an implementation that was removed from the map while the
 * type stayed.
 */
type GuardCoverage = Record<TaskGuard, true>;
const _guardCoverage: GuardCoverage = {
  specHasCheckableCriterionAndOracleRef: true,
  'graphAdmissible+oracleAdmitted+planApprovalValid': true,
  allNodesTerminal: true,
  allApplicableGatesPassedIncludingOracle: true,
  iterationBudgetRemains: true,
  iterationBudgetExhausted: true,
  requiredApprovalClassIdentified: true,
  reviewFatigueThreshold: true,
  approvalValidUnexpiredBound: true,
  autonomyPermitsOrHumanInitiated: true,
  deploymentTargetInRunbookSet: true,
  cancelledByHumanOrSuperseded: true,
};
void _guardCoverage;
void TASK_GUARDS;
