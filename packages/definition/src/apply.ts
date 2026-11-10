/**
 * `definition` — the applier.
 *
 * pack 02 §4.1: "`apply(sha)` requires: SHA is on the protected default
 * branch with required checks green (checked through the SCM adapter), an
 * owner `definition` approval bound to `bundleSha256`, and the applier DB
 * role."
 *
 * ## Three preconditions, all three required
 *
 * The apply is the one operation in the factory that changes what every
 * other component is *allowed to do*. The policy bundle's deny rules, the
 * capability registry, the grants — all of them live here. So the apply is
 * gated by three independent checks, and **all three** must pass:
 *
 * 1. **Provenance** — the SHA is on the protected default branch, with the
 *    required checks green. Checked through the SCM adapter, so the applier
 *    never trusts a caller that says "this SHA is fine".
 * 2. **Approval** — an owner `definition` approval, bound to the exact
 *    `bundleSha256` being applied. The binding is what makes the approval
 *    *meaningful*: approval of one bundle is not approval of a different
 *    one that happens to be applied afterwards.
 * 3. **Role** — the connection acts as `factory_applier`. The API role
 *    cannot insert into `definition_versions` (A0.7, AT-6/7), so a
 *    compromised API cannot apply a definition even if it bypasses the
 *    process-level checks.
 *
 * ## Why the checks are separate and independent
 *
 * Each one fails closed, and each one fails for a different reason:
 *
 * * Provenance can fail because someone pushed a bad commit.
 * * Approval can fail because nobody approved it.
 * * Role can fail because the wrong process called.
 *
 * An attacker who defeats one still faces the other two. The most important
 * property is that they are **not the same check twice**: provenance and
 * approval are genuinely independent — a commit can be green and unapproved,
 * or approved and un-green.
 *
 * ## Failure leaves the previous version active
 *
 * An invalid bundle ⇒ apply refused, the previous version stays active
 * (pack 02 §4.1). The apply is one transaction: the new version is inserted
 * and the old one deactivated together, so there is no window in which two
 * versions are active or none is.
 */

import type { Approval } from '@factory/contracts';

import { definitionBundleSha256, type DefinitionBundle } from './documents.js';
import { planBetween, type DefinitionPlan } from './plan.js';

/**
 * The reasons an apply can be refused.
 *
 * A closed set, so a caller can exhaustively handle them — and so no
 * refusal reason can be invented at runtime.
 */
export const APPLY_REFUSALS = [
  'invalid_bundle',
  'sha_not_on_protected_branch',
  'required_checks_not_green',
  'no_approval',
  'approval_not_for_definition',
  'approval_hash_mismatch',
  'approval_expired',
  'approval_consumed',
  'approval_revoked',
  'not_approver',
  'wrong_db_role',
  'unknown_sha',
] as const;

export type ApplyRefusal = (typeof APPLY_REFUSALS)[number];

/**
 * A refusal, with the reason and enough context to act on it.
 */
export interface ApplyRefusalDetail {
  readonly refusal: ApplyRefusal;
  readonly message: string;
  /** What the operator should do next. */
  readonly remedy: string;
}

/**
 * The result of an apply attempt.
 */
export type ApplyOutcome =
  | {
      readonly ok: true;
      readonly sha: string;
      readonly bundleSha256: `sha256:${string}`;
      readonly plan: DefinitionPlan;
    }
  | { readonly ok: false; readonly detail: ApplyRefusalDetail };

/**
 * What the applier needs to know about the SCM side.
 *
 * This is the narrow interface the applier uses — the full `ScmAdapter` is
 * much wider, and the applier must not depend on more of it than the
 * check needs (AGENTS.md §1: "touch only what the ticket names").
 */
export interface DefinitionScmCheck {
  /**
   * Whether the SHA exists on the protected default branch, and whether
   * its required checks are green.
   */
  checkProtectedBranch(sha: string): Promise<{
    readonly ok: boolean;
    readonly onProtectedBranch: boolean;
    readonly checksGreen: boolean;
    readonly reason?: string;
  }>;
}

/**
 * The approval the applier requires.
 *
 * The applier does not read the `approvals` table itself — it is handed the
 * approval by the caller, which reads it with the appropriate role. What
 * the applier checks is the **binding**, and the binding is the whole
 * point.
 */
export interface DefinitionApprovalInput {
  readonly approval: Approval;
  /** The login of the human performing the apply. */
  readonly appliedBy: string;
}

/**
 * The store the applier writes through.
 *
 * The write is one transaction: insert the new version, deactivate the
 * old. The applier never writes `definition_versions` directly — it goes
 * through this port, and the port's implementation is what talks to the
 * `factory_applier` role.
 */
