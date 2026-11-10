/**
 * The grant mapper.
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
 *   engine evaluates against. Its `allow` is a list of **scopes** too, but
 *   it has no `resourceScope` object: the repo and the globs are flat
 *   fields.
 *
 * The broker needs the second one, because the policy engine consumes it.
 * This file is the boundary between the two.
 *
 * ## The direction of the mapping
 *
 * The mapping goes **definition → effective**. The broker never *widens* a
 * grant: it reads the grant it is given and maps it. A caller cannot hand
 * the broker a broader scope than its own, because the broker derives the
 * effective grant from the definition's document and nothing else.
 */

import type { CapabilityGrant } from '@factory/contracts';
import type { EffectiveGrant } from '@factory/policy';

import type { BrokerGrant } from './types.js';

/**
 * Map a definition `CapabilityGrant` document to the policy engine's
 * `EffectiveGrant`.
 *
 * The `resourceScope` is optional in the definition; when it is absent the
 * effective grant carries no repo and no globs, which means the grant
 * constrains no resource — exactly the definition's own statement.
 */
export const effectiveGrantOf = (grant: CapabilityGrant): EffectiveGrant => {
  const resourceScope = grant.spec.resourceScope;
  const paths = resourceScope?.paths;

  return {
    allow: [...grant.spec.allow],
    deny: [...grant.spec.deny],
    ...(resourceScope?.repo === undefined ? {} : { repo: resourceScope.repo }),
    ...(paths?.writeGlobs === undefined || paths.writeGlobs.length === 0
      ? {}
      : { writeGlobs: [...paths.writeGlobs] }),
    ...(paths?.denyGlobs === undefined || paths.denyGlobs.length === 0
      ? {}
      : { denyGlobs: [...paths.denyGlobs] }),
  };
};

/**
 * Map the broker's own grant shape to the policy engine's.
 *
 * The broker's `BrokerGrant` is what the *caller* supplies: it carries the
 * grant's id (for the invocation record) and the capability ids the grant
 * names, alongside the scopes.
 *
 * The capability ids are **not** scopes and are not copied into `allow`:
 * a grant's `allow` list is a list of scopes, and mixing the two
 * namespaces would let a capability id masquerade as a scope.
 */
export const policyGrantOf = (grant: BrokerGrant): EffectiveGrant => ({
  allow: [...grant.scopes],
  deny: [...grant.deny],
  ...(grant.repo === undefined ? {} : { repo: grant.repo }),
  ...(grant.writeGlobs === undefined || grant.writeGlobs.length === 0
    ? {}
    : { writeGlobs: [...grant.writeGlobs] }),
  ...(grant.denyGlobs === undefined || grant.denyGlobs.length === 0
    ? {}
    : { denyGlobs: [...grant.denyGlobs] }),
});

/**
 * The scope a capability requires.
 *
 * pack 04 §5: `git.patch.apply` requires `repo:write:path:<glob>`;
 * `github.pr.create` requires `git.write.pr`. The capability's
 * `scope.required` is a list, and the **first** entry is the one the grant
 * check compares against.
 *
 * ## Why the first entry and not "any"
 *
 * The policy engine's grant check takes a single `requiredScope`. A
 * capability with several required scopes is one the definition should not
 * declare (the v1 registry does not), and taking the first is the
 * conservative reading: the grant must cover the scope that is listed
 * first, and a capability that lists none cannot be shown to be safe.
 */
export const requiredScopeOf = (capability: {
  readonly scope: { readonly required: readonly string[] };
}): string | undefined => capability.scope.required[0];
