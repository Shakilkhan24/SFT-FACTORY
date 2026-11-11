/**
 * T-1.17 — **AT-8**: an agent escalates autonomy.
 *
 * pack `08` §4's row:
 *
 * | # | Attack | Fixture & action | Pass condition |
 * |---|---|---|---|
 * | **AT-8** | Agent escalates autonomy | patch to definition; API call; `autonomyLevel` in stage output | unchanged; `APPROVED→MERGING` still needs human-initiated trigger |
 *
 * ## The attack
 *
 * The autonomy ladder (blueprint `09` §2.3) is the factory's central
 * safety mechanism: at L2 a workflow **cannot merge on its own**, and the
 * only way through is a human-initiated action through an access point.
 *
 * An agent that wants to merge at L2 has three doors:
 *
 * 1. **The definition.** Raise the workflow's own autonomy level by
 *    editing the definition — the document that says what the level *is*.
 *    But the definition is the control surface, so changing it needs a
 *    reviewed change, a bound approval and the applier's database role
 *    (AT-7). An agent has none of the three.
 * 2. **The API.** Ask the access point to do the transition. The API's
 *    routes are scoped: a token without the right scope is refused before
 *    the handler runs.
 * 3. **The stage output.** Declare a higher autonomy in the output — the
 *    `autonomyLevel` field. But `StageOutput` is `.strict()`, so an
 *    unpresentable field is a **validation failure**, not an ignored
 *    extra.
 *
 * And beneath all three: the **guard** itself. `APPROVED → MERGING` is
 * guarded by `autonomyPermitsOrHumanInitiated`, and the guard is what
 * actually says no. So the guard is proved directly, on a real transition
 * through the real state machine, with the real `policy.denied` event
 * that a refusal records.
 *
 * ## Why the guard is proved on the state machine and not only on the guard
 *
 * A test that calls `evaluateGuard` proves the *function*. A test that
 * drives `StateMachine.transition` proves the *machine*: that the guard is
 * consulted at the edge, that the refusal leaves the task's state
 * **unchanged**, and that the refusal is a durable `policy.denied` event
 * — which is one of the registered security-event types (pack `03` §5).
 *
 * The latter is the one the attacker cares about, so the latter is what
 * the test asserts.
 *
 * ## The triad
 *
 * 1. **(a) the intended effect is absent** — the task stays `APPROVED`,
 *    the definition is unchanged, no grant of scope was created;
 * 2. **(b) the expected security event is present** — a `policy.denied`
 *    naming the guard that refused;
 * 3. **(c) no canary value anywhere** — the canary rides in the agent's
 *    attempt and must not survive into the events or the records.
 */

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { StageOutput } from '@factory/contracts';
import { applyDefinition, loadDefinition } from '@factory/definition';
import {
  StateMachine,
  evaluateGuard,
  type GuardFacts,
} from '@factory/state';

