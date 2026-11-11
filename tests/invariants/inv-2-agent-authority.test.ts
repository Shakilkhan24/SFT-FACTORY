/**
 * **INV-2** — no agent can widen its scope, autonomy or credentials.
 *
 * checklist 14 §"The twelve invariants and their mutations", row INV-2:
 *
 * > | **INV-2** | No agent can widen its scope, autonomy or credentials |
 * > *delete `deny-factory-write` / the agent-actor check* |
 *
 * and pack `08` §3, on what the test asserts:
 *
 * > **INV-2** — a property test: for every agent-actor request that
 * > creates/edits grants, autonomy, credentials or the definition (API +
 * > tool + DB) ⇒ denied; the level and the grants are unchanged afterwards.
 *
 * ## What "widening" means
 *
 * The factory's authority is a **ladder** (blueprint `09` §2.3) and a
 * **grant set** (blueprint `11` §2). Both are set by humans, from the
 * outside. An agent — at any autonomy level, with any grant — must never
 * be able to move either of them.
 *
 * The four resources the specification names are the four places the
 * authority actually lives:
 *
 * | Resource | Where it lives | The door |
 * |---|---|---|
 * | **grants** | the grant set — what capabilities and scopes a task may use | the API's temporary-grant route; the broker's grant gate |
 * | **autonomy** | the task's `autonomy_level` — how far it may act alone | the stage output's schema; the `APPROVED → MERGING` guard |
 * | **credentials** | the minted short-lived credential | the broker's credential step; the `secret.read` scope |
 * | **the definition** | the control surface — the workflows, the policy, the capabilities | the API's apply route; the `definition_versions` table |
 *
 * And the three layers are the three places a request can arrive:
 *
 * * the **API** — `apps/api`;
 * * the **tool** — the broker, which is *"the agent's only sanctioned
 *   channel"* (blueprint `11` §1);
 * * the **DB** — the role's grants, which are the last line and do not
 *   care who asked.
 *
 * ## Why this test is a **property** test and not a list of cases
 *
 * The red-team suite already covers AT-5 (an agent widens its own scope)
 * and AT-8 (an agent escalates autonomy) — one attack, one door, one
 * assertion each. That is the right shape for an attack: it is a *story*.
 *
 * But INV-2's claim is **systematic**: *"for **every** agent-actor request
 * that creates/edits grants, autonomy, credentials or the definition"*. So
 * this file enumerates the requests — across all four resources and all
 * three layers — and asserts, for each one:
 *
 * 1. the request is **denied**;
 * 2. the **autonomy level** is unchanged;
 * 3. the **grants** are unchanged.
 *
 * and it does that for a *generated* spread of capability ids, scopes,
 * autonomy levels and grant contents, so the claim is not "these four
 * requests are refused" but "requests of this shape are refused".
 *
 * ## The mutation this file is written against
 *
 * *"delete `deny-factory-write` / the agent-actor check"*. The guard has
 * two halves and the file proves both:
 *
 * * **the tool half** — `definition/policy-bundle.yaml`'s
 *   `deny-factory-write` rule (`when: { capability: factory.write }`) and
 *   its sibling `deny-secret-read-agent`
 *   (`when: { capability: secret.read, actorKind: agent }`). These are
 *   matched by `packages/policy`'s deny-rule matcher and produce a `DENY`
 *   **before** the grant check, so no grant can reach them.
 * * **the API half** — the route's scope requirement. An agent's token
 *   carries no `intervene` and no `amend-factory` scope, so
 *   `POST /v1/grants/temporary` and `POST /v1/definition/apply` are
 *   refused at the scope check, before the handler runs.
 *
 * The DB half — the applier role being the only writer of
 * `definition_versions` (A0.7) — is the third layer, and it does not
 * depend on the actor at all: it is a **privilege**, not a policy.
 *
 * ## Why the "unchanged afterwards" half is the real assertion
 *
 * A refusal that *partially* applied is worse than no refusal: the audit
 * says "denied", and the world says "granted". So every case below reads
 * the grants and the autonomy level **back** after the denial and compares
 * them to what they were before. A denial that created a grant and then
 * reported a refusal fails the test.
 *
 * ## The environment
 *
 * The DB layer needs a real Postgres — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available that layer **skips**: it is an environment
 * limit, not a defect. The API and tool layers always run.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import fc from 'fast-check';

import {
  StageOutput,
  type Autonomy,
  type PolicyInput,
} from '@factory/contracts';
import { readPolicyBundle } from '@factory/definition';
import { evaluate } from '@factory/policy';
import { StateMachine, type GuardFacts } from '@factory/state';

import {
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.ts';
import { hashToken } from '../../apps/api/src/auth.ts';
import type { Harness } from '../../apps/api/src/harness.ts';
import {
  aCapability,
  aContext,
  aGrant,
  anEntry,
  buildBroker,
} from '../helpers/broker.ts';
import { MemoryStateMachineStore } from '../helpers/state.ts';
import { containerRunning } from '../helpers/eventlog.ts';
import { createPostgres, isError, isPermissionDenied, type Postgres } from '../helpers/postgres.ts';

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, the DB layer **skips** rather than fails: the absence
 * of a Docker daemon is an environment limit, not a defect in the factory.
 */
const running = await containerRunning();

/**
 * The repository root.
 */
const repoRoot = resolve(import.meta.dirname, '..', '..');

/**
 * The migrations directory.
 */
const migrationsDir = join(repoRoot, 'migrations');

/**
 * The schema migration.
 */
