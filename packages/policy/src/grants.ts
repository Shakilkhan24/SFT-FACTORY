/**
 * The grant check — step 4 of the algorithm.
 *
 * pack 02 §4.4 step 4: "Grant check: effective grant = `workflow ∩ stage ∩
 * resource`; capability or scope absent ⇒ `DENY(no_grant)`."
 *
 * blueprint 11 §4.3 (the three-scope rule): "Every capability invocation is
 * checked against three scopes simultaneously… **The narrowest scope wins.**
 * A stage's scope is the intersection of the three, not the union."
 *
 * The intersection is implemented here as three separate checks, each of
 * which must pass:
 *
 * 1. **workflow scope** — the workflow's grant includes the capability;
 * 2. **stage scope** — the stage's narrower grant includes it;
 * 3. **resource scope** — the capability's `resourcePattern` matches the
 *    actual resource being acted on.
 *
 * blueprint 11 §4.3: "**Resource scope is the one that catches the
 * interesting bug.** A worker with `repo:write` on `org/repo` that is handed
 * an artefact referencing `org/other-repo` must be refused on the *resource*,
 * not the capability."
 *
 * blueprint 11 §4.4 (deny overrides): "A `deny` entry wins over any `grant`,
 * at every level, and over the capability's own declaration. Deny lists are
 * checked first, and a match is terminal." — the grant's own `deny` list is
 * checked here, before any allow entry, and a match is terminal for the
 * grant check.
 *
 * The grants themselves are **inputs**: the engine does not read the
 * definition. The caller resolves the workflow and stage grants and passes
 * them in, so the engine stays pure and the resolution stays with the
 * component that owns the definition.
 *
 * ## A grant holds *scopes*, and a capability holds a *required scope*
 *
 * pack 04 §5, the v1 capability registry:
 *
 * | id | required scope |
 * |---|---|
 * | `git.patch.apply` | `repo:write:path:<glob>` |
 * | `git.push.branch` | `git.write.branch` (`refs/heads/factory/*`) |
 * | `github.pr.create` | `git.write.pr` |
 *
 * So a grant's `allow` list is a list of **scopes**
 * (`git.write.branch`, `repo:write:path:src/**`), and a capability's id is
 * a different namespace (`git.patch.apply`). The two are not comparable
 * directly — a grant does not enumerate capability ids, and a capability id
 * is not a scope.
 *
 * The comparison the grant check makes is therefore: does the grant's scope
 * set cover **the scope the capability requires**? The required scope comes
 * from the capability's own declaration, which the caller resolves (the
 * engine does not read the registry — that would be I/O).
 *
 * The capability **id** still matters, for two things the scope cannot
 * express:
 *
 * * the deny rules, which name capability ids (`factory.write`,
 *   `git.push.protected`, `secret.read`) — those are matched in step 2, not
 *   here; and
 * * the grant's own `deny` list, which may name either a scope or a
 *   capability id.
 */

import type { PolicyInput } from '@factory/contracts';

import { matchesGlob } from './glob.js';

/**
 * A grant as the engine sees it.
 *
 * The shape is the pack 03 §4.5 `CapabilityGrant` reduced to the fields the
 * engine reads, so the caller can pass a parsed grant directly.
 */
export interface EffectiveGrant {
  /**
   * The **scopes** the grant allows.
   *
   * pack 04 §5: `git.push.branch` requires `git.write.branch`; a grant
   * naming `git.write.branch` allows it. Scopes are hierarchical and
   * prefix-matched (blueprint 11 §4.2), so `repo:write` covers
   * `repo:write:path:src/**`.
   */
  readonly allow: readonly string[];

  /**
   * The scopes or capability ids the grant forbids.
   *
   * Checked first; a match is terminal (blueprint 11 §4.4).
   */
  readonly deny: readonly string[];

  /** The repository the grant is scoped to, when it is scoped to one. */
  readonly repo?: string;

