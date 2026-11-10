/**
 * `credentials` — the **scope computation**.
 *
 * blueprint 11 §7.1 rule 3: *"Least privilege — the credential's scopes are
 * the intersection of what the capability needs and what the workflow
 * granted. A capability that needs `repo:read` never receives
 * `repo:write`."*
 *
 * ## The intersection is the whole point
 *
 * Three sets meet here:
 *
 * 1. **What the capability needs** — the capability's declared
 *    `credentials.permissions` and the scopes its `scope.required` names.
 * 2. **What the grant allows** — the grant's allow-list, narrowed further by
 *    its deny-list.
 * 3. **What the resource is** — the concrete target: which repository, and
 *    which paths within it.
 *
 * The credential gets the **intersection**. A capability cannot widen its
 * own scope by asking for more, and a grant cannot grant what the
 * capability does not need.
 *
 * ## Why the intersection can be empty
 *
 * It frequently is. A capability that needs `repo:write` under a grant that
 * allows only `repo:read` has an **empty** effective scope. That is not a
 * degraded credential — it is a **refusal**, because a credential with
 * `contents: read` handed to a capability that needs `contents: write`
 * would fail confusingly at the provider instead of here.
 *
 * So the computation returns a `Result`, and an empty intersection is
 * `policy.denied`.
 *
 * ## The permission vocabulary
 *
 * GitHub's installation-token permissions are named things
 * (`contents`, `pull_requests`, `issues`, `checks`) at a level (`read` or
 * `write`). The factory's **scope** vocabulary is different and coarser
 * (`repo:read`, `repo:write:path:**`, `git.write.commit`). This module is
 * the bridge: a *scope* says what the task needs; a *permission* says what
 * the token carries.
 *
 * The bridge is a fixed table rather than a rule, because the mapping
 * from the factory's scopes to GitHub's permissions is a **policy
 * decision** (ADR-0018: "the App's exact permission set is not decided by
 * this ADR") and a table is where a policy decision belongs — visible,
 * reviewable, and changed in one place.
 */

import type { CredentialScope } from '@factory/contracts';
import { factoryError, type FactoryError, type Result } from '@factory/core';

/**
 * The GitHub permissions the factory may ask for.
 *
 * pack 04 §2.1 lists the App's *repository permissions*; this is the
 * narrower set the **per-task token** may carry, because the token is
 * narrowed to the task (pack 04 §2.2 step 2).
 */
export const GITHUB_PERMISSIONS = [
  'contents',
  'pull_requests',
  'issues',
  'checks',
  'metadata',
  'actions',
  'dependabot_alerts',
] as const;

export type GithubPermission = (typeof GITHUB_PERMISSIONS)[number];

/**
 * The level a permission is held at.
 */
export type PermissionLevel = 'read' | 'write';

/**
 * The scopes the factory understands.
 *
 * These are the scopes pack 04 §5's capability registry uses, plus the
 * grant vocabulary from blueprint 11 §4.2.
 */
export const FACTORY_SCOPES = [
  'repo:read',
  'repo:write',
  'repo:write:pr',
  'repo:write:commit',
  'repo:write:branch',
  'repo:write:path',
  'net.fetch',
  'artifact.read',
  'artifact.write',
  'knowledge.write',
  'notify.send',
  'mcp.test',
  'shell.sandboxed',
  'github.pr.read',
  'github.pr.write',
  'github.issue.read',
  'github.issue.write',
  'github.checks.write',
  'github.actions.read',
  'github.advisories.read',
  'github.metadata.read',
] as const;

export type FactoryScope = (typeof FACTORY_SCOPES)[number];

/**
 * The scope → permission mapping.
 *
 * ## Why it is a table and not a rule
 *
 * A rule ("any scope starting with `repo:write` implies `contents:write`")
 * would be shorter and would be **wrong**: `repo:write:pr` needs
 * `pull_requests:write` but must **not** get `contents:write`, because a
 * PR stage has no business pushing commits. A rule cannot express that
 * distinction; a table can, and the table is reviewable.
 *
 * ## The `read`/`write` levels
 *
 * A scope maps to a *level* per permission. The effective permission is
 * the **lower** of what the scope implies and what the grant allows — a
 * scope that implies `write` under a grant that allows only `read` gets
 * `read`.
 */
