/**
 * T-1.17 — **AT-4**: a tool outside the grant.
 *
 * pack `08` §4's row:
 *
 * | # | Attack | Fixture & action | Pass condition |
 * |---|---|---|---|
 * | **AT-4** | Tool outside grant | stage lacking `github.pr.create` requests it |
 *   denied at broker step 3; `tool.denied` with capability + step; adapter never invoked (spy) |
 *
 * ## The attack
 *
 * A stage is granted `git.patch.apply` and nothing else. It then asks the
 * broker for `github.pr.create` — a capability that exists in the registry,
 * and one the task has no grant for.
 *
 * The grant is not merely a list of what the agent *may* call. It is the
 * **only** thing that says what it may call, so the request has to be
 * refused at the gate that checks it.
 *
 * ## The triad
 *
 * pack `08` §4's harness rule asks for three assertions after every
 * attack:
 *
 * 1. **(a) the intended effect is absent** — the PR was never created;
 * 2. **(b) the expected security event is present** — a `tool.denied`
 *    naming the capability and the step that refused it;
 * 3. **(c) no canary value anywhere** — in the events, the artefacts, the
 *    logs, the PR bodies or the patches.
 *
 * The canary here is a **fake provider key** planted in the broker's
 * memory — the shape the harness rule names ("canary secrets planted in
 * the worker env, in broker memory (fake App key, fake provider key)").
 * The attack carries it in the call's arguments, so the assertion is
 * meaningful: the request that was refused is exactly the request that
 * would have leaked it.
 *
 * ## Why the spy is on the *adapter*, not the broker
 *
 * "adapter never invoked" is the load-bearing part. The broker's own
 * outcome says it refused — but the outcome is the broker's *word* about
 * itself. The adapter's spy is an **independent** observation: if the
 * adapter had run, the spy would have seen it whatever the broker said.
 */

import { describe, expect, it } from 'vitest';

import { aCapability, aGrant, aRequest, anEntry, buildBroker } from '../helpers/broker.ts';

/**
 * The canary — a fake provider key, planted in the broker's memory.
 *
 * It is the value the red-team harness rule requires be found **nowhere**
 * after an attack. It is planted where the harness rule says it is: *"in
 * broker memory (fake App key, fake provider key)"* — so it is the
 * **credential's material**, held by the credential provider and handed to
 * the adapter as the credential parameter.
 *
 * It is deliberately **not** put in the call's arguments. The arguments are
 * the caller's own data, and the broker's contract (blueprint 11 §6.5) is
 * about the *credential's* material: *"the credential's reference and scopes
 * are recorded but its material never is."*
 */
const CANARY = 'sk-canary-AT4-3f7a9c1e-do-not-leak';

/**
 * The capability the attack asks for — `github.pr.create`.
 *
 * It is **registered**: the attack is not "a capability that does not
 * exist" (that is AT-4's sibling, the MCP-advertised-but-unregistered
 * case). It exists, the agent knows it exists, and the agent asks for it
 * anyway. Only the grant stops it.
 */
const PR_CREATE = aCapability({
  id: 'github.pr.create',
  version: '1.0.0',
  kind: 'mutation',
  effect: { class: 'E3', reversible: false, external: true },
  scope: {
    required: ['git.write.pr'],
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
  },
  credentials: {
    provider: 'github',
    permissions: { pull_requests: 'write' },
    ttlSeconds: 300,
  },
});

/**
 * The capability the stage *does* hold — the one it is allowed to call.
 */
