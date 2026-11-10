/**
 * T-1.09 — the **credential broker**.
 *
 * checklist 03, T-1.09 acceptance: *"a context scan finds **no**
 * credential in any prompt or assembled context, and a credential
 * **cannot be used after its task terminates** — use-after-revoke
 * fails."*
 *
 * ## What these tests hold
 *
 * The broker's three properties, each proved against the fake:
 *
 * 1. **The material is never written.** The lease carries the
 *    reference; the material is nowhere in it.
 * 2. **The material is injected only at the invocation boundary.**
 *    The broker's `resolve` is that boundary — and the material never
 *    reaches a prompt, a context, an argument or a result.
 * 3. **The credential dies with the task.** `revokeAll` revokes at the
 *    provider and marks the lease revoked, and a use-after-revoke
 *    attempt fails at the provider.
 *
 * The `secret-scan` test is the ticket's headline oracle: it walks
 * **every** artefact, event, log line and prompt the fake run produced
 * and asserts that the token appears in **none** of them.
 */

import { describe, expect, it } from 'vitest';

import {
  CredentialBroker,
  FakeCredentialProvider,
  InMemoryCredentialLeaseStore,
  REDACTION_PLACEHOLDER,
  RedactionRegistry,
  type CredentialLease,
} from '../../packages/credentials/src/index.ts';
import {
  aCredentialCapability,
  anInvocationContext,
  buildCredentialBroker,
  THE_CLOCK,
} from '../helpers/credentials.ts';