  /** The paths the grant allows writing to. */
  readonly writeGlobs?: readonly string[];

  /** The paths the grant forbids writing to. */
  readonly denyGlobs?: readonly string[];
}

/**
 * The result of the grant check.
 */
export type GrantCheckResult =
  | { readonly granted: true }
  | { readonly granted: false; readonly reason: string };

/**
 * The scope prefixes that carry a parameter (pack 03 §7).
 *
 * `repo:write:path:<glob>` and `net.egress:<host>` are *parameterised*: the
 * parameter is part of the scope string, and what the parameter means
 * differs between them — one is a path glob, the other is a host.
 */
const PARAMETERISED_PREFIXES: readonly string[] = [
  'repo:write:path:',
  'net.egress:',
];

/**
 * Whether a scope string is in a grant's allow list.
 *
 * The scope vocabulary is **hierarchical and prefix-matched** (blueprint 11
 * §4.2): "Scopes are hierarchical and prefix-matched, so a grant can be
 * expressed without enumerating every capability."
 *
 * There are three ways a scope covers a capability:
 *
 * 1. **Equality.** `repo:read` covers `repo:read`.
 * 2. **Hierarchy.** `repo:write` covers `repo:write:path:src/**` — a scope
 *    covers its children, separated by `:`.
 * 3. **Parameterisation.** `repo:write:path:src/**` covers
 *    `repo:write:path:src/index.ts` — the parameter is a *glob* for the
 *    path form and a *host* for the egress form.
 *
 * The third case is why this is not a plain prefix match: a prefix match
 * would require the granted scope to be a literal prefix of the capability,
 * and `repo:write:path:src/**` is not a prefix of
 * `repo:write:path:src/index.ts` — the `**` is in the way.
 */
export const scopeAllowed = (
  allowed: readonly string[],
  capabilityId: string,
): boolean =>
  allowed.some((scope) => scopeCovers(scope, capabilityId));

/**
 * Whether one scope covers a capability.
 */
const scopeCovers = (scope: string, capabilityId: string): boolean => {
  if (scope === capabilityId) {
    return true;
  }

  // A hierarchical scope covers its children: `repo:write` covers
  // `repo:write:path:src/**`.
  if (capabilityId.startsWith(`${scope}:`)) {
    return true;
  }

  // A parameterised scope covers a capability with the same prefix and a
  // matching parameter.
  const parameterised = PARAMETERISED_PREFIXES.find((prefix) =>
    scope.startsWith(prefix),
  );
  if (parameterised === undefined) {
    return false;
  }
  if (!capabilityId.startsWith(parameterised)) {
    return false;
  }

  const grantedParameter = scope.slice(parameterised.length);
  const capabilityParameter = capabilityId.slice(parameterised.length);

  if (parameterised === 'net.egress:') {
    // The egress parameter is a host. `net.egress:example.com` covers
    // `net.egress:example.com` and its subdomains, and nothing else.
    return (
      capabilityParameter === grantedParameter ||
      capabilityParameter.endsWith(`.${grantedParameter}`)
    );
  }

  // The path parameter is a glob.
  return matchesGlob(grantedParameter, capabilityParameter);
};

/**
 * Whether the resource is within the grant's resource scope.
 *
 * The check is in two parts, and **both** must hold:
 *
 * 1. the repository matches, when the grant names one and the action carries
 *    one;
 * 2. every path the action touches is inside an allowed write glob and
 *    outside every deny glob.
 *
 * A path the grant does not cover is not covered by the grant — there is no
 * "allow by omission" here, because the intersection of the three scopes is
 * what grants authority.
 */