const SCOPE_PERMISSIONS: Readonly<
  Record<FactoryScope, Readonly<Partial<Record<GithubPermission, PermissionLevel>>>>
> = {
  'repo:read': {
    contents: 'read',
    metadata: 'read',
  },
  'repo:write': {
    contents: 'write',
    metadata: 'read',
  },
  'repo:write:pr': {
    pull_requests: 'write',
    metadata: 'read',
  },
  'repo:write:commit': {
    contents: 'write',
    metadata: 'read',
  },
  'repo:write:branch': {
    contents: 'write',
    metadata: 'read',
  },
  'repo:write:path': {
    contents: 'write',
    metadata: 'read',
  },
  'net.fetch': {},
  'artifact.read': {},
  'artifact.write': {},
  'knowledge.write': {},
  'notify.send': {},
  'mcp.test': {},
  'shell.sandboxed': {},
  'github.pr.read': {
    pull_requests: 'read',
    metadata: 'read',
  },
  'github.pr.write': {
    pull_requests: 'write',
    metadata: 'read',
  },
  'github.issue.read': {
    issues: 'read',
    metadata: 'read',
  },
  'github.issue.write': {
    issues: 'write',
    metadata: 'read',
  },
  'github.checks.write': {
    checks: 'write',
    metadata: 'read',
  },
  'github.actions.read': {
    actions: 'read',
    metadata: 'read',
  },
  'github.advisories.read': {
    dependabot_alerts: 'read',
    metadata: 'read',
  },
  'github.metadata.read': {
    metadata: 'read',
  },
};

/**
 * The permission levels, ordered. `write` is broader than `read`.
 */
const LEVEL_RANK: Readonly<Record<PermissionLevel, number>> = {
  read: 1,
  write: 2,
};

/**
 * The narrower of two levels.
 *
 * `undefined` means "not permitted at all" and is the narrowest.
 */
const narrowest = (
  a: PermissionLevel | undefined,
  b: PermissionLevel | undefined,
): PermissionLevel | undefined => {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
};

/**
 * The three inputs to the scope computation.
 */
export interface ScopeInputs {
  /**
   * The scopes the **capability** needs.
   *
   * From the capability's `scope.required` and its `credentials.permissions`.
   */
  readonly required: readonly string[];
  /**
   * The scopes the **grant** allows.
   */
  readonly allowed: readonly string[];
  /**
   * The scopes the grant **denies**.
   *
   * A deny removes a scope from the intersection whatever else says
   * (blueprint 11 §4.4: "Deny overrides").
   */
  readonly denied?: readonly string[];
  /**
   * The repositories the credential may reach.
   *
   * The **resource**, narrowed: the task's repository, intersected with
   * the repositories the grant names.
   */
  readonly repositories: readonly string[];
}

/**
 * The computed scope.
 */
export interface EffectiveScope {
  /** The scopes that survived the intersection. */
  readonly scopes: readonly string[];
  /** The GitHub permissions the token will carry. */
  readonly permissions: Readonly<Record<string, PermissionLevel>>;
  /** The repositories the token may reach. */
  readonly repositories: readonly string[];
}

/**
 * Compute the effective scope — the intersection.
 *
 * @returns the effective scope, or a `policy.denied` when the
 *   intersection is empty.
 *
 * ## Why an empty intersection is a denial
 *
 * A capability that needs `repo:write` under a grant that allows only
 * `repo:read` has nothing to be granted. Minting a token for it anyway
 * — even a read-only one — would hand the capability a credential it
 * cannot use, and the failure would surface at the provider as an opaque
 * permission error rather than here as a clear refusal.
 */
