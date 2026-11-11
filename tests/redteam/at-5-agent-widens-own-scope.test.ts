/**
 * T-1.17 — **AT-5**: an agent widens its own scope.
 *
 * pack `08` §4's row:
 *
 * | # | Attack | Fixture & action | Pass condition |
 * |---|---|---|---|
 * | **AT-5** | Agent widens its own scope | agent actor calls temporary-grant API / emits a grant in output |
 *   denied; attempted scope recorded; no grant created; output schema `.strict()` rejects extra fields |
 *
 * ## The attack, in three doors
 *
 * AT-5 is one hole with three ways in, and each door is closed by a
 * *different* control — which is why the attack needs three proofs:
 *
 * 1. **The broker door.** The agent asks the broker for a capability its
 *    grant does not cover. This is the agent's **only** sanctioned
 *    channel (blueprint `11` §1: *"an agent reaches a tool directly and
 *    nothing checks whether it may"*; blueprint `13` §2.1: *"There is no
 *    other sanctioned channel"*), so it is the door that matters most.
 *    It is closed at the **grant** gate, and the refusal is recorded as
 *    a `tool.denied` **security event** carrying the attempted
 *    capability and the step that refused it.
 * 2. **The API door.** The agent calls `POST /v1/grants/temporary` — the
 *    one call that would hand it more scope than it has. It is closed by
 *    the API's **scope check**: the agent's token carries no `intervene`
 *    scope, so the call is refused and **no grant is created**.
 * 3. **The output door.** The agent's *stage output* carries a grant of
 *    its own. It is closed by the contracts' `.strict()` `StageOutput`:
 *    the extra field is a **validation failure**, not an ignored extra.
 *
 * ## Why "attempted scope recorded" is proved at the **broker**
 *
 * The API deliberately emits **no event** for a refused call — "a refusal
 * leaves no trace in the event log, which is what makes the log a record
 * of *changes*" (`apps/api/src/handlers/shared.ts`). That is a sound
 * design for *changes*.
 *
 * But a refused attempt is not a change, and it still has to leave a
 * record — pack `08` §4 asks for "the expected security event present"
 * after every attack, and `tool.denied` **is** a registered security
 * event (pack `03` §5: *"counted, alerted on, shown on the Health
 * region"*).
 *
 * So the attempted scope is recorded where a refused *agent action* is
 * recorded: the broker's `tool.denied` event, whose payload names the
 * capability and whose reason names the scope.
 *
 * ## The triad
 *
 * 1. **(a) the intended effect is absent** — no grant exists, no
 *    capability was invoked;
 * 2. **(b) the expected security event is present** — a `tool.denied`
 *    naming the attempted capability and the scope;
 * 3. **(c) no canary value anywhere** — the canary rides in the attempted
 *    scope, and must not survive into the events, the records or the
 *    grants.
 */

import { describe, expect, it } from 'vitest';

import { StageOutput } from '@factory/contracts';