export interface DefinitionVersionStore {
  /**
   * Apply a bundle as a new active version.
   *
   * @returns the SHA of the applied version.
   */
  applyVersion(input: {
    readonly sha: string;
    readonly bundleSha256: `sha256:${string}`;
    readonly bundle: DefinitionBundle;
    readonly plan: DefinitionPlan;
    readonly approvalId: string;
    readonly appliedBy: string;
  }): Promise<string>;
  /** The digest of the currently active bundle, if any. */
  activeBundle(): Promise<DefinitionBundle | undefined>;
  /** The digest of the currently active bundle. */
  activeSha256(): Promise<`sha256:${string}` | undefined>;
  /** The role the current connection acts as. */
  currentRole(): string;
}

/**
 * The options an apply carries.
 */
export interface ApplyOptions {
  /** The git SHA to apply. */
  readonly sha: string;
  /** The bundle loaded at that SHA. */
  readonly bundle: DefinitionBundle;
  /** The approval to check, if the caller found one. */
  readonly approval: Approval | undefined;
  /** The login of the human performing the apply. */
  readonly appliedBy: string;
  /** The SCM check for the SHA. */
  readonly scm: DefinitionScmCheck;
  /** The store to write through. */
  readonly store: DefinitionVersionStore;
}

/**
 * The role allowed to insert into `definition_versions`.
 *
 * pack 02 §4.1: "only role `factory_applier` can insert `definition_versions`;
 * the API role cannot (A0.7, AT-6/7)."
 */
export const APPLIER_ROLE = 'factory_applier';

/**
 * Check an approval against the bundle being applied.
 *
 * The approval must be:
 *
 * * of type `definition`;
 * * **not** expired, revoked, consumed or refused;
 * * bound to this exact `bundleSha256`;
 * * decided by someone in the approver list.
 *
 * @returns the refusal, or `undefined` when the approval is good.
 */
export const checkApproval = (
  approval: Approval | undefined,
  bundleSha256: `sha256:${string}`,
  appliedBy: string,
): ApplyRefusalDetail | undefined => {
  if (approval === undefined) {
    return {
      refusal: 'no_approval',
      message: 'no approval was supplied for this definition',
      remedy: 'request a "definition" approval for this bundle and retry',
    };
  }

  if (approval.type !== 'definition') {
    return {
      refusal: 'approval_not_for_definition',
      message: `the approval is of type "${approval.type}", not "definition"`,
      remedy: 'request an approval of type "definition"',
    };
  }

  if (approval.status === 'revoked') {
    return {
      refusal: 'approval_revoked',
      message: 'the approval was revoked',
      remedy: 'request a fresh approval',
    };
  }

  if (approval.status === 'consumed') {
    return {
      refusal: 'approval_consumed',
      message: 'the approval was already consumed by an earlier apply',
      remedy: 'request a fresh approval',
    };
  }

  if (approval.status === 'expired') {
    return {
      refusal: 'approval_expired',
      message: 'the approval has expired',
      remedy: 'request a fresh approval',
    };
  }

  if (approval.status === 'refused') {
    return {
      refusal: 'no_approval',
      message: 'the approval was refused',
      remedy: 'request a fresh approval',
    };
  }

  if (approval.status !== 'granted') {
    return {
      refusal: 'no_approval',
      message: `the approval is in state "${approval.status}", not "granted"`,
      remedy: 'obtain a granted approval for this bundle',
    };
  }

  // The binding. The approval names the digest of the artefact it approves;
  // the artefact is the bundle. A mismatch means the thing that was
  // approved is not the thing being applied.
  if (approval.artefactSha256 !== bundleSha256) {
    return {
      refusal: 'approval_hash_mismatch',
      message: `the approval is bound to ${approval.artefactSha256}, not to the bundle being applied (${bundleSha256})`,
      remedy: 'request an approval bound to the digest of the bundle you intend to apply',
    };
  }

  if (!approval.approvers.includes(appliedBy)) {
    return {
      refusal: 'not_approver',
      message: `"${appliedBy}" is not in the approval's approver list`,
      remedy: 'have an approver perform the apply',
    };
  }

  if (approval.decidedBy !== undefined && approval.decidedBy !== appliedBy) {
    // The approval is identity-bound and non-transferable (pack 02 §4.16):
    // the human who decided it is the human who applies it.
    return {
      refusal: 'not_approver',
      message: `the approval was decided by "${approval.decidedBy}", not by "${appliedBy}"`,
      remedy: 'have the approving human perform the apply',
    };
  }

  return undefined;
};

/**
 * Apply a definition bundle.
 *
 * **Fail-closed**: every refusal path returns without touching the store.
 * The previous version stays active when the apply is refused, and when the
 * apply succeeds the switch is a single transaction.
 */