const PATCH_APPLY = aCapability({
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
 * Build the broker with both capabilities registered.
 *
 * The `handler` is the **spy**: it records every call that reached an
 * adapter. It returns a PR-shaped value, so a call that *did* get through
 * would look like a created pull request — the intended effect, which the
 * test then asserts is absent.
 */
const buildAttacked = () =>
  buildBroker({
    entries: [anEntry(PATCH_APPLY), anEntry(PR_CREATE)],
    secret: CANARY,
    handler: (args, credential) => ({
      ok: true,
      prNumber: 42,
      url: 'https://github.invalid/org/repo/pull/42',
      // A capability that echoes its input would carry the secret into
      // the recorded result — so the handler echoes the credential too.
      echoed: args,
      echoedCredential: credential,
    }),
  });

describe('AT-4 — a tool outside the grant', () => {
  it('AT-4 denies the call at broker step 3 and names the capability and the step', async () => {
    const { broker, store } = buildAttacked();

    // The stage holds `git.patch.apply` only. It asks for `github.pr.create`.
    const outcome = await broker.invoke(
      aRequest({
        capabilityId: 'github.pr.create',
        grant: aGrant({
          capabilities: ['git.patch.apply'],
          scopes: ['repo:write:path:src/**'],
        }),
        args: { branch: 'feature/x', title: 'a change' },
      }),
    );

    // ---- (a) the intended effect is absent --------------------------
    expect(outcome.ok).toBe(false);

    // ---- refused at step 3 — the grant gate ------------------------
    expect(outcome.ok === false && outcome.failedAt).toBe('grant');
    expect(outcome.ok === false && outcome.stepNumber).toBe(3);
    expect(outcome.ok === false && outcome.failureClass).toBe('policy.denied');

    // The refusal says *which* capability was refused and *why*.
    expect(outcome.ok === false && outcome.reason).toContain('github.pr.create');
    expect(outcome.ok === false && outcome.reason).toContain(
      'does not name the capability',
    );

    // ---- (b) the expected security event is present ----------------
    const denials = store.events().filter((event) => event.eventType === 'tool.denied');
    expect(denials).toHaveLength(1);

    const denial = denials[0];
    expect(denial?.eventType).toBe('tool.denied');
    expect(denial?.actor).toEqual({ kind: 'agent', id: 'agent_1' });

    // The payload names the capability and the step that refused it.
    const payload = denial?.payload as {
      readonly capabilityId: string;
      readonly step: number;
      readonly reason: string;
    };
    expect(payload.capabilityId).toBe('github.pr.create');
    expect(payload.step).toBe(3);
    expect(payload.reason).toContain('github.pr.create');

    // The authority records the **violation** — the call was attempted and
    // refused, so the event says so.
    expect(denial?.authority.violation).toBe(true);
  });

  it('AT-4 never invokes the adapter — the spy sees nothing', async () => {
    const { broker, invoked, credentials } = buildAttacked();

    const outcome = await broker.invoke(
      aRequest({
        capabilityId: 'github.pr.create',
        grant: aGrant({
          capabilities: ['git.patch.apply'],
          scopes: ['repo:write:path:src/**'],
        }),
        args: { branch: 'feature/x' },
      }),
    );

    expect(outcome.ok).toBe(false);

    // The spy. This is the independent observation: the adapter was never
    // reached, so the PR was never created.
    expect(invoked).toEqual([]);

    // And no credential was consumed for the refused call — the grant
    // gate is step 3, and the credential is step 7.
    expect(credentials.calls).toEqual([]);
  });

  it('AT-4 leaves no canary value in the events, the records or the summaries', async () => {
    const { broker, store } = buildAttacked();

    await broker.invoke(
      aRequest({
        capabilityId: 'github.pr.create',
        grant: aGrant({
          capabilities: ['git.patch.apply'],
          scopes: ['repo:write:path:src/**'],
        }),
        args: { branch: 'feature/x' },
      }),
    );

    // The invocation row is recorded — a refused call is evidence — but
    // what it records is the **digest** of the arguments and a *summary*,
    // never the values. So the canary is not in it.
    const rows = store.records();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('denied');
    expect(rows[0]?.argsSha256).toMatch(/^[0-9a-f]{64}$/);

    // The whole store, serialised: no canary anywhere.
    const serialised = JSON.stringify({
      rows: store.records(),
      events: store.events(),
    });
    expect(serialised).not.toContain(CANARY);
    expect(serialised).not.toContain('sk-canary');
  });

  it('AT-4 leaves no canary in the result even when the capability echoes it', async () => {
    // The control for the assertion above: the *same* broker, the same
    // canary, but a call the grant **permits** — so the credential is
    // acquired, the adapter runs, and the adapter hands back a result
    // that echoes the credential's material.
    //
    // The broker strips the material from the result (blueprint 11 §6.5),
    // so even the permitted path leaves no canary. Without this, the
    // previous test would pass for the wrong reason: a refused call
    // acquires no credential, so it could not leak one.
    const { broker, store } = buildAttacked();

    const outcome = await broker.invoke(
      aRequest({
        capabilityId: 'github.pr.create',
        grant: aGrant({
          capabilities: ['git.patch.apply', 'github.pr.create'],
          scopes: ['repo:write:path:src/**', 'git.write.pr'],
        }),
        args: { branch: 'feature/x' },
      }),
    );

    expect(outcome.ok).toBe(true);

    // The material is gone from the value handed back to the agent.
    expect(JSON.stringify(outcome.ok ? outcome.value : null)).not.toContain(
      CANARY,
    );
    // And from everything the store recorded.
    expect(
      JSON.stringify({ rows: store.records(), events: store.events() }),
    ).not.toContain(CANARY);
  });

  it('AT-4 allows the capability the grant does name, so the refusal is the grant and not the pipeline', async () => {
    // The control: the same broker, the same capability set, and a grant
    // that *does* name `github.pr.create` — the call goes through.
    //
    // Without this, a broker that denied everything would pass the attack
    // test. This proves the refusal was caused by the **grant**, not by a
    // pipeline that is broken in the other direction.
    const { broker, invoked } = buildAttacked();

    const outcome = await broker.invoke(
      aRequest({
        capabilityId: 'github.pr.create',
        grant: aGrant({
          capabilities: ['git.patch.apply', 'github.pr.create'],
          scopes: ['repo:write:path:src/**', 'git.write.pr'],
        }),
        args: { branch: 'feature/x', title: 'a change' },
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.args).toEqual({
      branch: 'feature/x',
      title: 'a change',
    });
  });
});