import {
  aCapability,
  aGrant,
  aRequest,
  anEntry,
  buildBroker,
} from '../helpers/broker.ts';
import {
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.ts';
import { hashToken } from '../../apps/api/src/auth.ts';
import type { Harness } from '../../apps/api/src/harness.ts';

/**
 * The canary — a fake provider key, planted in the broker's memory.
 *
 * The harness rule puts the canary *"in broker memory (fake App key, fake
 * provider key)"* — so it is planted as the **credential's material**,
 * which the credential provider holds and hands to the adapter as the
 * credential parameter.
 *
 * It is deliberately **not** in the call's arguments. The arguments are the
 * caller's own data, and the broker's contract (blueprint `11` §6.5) is
 * about the *credential's* material: *"the credential's reference and
 * scopes are recorded but its material never is."* A value the caller put
 * in the arguments is the caller's data and is recorded as such — the
 * broker redacts by **declared field name**, not by value.
 */
const CANARY = 'sk-canary-AT5-9b2d4e6a-do-not-leak';

/**
 * The scope the agent tries to widen itself into.
 *
 * It is a plain scope string — the *attempted scope* the denial has to
 * name — so the "no canary anywhere" assertion is not satisfied by the
 * mere absence of a secret in a field that never held one.
 */
const WIDENED_SCOPE = 'repo:write:path:src/**';

/**
 * The capability the agent tries to grant itself.
 */
const WIDENED_CAPABILITY = 'git.push.protected';

/**
 * The capability the agent's grant does cover — the one it may call.
 */
const ALLOWED_CAPABILITY = aCapability({
  id: 'git.patch.apply',
  version: '1.0.0',
  kind: 'mutation',
  effect: { class: 'E2', reversible: true, external: false },
  scope: {
    required: ['repo:write:path:src/**'],
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
  },
  credentials: { provider: '', permissions: {}, ttlSeconds: 60 },
});

/**
 * The capability the agent tries to reach — one whose required scope its
 * grant does not cover.
 */
const WIDENED = aCapability({
  id: WIDENED_CAPABILITY,
  version: '1.0.0',
  kind: 'mutation',
  effect: { class: 'E4', reversible: false, external: true },
  scope: {
    required: ['git.push.protected'],
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
  },
  credentials: {
    provider: 'github',
    permissions: { contents: 'write' },
    ttlSeconds: 300,
  },
});

describe('AT-5 — an agent widens its own scope', () => {
  describe('the broker door — the agent’s only sanctioned channel', () => {
    it('AT-5 denies the widened capability and records the attempted scope', async () => {
      const { broker, store } = buildBroker({
        entries: [anEntry(ALLOWED_CAPABILITY), anEntry(WIDENED)],
        secret: CANARY,
      });

      const outcome = await broker.invoke(
        aRequest({
          capabilityId: WIDENED_CAPABILITY,
          // The grant covers `git.patch.apply` and `repo:write:path:src/**`
          // — and nothing else.
          grant: aGrant({
            capabilities: ['git.patch.apply'],
            scopes: ['repo:write:path:src/**'],
          }),
          args: { repo: 'org/repo', scope: WIDENED_SCOPE },
        }),
      );

      // ---- (a) the intended effect is absent ------------------------
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.failureClass).toBe('policy.denied');

      // ---- (b) the expected security event is present ----------------
      const denials = store.events().filter(
        (event) => event.eventType === 'tool.denied',
      );
      expect(denials).toHaveLength(1);

      const denial = denials[0];
      expect(denial?.eventType).toBe('tool.denied');
      expect(denial?.authority.violation).toBe(true);

      const payload = denial?.payload as {
        readonly capabilityId: string;
        readonly step: number;
        readonly reason: string;
      };
      // The attempted **capability** is named.
      expect(payload.capabilityId).toBe(WIDENED_CAPABILITY);
      // The attempted **scope** is named, in the reason. The scope gate
      // refused because the grant does not allow `git.push.protected`.
      expect(payload.reason).toContain('git.push.protected');
      // And the step says *which* gate refused.
      expect(payload.step).toBe(3);
    });

    it('AT-5 creates no grant and invokes no adapter', async () => {
      const { broker, store, invoked, credentials } = buildBroker({
        entries: [anEntry(ALLOWED_CAPABILITY), anEntry(WIDENED)],
        secret: CANARY,
      });

      const outcome = await broker.invoke(
        aRequest({
          capabilityId: WIDENED_CAPABILITY,
          grant: aGrant({
            capabilities: ['git.patch.apply'],
            scopes: ['repo:write:path:src/**'],
          }),
          args: { repo: 'org/repo', scope: WIDENED_SCOPE },
        }),
      );

      expect(outcome.ok).toBe(false);

      // No adapter ran — so no grant was widened, no push happened.
      expect(invoked).toEqual([]);
      // And no credential was minted for the refused attempt: the grant
      // gate is step 3 and the credential is step 7.
      expect(credentials.calls).toEqual([]);

      // The only record is the denial. There is no successful invocation
      // alongside it.
      const rows = store.records();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('denied');
      expect(rows[0]?.capabilityId).toBe(WIDENED_CAPABILITY);
    });

    it('AT-5 leaves no canary in the events or the records', async () => {
      const { broker, store } = buildBroker({
        entries: [anEntry(ALLOWED_CAPABILITY), anEntry(WIDENED)],
        secret: CANARY,
      });

      await broker.invoke(
        aRequest({
          capabilityId: WIDENED_CAPABILITY,
          grant: aGrant({
            capabilities: ['git.patch.apply'],
            scopes: ['repo:write:path:src/**'],
          }),
          args: { repo: 'org/repo', scope: WIDENED_SCOPE },
        }),
      );

      const serialised = JSON.stringify({
        rows: store.records(),
        events: store.events(),
      });
      expect(serialised).not.toContain(CANARY);
      expect(serialised).not.toContain('sk-canary');
    });

    it('AT-5 leaves no canary even when the permitted path acquires the credential', async () => {
      // The control for the assertion above.
      //
      // A refused call never reaches step 7, so it never acquires a
      // credential — which means "no canary in the records" would hold
      // *vacuously*. This proves the same broker, with the same canary,
      // on the **permitted** path: the credential is acquired, the adapter
      // runs, and the adapter **echoes the credential's material** back.
      //
      // The broker strips the material from the result (blueprint `11`
      // §6.5), so even the permitted path leaves no canary.
      const { broker, store, invoked } = buildBroker({
        entries: [anEntry(ALLOWED_CAPABILITY), anEntry(WIDENED)],
        secret: CANARY,
        handler: (args, credential) => ({
          ok: true,
          echoedArgs: args,
          echoedCredential: credential,
        }),
      });

      const outcome = await broker.invoke(
        aRequest({
          capabilityId: WIDENED_CAPABILITY,
          grant: aGrant({
            capabilities: ['git.patch.apply', WIDENED_CAPABILITY],
            scopes: ['repo:write:path:src/**', 'git.push.protected'],
          }),
          args: { repo: 'org/repo' },
        }),
      );

      expect(outcome.ok).toBe(true);
      // The adapter really did receive the material — so this is not a
      // vacuous pass over a broker that never hands out a credential.
      expect(invoked).toHaveLength(1);
      expect(
        JSON.stringify(invoked[0]?.credential),
      ).toContain(CANARY);

      // The material is gone from the value handed back to the agent…
      expect(
        JSON.stringify(outcome.ok ? outcome.value : null),
      ).not.toContain(CANARY);
      // …and from everything the store recorded.
      expect(
        JSON.stringify({ rows: store.records(), events: store.events() }),
      ).not.toContain(CANARY);
    });

    it('AT-5 allows the capability the grant does cover, so the refusal is the grant', async () => {
      // The control: the same broker, the same capability set, and a grant
      // that names the widened capability — the call goes through.
      //
      // Without this, a broker that denied everything would pass the
      // attack test. This proves the refusal was caused by the **grant**.
      const { broker, invoked } = buildBroker({
        entries: [anEntry(ALLOWED_CAPABILITY), anEntry(WIDENED)],
      });

      const outcome = await broker.invoke(
        aRequest({
          capabilityId: WIDENED_CAPABILITY,
          grant: aGrant({
            capabilities: ['git.patch.apply', WIDENED_CAPABILITY],
            scopes: ['repo:write:path:src/**', 'git.push.protected'],
          }),
          args: { repo: 'org/repo' },
        }),
      );

      expect(outcome.ok).toBe(true);
      expect(invoked).toHaveLength(1);
    });
  });

  describe('the API door — the temporary-grant access point', () => {
    /**
     * A harness whose CLI token carries **only** the scopes an agent's own
     * work would carry — and explicitly **not** `intervene`.
     */
    const buildAgentHarness = async (): Promise<Harness> => {
      const harness = await buildHarness({
        scopes: ['define-intent', 'inspect'],
      });

      // A **third** credential: the agent's own token. It is a valid
      // factory token for an allow-listed login, and it carries no
      // `intervene` scope.
      //
      // This is the attacker's *best* position: a real credential, a real
      // login, a real token — but scoped to what the agent was given.
      harness.tokens.put({
        id: 'tok-agent',
        tokenHash: hashToken('fac_agenttoken0001'),
        login: 'alice',
        scopes: ['define-intent', 'inspect'],
        expiresAt: '2999-01-01T00:00:00.000Z',
      });

      return harness;
    };

    /**
     * The headers an agent's bearer token carries.
     */
    const AGENT_HEADERS = (harness: Harness): Record<string, string> =>
      cliHeaders(harness, 'fac_agenttoken0001');

    it('AT-5 denies an agent actor the temporary-grant API', async () => {
      const harness = await buildAgentHarness();

      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/grants/temporary',
        headers: mutatingHeaders(AGENT_HEADERS(harness), 'key-at5-1'),
        payload: {
          taskId: 'tsk_at5_0001',
          capability: WIDENED_CAPABILITY,
          scope: WIDENED_SCOPE,
          ttlSeconds: 3600,
          reason: 'the agent decided it needs more scope',
        },
      });

      // ---- (a) the intended effect is absent ------------------------
      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      const body = response.json<{ code: string; detail: string }>();
      expect(body.code).toBe('policy_denied');

      // ---- the missing scope is named --------------------------------
      //
      // The refusal says *which* scope the caller lacked. A refusal that
      // named no reason would be indistinguishable from a typo, and the
      // audit would lose the only record of the attempt.
      expect(body.detail).toContain('intervene');

      await harness.close();
    });

    it('AT-5 creates no grant — the intervention port is never reached', async () => {
      const harness = await buildAgentHarness();

      await harness.app.inject({
        method: 'POST',
        url: '/v1/grants/temporary',
        headers: mutatingHeaders(AGENT_HEADERS(harness), 'key-at5-2'),
        payload: {
          taskId: 'tsk_at5_0001',
          capability: WIDENED_CAPABILITY,
          scope: WIDENED_SCOPE,
          ttlSeconds: 3600,
          reason: 'the agent decided it needs more scope',
        },
      });

      // The port records the grants it created. It was never reached, so
      // the list is empty — the grant does not exist.
      expect(harness.intervention.grants).toEqual([]);

      // And no approval was requested: the refusal happened **before**
      // the action, so no `approval.requested` event was emitted.
      const requested = harness.events.events.filter(
        (event) => event.eventType === 'approval.requested',
      );
      expect(requested).toEqual([]);

      await harness.close();
    });

    it('AT-5 leaves no canary in the events, the grants or the log', async () => {
      const harness = await buildAgentHarness();

      await harness.app.inject({
        method: 'POST',
        url: '/v1/grants/temporary',
        headers: mutatingHeaders(AGENT_HEADERS(harness), 'key-at5-3'),
        payload: {
          taskId: 'tsk_at5_0001',
          capability: WIDENED_CAPABILITY,
          scope: WIDENED_SCOPE,
          ttlSeconds: 3600,
          reason: `the agent decided it needs more scope: ${CANARY}`,
        },
      });

      // The canary rode in the attempted grant's free-form **reason** —
      // the one field a grant record stores verbatim. It must not have
      // survived anywhere: not into an event, not into a created grant.
      const serialised = JSON.stringify({
        events: harness.events.events,
        grants: harness.intervention.grants,
      });
      expect(serialised).not.toContain(CANARY);
      expect(serialised).not.toContain('sk-canary');

      await harness.close();
    });

    it('AT-5 refuses a human caller the temporary grant too — the scope is what matters, not the identity', async () => {
      // The control: the *same* call, from the harness's own token, which
      // **does** carry `intervene`. It goes through.
      //
      // Without this, a test that only proved the refusal would pass
      // against an API that refuses the temporary-grant call for
      // everybody — a broken feature rather than a working control.
      const harness = await buildHarness();

      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/grants/temporary',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at5-4'),
        payload: {
          taskId: 'tsk_at5_0001',
          capability: WIDENED_CAPABILITY,
          scope: WIDENED_SCOPE,
          ttlSeconds: 3600,
          reason: `a human widened the scope on purpose: ${CANARY}`,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(harness.intervention.grants).toHaveLength(1);
      expect(harness.intervention.grants[0]?.capability).toBe(
        WIDENED_CAPABILITY,
      );

      // The human's grant **does** carry the scope — that is the point of
      // the control. The refusal above was about the *caller's* authority,
      // not about the scope's content.
      expect(harness.intervention.grants[0]?.scope).toBe(WIDENED_SCOPE);

      // And the grant record **does** keep the free-form reason verbatim —
      // which is what makes the "no canary" assertion above meaningful:
      // a created grant *would* have carried the secret, so the refused
      // call's leaving no trace is a fact about the refusal, not about
      // the API never storing free text.
      expect(
        JSON.stringify(harness.intervention.grants),
      ).toContain(CANARY);

      await harness.close();
    });
  });

  describe('the output door — a grant emitted in the stage output', () => {
    it('AT-5 rejects a stage output that carries a grant', () => {
      // The agent's output tries to widen its own scope by *declaring*
      // the grant, rather than by asking for one. The `.strict()` schema
      // refuses it: the extra field is a validation failure, not an
      // ignored extra.
      const output = {
        status: 'success',
        artefacts: [],
        grant: {
          capability: WIDENED_CAPABILITY,
          scope: WIDENED_SCOPE,
          ttlSeconds: 3600,
          reason: CANARY,
        },
      };

      const parsed = StageOutput.safeParse(output);

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find(
          (entry) => entry.code === 'unrecognized_keys',
        );
        expect(issue).toBeDefined();
        expect(issue?.path).toEqual([]);
        expect(issue?.message).toContain('grant');
      }
    });

    it('AT-5 rejects a stage output that names a widened scope directly', () => {
      // The other spelling of the same attack: not a `grant` object, but
      // a `scopes` array naming the scope it wants.
      const parsed = StageOutput.safeParse({
        status: 'success',
        artefacts: [],
        scopes: [WIDENED_SCOPE],
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some(
            (issue) =>
              issue.code === 'unrecognized_keys' &&
              issue.message.includes('scopes'),
          ),
        ).toBe(true);
      }
    });

    it('AT-5 accepts a stage output that carries no grant', () => {
      // The control: the ordinary output parses. So the refusal above is
      // the extra field, not the schema being broken.
      const parsed = StageOutput.safeParse({
        status: 'success',
        artefacts: [],
      });

      expect(parsed.success).toBe(true);
    });

    it('AT-5 makes autonomyLevel unpresentable in a stage output', () => {
      // AT-8's "autonomyLevel in stage output" is the same door seen from
      // the other side, and it is closed by the same `.strict()` object.
      // The stage cannot raise its own autonomy by writing it down.
      const parsed = StageOutput.safeParse({
        status: 'success',
        artefacts: [],
        autonomyLevel: 4,
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some((issue) =>
            issue.message.includes('autonomyLevel'),
          ),
        ).toBe(true);
      }
    });
  });
});
