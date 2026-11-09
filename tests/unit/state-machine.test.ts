/**
 * T-1.04 — the state machine's properties.
 *
 * The ticket's oracle is a **property** test, not a set of examples:
 *
 * > **property tests**: only table transitions succeed; every accepted
 * > transition appends ≥1 event; replaying events reproduces the state;
 * > `APPROVED→MERGING` refused at L2 unless the trigger is human-initiated
 * > with a matching SHA; ABANDONED reachable from any non-terminal; the node
 * > machine includes lease-expiry.
 *
 * A property test is the right shape here because the claim is about
 * *every* state pair, not about a few. "Only table transitions succeed"
 * means all 19 × 19 = 361 pairs — so all 361 are checked, and the check is
 * the table itself rather than a hand-written list that could drift from it.
 *
 * The machine is pure (pack 02 §3), so it runs against an in-memory store
 * and these tests need no database.
 */

import { describe, expect, it } from 'vitest';

import {
  NODE_STATES,
  TASK_STATES,
  allTaskTransitions,
  checkGuard,
  checkNodeGuard,
  evaluateGuard,
  guardFor,
  isAllowedNodeTransition,
  isAllowedTransition,
  isTerminal,
  nodeTransitionsFrom,
  replayTask,
  StateMachine,
  TASK_GUARD_IMPLEMENTATIONS,
  TASK_GUARDS,
  transitionsFrom,
  type GuardFacts,
  type NodeState,
  type TaskState,
} from '../../packages/state/src/index.ts';
import { MemoryStateMachineStore } from '../helpers/state.ts';

const ACTOR = { kind: 'agent' as const, id: 'agent_test' };
const AUTHORITY = { basis: 'system-rule' as const };

/**
 * A command for a transition.
 */
const cmd = (overrides: {
  readonly taskId?: string;
  readonly to: TaskState;
  readonly expectedVersion?: number;
  readonly facts?: GuardFacts;
}) => ({
  taskId: overrides.taskId ?? 'tsk_prop',
  to: overrides.to,
  trigger: 'test',
  actor: ACTOR,
  authority: AUTHORITY,
  expectedVersion: overrides.expectedVersion ?? 0,
  eventType: 'request.triaged' as const,
  ...(overrides.facts === undefined ? {} : { facts: overrides.facts }),
});

/**
 * A store with one task in the given state.
 */
const storeWith = (state: TaskState, taskId = 'tsk_prop'): MemoryStateMachineStore => {
  const store = new MemoryStateMachineStore();
  store.addTask({ id: taskId, state, version: 0, autonomyLevel: 2 });
  return store;
};

/**
 * The facts that satisfy every guard.
 *
 * The machine's guards are checked individually; this is the "everything is
 * fine" bundle used when the test is about the *table* rather than about a
 * particular guard.
 */
const satisfiedFacts: GuardFacts = {
  criteriaCount: 3,
  oracleRef: 'orc_1',
  graph: {
    acyclic: true,
    fanOutEdgesJustified: true,
    capabilitiesWithinGrant: true,
    oracleAdmitted: true,
    planApprovalValid: true,
  },
  nodeStates: ['SUCCEEDED', 'FAILED', 'INCOMPLETE'],
  gatesPassed: true,
  iterationBudgetRemains: true,
  requiredApprovalClass: 'merge',
  approval: { exists: true, unexpired: true, boundToArtefact: true },
  approvedSha: 'sha256:abc',
  headSha: 'sha256:abc',
  reviewCount: 0,
  reviewFatigueThreshold: 3,
  deploymentTargetInRunbookSet: true,
  cancelledByHuman: true,
  humanInitiated: true,
  accessPoint: 'github',
  leaseExpired: true,
  retryPermittedByPolicy: true,
};

/**
 * The facts that satisfy a **specific** edge's guard.
 *
 * Some guards are mutually exclusive — `iterationBudgetRemains` and
 * `iterationBudgetExhausted` are opposites — so one bundle cannot satisfy
 * every edge. This resolves the facts per edge, so a property test over the
 * whole table can assert that every edge is *reachable* without weakening
 * any guard to make it so.
 */