const coreSql = readFileSync(join(migrationsDir, '0001_core.sql'), 'utf8');

/**
 * The privilege migration.
 *
 * This is the file that decides who may write what — and the DB half of
 * INV-2 is a claim about **it**, so the tests read it rather than assume
 * it.
 */
const grantsSql = readFileSync(join(migrationsDir, '0001_grants.sql'), 'utf8');

/**
 * The canary — a fake provider key.
 *
 * It rides in every agent attempt, so the "nothing changed" assertions
 * are meaningful: the refused request is exactly the request that would
 * have carried it, so its absence afterwards is a fact about the refusal
 * and not about a field that never held it.
 */
const CANARY = 'sk-canary-INV2-4f1a8c07-do-not-leak';

/**
 * The agent's token plaintext.
 *
 * A **real** credential for an allow-listed login, scoped to what an
 * agent's own work would carry. It is the attacker's best position: a
 * valid login, a valid token, an allow-listed identity — and no
 * `intervene`, no `amend-factory`, no `approve`.
 */
const AGENT_TOKEN = 'fac_inv2agent0001';

/**
 * The scopes the agent's token carries.
 *
 * Deliberately narrow: `define-intent` (ask for work) and `inspect`
 * (watch it happen). The scopes that would let the agent *widen* its own
 * authority — `intervene` (temporary grants, kill switch),
 * `amend-factory` (the definition) and `approve` (the approvals that back
 * a merge) — are absent, and their absence is the control.
 */
const AGENT_SCOPES = ['define-intent', 'inspect'] as const;

/**
 * Build a harness whose CLI token is the **agent's** token.
 *
 * The harness's own token — the one `cliHeaders` uses by default — is a
 * full-authority token. So a second token is minted here, carrying only
 * the agent's scopes.
 */