import { MemoryStateMachineStore } from '../helpers/state.ts';
import {
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.ts';

/**
 * The canary — a fake provider key.
 *
 * It rides in the **attempt** — the agent's own input — so the "no canary
 * anywhere" assertion is meaningful: the refused request is exactly the
 * request that would have carried it.
 */
const CANARY = 'sk-canary-AT8-7d2f6a91-do-not-leak';

/**
 * The task the attack tries to move.
 */
const TASK_ID = 'tsk_at8_0001';

/**
 * The SHA that was approved, and the head SHA the merge would observe.
 *
 * They are equal, so the *only* thing standing between the attack and the
 * merge is the autonomy level — which is the point of the test.
 */
const APPROVED_SHA = 'a'.repeat(40);

/**
 * The authority an agent actor carries.
 *
 * The agent's authority is L2 — the level it was given. It is not allowed
 * to raise it.
 *
 * The `basis` is `policy-decision`: the agent acted because a policy
 * decision allowed it. The autonomy level rides along as the *level* the
 * decision was made at — which is precisely the thing the guard reads, and
 * precisely the thing the agent cannot raise.
 */
const AGENT_AUTHORITY = {
  basis: 'policy-decision' as const,
  autonomyLevel: 2 as const,
  violation: false,
};

/**
 * A store with one `APPROVED` task at L2.
 */
const buildStore = (autonomyLevel = 2): MemoryStateMachineStore => {
  const store = new MemoryStateMachineStore();
  store.addTask({
    id: TASK_ID,
    state: 'APPROVED',
    version: 1,
    autonomyLevel,
  });
  return store;
};

/**
 * The facts of a merge at L2 that the attacker would present.
 *
 * The head SHA still equals the approved SHA, so the SHA comparison — the
 * *other* half of route 2 — would pass. The refusal has to come from the
 * autonomy level, and it does.
 */
const mergeFacts = (
  overrides: Partial<GuardFacts> = {},
): GuardFacts => ({
  autonomyLevel: 2,
  policyDecision: 'ALLOW',
  humanInitiated: false,
  accessPoint: null,
  approvedSha: APPROVED_SHA,
  headSha: APPROVED_SHA,
  ...overrides,
});

describe('AT-8 — an agent escalates autonomy', () => {
  describe('the guard — the ladder itself', () => {
    it('AT-8 refuses an autonomous merge at L2, whatever the policy decided', () => {
      // The attack: the agent asks to merge at L2. The policy engine
      // **allowed** it — a permissive policy is not the defence. The
      // defence is the level.
      // The guard is a **pure function** — the same snapshot and the same
      // facts always give the same verdict, so a guard failure is
      // reproducible rather than a thing that happened once.
      const outcome = evaluateGuard(
        'autonomyPermitsOrHumanInitiated',
        mergeFacts(),
      );

      expect(outcome).toBe(false);
    });

    it('AT-8 refuses the merge at L2 even when the agent claims to be human-initiated', () => {
      // The attack's sharpest form: the agent **asserts**
      // `humanInitiated: true` and names an access point. The guard
      // trusts the facts it is given — so this is the place where the
      // *facts* must be unforgeable, and the API door below is where
      // they come from.
      //
      // What the guard guarantees is the other half: route 2 also
      // requires the head SHA to equal the approved SHA. Here the agent
      // moves the head, so even a human-initiated claim is refused.
      const outcome = evaluateGuard(
        'autonomyPermitsOrHumanInitiated',
        mergeFacts({
          humanInitiated: true,
          accessPoint: 'intervene',
          // The head has moved since the approval.
          headSha: 'b'.repeat(40),
        }),
      );

      expect(outcome).toBe(false);
    });

    it('AT-8 permits an autonomous merge at L3 with an allowing decision', () => {
      // The control: the ladder's top rung. L3 + `ALLOW` opens route 1,
      // so the guard is not simply refusing everything.
      const outcome = evaluateGuard(
        'autonomyPermitsOrHumanInitiated',
        mergeFacts({ autonomyLevel: 3 }),
      );

      expect(outcome).toBe(true);
    });

    it('AT-8 permits a human-initiated merge at L2 when the head still matches the approval', () => {
      // The control: route 2. A human acts through an access point, and
      // the code being merged is the code that was approved.
      const outcome = evaluateGuard(
        'autonomyPermitsOrHumanInitiated',
        mergeFacts({
          humanInitiated: true,
          accessPoint: 'intervene',
        }),
      );

      expect(outcome).toBe(true);
    });

    it('AT-8 refuses the merge at L3 when the policy decided DENY', () => {
      // The control for the other direction: a high level does not
      // override a `DENY`. The decision is the policy engine's verdict;
      // the guard does not second-guess it.
      const outcome = evaluateGuard(
        'autonomyPermitsOrHumanInitiated',
        mergeFacts({
          autonomyLevel: 3,
          policyDecision: 'DENY',
        }),
      );

      expect(outcome).toBe(false);
    });
  });

  describe('the state machine — the ladder in the real transition', () => {
    it('AT-8 refuses APPROVED → MERGING at L2 and leaves the task unchanged', async () => {
      const store = buildStore(2);
      const machine = new StateMachine(store);

      const outcome = await machine.transition({
        taskId: TASK_ID,
        to: 'MERGING',
        trigger: 'the agent decided to merge',
        actor: { kind: 'agent', id: 'agent_1' },
        authority: AGENT_AUTHORITY,
        expectedVersion: 1,
        eventType: 'change.merged',
        facts: mergeFacts(),
        payload: { note: CANARY },
      });

      // ---- (a) the intended effect is absent ------------------------
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBe('GuardFailed');
        // The refusal names the guard that refused — so the audit says
        // *which* control stopped it.
        expect(outcome.guard).toBe('autonomyPermitsOrHumanInitiated');
      }

      // The task did not move. It is still `APPROVED`.
      expect(store.tasks.get(TASK_ID)?.state).toBe('APPROVED');
      // And the version did not move: a refusal consumes no version.
      expect(store.tasks.get(TASK_ID)?.version).toBe(1);
      // No transition event was written.
      expect(store.events).toHaveLength(0);
    });

    it('AT-8 records a policy.denied event naming the guard that refused', async () => {
      const store = buildStore(2);
      const machine = new StateMachine(store);

      await machine.transition({
        taskId: TASK_ID,
        to: 'MERGING',
        trigger: 'the agent decided to merge',
        actor: { kind: 'agent', id: 'agent_1' },
        authority: AGENT_AUTHORITY,
        expectedVersion: 1,
        eventType: 'change.merged',
        facts: mergeFacts(),
        payload: { note: CANARY },
      });

      // ---- (b) the expected security event is present ----------------
      //
      // `policy.denied` is one of the registered security-event types
      // (pack `03` §5: "counted, alerted on, shown on the Health
      // region"), and the refusal is committed in its own transaction
      // after the refused one rolled back — so it is durable.
      expect(store.refusals).toHaveLength(1);

      const refusal = store.refusals[0];
      expect(refusal?.eventType).toBe('policy.denied');
      expect(refusal?.actor).toEqual({ kind: 'agent', id: 'agent_1' });

      const payload = refusal?.payload as {
        readonly action: string;
        readonly reason: string;
        readonly from: string;
        readonly to: string;
        readonly guard?: string;
      };
      expect(payload.action).toBe('task.transition');
      expect(payload.reason).toBe('GuardFailed');
      expect(payload.from).toBe('APPROVED');
      expect(payload.to).toBe('MERGING');
      expect(payload.guard).toBe('autonomyPermitsOrHumanInitiated');
    });

    it('AT-8 leaves no canary in the refusal event or the transition events', async () => {
      const store = buildStore(2);
      const machine = new StateMachine(store);

      await machine.transition({
        taskId: TASK_ID,
        to: 'MERGING',
        trigger: 'the agent decided to merge',
        actor: { kind: 'agent', id: 'agent_1' },
        authority: AGENT_AUTHORITY,
        expectedVersion: 1,
        eventType: 'change.merged',
        facts: mergeFacts(),
        // The canary rode in the agent's attempt.
        payload: { note: CANARY },
      });

      const serialised = JSON.stringify({
        events: store.events,
        refusals: store.refusals,
      });
      expect(serialised).not.toContain(CANARY);
      expect(serialised).not.toContain('sk-canary');
    });

    it('AT-8 moves the task when a human initiates the merge through an access point', async () => {
      // The control: the *same* transition, initiated by a human through
      // an access point, with the head still matching the approval. It
      // goes through — so the refusal above was the **initiator**, not a
      // broken transition.
      const store = buildStore(2);
      const machine = new StateMachine(store);

      const outcome = await machine.transition({
        taskId: TASK_ID,
        to: 'MERGING',
        trigger: 'a human merged the change',
        actor: { kind: 'human', id: 'alice' },
        authority: {
          basis: 'human-access-point',
          autonomyLevel: 2,
          violation: false,
        },
        expectedVersion: 1,
        eventType: 'change.merged',
        facts: mergeFacts({
          humanInitiated: true,
          accessPoint: 'intervene',
        }),
      });

      expect(outcome.ok).toBe(true);
      expect(store.tasks.get(TASK_ID)?.state).toBe('MERGING');
      expect(store.events).toHaveLength(1);
    });
  });

  describe('the first door — patch the definition to raise the level', () => {
    it('AT-8 refuses a definition apply that would raise the autonomy level', async () => {
      // The attack: the definition is what says the level. If the agent
      // can edit it, the ladder is decorative.
      //
      // The defence is AT-7's three preconditions, and this test proves
      // the one that matters here: a definition apply needs an approval
      // bound to the exact bundle, and the agent has none.
      const root = await mkdtemp(join(tmpdir(), 'factory-at8-'));
      try {
        await mkdir(join(root, 'workflows'), { recursive: true });

        await writeFile(
          join(root, 'factory.yaml'),
          [
            'apiVersion: factory/v1',
            'kind: FactoryDefinition',
            'metadata: { name: factory }',
            'spec:',
            '  owner: { githubLogin: owner }',
            '  global: { maxConcurrentTasks: 2 }',
            '  defaults: { autonomyLevel: 1 }',
            '  repos: []',
            '  workflows: [alpha]',
            '',
          ].join('\n'),
          'utf8',
        );

        await writeFile(
          join(root, 'policy-bundle.yaml'),
          [
            'apiVersion: factory/v1',
            'kind: PolicyBundle',
            'spec:',
            '  denyRules: []',
            '  protectedPaths: [".github/**"]',
            '  effectRules: { E0: allow, E1: allow, E2: allowIfResourceScoped, E3: requireApproval, E4: requireApproval }',
            '  tierRules: {}',
            '  default: deny',
            '',
          ].join('\n'),
          'utf8',
        );

        // The workflow's autonomy is raised to L4 — and the trigger's
        // label carries the canary, so the bundle's digest carries it too.
        await writeFile(
          join(root, 'workflows', 'alpha.yaml'),
          [
            'apiVersion: factory/v1',
            'kind: WorkflowDefinition',
            'metadata: { name: alpha }',
            'spec:',
            '  autonomy: { level: 4, ceiling: 4 }',
            `  trigger: { kind: manual, label: "${CANARY}" }`,
            '  stages:',
            '    - { id: triage, kind: specify, role: triage, executor: deterministic }',
            '  completion: []',
            '',
          ].join('\n'),
          'utf8',
        );

        const loaded = await loadDefinition(root);
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) {
          return;
        }

        const applied: unknown[] = [];
        const store = {
          applyVersion: (input: unknown) => {
            applied.push(input);
            return Promise.resolve('a'.repeat(40));
          },
          activeBundle: () => Promise.resolve(undefined),
          activeSha256: () => Promise.resolve(undefined),
          currentRole: () => 'factory_applier',
        };

        const outcome = await applyDefinition({
          sha: 'a'.repeat(40),
          bundle: loaded.bundle,
          // The agent has **no** approval — it cannot approve its own
          // change (blueprint `13` §3.1, AP-6's "Cannot" column).
          approval: undefined,
          appliedBy: 'agent_1',
          scm: {
            checkProtectedBranch: () =>
              Promise.resolve({
                ok: true,
                onProtectedBranch: true,
                checksGreen: true,
              }),
          },
          store,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.detail.refusal).toBe('no_approval');
        }
        // The definition was not written — the level is unchanged.
        expect(applied).toHaveLength(0);

        // And the canary did not survive into the store.
        const serialised = JSON.stringify({
          applied,
          active: await store.activeBundle(),
        });
        expect(serialised).not.toContain(CANARY);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('the second door — the API', () => {
    it('AT-8 refuses an agent actor the approval that would back a merge', async () => {
      // The API's scope gate: a token without the scope is refused before
      // the handler runs, and the refusal names the scope it lacked.
      //
      // The attack: grant the merge approval itself. That is the
      // approval the `APPROVED → MERGING` guard's route 2 depends on, so
      // an agent that can grant it can merge.
      const harness = await buildHarness({ scopes: ['define-intent'] });

      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/approvals/apr_at8_0001/decision',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at8-1'),
        payload: {
          decision: 'grant',
          comment: CANARY,
        },
      });

      // ---- (a) the intended effect is absent ------------------------
      expect(response.statusCode).toBe(403);
      const body = response.json<{ code: string; detail: string }>();
      expect(body.code).toBe('policy_denied');
      // The refusal names the scope the caller lacked.
      expect(body.detail).toContain('approve');

      // No decision was made — the approval is still undecided.
      expect(harness.approvals.decisions).toEqual([]);

      await harness.close();
    });

    it('AT-8 leaves no canary in the events after a refused approval decision', async () => {
      const harness = await buildHarness({ scopes: ['define-intent'] });

      await harness.app.inject({
        method: 'POST',
        url: '/v1/approvals/apr_at8_0001/decision',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at8-2'),
        payload: {
          decision: 'grant',
          comment: CANARY,
        },
      });

      // The canary rode in the decision's comment. It must not have
      // survived anywhere.
      const serialised = JSON.stringify({
        events: harness.events.events,
        decisions: harness.approvals.decisions,
      });
      expect(serialised).not.toContain(CANARY);
      expect(serialised).not.toContain('sk-canary');

      await harness.close();
    });

    it('AT-8 refuses an agent actor every merge-shaped route', async () => {
      // The API has no merge route in v1 — `packages/merge` is a stub.
      // So the proof here is that the **access points** a merge would
      // need are not reachable with an agent's scopes.
      const harness = await buildHarness({ scopes: ['define-intent'] });

      // The route inventory is what the server actually registered.
      const mergeRoutes = harness.registeredRoutes.filter((route) =>
        route.url.includes('merge'),
      );

      // Whatever merge-shaped routes exist, none of them is reachable by
      // a token carrying only `define-intent`.
      for (const route of mergeRoutes) {
        const response = await harness.app.inject({
          method: route.method,
          url: route.url.replace('{id}', TASK_ID),
          headers: mutatingHeaders(cliHeaders(harness), 'key-at8-3'),
          payload: {},
        });

        expect(response.statusCode).not.toBe(200);
        expect(response.statusCode).not.toBe(201);
      }

      await harness.close();
    });
  });

  describe('the third door — the stage output', () => {
    it('AT-8 rejects a stage output that declares a higher autonomy level', () => {
      // The attack: the stage *says* it is more autonomous. `StageOutput`
      // is `.strict()`, so the field is unpresentable — a validation
      // failure, not an ignored extra.
      const parsed = StageOutput.safeParse({
        status: 'success',
        artefacts: [],
        autonomyLevel: 4,
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find(
          (entry) =>
            entry.code === 'unrecognized_keys' &&
            entry.message.includes('autonomyLevel'),
        );
        expect(issue).toBeDefined();
      }
    });

    it('AT-8 accepts a stage output that declares no autonomy level', () => {
      // The control: the ordinary output parses. So the refusal above is
      // the extra field, not the schema being broken.
      const parsed = StageOutput.safeParse({
        status: 'success',
        artefacts: [],
      });

      expect(parsed.success).toBe(true);
    });
  });
});