const factsFor = (from: TaskState, to: TaskState): GuardFacts => {
  const base: GuardFacts = { ...satisfiedFacts };

  // `VERIFYING → RUNNING` needs budget remaining; `VERIFYING → FAILED` needs
  // it exhausted. They are opposites by design.
  if (from === 'VERIFYING' && to === 'FAILED') {
    return { ...base, iterationBudgetRemains: false };
  }

  // `AWAITING_REVIEW → ESCALATED` fires when the review-fatigue threshold
  // is reached, so the review count must be at or above it.
  if (from === 'AWAITING_REVIEW' && to === 'ESCALATED') {
    return { ...base, reviewCount: base.reviewFatigueThreshold ?? 3 };
  }

  // `MERGED → DEPLOYING`'s guard is hard-false in v1, so no facts can
  // satisfy it. The test that checks the table's reachability excludes it
  // deliberately.
  return base;
};

describe('T-1.04 · the task state machine', () => {
  it('A1.25 has exactly 19 task states and 8 node states', () => {
    // The roadmap says "20 states". blueprint `09` §2.1 lists 19 and is
    // authoritative (checklist 02 trap 6). The twentieth was not invented.
    expect(TASK_STATES).toHaveLength(19);
    expect(NODE_STATES).toHaveLength(8);
    expect(new Set(TASK_STATES).size).toBe(19);
    expect(new Set(NODE_STATES).size).toBe(8);
  });

  it('A1.25 every guard name in the pack has an implementation', () => {
    // A guard name in the table with no implementation would silently
    // become "always false" — or, worse, "always true".
    for (const guard of TASK_GUARDS) {
      expect(
        TASK_GUARD_IMPLEMENTATIONS[guard],
        `guard ${guard} has no implementation`,
      ).toBeTypeOf('function');
    }
  });

  it('A1.25 an unknown guard name fails closed', () => {
    // A typo in the table must not open a transition.
    expect(evaluateGuard('noSuchGuard', satisfiedFacts)).toBe(false);
    expect(evaluateGuard(null, satisfiedFacts)).toBe(true);
  });

  it('A1.26 only table transitions succeed', async () => {
    // All 19 × 19 = 361 pairs. The table is the oracle: a pair is allowed
    // if and only if `isAllowedTransition` says so, and the machine accepts
    // exactly those.
    const allowed = new Set(
      allTaskTransitions().map((transition) => `${transition.from}->${transition.to}`),
    );

    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        const key = `${from}->${to}`;
        const inTable = allowed.has(key);

        // The table lookup and the transition list agree.
        expect(isAllowedTransition(from, to), `isAllowedTransition ${key}`).toBe(
          inTable,
        );

        // The machine agrees with the table: an edge that is not in the
        // table is refused as `IllegalTransition`, and one that is in the
        // table gets as far as its guard.
        const store = storeWith(from);
        const machine = new StateMachine(store);
        const result = await machine.transition(
          cmd({ to, facts: inTable ? factsFor(from, to) : {} }),
        );

        if (!inTable) {
          expect(result.ok, `${key} should be refused`).toBe(false);
          if (!result.ok) {
            expect(result.error, `${key} error kind`).toBe('IllegalTransition');
          }
          continue;
        }

        // The edge is in the table, so the machine must not call it
        // `IllegalTransition`. It either passes its guard or fails it —
        // and which one depends on the facts, not on the table.
        if (result.ok) {
          expect(result.snapshot.state).toBe(to);
        } else {
          expect(result.error, `${key} error kind`).toBe('GuardFailed');
        }
      }
    }
  });

  it('A1.26 every table transition is reachable except the hard-false v1 deploy guard', () => {
    // The pack annotates `MERGED → DEPLOYING`: "v1: guard is hard-false
    // (no deploy capability exists)". So one edge in the table is
    // deliberately unreachable, and every other edge must be reachable
    // with facts that satisfy its guard.
    const unreachable: string[] = [];

    for (const transition of allTaskTransitions()) {
      const facts = factsFor(transition.from, transition.to);
      const passes = checkGuard(transition.from, transition.to, facts);
      if (!passes) {
        unreachable.push(`${transition.from}->${transition.to}`);
      }
    }

    expect(unreachable).toEqual(['MERGED->DEPLOYING']);
  });

  it('A1.26 a refused transition changes no state and appends a policy.denied event', async () => {
    // "An illegal transition ⇒ `ConcurrencyError | IllegalTransition`, **no
    // state change**, and a `policy.denied`-class event."
    const store = storeWith('DRAFT');
    const machine = new StateMachine(store);

    const result = await machine.transition(cmd({ to: 'MERGED' }));

    expect(result.ok).toBe(false);
    expect(store.tasks.get('tsk_prop')?.state).toBe('DRAFT');
    expect(store.tasks.get('tsk_prop')?.version).toBe(0);
    expect(store.events).toHaveLength(0);

    // The refusal is recorded.
    expect(store.refusals).toHaveLength(1);
    expect(store.refusals[0]?.eventType).toBe('policy.denied');
    expect(store.refusals[0]?.aggregate.id).toBe('tsk_prop');
  });

  it('A1.26 a refused transition does not consume a version', async () => {
    const store = storeWith('DRAFT');
    const machine = new StateMachine(store);

    await machine.transition(cmd({ to: 'MERGED' }));
    await machine.transition(cmd({ to: 'MERGED' }));
    await machine.transition(cmd({ to: 'MERGED' }));

    expect(store.tasks.get('tsk_prop')?.version).toBe(0);
  });

  it('A1.26 every accepted transition appends at least one event', async () => {
    for (const transition of allTaskTransitions()) {
      // `MERGED → DEPLOYING` is the one edge the pack makes hard-false in
      // v1, so it is never accepted and never appends.
      if (transition.from === 'MERGED' && transition.to === 'DEPLOYING') {
        continue;
      }

      const store = storeWith(transition.from);
      const machine = new StateMachine(store);

      const result = await machine.transition(
        cmd({ to: transition.to, facts: factsFor(transition.from, transition.to) }),
      );

      expect(result.ok, `${transition.from}->${transition.to} should be accepted`).toBe(
        true,
      );
      expect(
        store.eventCountFor('tsk_prop'),
        `${transition.from}->${transition.to} appended no event`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('A1.26 an accepted transition bumps the version exactly once', async () => {
    for (const transition of allTaskTransitions()) {
      if (transition.from === 'MERGED' && transition.to === 'DEPLOYING') {
        continue;
      }

      const store = storeWith(transition.from);
      const machine = new StateMachine(store);

      await machine.transition(
        cmd({ to: transition.to, facts: factsFor(transition.from, transition.to) }),
      );

      expect(
        store.tasks.get('tsk_prop')?.version,
        `${transition.from}->${transition.to} bumped the version wrongly`,
      ).toBe(1);
    }
  });

  it('A1.27 replaying the events reproduces the state', async () => {
    // A walk along a legal path, then a replay of the events.
    const path: TaskState[] = ['DRAFT', 'TRIAGED', 'REFINED', 'PLANNED', 'QUEUED'];

    const store = storeWith('DRAFT');
    const machine = new StateMachine(store);

    let previous: TaskState = 'DRAFT';
    let version = 0;
    for (const to of path.slice(1)) {
      const result = await machine.transition(
        cmd({ to, expectedVersion: version, facts: factsFor(previous, to) }),
      );
      expect(result.ok, `${previous}->${to} should be accepted`).toBe(true);
      if (result.ok) {
        version = result.snapshot.version;
      }
      previous = to;
    }

    const replayed = replayTask('tsk_prop', store.events);

    expect(replayed.state).toBe(store.tasks.get('tsk_prop')?.state);
    expect(replayed.state).toBe('QUEUED');
    expect(replayed.version).toBe(store.tasks.get('tsk_prop')?.version);
    expect(replayed.transitions).toBe(path.length - 1);
  });

  it('A1.27 replay reproduces the state after every accepted transition', async () => {
    // Not just one path — every edge, replayed from its own events.
    for (const transition of allTaskTransitions()) {
      if (transition.from === 'MERGED' && transition.to === 'DEPLOYING') {
        continue;
      }

      const store = storeWith(transition.from);
      const machine = new StateMachine(store);

      await machine.transition(
        cmd({ to: transition.to, facts: factsFor(transition.from, transition.to) }),
      );

      const replayed = replayTask('tsk_prop', store.events);
      expect(
        replayed.state,
        `replay of ${transition.from}->${transition.to} disagreed`,
      ).toBe(transition.to);
    }
  });

  it('A1.27 a stale expected version is a ConcurrencyError, not a state change', async () => {
    const store = storeWith('DRAFT');
    const machine = new StateMachine(store);

    const result = await machine.transition(cmd({ to: 'TRIAGED', expectedVersion: 7 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('ConcurrencyError');
    }
    expect(store.tasks.get('tsk_prop')?.state).toBe('DRAFT');
    expect(store.tasks.get('tsk_prop')?.version).toBe(0);
  });

  it('A1.28 ABANDONED is reachable from every non-terminal state', async () => {
    const nonTerminal = TASK_STATES.filter((state) => !isTerminal(state));

    // Every non-terminal state, except the ones that are already terminal
    // by another route.
    expect(nonTerminal.length).toBeGreaterThan(0);

    for (const from of nonTerminal) {
      expect(
        isAllowedTransition(from, 'ABANDONED'),
        `${from} cannot reach ABANDONED`,
      ).toBe(true);

      const store = storeWith(from);
      const machine = new StateMachine(store);
      const result = await machine.transition(
        cmd({ to: 'ABANDONED', facts: { cancelledByHuman: true } }),
      );

      expect(result.ok, `${from}->ABANDONED was refused`).toBe(true);
      expect(store.tasks.get('tsk_prop')?.state).toBe('ABANDONED');
    }
  });

  it('A1.28 ABANDONED is NOT reachable from a terminal state', () => {
    const terminal = TASK_STATES.filter((state) => isTerminal(state));

    for (const from of terminal) {
      expect(
        isAllowedTransition(from, 'ABANDONED'),
        `${from} is terminal but can reach ABANDONED`,
      ).toBe(false);
    }
  });

  it('A1.28 the ABANDONED guard requires a cancellation or a supersession', () => {
    // The wildcard row is not a free pass — it has a guard.
    const guard = guardFor('DRAFT', 'ABANDONED');
    expect(guard).toBe('cancelledByHumanOrSuperseded');

    expect(checkGuard('DRAFT', 'ABANDONED', {})).toBe(false);
    expect(checkGuard('DRAFT', 'ABANDONED', { cancelledByHuman: true })).toBe(true);
    expect(checkGuard('DRAFT', 'ABANDONED', { superseded: true })).toBe(true);
  });

  it('A1.29 APPROVED→MERGING is refused at L2 for an autonomous agent', async () => {
    // "At L2 the only accepted trigger is a **human-initiated action**."
    const store = storeWith('APPROVED');
    const machine = new StateMachine(store);

    const result = await machine.transition(
      cmd({
        to: 'MERGING',
        facts: {
          autonomyLevel: 2,
          policyDecision: 'ALLOW',
          humanInitiated: false,
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('GuardFailed');
      expect(result.guard).toBe('autonomyPermitsOrHumanInitiated');
    }
    expect(store.tasks.get('tsk_prop')?.state).toBe('APPROVED');
  });

  it('A1.29 APPROVED→MERGING is accepted at L2 for a human-initiated merge with a matching SHA', async () => {
    const store = storeWith('APPROVED');
    const machine = new StateMachine(store);

    const result = await machine.transition(
      cmd({
        to: 'MERGING',
        facts: {
          autonomyLevel: 2,
          humanInitiated: true,
          accessPoint: 'github',
          approvedSha: 'sha256:head',
          headSha: 'sha256:head',
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(store.tasks.get('tsk_prop')?.state).toBe('MERGING');
  });

  it('A1.29 APPROVED→MERGING is refused at L2 when the head SHA does not match', async () => {
    // ADR-0003: the merge may only proceed if the head still equals the
    // approved SHA. A moved head is a different code than the one approved.
    const store = storeWith('APPROVED');
    const machine = new StateMachine(store);

    const result = await machine.transition(
      cmd({
        to: 'MERGING',
        facts: {
          autonomyLevel: 2,
          humanInitiated: true,
          accessPoint: 'github',
          approvedSha: 'sha256:approved',
          headSha: 'sha256:moved',
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(store.tasks.get('tsk_prop')?.state).toBe('APPROVED');
  });

  it('A1.29 APPROVED→MERGING is refused at L2 with no SHA at all', async () => {
    // A human-initiated merge with no SHA to compare is not a merge of the
    // approved artefact.
    const store = storeWith('APPROVED');
    const machine = new StateMachine(store);

    const result = await machine.transition(
      cmd({
        to: 'MERGING',
        facts: {
          autonomyLevel: 2,
          humanInitiated: true,
          accessPoint: 'github',
        },
      }),
    );

    expect(result.ok).toBe(false);
  });

  it('A1.29 APPROVED→MERGING is accepted at L3 with an allowing policy decision', async () => {
    const store = storeWith('APPROVED');
    const machine = new StateMachine(store);

    const result = await machine.transition(
      cmd({
        to: 'MERGING',
        facts: {
          autonomyLevel: 3,
          policyDecision: 'ALLOW',
          humanInitiated: false,
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(store.tasks.get('tsk_prop')?.state).toBe('MERGING');
  });

  it('A1.29 APPROVED→MERGING is refused at L3 when the policy says DENY', async () => {
    // The policy engine's verdict is authoritative: a DENY fails both
    // routes, even the autonomy route.
    const store = storeWith('APPROVED');
    const machine = new StateMachine(store);

    const result = await machine.transition(
      cmd({
        to: 'MERGING',
        facts: {
          autonomyLevel: 4,
          policyDecision: 'DENY',
          humanInitiated: true,
          accessPoint: 'github',
          approvedSha: 'sha256:head',
          headSha: 'sha256:head',
        },
      }),
    );

    expect(result.ok).toBe(false);
  });

  it('A1.29 the L2 refusal is a guard failure and appends a policy.denied event', async () => {
    const store = storeWith('APPROVED');
    const machine = new StateMachine(store);

    await machine.transition(
      cmd({
        to: 'MERGING',
        facts: { autonomyLevel: 2, policyDecision: 'ALLOW' },
      }),
    );

    expect(store.refusals).toHaveLength(1);
    expect(store.refusals[0]?.eventType).toBe('policy.denied');
    expect(store.tasks.get('tsk_prop')?.version).toBe(0);
  });

  it('A1.29 the MERGED→DEPLOYING guard is hard-false in v1', () => {
    // The pack annotates the row: "v1: guard is hard-false (no deploy
    // capability exists)".
    expect(guardFor('MERGED', 'DEPLOYING')).toBe('deploymentTargetInRunbookSet');
    expect(checkGuard('MERGED', 'DEPLOYING', satisfiedFacts)).toBe(false);
    expect(
      checkGuard('MERGED', 'DEPLOYING', {
        ...satisfiedFacts,
        deploymentTargetInRunbookSet: true,
        deploymentTarget: 'prod',
      }),
    ).toBe(false);
  });

  it('A1.30 the transition table is the one from the pack', () => {
    // A spot-check of the table's shape. The exhaustive check is
    // `allTaskTransitions`; this catches a table that was edited wholesale.
    const edges = new Set(
      allTaskTransitions().map((transition) => `${transition.from}->${transition.to}`),
    );

    for (const edge of [
      'DRAFT->TRIAGED',
      'DRAFT->REJECTED',
      'TRIAGED->REFINED',
      'TRIAGED->FAILED',
      'REFINED->PLANNED',
      'REFINED->ESCALATED',
      'PLANNED->QUEUED',
      'PLANNED->ESCALATED',
      'QUEUED->RUNNING',
      'RUNNING->QUEUED',
      'RUNNING->VERIFYING',
      'RUNNING->ESCALATED',
      'RUNNING->INCOMPLETE',
      'VERIFYING->AWAITING_REVIEW',
      'VERIFYING->RUNNING',
      'VERIFYING->FAILED',
      'AWAITING_REVIEW->AWAITING_APPROVAL',
      'AWAITING_REVIEW->REJECTED',
      'AWAITING_REVIEW->ESCALATED',
      'AWAITING_APPROVAL->APPROVED',
      'AWAITING_APPROVAL->REJECTED',
      'APPROVED->MERGING',
      'MERGING->MERGED',
      'MERGING->FAILED',
      'MERGED->DEPLOYING',
      'DEPLOYING->DEPLOYED',
      'DEPLOYING->FAILED',
      'ESCALATED->QUEUED',
      'ESCALATED->REJECTED',
      'INCOMPLETE->ESCALATED',
    ]) {
      expect(edges.has(edge), `missing edge ${edge}`).toBe(true);
    }
  });

  it('A1.30 every transition out of a terminal state is refused', () => {
    // A terminal state is terminal — with two documented exceptions, both
    // of them the pack's own rows.
    //
    // pack 03 §6 annotates `MERGED` as "code path": it is terminal *for a
    // code-only workflow*, but a deployment workflow continues from it to
    // `DEPLOYING`. And `INCOMPLETE → ESCALATED` exists because a human may
    // accept the partial work or ask for continuation — blueprint `09`
    // §2.2: "INCOMPLETE → ESCALATED: human accepts partial or requests
    // continuation".
    //
    // What must not happen is a terminal state growing an edge the pack
    // does not list. So each terminal state's outgoing edges are compared
    // against the pack's table, not against "none".
    const expectedOutgoing: Readonly<Record<string, readonly TaskState[]>> = {
      MERGED: ['DEPLOYING'],
      INCOMPLETE: ['ESCALATED'],
    };

    for (const state of TASK_STATES.filter((s) => isTerminal(s))) {
      expect(
        transitionsFrom(state).map((t) => t.to),
        `${state} has unexpected outgoing edges`,
      ).toEqual(expectedOutgoing[state] ?? []);
    }
  });
});

describe('T-1.04 · the node state machine', () => {
  it('A1.31 the node machine includes the lease-expiry transition', () => {
    // blueprint `09` §3: "LEASED → READY: lease expired, re-lequeued".
    // Without it a node could be released while its lease is live, and two
    // workers could run it.
    expect(isAllowedNodeTransition('LEASED', 'READY')).toBe(true);
    expect(nodeTransitionsFrom('LEASED')).toContain('READY');
  });

  it('A1.31 LEASED→READY requires an expired lease', () => {
    expect(checkNodeGuard('LEASED', 'READY', {})).toBe(false);
    expect(checkNodeGuard('LEASED', 'READY', { leaseExpired: true })).toBe(true);
  });

  it('A1.31 only table node transitions succeed', () => {
    const allowed = new Set<NodeState>();
    for (const state of NODE_STATES) {
      for (const to of nodeTransitionsFrom(state)) {
        allowed.add(to);
      }
    }

    for (const from of NODE_STATES) {
      for (const to of NODE_STATES) {
        const expected = nodeTransitionsFrom(from).includes(to);
        expect(
          isAllowedNodeTransition(from, to),
          `${from}->${to}`,
        ).toBe(expected);
      }
    }
  });

  it('A1.31 FAILED→READY requires policy permission for the retry', () => {
    // The pack's comment: "retry only if policy permits".
    expect(isAllowedNodeTransition('FAILED', 'READY')).toBe(true);
    expect(
      checkNodeGuard('FAILED', 'READY', { retryPermittedByPolicy: true }),
    ).toBe(true);
    expect(checkNodeGuard('FAILED', 'READY', {})).toBe(false);
  });

  it('A1.31 the node machine has exactly 8 states and 10 edges', () => {
    expect(NODE_STATES).toHaveLength(8);
    const edges = NODE_STATES.reduce(
      (count, state) => count + nodeTransitionsFrom(state).length,
      0,
    );
    expect(edges).toBe(10);
  });
});