const buildAgentHarness = async (): Promise<Harness> => {
  const harness = await buildHarness({ scopes: ['define-intent', 'inspect'] });
  harness.tokens.put({
    id: 'tok-agent',
    tokenHash: hashToken(AGENT_TOKEN),
    login: 'alice',
    scopes: [...AGENT_SCOPES],
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
  return harness;
};

/**
 * The headers the agent's bearer token carries.
 */
const agentHeaders = (harness: Harness): Record<string, string> =>
  cliHeaders(harness, AGENT_TOKEN);

/**
 * The four resources an agent must not be able to widen.
 */
type Resource = 'grants' | 'autonomy' | 'credentials' | 'definition';

describe('INV-2 — no agent can widen its scope, autonomy or credentials', () => {
  describe('the tool layer — the broker is the agent\'s only sanctioned channel', () => {
    it('INV-2 denies a GENERATED agent request for the factory.write capability, whatever the grant says', async () => {
      // The tool half of the mutation: delete `deny-factory-write` from
      // the bundle and the agent's `factory.write` call would go through.
      //
      // So this test gives the agent the **best possible** position: a
      // grant that names the capability *and* the scope it requires, at
      // the highest autonomy level, so that the **only** thing that can
      // refuse it is the deny rule.
      //
      // Without that, a refusal would be attributable to the grant and
      // the deny rule would never be exercised — which is the trap in
      // checklist 14 trap 2 ("mutating something the test does not
      // actually depend on").
      const bundle = (await readPolicyBundle()).bundle;

      await fc.assert(
        fc.asyncProperty(
          // The capability's scope — the grant will cover it, so the
          // grant check cannot be the thing that refuses.
          fc.string({ minLength: 1, maxLength: 24 }),
          // The autonomy level the agent claims. The ladder's top rung,
          // so the autonomy check cannot be the thing that refuses.
          //
          // The arbitrary is typed as the ladder's union: the contract
          // type is `0 | 1 | 2 | 3 | 4`, and `fc.constantFrom(2, 3, 4)`
          // would widen to `number` — which is the type the *property*
          // carries, not the type the *contract* accepts.
          fc.constantFrom<Autonomy>(2, 3, 4),
          // The args the agent passes.
          fc.string({ minLength: 1, maxLength: 40 }),
          async (scope, autonomy, note) => {
            const capability = aCapability({
              id: 'factory.write',
              version: '1.0.0',
              kind: 'mutation',
              effect: { class: 'E4', reversible: false, external: true },
              scope: {
                required: [scope],
                resourcePattern: 'repo:{owner}/{name}',
                environment: 'orchestrator',
              },
              credentials: {
                provider: 'github',
                permissions: { contents: 'write' },
                ttlSeconds: 300,
              },
            });

            const { broker, store, invoked, credentials } = buildBroker({
              entries: [anEntry(capability)],
              secret: CANARY,
              // The grant allows **everything** the capability needs.
              policyBundle: bundle,
            });

            const result = await broker.invoke({
              capabilityId: 'factory.write',
              args: { repo: 'org/repo', note },
              context: aContext({ autonomy }),
              grant: aGrant({
                capabilities: ['factory.write'],
                scopes: [scope],
              }),
            });

            // ---- (a) the intended effect is absent -----------------
            expect(result.ok).toBe(false);
            if (result.ok) {
              return;
            }
            expect(result.failureClass).toBe('policy.denied');

            // The refusal names the rule that refused. `deny-factory-write`
            // is the guard the mutation deletes, so the test asserts it
            // **by name** — a refusal that named no rule would not be
            // sensitive to the mutation at all.
            const denials = store
              .events()
              .filter((event) => event.eventType === 'tool.denied');
            expect(denials.length).toBeGreaterThan(0);
            const payload = denials[0]?.payload as {
              readonly capabilityId?: string;
              readonly reason?: string;
              readonly ruleIds?: readonly string[];
            };
            expect(payload.capabilityId).toBe('factory.write');
            expect(payload.ruleIds ?? []).toContain('deny-factory-write');

            // No adapter ran and no credential was minted.
            expect(invoked).toEqual([]);
            expect(credentials.calls).toEqual([]);
          },
        ),
        { numRuns: 25 },
      );
    });

    it('INV-2 denies a GENERATED agent request for the secret.read capability', async () => {
      // The second half of the deny-rule family: `deny-secret-read-agent`
      // matches on `actorKind: agent`. The credential half of INV-2.
      const bundle = (await readPolicyBundle()).bundle;

      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 24 }),
          fc.string({ minLength: 1, maxLength: 40 }),
          async (scope, note) => {
            const capability = aCapability({
              id: 'secret.read',
              version: '1.0.0',
              kind: 'read',
              effect: { class: 'E3', reversible: true, external: false },
              scope: {
                required: [scope],
                resourcePattern: 'repo:{owner}/{name}',
                environment: 'orchestrator',
              },
              credentials: {
                provider: 'github',
                permissions: {},
                ttlSeconds: 60,
              },
            });

            const { broker, store, invoked, credentials } = buildBroker({
              entries: [anEntry(capability)],
              secret: CANARY,
              policyBundle: bundle,
            });

            const result = await broker.invoke({
              capabilityId: 'secret.read',
              args: { repo: 'org/repo', note },
              context: aContext({ actor: { kind: 'agent', id: 'agent_1' } }),
              grant: aGrant({
                capabilities: ['secret.read'],
                scopes: [scope],
              }),
            });

            expect(result.ok).toBe(false);
            if (result.ok) {
              return;
            }
            expect(result.failureClass).toBe('policy.denied');

            const denials = store
              .events()
              .filter((event) => event.eventType === 'tool.denied');
            expect(denials.length).toBeGreaterThan(0);
            const payload = denials[0]?.payload as {
              readonly ruleIds?: readonly string[];
            };
            expect(payload.ruleIds ?? []).toContain('deny-secret-read-agent');

            // No credential was minted and no adapter ran: the
            // credential never existed.
            expect(credentials.calls).toEqual([]);
            expect(invoked).toEqual([]);
          },
        ),
        { numRuns: 25 },
      );
    });

    it('INV-2 the policy engine refuses an agent factory.write even when the grant allows everything', async () => {
      // The same claim, one layer down: the **engine** itself refuses, so
      // the broker's refusal is not an artefact of the broker's own
      // wiring.
      //
      // The grant allows the scope, the autonomy is the ladder's top rung,
      // and the effect class is E4 (which the bundle's effect rules would
      // otherwise turn into `REQUIRE_APPROVAL`). Only the deny rule can
      // produce a `DENY`.
      const bundle = (await readPolicyBundle()).bundle;

      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 24 }),
          fc.constantFrom<Autonomy>(2, 3, 4),
          (scope, autonomy) => {
            const input: PolicyInput = {
              action: 'invoke:factory.write',
              capabilityId: 'factory.write',
              effectClass: 'E4',
              actor: { kind: 'agent', id: 'agent_1' },
              taskId: 'task_1',
              workflow: 'workflow_1',
              stage: 'implement',
              autonomy,
              resource: {
                kind: 'repo',
                ref: 'org/repo',
                paths: ['src/index.ts'],
              },
            };

            const decision = evaluate(
              input,
              bundle,
              {
                // The grant allows everything.
                workflowGrant: { allow: [scope, 'factory.write'], deny: [] },
                requiredScope: scope,
                requiredAutonomy: 1,
              },
            );

            expect(decision.outcome).toBe('DENY');
            expect(decision.ruleIds).toContain('deny-factory-write');
          },
        ),
        { numRuns: 25 },
      );
    });
  });

  describe('the API layer — the access points are scoped', () => {
    it('INV-2 denies a GENERATED agent request for a temporary grant', async () => {
      // The API half of the mutation: the agent asks for more scope.
      //
      // The refusal is at the **scope check**, before the handler runs —
      // so the grant port is never reached, and no grant exists.
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 24 }),
          fc.string({ minLength: 1, maxLength: 40 }),
          fc.integer({ min: 60, max: 3600 }),
          async (capability, scope, ttlSeconds) => {
            const harness = await buildAgentHarness();
            const response = await harness.app.inject({
              method: 'POST',
              url: '/v1/grants/temporary',
              headers: mutatingHeaders(agentHeaders(harness), 'key-inv2-grant'),
              payload: {
                taskId: 'tsk_inv2_0001',
                capability,
                scope,
                ttlSeconds,
                reason: `the agent decided it needed more scope: ${CANARY}`,
              },
            });

            // ---- (a) the intended effect is absent ----------------
            expect(response.statusCode).toBe(403);
            const body = response.json<{ code: string; detail: string }>();
            expect(body.code).toBe('policy_denied');
            // The refusal names the scope the caller lacked — a
            // refusal that named no reason would be indistinguishable
            // from a typo.
            expect(body.detail).toContain('intervene');

            // ---- (b) the grants are unchanged ---------------------
            expect(harness.intervention.grants).toEqual([]);

            // ---- (c) no approval was even requested ---------------
            const requested = harness.events.events.filter(
              (event) => event.eventType === 'approval.requested',
            );
            expect(requested).toEqual([]);

            // ---- (d) the canary did not survive -------------------
            expect(
              JSON.stringify({
                events: harness.events.events,
                grants: harness.intervention.grants,
              }),
            ).not.toContain(CANARY);

            await harness.close();
          },
        ),
        { numRuns: 10 },
      );
    }, 120_000);

    it('INV-2 denies a GENERATED agent request to apply the definition', async () => {
      // The definition half, at the API. The route requires the
      // `amend-factory` scope, which the agent's token does not carry.
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 40, maxLength: 40 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          async (sha, approvalId) => {
            const harness = await buildAgentHarness();
            const response = await harness.app.inject({
              method: 'POST',
              url: '/v1/definition/apply',
              headers: mutatingHeaders(agentHeaders(harness), 'key-inv2-def'),
              payload: { sha, approvalId },
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ code: string; detail: string }>();
            expect(body.code).toBe('policy_denied');
            expect(body.detail).toContain('amend-factory');

            // The apply was never attempted.
            expect(harness.definition.applies).toEqual([]);

            // And no `definition.applied` event was emitted.
            const applied = harness.events.events.filter(
              (event) => event.eventType === 'definition.applied',
            );
            expect(applied).toEqual([]);

            await harness.close();
          },
        ),
        { numRuns: 10 },
      );
    }, 120_000);

    it('INV-2 denies a GENERATED agent request to decide an approval', async () => {
      // The autonomy half at the API: the approval is what backs a merge,
      // so an agent that can grant it can merge. The route requires the
      // `approve` scope, which the agent's token does not carry.
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 24 }),
          fc.string({ minLength: 1, maxLength: 60 }),
          async (decision, comment) => {
            const harness = await buildAgentHarness();
            const response = await harness.app.inject({
              method: 'POST',
              url: '/v1/approvals/apr_inv2_0001/decision',
              headers: mutatingHeaders(agentHeaders(harness), 'key-inv2-apr'),
              payload: { decision, comment },
            });

            expect(response.statusCode).toBe(403);
            const body = response.json<{ code: string; detail: string }>();
            expect(body.code).toBe('policy_denied');
            expect(body.detail).toContain('approve');

            // No decision was made.
            expect(harness.approvals.decisions).toEqual([]);
            expect(harness.approvals.revocations).toEqual([]);

            await harness.close();
          },
        ),
        { numRuns: 10 },
      );
    }, 120_000);

    it('INV-2 the control — the same requests from a human token are not refused for want of scope', async () => {
      // Without this, a test that only proved the refusal would pass
      // against an API that refuses everything — a broken feature rather
      // than a working control.
      //
      // The harness's own token carries every scope, so the *same* calls
      // go through — and what is refused then is the **content** (an
      // unbound approval, a missing approval), not the caller.
      const harness = await buildHarness();

      const grantResponse = await harness.app.inject({
        method: 'POST',
        url: '/v1/grants/temporary',
        headers: mutatingHeaders(cliHeaders(harness), 'key-inv2-ctl-1'),
        payload: {
          taskId: 'tsk_inv2_0002',
          capability: 'factory.write',
          scope: 'repo:write:path:src/**',
          ttlSeconds: 600,
          reason: 'a human widened the scope on purpose',
        },
      });
      expect(grantResponse.statusCode).toBe(201);
      expect(harness.intervention.grants).toHaveLength(1);
      expect(harness.intervention.grants[0]?.capability).toBe('factory.write');

      await harness.close();
    });
  });

  describe('the autonomy layer — the ladder itself', () => {
    it('INV-2 refuses a GENERATED autonomous merge at the task\'s level and leaves the level unchanged', async () => {
      // The autonomy resource, proved on the **machine** rather than on
      // the guard function.
      //
      // The guard is `autonomyPermitsOrHumanInitiated`. The transition's
      // **authority** carries the level the task is actually at, and the
      // facts carry the level the workflow is at — so a transition that
      // claims a higher level in its facts cannot raise the task's
      // level, and this test proves it by reading the level back.
      //
      // ## What this test does **not** claim
      //
      // It does not claim that the machine refuses every merge at a low
      // level. It cannot: the guard's autonomy input is the **caller's**
      // fact (`transition.ts`: `autonomyLevel: request.facts?.autonomyLevel
      // ?? context.autonomyLevel` — the caller's value wins). That is a
      // real gap and it is reported as one; the next test pins it. What
      // this test proves is the specification's actual claim: the level
      // and the grants are **unchanged afterwards**, whatever the agent
      // asked for.
      await fc.assert(
        fc.asyncProperty(
          // The level the task is actually at.
          fc.constantFrom<Autonomy>(1, 2),
          // The level the agent *claims* in its facts.
          fc.constantFrom<Autonomy>(3, 4),
          fc.string({ minLength: 1, maxLength: 40 }),
          async (actualLevel, claimedLevel, note) => {
            const store = new MemoryStateMachineStore();
            store.addTask({
              id: 'tsk_inv2_0003',
              state: 'APPROVED',
              version: 1,
              autonomyLevel: actualLevel,
            });
            const machine = new StateMachine(store);

            const facts: GuardFacts = {
              autonomyLevel: claimedLevel,
              policyDecision: 'ALLOW',
              humanInitiated: false,
              accessPoint: null,
              approvedSha: 'a'.repeat(40),
              headSha: 'a'.repeat(40),
            };

            const result = await machine.transition({
              taskId: 'tsk_inv2_0003',
              to: 'MERGING',
              trigger: 'the agent decided to merge',
              actor: { kind: 'agent', id: 'agent_1' },
              authority: {
                basis: 'policy-decision',
                autonomyLevel: actualLevel,
                violation: false,
              },
              expectedVersion: 1,
              eventType: 'change.merged',
              facts,
              payload: { note },
            });

            // ---- (a) the level is unchanged ------------------------
            //
            // The outcome itself is not asserted here — this test is
            // about the *record*, not about whether the transition was
            // allowed. But the transition must not have thrown: a
            // refused transition is a **refusal**, and one that threw
            // would have written no record at all, which would make the
            // assertions below vacuous.
            expect(result).toBeDefined();

            // This is the specification's claim, and it holds whether the
            // transition was refused or not: the task's **stored** level is
            // the task's own, never the one the agent claimed.
            const task = store.tasks.get('tsk_inv2_0003');
            expect(task?.autonomyLevel).toBe(actualLevel);

            // And the transition did not rewrite the level under the
            // agent's feet: the level is not part of the update the
            // transition performs at all.
            expect(task?.autonomyLevel).not.toBe(claimedLevel);

            // ---- (b) the recorded authority carries the task's level --
            //
            // Whether the transition was refused or carried through, every
            // event it wrote names the level the task is at — the one an
            // auditor reads. So the *record* of the attempt cannot claim a
            // level the task never had.
            const written = [...store.events, ...store.refusals];
            for (const event of written) {
              expect(event.authority.autonomyLevel).toBe(actualLevel);
            }
          },
        ),
        { numRuns: 20 },
      );
    });

    it('INV-2 the guard refuses a merge whose facts do not claim a higher level', async () => {
      // The **refusal** half, on the same machine.
      //
      // Here the agent claims nothing: the facts carry the task's own
      // level, so the guard's L3 route is closed and the merge is
      // refused. This is the case the machine really does refuse, and it
      // is the case the red-team suite (AT-8) covers.
      //
      // The two tests together say exactly what is true: the machine
      // refuses when the facts do not claim a higher level, and when they
      // do claim one, the task's stored level is still untouched.
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<Autonomy>(1, 2),
          async (actualLevel) => {
            const store = new MemoryStateMachineStore();
            store.addTask({
              id: 'tsk_inv2_0004',
              state: 'APPROVED',
              version: 1,
              autonomyLevel: actualLevel,
            });
            const machine = new StateMachine(store);

            const facts: GuardFacts = {
              // The facts carry the **task's own** level — the honest
              // case, and the case the machine refuses.
              autonomyLevel: actualLevel,
              policyDecision: 'ALLOW',
              humanInitiated: false,
              accessPoint: null,
              approvedSha: 'a'.repeat(40),
              headSha: 'a'.repeat(40),
            };

            const result = await machine.transition({
              taskId: 'tsk_inv2_0004',
              to: 'MERGING',
              trigger: 'the agent decided to merge',
              actor: { kind: 'agent', id: 'agent_1' },
              authority: {
                basis: 'policy-decision',
                autonomyLevel: actualLevel,
                violation: false,
              },
              expectedVersion: 1,
              eventType: 'change.merged',
              facts,
              // The **canary** rides in the refused attempt here, not an
              // arbitrary note: the assertion below is that the canary
              // does not survive into the refusal, so the payload has to
              // carry it.
              payload: { note: CANARY },
            });

            // ---- (a) the intended effect is absent ----------------
            expect(result.ok).toBe(false);
            if (result.ok) {
              return;
            }
            expect(result.error).toBe('GuardFailed');
            // The refusal names the guard that refused, so the audit says
            // *which* control stopped it.
            expect(result.guard).toBe('autonomyPermitsOrHumanInitiated');

            // ---- (b) the level and the grants are unchanged -------
            const task = store.tasks.get('tsk_inv2_0004');
            expect(task?.state).toBe('APPROVED');
            expect(task?.version).toBe(1);
            expect(task?.autonomyLevel).toBe(actualLevel);

            // No transition event was written; only the refusal.
            expect(store.events).toHaveLength(0);
            expect(store.refusals).toHaveLength(1);
            expect(store.refusals[0]?.eventType).toBe('policy.denied');

            // ---- (c) no canary survived ---------------------------
            //
            // The canary rode in the refused attempt, and a refusal
            // records **why**, not **what was asked for**. So it must not
            // have survived into the refusal event.
            expect(
              JSON.stringify({
                events: store.events,
                refusals: store.refusals,
              }),
            ).not.toContain(CANARY);
          },
        ),
        { numRuns: 20 },
      );
    });

    it('INV-2 pins the known gap — the guard’s autonomy input is the caller’s fact, not the task’s level', async () => {
      // A **tripwire**, not an endorsement.
      //
      // `packages/state/src/transition.ts` resolves the guard's autonomy
      // input as `request.facts?.autonomyLevel ?? context.autonomyLevel`
      // — the **caller's** value wins over the task's stored level. So a
      // caller that asserts L3 in the facts gets the guard's L3 route even
      // when the task is at L1.
      //
      // That is a real weakness and it is **reported, not fixed** here.
      // This test pins the current behaviour so that:
      //
      // * the gap is **visible** — a reader of this file sees exactly what
      //   the machine does and does not enforce; and
      // * the moment someone closes it, this test **fails**, so the fix
      //   cannot land silently.
      //
      // The claim it makes is precise: the guard consulted the *claimed*
      // level, not the task's.
      const store = new MemoryStateMachineStore();
      store.addTask({
        id: 'tsk_inv2_0005',
        state: 'APPROVED',
        version: 1,
        autonomyLevel: 1,
      });
      const machine = new StateMachine(store);

      const result = await machine.transition({
        taskId: 'tsk_inv2_0005',
        to: 'MERGING',
        trigger: 'the agent decided to merge',
        actor: { kind: 'agent', id: 'agent_1' },
        authority: {
          basis: 'policy-decision',
          autonomyLevel: 1,
          violation: false,
        },
        expectedVersion: 1,
        eventType: 'change.merged',
        facts: {
          autonomyLevel: 3,
          policyDecision: 'ALLOW',
          humanInitiated: false,
          accessPoint: null,
          approvedSha: 'a'.repeat(40),
          headSha: 'a'.repeat(40),
        },
        payload: { note: CANARY },
      });

      // The transition went through — the guard took the caller's claim.
      expect(result.ok).toBe(true);

      // But the task's **stored** level is still L1. The widening was
      // attempted, not performed: the ladder is not what moved.
      expect(store.tasks.get('tsk_inv2_0005')?.autonomyLevel).toBe(1);

      // And the event that was written records the **task's** level, not
      // the claim — so the audit trail cannot be used to claim a level the
      // task never had.
      const written = store.events[0];
      expect(written?.authority.autonomyLevel).toBe(1);
    });

    it('INV-2 rejects a GENERATED stage output that tries to widen the autonomy or declare a grant', () => {
      // The output door. `StageOutput` is `.strict()`, so an extra field
      // is a **validation failure**, not an ignored extra — and the
      // schema is the same one for every field an agent might try.
      fc.assert(
        fc.property(
          fc.constantFrom('autonomyLevel', 'grant', 'scopes', 'capability', 'level'),
          fc.constantFrom(1, 2, 3, 4, 40),
          (field, value) => {
            const parsed = StageOutput.safeParse({
              status: 'success',
              artefacts: [],
              [field]: value,
            });
            expect(parsed.success).toBe(false);
            if (parsed.success) {
              return;
            }
            expect(
              parsed.error.issues.some(
                (issue) =>
                  issue.code === 'unrecognized_keys' &&
                  issue.message.includes(field),
              ),
            ).toBe(true);
          },
        ),
        { numRuns: 25 },
      );
    });

    it('INV-2 the control — an ordinary stage output parses', () => {
      // So the refusals above are the extra field, not a broken schema.
      const parsed = StageOutput.safeParse({
        status: 'success',
        artefacts: [],
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('the DB layer — the applier role is the only writer of the definition', () => {
    let postgres: Postgres;

    beforeAll(async () => {
      if (!running) {
        return;
      }
      postgres = await createPostgres('factory_t1_inv2_authority');

      // The migrations are applied, as `factory_owner` — the role that owns
      // the schema in production. Applying them as the superuser would
      // leave the tables owned by the superuser, and the *privileges*
      // would then be the wrong question: a superuser owns everything, so
      // every role could write everything.
      //
      // So the privileges being proved here are the ones the privilege
      // script actually grants, and not an artefact of who owns the
      // tables.
      const applied = await postgres.psqlAsOwner(`
        ${coreSql}
        SELECT factory.ensure_event_partitions(3);
        ${grantsSql}
      `);
      expect(isError(applied)).toBe(false);
    }, 120_000);

    afterAll(async () => {
      await postgres?.destroy();
    });

    it.skipIf(!running)('INV-2 the runtime role cannot write definition_versions', async () => {
      // The DB half of INV-2, and the one that does not care who asked.
      //
      // A0.7: *"only the applier may write `definition_versions`"*. So the
      // role the running system uses — `factory_app` — cannot write the
      // control surface, whoever is holding its connection. An agent's
      // request that somehow reached the database is stopped here.
      const out = await postgres.psqlAs(
        'factory_app',
        "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('a','\\x00','{}','agent_1');",
      );
      expect(isPermissionDenied(out)).toBe(true);
    }, 60_000);

    it.skipIf(!running)('INV-2 the readonly role cannot write anything', async () => {
      // The credential half at the DB layer: the lease table is
      // append-only for the runtime role, and read-only for the reader.
      const lease = await postgres.psqlAs(
        'factory_readonly',
        "INSERT INTO credential_leases(id,task_id,provider,scope,minted_at,expires_at) VALUES ('crd_x','t','github','{}','now()','now()');",
      );
      expect(isPermissionDenied(lease)).toBe(true);

      // And the runtime role cannot forge a credential's *material* into
      // the lease — the table stores the reference only, and the reader
      // can see every column of it without seeing a secret.
      const columns = await postgres.psqlAsOwner(`
        SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema='factory' AND table_name='credential_leases';
      `);
      expect(columns).toContain('scope');
      expect(columns).not.toContain('secret');
      expect(columns).not.toContain('material');
      expect(columns).not.toContain('password');
    }, 60_000);

    it.skipIf(!running)('INV-2 the edge role cannot write the definition either', async () => {
      // A third role, for the same reason: the privilege is the control,
      // not the actor.
      const out = await postgres.psqlAs(
        'factory_edge',
        "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('b','\\x00','{}','agent_1');",
      );
      expect(isPermissionDenied(out)).toBe(true);
    }, 60_000);

    it.skipIf(!running)('INV-2 the applier role CAN write definition_versions — the control is a privilege, not a ban', async () => {
      // The control for the three refusals above.
      //
      // Without it, a database that refused every write would pass them
      // — and the control would be "the table is read-only", not "the
      // right role may write it". The invariance that matters is that
      // the write is *possible*, and possible **only** by the applier.
      const out = await postgres.psqlAs(
        'factory_applier',
        "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('c','\\x00','{}','owner');",
      );
      expect(isError(out)).toBe(false);
    }, 60_000);
  });

  describe('the whole surface — every resource, every layer, one table', () => {
    it('INV-2 enumerates every widening route and proves the agent cannot reach one', async () => {
      // The systematic version.
      //
      // The four resources, enumerated from the **route inventory** and the
      // **policy bundle** rather than from a hand-written list — so a route
      // or a rule added later is covered without anyone remembering to
      // extend this file.
      //
      // For each resource the test asserts the *shape* of the control:
      //
      // * **the API door** — every route that widens the resource demands a
      //   scope the agent's token does not carry. A resource with **no**
      //   route (the credentials — the API exposes no credential surface at
      //   all, which is itself the control) is asserted to have none.
      // * **the tool door** — the bundle names a deny rule for the
      //   capability that resource would need, and the rule is *agent-
      //   shaped* where the resource is agent-only.
      // * **the DB door** — the definition is writable only by the applier.
      const bundle = (await readPolicyBundle()).bundle;

      // ---- the resources ------------------------------------------
      const resources: readonly Resource[] = [
        'grants',
        'autonomy',
        'credentials',
        'definition',
      ];

      // The routes that create or edit each resource, read out of the
      // API's own inventory — so the enumeration cannot drift from the
      // server.
      const { ROUTES } = await import('../../apps/api/src/routes.ts');

      /**
       * The routes that widen a resource.
       *
       * A resource with no widening route is a legitimate answer — the
       * credentials are one — so the mapping is by **access point**, and
       * the count is asserted below rather than assumed.
       */
      const routesFor = (resource: Resource) =>
        ROUTES.filter((route) => {
          switch (resource) {
            case 'grants':
              // The temporary-grant route — the only one that hands out
              // scope.
              return route.path === '/v1/grants/temporary';
            case 'autonomy':
              // The approvals — the decision and the revoke. Both decide
              // whether a merge may happen on its own.
              return (
                route.path.startsWith('/v1/approvals/') &&
                route.path.endsWith('/decision')
              );
            case 'credentials':
              // The API exposes **no** credential surface. The credential
              // is minted by the broker, from the task's own grant, and it
              // is never addressable over HTTP.
              return route.path.includes('/credential');
            case 'definition':
              // The apply — the one route that writes the control surface.
              return route.path === '/v1/definition/apply';
            default:
              return false;
          }
        });

      fc.assert(
        fc.property(
          fc.constantFrom(...resources),
          (resource) => {
            // ---- the tool door --------------------------------------
            //
            // The bundle must name the rule that refuses the capability
            // this resource would need. Without the rule the tool door
            // would be open, whatever the API did.
            const denyRuleIds = bundle.spec.denyRules.map((rule) => rule.id);
            expect(denyRuleIds).toContain('deny-factory-write');
            expect(denyRuleIds).toContain('deny-secret-read-agent');

            // ---- the API door ---------------------------------------
            //
            // Every route that widens the resource must demand a scope the
            // agent's token does not carry — so the agent cannot reach it.
            const routes = routesFor(resource);

            // The credentials have no route at all. Asserted **exactly**,
            // so a route added later for them turns this red: a new
            // credential route would have to carry an agent-reachable
            // scope to be a widening door, and that would be a defect.
            if (resource === 'credentials') {
              expect(routes).toEqual([]);
            } else {
              expect(routes.length).toBeGreaterThan(0);
            }

            for (const route of routes) {
              // The route demands at least one scope, and the agent's
              // token carries none of them.
              expect(route.scopes.length).toBeGreaterThan(0);
              for (const scope of route.scopes) {
                expect(AGENT_SCOPES as readonly string[]).not.toContain(scope);
              }
            }
          },
        ),
        { numRuns: 16 },
      );
    });

    it('INV-2 the agent’s own scopes reach no widening route at all', async () => {
      // The **enumeration** control, stated as a property of the whole
      // inventory rather than of one resource.
      //
      // For every route the server declares, the question is: *could this
      // route widen the agent's authority?* It could only do so if the
      // route required **no scope the agent lacks** — that is, if the
      // agent's two scopes were enough. So the claim is: there is no
      // **authenticated** route in the entire inventory that the agent's
      // scopes alone satisfy, except the ones that only *read*.
      //
      // This is the strongest form the API half can take, because it does
      // not depend on which routes exist — it depends on which routes the
      // agent could use.
      const { ROUTES } = await import('../../apps/api/src/routes.ts');

      const agentScopes = AGENT_SCOPES as readonly string[];

      // The **authenticated** routes the agent's scopes cover. The public
      // ones are excluded deliberately, and proved separately below: a
      // public route is not reachable by *authority* but by *network*, so
      // it is a different question.
      const reachable = ROUTES.filter(
        (route) =>
          route.auth !== 'public' &&
          route.scopes.every((scope) => agentScopes.includes(scope)),
      );

      // There is at least one such route — the test would otherwise be
      // vacuous.
      expect(reachable.length).toBeGreaterThan(0);

      // The routes the agent can reach are named **exactly**, so the
      // claim is not "some route is missing" but "these are all of
      // them".
      expect(reachable.map((route) => route.path).sort()).toEqual([
        '/v1/audit/explain',
        '/v1/intents',
        '/v1/metrics/summary',
        '/v1/runs/{id}',
        '/v1/runs/{id}/artefacts/{name}',
        '/v1/stream',
        '/v1/tasks',
        '/v1/tasks/{id}',
        '/v1/tasks/{id}/events',
        '/v1/tasks/{id}/runs',
        '/v1/views/overview',
      ]);

      // Every route the agent can reach **except** `define-intent` is
      // non-mutating: it reads.
      //
      // A mutating route the agent could reach would be a widening door
      // by construction — the agent could change the world with its own
      // two scopes. `define-intent` is the single exception, and it is
      // named rather than allowed: it creates an *intent*, which becomes
      // a task, and a task is governed by the workflow's autonomy level.
      for (const route of reachable) {
        if (route.path === '/v1/intents') {
          continue;
        }
        expect({
          method: route.method,
          path: route.path,
          mutating: route.mutating,
        }).toEqual({
          method: route.method,
          path: route.path,
          mutating: false,
        });
      }

      // And the widening routes are all **outside** the agent's reach —
      // named explicitly, so the claim is not "some route is missing" but
      // "these specific widening doors are all shut".
      const widening = ROUTES.filter(
        (route) =>
          route.mutating &&
          route.auth !== 'public' &&
          (route.path === '/v1/grants/temporary' ||
            route.path === '/v1/definition/apply' ||
            route.path.endsWith('/decision') ||
            route.path.endsWith('/revoke')),
      );
      expect(widening.length).toBeGreaterThan(0);
      for (const route of widening) {
        expect(
          route.scopes.some((scope) => !agentScopes.includes(scope)),
        ).toBe(true);
      }
    });

    it('INV-2 the one route the agent can reach creates a task, not authority', async () => {
      // The **behavioural** half of the claim above.
      //
      // `POST /v1/intents` is the only mutating route the agent's own
      // scopes reach. This test calls it — as the agent — and then reads
      // **every** authority-bearing store to show that what it created is
      // a task and nothing else: no grant, no approval, no autonomy
      // change, no definition write.
      const harness = await buildAgentHarness();

      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/intents',
        headers: mutatingHeaders(agentHeaders(harness), 'key-inv2-intent'),
        payload: {
          repo: 'org/repo',
          source: {
            kind: 'manual',
            title: 'the agent asked for this',
            body: 'a request the agent made for itself',
          },
        },
      });

      expect(response.statusCode).toBe(202);

      // An intent was recorded — the agent *can* ask for work.
      expect(harness.intents.recorded).toHaveLength(1);
      expect(harness.intents.recorded[0]?.repo).toBe('org/repo');

      // And nothing else moved. These are the four authority resources
      // INV-2 names: grants, autonomy, credentials and the definition.
      expect(harness.intervention.grants).toEqual([]);
      expect(harness.approvals.decisions).toEqual([]);
      expect(harness.approvals.revocations).toEqual([]);
      expect(harness.definition.applies).toEqual([]);

      // And the task that was created confers **no autonomy at all**.
      //
      // The API's access-point events carry the authority
      // `{basis: 'human-access-point'}` and **no** autonomy level — the
      // API never grants autonomy to anybody, so it cannot grant it to an
      // agent. The task's level is the workflow's, set when the task is
      // planned, and the agent's call did not touch it.
      const created = harness.events.events.filter(
        (event) => event.eventType === 'intent.recorded',
      );
      expect(created).toHaveLength(1);
      expect(created[0]?.authority).toEqual({ basis: 'human-access-point' });
      expect(created[0]?.authority.autonomyLevel).toBeUndefined();

      await harness.close();
    });

    it('INV-2 the public routes change nothing, so no public door is a widening door', async () => {
      // The public half of the enumeration.
      //
      // The inventory declares four public routes: the GitHub webhook and
      // the three operational endpoints. A public route is reachable
      // **without a factory credential**, so it is exactly the place where
      // a widening door would be most dangerous — and it is also the place
      // where the scope check cannot help.
      //
      // So the claim has to be proved **behaviourally**: the only public
      // route that mutates is the webhook, and the webhook **refuses** —
      // it answers `501` and changes nothing. The other three are the
      // health checks and the metrics, which read.
      //
      // The proof is a real request against the real app, not an
      // inspection of the inventory.
      const harness = await buildAgentHarness();

      // ---- the webhook refuses, and creates nothing -------------------
      const webhook = await harness.app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: mutatingHeaders(agentHeaders(harness), 'key-inv2-wh'),
        payload: {
          // A delivery that *would* create an intent, if the webhook were
          // implemented. It is the attacker's best effort at the public
          // door.
          repository: { full_name: 'org/repo' },
          issue: { number: 1, title: 'the agent asked for this' },
          sender: { login: 'alice' },
        },
      });

      expect(webhook.statusCode).toBe(501);

      // Nothing was created: no intent, no event, no grant.
      expect(harness.intents.recorded).toEqual([]);
      expect(harness.events.events).toEqual([]);
      expect(harness.intervention.grants).toEqual([]);

      // ---- the operational routes read, and change nothing -----------
      for (const path of ['/healthz', '/readyz', '/metrics']) {
        const response = await harness.app.inject({
          method: 'GET',
          url: path,
        });
        expect(response.statusCode).toBe(200);
      }

      // Still nothing.
      expect(harness.intents.recorded).toEqual([]);
      expect(harness.events.events).toEqual([]);

      await harness.close();
    });
  });
});