export const resourceInScope = (
  grant: EffectiveGrant,
  input: PolicyInput,
): boolean => {
  const resource = input.resource;
  if (resource === undefined) {
    // No resource means no resource constraint to violate.
    return true;
  }

  if (grant.repo !== undefined) {
    const repo = resource.ref;
    if (!repoMatches(grant.repo, repo)) {
      return false;
    }
  }

  const paths = resource.paths ?? [];
  if (paths.length === 0) {
    return true;
  }

  const denyGlobs = grant.denyGlobs ?? [];
  for (const path of paths) {
    if (denyGlobs.some((glob) => matchesGlob(glob, path))) {
      return false;
    }
  }

  const writeGlobs = grant.writeGlobs ?? [];
  if (writeGlobs.length === 0) {
    // A grant with no write globs constrains no paths.
    return true;
  }

  return paths.every((path) => writeGlobs.some((glob) => matchesGlob(glob, path)));
};

/**
 * Whether a repository reference matches a grant's repository scope.
 *
 * The grant names a repository as `<owner>/<name>`; the resource may name it
 * the same way. A grant for `org/repo` does not cover `org/other-repo`.
 */
const repoMatches = (grantRepo: string, resourceRef: string): boolean => {
  if (grantRepo === resourceRef) {
    return true;
  }
  // A grant may name a repository without its owner (`repo`), in which case
  // only the name must match.
  if (!grantRepo.includes('/')) {
    const name = resourceRef.split('/').pop();
    return name === grantRepo;
  }
  return false;
};

/**
 * The grant check for one grant.
 *
 * The grant's `deny` list is checked **first** and a match is terminal
 * (blueprint 11 §4.4). Then the capability's required scope must be covered
 * by the grant's `allow` list, and the resource must be in scope.
 *
 * @param grant the grant to check against.
 * @param input the action.
 * @param requiredScope the scope the action's capability requires. This is
 *   the capability's own declaration (pack 04 §5), resolved by the caller.
 */
export const checkGrant = (
  grant: EffectiveGrant,
  input: PolicyInput,
  requiredScope: string,
): GrantCheckResult => {
  const capabilityId = input.capabilityId;
  if (capabilityId === undefined) {
    return {
      granted: false,
      reason: 'the action names no capability, so no grant can cover it',
    };
  }

  // Deny first, at every level. A match is terminal. A deny entry may name
  // a scope or a capability id, so both are checked.
  const deniedByScope = grant.deny.some((entry) => scopeAllowed([entry], requiredScope));
  const deniedByCapability = grant.deny.some((entry) => entry === capabilityId);
  if (deniedByScope || deniedByCapability) {
    return {
      granted: false,
      reason: `capability ${capabilityId} is denied by the grant`,
    };
  }

  if (!scopeAllowed(grant.allow, requiredScope)) {
    return {
      granted: false,
      reason: `capability ${capabilityId} requires scope ${requiredScope}, which the grant does not allow`,
    };
  }

  if (!resourceInScope(grant, input)) {
    return {
      granted: false,
      reason: 'the resource is outside the grant\'s resource scope',
    };
  }

  return { granted: true };
};

/**
 * The grant check across the three scopes.
 *
 * The effective grant is the **intersection** of the workflow, stage and
 * resource scopes, so the check passes only if every scope that applies
 * allows the capability. A scope that does not apply (no stage grant, no
 * resource scope) contributes nothing — the intersection is over the scopes
 * that are present, and each present scope must allow.
 */
export const checkEffectiveGrant = (
  grants: {
    readonly workflowGrant?: EffectiveGrant;
    readonly stageGrant?: EffectiveGrant;
  },
  input: PolicyInput,
  requiredScope: string,
): GrantCheckResult => {
  const present = [grants.workflowGrant, grants.stageGrant].filter(
    (grant): grant is EffectiveGrant => grant !== undefined,
  );

  if (present.length === 0) {
    return {
      granted: false,
      reason: 'no grant applies to this action',
    };
  }

  for (const grant of present) {
    const result = checkGrant(grant, input, requiredScope);
    if (!result.granted) {
      return result;
    }
  }

  return { granted: true };
};
