/**
 * The policy bundle — the rules the engine evaluates against.
 *
 * pack 03 §4.7 defines `definition/policy-bundle.yaml`; the
 * {@link PolicyBundle} schema in `@factory/contracts` is the contract for
 * its shape. This module adds the two things the schema cannot express:
 *
 * 1. the **bundle digest** (`bundleSha256`), which every decision carries so
 *    a decision can be tied to the exact rule set that produced it
 *    (blueprint 13 §2.4: "an auditor can reconstruct any action's
 *    authorisation from the event log alone");
 * 2. the **protected-path set**, which the deny-rule matcher expands the
 *    `@protectedPaths` reference against.
 *
 * The digest is computed over the **canonical JSON of the bundle**, not over
 * the YAML bytes: the YAML is one serialisation of the rules, and two YAML
 * files that differ only in formatting describe the same policy. Hashing the
 * canonical form means the digest tracks the *rules*, not the file's
 * whitespace (AGENTS.md §4: "hashes over canonical JSON only").
 *
 * **Pure**: no filesystem, no clock. The bundle is read and parsed by the
 * caller; this module only takes an already-parsed value.
 */

import { PolicyBundle, type DenyRule } from '@factory/contracts';
import { canonicalJsonOfUnknown, sha256 } from '@factory/core';

/**
 * A policy bundle plus the digest of its canonical form.
 *
 * The digest is computed once, at load time, so every decision that uses the
 * bundle carries the same value without re-hashing it per evaluation.
 */
export interface LoadedPolicyBundle {
  readonly bundle: PolicyBundle;
  /** `sha256:<64 hex>` over the canonical JSON of the bundle. */
  readonly sha256: `sha256:${string}`;
}

/**
 * The digest of a bundle's canonical JSON.
 *
 * Exposed separately so a caller that loads the bundle elsewhere (the
 * definition loader) can compute the same value without constructing a
 * {@link LoadedPolicyBundle}.
 */
export const policyBundleSha256 = (bundle: PolicyBundle): `sha256:${string}` =>
  `sha256:${sha256(canonicalJsonOfUnknown(bundle))}`;

/**
 * Wrap a parsed bundle with its digest.
 *
 * @throws {ZodError} when the value is not a valid bundle — the bundle is
 *   configuration, and a malformed one is a deployment error, not a
 *   runtime condition the engine should paper over.
 */
export const loadPolicyBundle = (value: unknown): LoadedPolicyBundle => {
  const bundle = PolicyBundle.parse(value);
  return { bundle, sha256: policyBundleSha256(bundle) };
};

/**
 * The protected-path patterns (pack 03 §4.7).
 *
 * `protectedPaths: [ ".github/**", "CODEOWNERS", ".factory/**",
 * "tests/acceptance/**", "**\/migrations/**", "Dockerfile*",
 * "docker-compose*.y*ml" ]`
 */
export const protectedPaths = (bundle: PolicyBundle): readonly string[] =>
  bundle.spec.protectedPaths;

/**
 * The deny rules, in bundle order.
 *
 * The order is the bundle's, because `ruleIds` on a decision lists **every**
 * matched rule and the list reads as the bundle declared it.
 */
export const denyRules = (bundle: PolicyBundle): readonly DenyRule[] =>
  bundle.spec.denyRules;

/**
 * The effect-class rules.
 */
export const effectRules = (bundle: PolicyBundle) => bundle.spec.effectRules;

/**
 * The tier rules.
 */
export const tierRules = (bundle: PolicyBundle) => bundle.spec.tierRules;