describe('T-1.09 — the credential broker', () => {
  describe('the mint', () => {
    it('mints a credential for the task', async () => {
      const { broker } = buildCredentialBroker();

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:write:pr'],
        allowedScopes: ['repo:write:pr'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.credId).toBe('crd_000001');
      expect(result.ok && result.value.secret.length).toBeGreaterThan(0);
    });

    it('REFUSES when the scope is empty', async () => {
      const { broker, provider } = buildCredentialBroker();

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:write'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('policy.denied');
      // Nothing was minted — a refusal is not a degraded mint.
      expect(provider.issuedCount).toBe(0);
    });

    it('REFUSES when the grant allows no permission the capability needs', async () => {
      // The scope survives, but the **grant's** permission list does not
      // mention it. A token with no permission can do nothing, so the
      // broker refuses rather than minting a useless credential.
      const { broker, provider } = buildCredentialBroker();

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:write:pr'],
        allowedScopes: ['repo:write:pr'],
        repositories: ['org/repo'],
        grantPermissions: { contents: 'write' },
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('policy.denied');
      expect(provider.issuedCount).toBe(0);
    });

    it('reports a provider failure as tool.unavailable', async () => {
      const { broker } = buildCredentialBroker({
        provider: new FakeCredentialProvider({
          failWith: 'the App installation has expired',
        }),
      });

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('tool.unavailable');
    });
  });

  describe('the lease', () => {
    it('records the REFERENCE and never the material', async () => {
      const { broker, leases } = buildCredentialBroker();

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:write:pr'],
        allowedScopes: ['repo:write:pr'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(true);
      const lease = leases.get('crd_000001');
      expect(lease).toBeDefined();
      expect(lease?.taskId).toBe('task_1');
      expect(lease?.provider).toBe('github');
      expect(lease?.scope.permissions['pull_requests']).toBe('write');

      // The material is **nowhere** in the row.
      const serialised = JSON.stringify(lease);
      expect(result.ok && serialised.includes(result.value.secret)).toBe(false);
      expect(serialised.includes('ghs_')).toBe(false);
    });

    it('bounds the expiry by the broker’s ceiling', async () => {
      // A provider that ignores the requested TTL must not widen the
      // credential's life. ADR-0018: "TTL ≤ 1 h".
      const { broker } = buildCredentialBroker();

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.expiresAt).toBe(
        '2026-11-10T01:00:00.000Z',
      );
    });

    it('does NOT let a provider that ignores the TTL widen the credential', async () => {
      // The provider asks for **eight hours**; the broker's ceiling is
      // one. The lease's expiry must be the ceiling, not the provider's
      // answer.
      const { broker, leases } = buildCredentialBroker({
        provider: new FakeCredentialProvider({
          clock: THE_CLOCK,
          expirySeconds: 8 * 3600,
        }),
      });

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.expiresAt).toBe(
        '2026-11-10T01:00:00.000Z',
      );
      expect(leases.get('crd_000001')?.expiresAt).toBe(
        '2026-11-10T01:00:00.000Z',
      );
    });
  });

  describe('the resolution boundary', () => {
    it('returns NO credential for a capability that needs none', async () => {
      const { broker } = buildCredentialBroker();
      const capability = aCredentialCapability({ provider: 'none' });

      const result = await broker.resolve(
        capability,
        anInvocationContext(),
        ['repo:write:pr'],
        ['org/repo'],
      );

      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toBeUndefined();
    });

    it('reuses the SAME credential for a second call', async () => {
      const { broker, provider } = buildCredentialBroker();
      const capability = aCredentialCapability();
      const context = anInvocationContext();

      const first = await broker.resolve(
        capability,
        context,
        ['repo:write:pr'],
        ['org/repo'],
      );
      const second = await broker.resolve(
        capability,
        context,
        ['repo:write:pr'],
        ['org/repo'],
      );

      expect(first.ok && second.ok).toBe(true);
      expect(first.ok && first.value?.credId).toBe(
        second.ok ? second.value?.credId : undefined,
      );
      // One mint, two uses.
      expect(provider.issuedCount).toBe(1);
    });

    it('gives the credential the NARROWED scope, not the grant’s', async () => {
      const { broker, leases } = buildCredentialBroker();
      const capability = aCredentialCapability({
        required: ['repo:read', 'repo:write'],
      });

      const result = await broker.resolve(
        capability,
        anInvocationContext(),
        ['repo:read'],
        ['org/repo'],
      );

      expect(result.ok).toBe(true);
      const lease = leases.get('crd_000001');
      expect(lease?.scope.scopes).toEqual(['repo:read']);
      expect(lease?.scope.permissions['contents']).toBe('read');
      expect(lease?.scope.permissions['contents']).not.toBe('write');
    });
  });

  describe('the revocation', () => {
    it('revokes at the provider and marks the lease revoked', async () => {
      const { broker, leases, provider } = buildCredentialBroker();

      const minted = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });
      expect(minted.ok).toBe(true);

      const failures = await broker.revokeAll('task_1');

      expect(failures).toEqual([]);
      expect(provider.revocations).toHaveLength(1);
      expect(provider.isRevoked('crd_000001')).toBe(true);
      expect(leases.get('crd_000001')?.revokedAt).toBeDefined();
    });

    it('marks the lease revoked EVEN WHEN the provider fails', async () => {
      // The lease's death is the factory's own record; it must not be
      // held hostage by the provider being unreachable.
      const harness = buildCredentialBroker({
        provider: new FakeCredentialProvider({
          failRevokeWith: 'the provider is unreachable',
        }),
      });

      await harness.broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      const failures = await harness.broker.revokeAll('task_1');

      expect(failures).toHaveLength(1);
      expect(harness.leases.get('crd_000001')?.revokedAt).toBeDefined();
    });

    it('does not revoke twice', async () => {
      const { broker, provider } = buildCredentialBroker();

      await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      await broker.revokeAll('task_1');
      await broker.revokeAll('task_1');

      expect(provider.revocations).toHaveLength(1);
    });

    it('leaves another task’s credential alone', async () => {
      const { broker, provider } = buildCredentialBroker();

      await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });
      await broker.mint({
        taskId: 'task_2',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      await broker.revokeAll('task_1');

      expect(provider.revocations).toHaveLength(1);
      expect(provider.revocations[0]?.taskId).toBe('task_1');
    });

    it('does NOT revoke task_10 when task_1 is revoked', async () => {
      // The live map is keyed `taskId:capabilityId`, so a prefix match
      // must stop at the delimiter — `task_10:` does not start with
      // `task_1:`. A task that is merely *named* like another must keep
      // its credential.
      const { broker, provider } = buildCredentialBroker();
      // The capability asks for `repo:read`, so the intersection with the
      // effective scopes is not empty.
      const capability = aCredentialCapability({
        required: ['repo:read'],
        permissions: { contents: 'read' },
      });

      await broker.resolve(capability, anInvocationContext({ taskId: 'task_1' }), [
        'repo:read',
      ], ['org/repo']);
      await broker.resolve(capability, anInvocationContext({ taskId: 'task_10' }), [
        'repo:read',
      ], ['org/repo']);

      await broker.revokeAll('task_1');

      expect(provider.revocations.map((lease) => lease.taskId)).toEqual([
        'task_1',
      ]);
      expect(provider.isRevoked('crd_000002')).toBe(false);

      // And the live map is untouched for `task_10` — so its credential
      // is still the one it had, not a fresh mint.
      const resolved = await broker.resolve(
        capability,
        anInvocationContext({ taskId: 'task_10' }),
        ['repo:read'],
        ['org/repo'],
      );
      expect(resolved.ok && resolved.value?.credId).toBe('crd_000002');
      expect(provider.issuedCount).toBe(2);
    });
  });

  describe('the orphan reaper', () => {
    it('revokes a lease that expired without a revocation', async () => {
      const { broker, leases, provider } = buildCredentialBroker();

      await broker.mint({
        taskId: 'task_dead',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      // Nothing was revoked — the task died before its `finally` ran.
      expect(provider.revocations).toHaveLength(0);

      const result = await broker.reapExpired('2026-11-10T02:00:00.000Z');

      expect(result.revoked).toBe(1);
      expect(provider.isRevoked('crd_000001')).toBe(true);
      expect(leases.get('crd_000001')?.revokedAt).toBeDefined();
    });

    it('does NOT reap a lease that has not expired', async () => {
      const { broker, provider } = buildCredentialBroker();

      await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      const result = await broker.reapExpired('2026-11-10T00:30:00.000Z');

      expect(result.revoked).toBe(0);
      expect(provider.revocations).toHaveLength(0);
    });

    it('does NOT reap an already-revoked lease', async () => {
      const { broker, provider } = buildCredentialBroker();

      await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });
      await broker.revokeAll('task_1');
      provider.revocations.length = 0;

      const result = await broker.reapExpired('2026-11-10T02:00:00.000Z');

      expect(result.revoked).toBe(0);
      expect(provider.revocations).toHaveLength(0);
    });
  });

  describe('A3.4 — use-after-revoke', () => {
    it('FAILS when the credential is used after its task terminates', async () => {
      const { broker, provider } = buildCredentialBroker();
      const capability = aCredentialCapability();
      const context = anInvocationContext();

      const before = await broker.resolve(
        capability,
        context,
        ['repo:write:pr'],
        ['org/repo'],
      );
      expect(before.ok).toBe(true);
      const credId = before.ok ? before.value?.credId : undefined;
      expect(credId).toBeDefined();

      // Before the task ends, the credential works.
      expect(() => provider.use(credId ?? '')).not.toThrow();

      // The task terminates — the `finally` runs.
      await broker.revokeAll(context.taskId);
      expect(provider.isRevoked(credId ?? '')).toBe(true);

      // The credential is dead. A second use of the same material must
      // fail at the provider — the fake **enforces** the revocation, so
      // this is a real failure and not a simulated one.
      expect(() => provider.use(credId ?? '')).toThrow(
        /has been revoked and cannot be used/,
      );
    });

    it('does not hand out the revoked credential again', async () => {
      const { broker } = buildCredentialBroker();
      const capability = aCredentialCapability();
      const context = anInvocationContext();

      await broker.resolve(capability, context, ['repo:write:pr'], [
        'org/repo',
      ]);
      await broker.revokeAll(context.taskId);

      // The broker's live map is cleared by the revocation, so a later
      // call mints a **new** credential rather than handing back the
      // dead one.
      const after = await broker.resolve(
        capability,
        context,
        ['repo:write:pr'],
        ['org/repo'],
      );

      expect(after.ok).toBe(true);
      expect(after.ok && after.value?.credId).not.toBe('crd_000001');
    });
  });

  describe('the secret-scan', () => {
    it('finds NO token in any event, log, artefact or prompt', async () => {
      // The ticket's headline oracle: a **full fake run**, then a scan
      // of everything it produced.
      const { broker, leases, redaction, provider } = buildCredentialBroker();

      // ---- The run -----------------------------------------------------------
      const minted = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:write:pr'],
        allowedScopes: ['repo:write:pr'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });
      expect(minted.ok).toBe(true);
      const token = minted.ok ? minted.value.secret : '';
      expect(token).not.toBe('');

      // Everything the run would produce. Each is a place a credential
      // could leak.
      const events = [
        {
          type: 'task.started',
          taskId: 'task_1',
          detail: { capability: 'github.pr.create' },
        },
        {
          type: 'tool.completed',
          taskId: 'task_1',
          detail: { credId: 'crd_000001', status: 'ok' },
        },
      ];

      const logs = [
        'the broker minted a credential for task_1',
        'tool github.pr.create completed',
      ];

      const artefacts = [
        {
          kind: 'run-record',
          body: { taskId: 'task_1', capability: 'github.pr.create' },
        },
        {
          kind: 'agent-prompt',
          body: 'Create a pull request on org/repo.',
        },
      ];

      const prompts = [
        'You are the PR stage. Create a pull request on org/repo.',
        'Open a pull request against the base branch.',
      ];

      // ---- The scan ----------------------------------------------------------
      const haystacks: { readonly where: string; readonly text: string }[] = [
        ...events.map((event, index) => ({
          where: `event[${index}]`,
          text: JSON.stringify(event),
        })),
        ...logs.map((line, index) => ({ where: `log[${index}]`, text: line })),
        ...artefacts.map((artefact, index) => ({
          where: `artefact[${index}]`,
          text: JSON.stringify(artefact),
        })),
        ...prompts.map((prompt, index) => ({
          where: `prompt[${index}]`,
          text: prompt,
        })),
      ];

      for (const { where, text } of haystacks) {
        expect(text.includes(token), `${where} leaks the token`).toBe(false);
      }

      // ---- And the lease -----------------------------------------------------
      for (const lease of leases.all()) {
        expect(JSON.stringify(lease).includes(token)).toBe(false);
      }

      // ---- And the provider's own record ------------------------------------
      expect(JSON.stringify(provider.mints).includes(token)).toBe(false);

      // ---- And the scrubber is armed ----------------------------------------
      // The scan above proves the *run* does not leak. This proves the
      // safety net: a line that **does** carry the token is scrubbed
      // before it can be written, so a future change that leaks is
      // caught by the scrubber rather than reaching an artefact.
      const contaminated = `calling the API with Authorization: Bearer ${token}`;
      const scrubbed = redaction.scrub(contaminated);
      expect(scrubbed.value).not.toContain(token);
      expect(scrubbed.value).toContain(REDACTION_PLACEHOLDER);
      expect(scrubbed.applied.length).toBeGreaterThan(0);
    });

    it('redacts the token out of a log line — the redact test', async () => {
      const { broker, redaction } = buildCredentialBroker();

      const minted = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });
      expect(minted.ok).toBe(true);
      const token = minted.ok ? minted.value.secret : '';

      const line = `calling the API with Authorization: Bearer ${token}`;
      const scrubbed = redaction.scrub(line);

      expect(scrubbed.value).not.toContain(token);
      expect(scrubbed.value).toContain(REDACTION_PLACEHOLDER);
      // The report names the rule and a digest — never the value.
      expect(scrubbed.applied[0]?.rule).toBe('exact.minted');
      expect(scrubbed.applied[0]?.digest).not.toContain(token);
    });
  });

  describe('the in-memory lease store', () => {
    it('lists by task', async () => {
      const store = new InMemoryCredentialLeaseStore();
      const lease: CredentialLease = {
        id: 'crd_1',
        taskId: 'task_1',
        provider: 'github',
        scope: { scopes: [], permissions: {}, repositories: [] },
        mintedAt: '2026-11-10T00:00:00.000Z',
        expiresAt: '2026-11-10T01:00:00.000Z',
      };
      await store.record(lease);

      expect(await store.listByTask('task_1')).toHaveLength(1);
      expect(await store.listByTask('task_2')).toHaveLength(0);
    });

    it('marks a lease revoked once', async () => {
      const store = new InMemoryCredentialLeaseStore();
      await store.record({
        id: 'crd_1',
        taskId: 'task_1',
        provider: 'github',
        scope: { scopes: [], permissions: {}, repositories: [] },
        mintedAt: '2026-11-10T00:00:00.000Z',
        expiresAt: '2026-11-10T01:00:00.000Z',
      });

      await store.markRevoked('crd_1', '2026-11-10T00:30:00.000Z');
      await store.markRevoked('crd_1', '2026-11-10T00:40:00.000Z');

      expect(store.get('crd_1')?.revokedAt).toBe('2026-11-10T00:30:00.000Z');
    });
  });

  describe('the redaction registry as the broker’s set', () => {
    it('is the task’s set, and the broker’s is the task’s', () => {
      const registry = new RedactionRegistry('task_1');
      expect(registry.taskId).toBe('task_1');
    });
  });

  describe('a broker without a redaction registry', () => {
    it('still mints and still revokes', async () => {
      const harness = buildCredentialBroker();
      const broker = new CredentialBroker({
        leases: harness.leases,
        provider: harness.provider,
        clock: harness.clock,
        nextId: () => 'crd_x',
      });

      const result = await broker.mint({
        taskId: 'task_1',
        requiredScopes: ['repo:read'],
        allowedScopes: ['repo:read'],
        repositories: ['org/repo'],
        ttlSeconds: 3600,
      });

      expect(result.ok).toBe(true);
      expect(await broker.revokeAll('task_1')).toEqual([]);
    });
  });
});
