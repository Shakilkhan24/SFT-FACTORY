/**
 * T-1.09 — the **scope computation**.
 *
 * blueprint 11 §7.1 rule 3: *"Least privilege — the credential's scopes
 * are the intersection of what the capability needs and what the workflow
 * granted. A capability that needs `repo:read` never receives
 * `repo:write`."*
 *
 * ## What these tests hold
 *
 * The intersection is the whole of least privilege, and it has three
 * inputs. Each is tested on its own, and then in combination:
 *
 * 1. **the capability's needs** — what it asks for;
 * 2. **the grant's allow-list** — what is permitted;
 * 3. **the grant's deny-list** — what is refused whatever else says.
 *
 * The sharpest edges:
 *
 * * a scope the grant does not mention is **not** granted — an empty
 *   intersection is a **refusal**, not a degraded credential;
 * * a **deny** removes a scope whatever the allow-list says;
 * * a capability that needs `repo:read` never receives `repo:write` —
 *   the *narrower* level wins;
 * * a permission the grant does not mention at all is **removed**, not
 *   left at the computed level.
 */

import { describe, expect, it } from 'vitest';

import {
  computeEffectiveScope,
  effectiveTtlSeconds,
  MAX_CREDENTIAL_TTL_SECONDS,
  narrowPermissionsToGrant,
  toCredentialScope,
} from '../../packages/credentials/src/index.ts';

describe('T-1.09 — the credential scope', () => {
  describe('the intersection', () => {
    it('keeps a scope the capability needs and the grant allows', () => {
      const result = computeEffectiveScope({
        required: ['repo:read'],
        allowed: ['repo:read', 'repo:write'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.scopes).toEqual(['repo:read']);
    });

    it('DROPS a scope the capability needs but the grant does not allow', () => {
      const result = computeEffectiveScope({
        required: ['repo:write', 'repo:read'],
        allowed: ['repo:read'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.scopes).toEqual(['repo:read']);
    });

    it('DROPS a scope the grant DENIES, whatever the allow-list says', () => {
      // The allow-list *includes* `repo:write` — the deny-list is what
      // refuses it. blueprint 11 §4.4: "Deny overrides."
      const result = computeEffectiveScope({
        required: ['repo:write', 'repo:read'],
        allowed: ['repo:write', 'repo:read'],
        denied: ['repo:write'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.scopes).toEqual(['repo:read']);
    });

    it('REFUSES when the intersection is empty', () => {
      const result = computeEffectiveScope({
        required: ['repo:write'],
        allowed: ['repo:read'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('policy.denied');
    });

    it('REFUSES when the grant allows nothing', () => {
      const result = computeEffectiveScope({
        required: ['repo:read'],
        allowed: [],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('policy.denied');
    });

    it('REFUSES when no repository is in scope', () => {
      const result = computeEffectiveScope({
        required: ['repo:read'],
        allowed: ['repo:read'],
        repositories: [],
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('policy.denied');
    });
  });

  describe('the permissions', () => {
    it('gives a capability that needs repo:read only a READ token', () => {
      // The sharp edge of least privilege: a read capability must not
      // receive write.
      const result = computeEffectiveScope({
        required: ['repo:read'],
        allowed: ['repo:read', 'repo:write'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.permissions['contents']).toBe('read');
      expect(result.ok && result.value.permissions['contents']).not.toBe(
        'write',
      );
    });

    it('gives a capability that needs repo:write:pr NO contents permission', () => {
      // A PR stage has no business pushing commits. The table, not a
      // rule, is what expresses this.
      const result = computeEffectiveScope({
        required: ['repo:write:pr'],
        allowed: ['repo:write:pr', 'repo:write'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.permissions['pull_requests']).toBe(
        'write',
      );
      expect(result.ok && result.value.permissions['contents']).toBeUndefined();
    });

    it('takes the WIDER level when two surviving scopes both imply one', () => {
      const result = computeEffectiveScope({
        required: ['repo:read', 'repo:write:commit'],
        allowed: ['repo:read', 'repo:write:commit'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.permissions['contents']).toBe('write');
    });

    it('gives an UNKNOWN scope no permission at all', () => {
      // An unknown scope must not be read as "all permissions". It
      // survives as a scope but contributes nothing.
      const result = computeEffectiveScope({
        required: ['some.scope.nobody.defined'],
        allowed: ['some.scope.nobody.defined'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.permissions).toEqual({});
    });
  });

  describe('the grant’s permission narrowing', () => {
    it('narrows a computed WRITE to the grant’s READ', () => {
      const narrowed = narrowPermissionsToGrant(
        { contents: 'write', metadata: 'read' },
        { contents: 'read', metadata: 'read' },
      );

      expect(narrowed['contents']).toBe('read');
      expect(narrowed['metadata']).toBe('read');
    });

    it('REMOVES a permission the grant does not mention', () => {
      // A grant that says nothing about `checks` has not granted `checks`.
      const narrowed = narrowPermissionsToGrant(
        { contents: 'write', checks: 'write' },
        { contents: 'write' },
      );

      expect(narrowed['checks']).toBeUndefined();
      expect(narrowed['contents']).toBe('write');
    });

    it('keeps the computed level when the grant allows the same', () => {
      const narrowed = narrowPermissionsToGrant(
        { contents: 'write' },
        { contents: 'write' },
      );

      expect(narrowed['contents']).toBe('write');
    });
  });

  describe('the TTL', () => {
    it('caps the TTL at one hour', () => {
      // ADR-0018: "TTL ≤ 1 h". A caller asking for longer is a bug that
      // would otherwise widen the credential's life.
      expect(effectiveTtlSeconds(7200)).toBe(MAX_CREDENTIAL_TTL_SECONDS);
      expect(MAX_CREDENTIAL_TTL_SECONDS).toBe(3600);
    });

    it('keeps a shorter TTL as it is', () => {
      expect(effectiveTtlSeconds(300)).toBe(300);
    });
  });

  describe('the contracts’ scope shape', () => {
    it('builds the contracts’ CredentialScope', () => {
      const result = computeEffectiveScope({
        required: ['repo:write:pr'],
        allowed: ['repo:write:pr'],
        repositories: ['org/repo'],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      const scope = toCredentialScope(result.value, 3600);

      expect(scope.provider).toBe('github');
      expect(scope.repositories).toEqual(['org/repo']);
      expect(scope.permissions['pull_requests']).toBe('write');
      expect(scope.ttlSeconds).toBe(3600);
    });
  });
});