export const applyDefinition = async (options: ApplyOptions): Promise<ApplyOutcome> => {
  const { sha, bundle, approval, appliedBy, scm, store } = options;

  // ---- Precondition 3: the DB role -------------------------------------
  //
  // Checked first because it is the cheapest and because it is the check
  // that cannot be satisfied by anything the caller controls. The API role
  // is refused here even if it somehow obtained a valid approval.
  const role = store.currentRole();
  if (role !== APPLIER_ROLE) {
    return {
      ok: false,
      detail: {
        refusal: 'wrong_db_role',
        message: `the connection acts as "${role}"; only "${APPLIER_ROLE}" may apply a definition`,
        remedy: 'run the apply with the applier database role',
      },
    };
  }

  // ---- Precondition 1: provenance --------------------------------------
  //
  // The SHA must be on the protected default branch, with its required
  // checks green. Both are asked of the SCM adapter, and the adapter's
  // answer is not negotiable: an unknown SHA is not "probably fine".
  let scmCheck: Awaited<ReturnType<DefinitionScmCheck['checkProtectedBranch']>>;
  try {
    scmCheck = await scm.checkProtectedBranch(sha);
  } catch (error) {
    // A failing SCM check is a refusal, not an allow. If the factory cannot
    // confirm where the SHA came from, it does not apply it.
    return {
      ok: false,
      detail: {
        refusal: 'unknown_sha',
        message: `the SCM could not confirm the provenance of ${sha}: ${describe(error)}`,
        remedy: 'retry once the SCM is reachable',
      },
    };
  }

  if (!scmCheck.onProtectedBranch) {
    return {
      ok: false,
      detail: {
        refusal: 'sha_not_on_protected_branch',
        message: `${sha} is not on the protected default branch`,
        remedy: 'apply a SHA that has been merged into the protected default branch',
      },
    };
  }

  if (!scmCheck.checksGreen) {
    return {
      ok: false,
      detail: {
        refusal: 'required_checks_not_green',
        message: `the required checks on ${sha} are not green${scmCheck.reason === undefined ? '' : `: ${scmCheck.reason}`}`,
        remedy: 'wait for the required checks to pass, or fix the failing check',
      },
    };
  }

  // ---- Precondition 2: the approval ------------------------------------
  const bundleSha256 = definitionBundleSha256(bundle);
  const refusal = checkApproval(approval, bundleSha256, appliedBy);
  if (refusal !== undefined) {
    return { ok: false, detail: refusal };
  }

  // ---- The plan --------------------------------------------------------
  //
  // The plan is computed against the *currently applied* version, so the
  // approval request and the apply see the same diff. The approval was
  // bound to the bundle's digest, and the plan is recorded with the
  // version, so an auditor can see exactly what was reviewed.
  const active = await store.activeBundle();
  const activeSha256 = await store.activeSha256();
  const plan = planBetween(
    active ?? emptyBundleLike(bundle),
    bundle,
    activeSha256 ?? emptyBundleDigest(),
    bundleSha256,
  );

  // ---- The write -------------------------------------------------------
  //
  // One transaction, inside the store. If it throws, the previous version
  // is still active — there is no half-applied state.
  //
  // `approval` is known to be defined here: `checkApproval` returns a
  // refusal for an undefined approval, so reaching this point means one
  // was supplied. The local binding makes that visible to the type checker
  // rather than asserting it away.
  const approvedApproval = approval;
  if (approvedApproval === undefined) {
    return {
      ok: false,
      detail: {
        refusal: 'no_approval',
        message: 'no approval was supplied for this definition',
        remedy: 'request a "definition" approval for this bundle and retry',
      },
    };
  }

  try {
    await store.applyVersion({
      sha,
      bundleSha256,
      bundle,
      plan,
      approvalId: approvedApproval.id,
      appliedBy,
    });
  } catch (error) {
    return {
      ok: false,
      detail: {
        refusal: 'invalid_bundle',
        message: `the definition could not be applied: ${describe(error)}`,
        remedy: 'check the database state and retry',
      },
    };
  }

  return { ok: true, sha, bundleSha256, plan };
};

/**
 * A bundle-shaped empty value, used when there is no active version to diff
 * against (the first apply).
 *
 * It mirrors the *shape* of a bundle so the diff code does not need a
 * special case; every document list is empty, so every document in the new
 * bundle reads as "added".
 */
const emptyBundleLike = (bundle: DefinitionBundle): DefinitionBundle => ({
  factory: bundle.factory,
  workflows: [],
  roles: [],
  capabilities: [],
  grants: [],
  environments: [],
  routingPolicy: [],
  policyBundle: bundle.policyBundle,
  criticalityMaps: [],
  repoOnboardings: [],
  oracles: [],
  taskGraphs: [],
});

/**
 * The digest of the canonical empty object — the "no active version"
 * sentinel.
 */
const emptyBundleDigest = (): `sha256:${string}` =>
  'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

/**
 * Describe an error without leaking its payload.
 */
const describe = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