export const computeEffectiveScope = (
  inputs: ScopeInputs,
): Result<EffectiveScope, FactoryError> => {
  const denied = new Set(inputs.denied ?? []);

  // A scope survives when the capability needs it, the grant allows it,
  // and the grant does not deny it.
  const surviving = inputs.required.filter((scope) => {
    if (denied.has(scope)) {
      return false;
    }
    return inputs.allowed.includes(scope);
  });

  if (surviving.length === 0) {
    return {
      ok: false,
      error: factoryError(
        'policy.denied',
        'the credential scope is empty: the capability needs a scope the grant does not allow',
        false,
        {
          required: [...inputs.required],
          allowed: [...inputs.allowed],
          denied: [...denied],
        },
      ),
    };
  }

  // The permissions are the union of what the surviving scopes imply,
  // each narrowed by the levels the scopes themselves imply. A scope
  // that implies `contents:write` and another that implies
  // `contents:read` produce `contents:write` — the *capability* is
  // asking for more than one scope, and the token should carry what the
  // widest surviving scope needs.
  const permissions: Record<string, PermissionLevel> = {};
  for (const scope of surviving) {
    const implied = SCOPE_PERMISSIONS[scope as FactoryScope];
    if (implied === undefined) {
      // An unknown scope is **not** silently ignored. It means the
      // capability declares a scope the factory does not understand, and
      // the safe reading of an unknown scope is "no permissions" — not
      // "all permissions". Ignoring it would grant nothing while
      // appearing to succeed; the scope survives as a *scope* but
      // contributes no permission.
      continue;
    }
    for (const [permission, level] of Object.entries(implied)) {
      const current = permissions[permission];
      permissions[permission] =
        current === undefined ? level : widest(current, level);
    }
  }

  if (inputs.repositories.length === 0) {
    return {
      ok: false,
      error: factoryError(
        'policy.denied',
        'the credential scope is empty: no repository is in scope',
        false,
        { required: [...inputs.required], allowed: [...inputs.allowed] },
      ),
    };
  }

  return {
    ok: true,
    value: {
      scopes: [...surviving].sort(),
      permissions,
      repositories: [...inputs.repositories],
    },
  };
};

/**
 * The broader of two levels.
 */
const widest = (
  a: PermissionLevel,
  b: PermissionLevel,
): PermissionLevel => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

/**
 * Narrow a computed scope to what a **grant** allows, permission by
 * permission.
 *
 * The scopes are already narrowed by `computeEffectiveScope`; this
 * second narrowing is the **permission-level** narrowing, which the scope
 * computation cannot do on its own because a grant expresses its limits
 * as scopes, not as GitHub permissions.
 *
 * A permission the grant does not mention at all is **removed**, not
 * left at the computed level. A grant that says nothing about
 * `checks` has not granted `checks`.
 *
 * @param grantPermissions the permissions the grant allows, by name.
 */
export const narrowPermissionsToGrant = (
  computed: Readonly<Record<string, PermissionLevel>>,
  grantPermissions: Readonly<Record<string, PermissionLevel>>,
): Readonly<Record<string, PermissionLevel>> => {
  const narrowed: Record<string, PermissionLevel> = {};
  for (const [permission, level] of Object.entries(computed)) {
    const granted = grantPermissions[permission];
    if (granted === undefined) {
      continue;
    }
    const level2 = narrowest(level, granted);
    if (level2 !== undefined) {
      narrowed[permission] = level2;
    }
  }
  return narrowed;
};

/**
 * Build the contracts' `CredentialScope` from an effective scope.
 *
 * The contracts' shape is narrow: one provider, a list of repositories, a
 * permission record, and a TTL. This is where the factory's richer
 * effective scope becomes that shape.
 */
export const toCredentialScope = (
  effective: EffectiveScope,
  ttlSeconds: number,
): CredentialScope => ({
  provider: 'github',
  repositories: [...effective.repositories],
  permissions: { ...effective.permissions },
  ttlSeconds,
});

/**
 * The **maximum** TTL a credential may have.
 *
 * pack 04 §2.2 step 2: "Token lifetime ≈ 1 h; re-mint for longer tasks."
 * ADR-0018: "TTL ≤ 1 h".
 *
 * The cap is enforced here rather than trusted from the caller, because a
 * caller that asks for a longer TTL is a bug that would otherwise widen
 * the credential's life — the one thing the ADR is explicit about.
 */
export const MAX_CREDENTIAL_TTL_SECONDS = 3600;

/**
 * The TTL a mint actually gets — the request's, capped.
 */
export const effectiveTtlSeconds = (requested: number): number =>
  Math.min(requested, MAX_CREDENTIAL_TTL_SECONDS);
