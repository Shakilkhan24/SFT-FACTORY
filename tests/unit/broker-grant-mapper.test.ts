/**
 * T-1.08 — the **grant mapper**.
 *
 * ## Why the mapper exists
 *
 * There are **two** shapes of "grant" in the factory, and they are not the
 * same thing:
 *
 * * The **definition's** `CapabilityGrant` document (pack 03 §4.5) — what a
 *   workflow declares. Its `allow` is a list of **scopes**, and it carries
 *   a `resourceScope`.
 * * The **policy engine's** `EffectiveGrant` (`@factory/policy`) — what the
 *   engine evaluates against. Its `allow` is a list of scopes too, but it
 *   has no `resourceScope` object: the repo and the globs are flat fields.
 *
 * The broker needs the second one, because the policy engine consumes it.
 * `grants.ts` is the boundary.
 *
 * ## The direction of the mapping
 *
 * The mapping goes **definition → effective**, and the broker never
 * *widens* a grant: it reads the grant it is given and maps it. A caller
 * cannot hand the broker a broader scope than its own.
 *
 * ## The two namespaces
 *
 * The definition's grant names **scopes**; the broker's own grant names
 * **capability ids** *and* scopes. The capability ids are **not** copied
 * into `allow` — a grant's `allow` list is a list of scopes, and mixing
 * the two namespaces would let a capability id masquerade as a scope.
 */

import { describe, expect, it } from 'vitest';

import type { CapabilityGrant } from '../../packages/contracts/src/index.ts';
import {
  effectiveGrantOf,
  policyGrantOf,
  requiredScopeOf,
} from '../../packages/broker/src/index.ts';
import { aCapability, aGrant } from '../helpers/broker.ts';

/**
 * A definition's `CapabilityGrant` document.
 */
const aDefinitionGrant = (
  overrides: Partial<CapabilityGrant['spec']> = {},
): CapabilityGrant => ({
  apiVersion: 'factory/v1',
  kind: 'CapabilityGrant',
  metadata: { name: 'grant_1' },
  spec: {
    workflow: 'workflow_1',
    stage: 'implement',
    allow: ['repo:read'],
    deny: [],
    ...overrides,
  },
});

describe('T-1.08 — the grant mapper', () => {
  describe('the definition grant → the effective grant', () => {
    it('carries the allow list across', () => {
      const effective = effectiveGrantOf(
        aDefinitionGrant({ allow: ['repo:read', 'git.write.pr'] }),
      );

      expect(effective.allow).toEqual(['repo:read', 'git.write.pr']);
    });

    it('carries the deny list across', () => {
      const effective = effectiveGrantOf(
        aDefinitionGrant({ allow: ['repo:read'], deny: ['repo:write'] }),
      );

      expect(effective.deny).toEqual(['repo:write']);
    });

    it('carries the repo across', () => {
      const effective = effectiveGrantOf(
        aDefinitionGrant({
          resourceScope: { repo: 'org/repo' },
        }),
      );

      expect(effective.repo).toBe('org/repo');
    });

    it('carries the write globs across', () => {
      const effective = effectiveGrantOf(
        aDefinitionGrant({
          resourceScope: {
            repo: 'org/repo',
            paths: { writeGlobs: ['src/**'], denyGlobs: ['src/secret/**'] },
          },
        }),
      );

      expect(effective.writeGlobs).toEqual(['src/**']);
      expect(effective.denyGlobs).toEqual(['src/secret/**']);
    });

    it('omits the repo when the grant has no resource scope', () => {
      // A grant with no resource scope constrains no resource. The
      // effective grant must say so by *omitting* the field — an empty
      // string would be a repo named "".
      const effective = effectiveGrantOf(aDefinitionGrant());

      expect('repo' in effective).toBe(false);
    });

    it('omits empty glob lists rather than carrying empty arrays', () => {
      const effective = effectiveGrantOf(
        aDefinitionGrant({
          resourceScope: {
            repo: 'org/repo',
            paths: { writeGlobs: [], denyGlobs: [] },
          },
        }),
      );

      expect('writeGlobs' in effective).toBe(false);
      expect('denyGlobs' in effective).toBe(false);
    });

    it('does not mutate the definition document', () => {
      // The mapper **copies** the lists, so the effective grant and the
      // document do not share an array. A caller that later widens the
      // document's list cannot reach through into the effective grant.
      const grant = aDefinitionGrant({ allow: ['repo:read'] });

      const effective = effectiveGrantOf(grant);

      expect(effective.allow).not.toBe(grant.spec.allow);
      expect(effective.allow).toEqual(['repo:read']);
    });
  });

  describe('the broker grant → the effective grant', () => {
    it('carries the scopes across as the allow list', () => {
      const effective = policyGrantOf(
        aGrant({ scopes: ['repo:read', 'git.write.pr'] }),
      );

      expect(effective.allow).toEqual(['repo:read', 'git.write.pr']);
    });

    it('carries the deny list across', () => {
      const effective = policyGrantOf(aGrant({ deny: ['repo:write'] }));

      expect(effective.deny).toEqual(['repo:write']);
    });

    it('carries the repo across', () => {
      const effective = policyGrantOf(aGrant({ repo: 'org/repo' }));

      expect(effective.repo).toBe('org/repo');
    });

    it('carries the globs across', () => {
      const effective = policyGrantOf(
        aGrant({ writeGlobs: ['src/**'], denyGlobs: ['src/secret/**'] }),
      );

      expect(effective.writeGlobs).toEqual(['src/**']);
      expect(effective.denyGlobs).toEqual(['src/secret/**']);
    });

    it('the CAPABILITY IDS are not copied into the allow list', () => {
      // The two namespaces must stay separate: `allow` is a list of
      // scopes, and a capability id in it would let a capability id
      // masquerade as a scope.
      const effective = policyGrantOf(
        aGrant({ capabilities: ['test.capability'], scopes: ['repo:read'] }),
      );

      expect(effective.allow).toEqual(['repo:read']);
      expect(effective.allow).not.toContain('test.capability');
    });

    it('omits empty glob lists rather than carrying empty arrays', () => {
      const effective = policyGrantOf(aGrant({ writeGlobs: [], denyGlobs: [] }));

      expect('writeGlobs' in effective).toBe(false);
      expect('denyGlobs' in effective).toBe(false);
    });

    it('does not mutate the broker grant', () => {
      // As above: the mapper copies the scopes, so the effective grant's
      // list is not the broker grant's list.
      const grant = aGrant({ scopes: ['repo:read'] });

      const effective = policyGrantOf(grant);

      expect(effective.allow).not.toBe(grant.scopes);
      expect(effective.allow).toEqual(['repo:read']);
    });
  });

  describe('the required scope', () => {
    it('is the FIRST required scope', () => {
      // pack 04 §5: `git.patch.apply` requires `repo:write:path:<glob>`.
      // The policy engine's grant check takes a single `requiredScope`.
      expect(
        requiredScopeOf({
          scope: { required: ['repo:write:path:**', 'git.write.commit'] },
        }),
      ).toBe('repo:write:path:**');
    });

    it('is undefined when the capability requires no scope', () => {
      expect(requiredScopeOf({ scope: { required: [] } })).toBeUndefined();
    });

    it('is the capability’s own declaration, unchanged', () => {
      const capability = aCapability({
        scope: {
          required: ['git.write.pr'],
          resourcePattern: 'repo:{owner}/{name}',
          environment: 'orchestrator',
        },
      });

      expect(requiredScopeOf(capability)).toBe('git.write.pr');
    });
  });
});
