/**
 * `tools/oracle-guard` — the CI check that an implementer did not touch the
 * oracle.
 *
 * Pack 05, T-0.03: "a PR from an implementer branch may not modify
 * the oracle directory or `tests/acceptance/**` unless the commits are
 * human-authored or labelled `oracle-approved`."
 *
 * The oracle directory glob is spelled with a double-star prefix in the
 * ticket; it is written out in prose here because a literal double-star
 * slash sequence inside a block comment terminates the comment early.
 *
 * This guard IS oracle independence (ADR-0005, invariant I-10). An agent that
 * can edit the test that judges it has no oracle. So the check has three
 * independent ways to be satisfied, and it fails if none of them applies:
 *
 *   1. The PR changes no protected path at all — the common case, and the
 *      cheapest to verify.
 *   2. Every commit in the PR is human-authored (a verified GitHub
 *      signature, or an author identity the owner controls).
 *   3. The PR carries the `oracle-approved` label, which only a human with
 *      write access can apply.
 *
 * Fail-closed (HR-8): if the commit list cannot be obtained, the guard fails.
 * It never passes because it could not check.
 */

import { globToRegExp } from '../lib/glob.ts';

/** The protected paths. Changing these is an oracle edit. */
export const PROTECTED_GLOBS: readonly string[] = [
  '**/test/oracle/**',
  'tests/acceptance/**',
];

/**
 * A broader set of oracle-bearing paths, reported as a warning rather than a
 * failure: touching these is allowed but almost always wrong, and the owner
 * should have looked.
 */
export const SENSITIVE_GLOBS: readonly string[] = [
  'packages/contracts/**',
  'definition/**',
  'migrations/**',
  '.github/**',
  'tests/invariants/**',
  'tests/redteam/**',
  'CODEOWNERS',
];

export interface OracleInput {
  /** The paths the PR changed. */
  readonly changedPaths: readonly string[];
  /** Every commit in the PR is human-authored. */
  readonly allCommitsHuman: boolean;
  /** The PR carries the `oracle-approved` label. */
  readonly hasOracleApproved: boolean;
  /** The commit list could be read at all. */
  readonly commitsAvailable: boolean;
}

export interface OracleVerdict {
  /** Whether the PR may pass. */
  readonly ok: boolean;
  /** The reasons it may not. */
  readonly violations: string[];
  /** Things the owner should look at, but which do not fail the check. */
  readonly warnings: string[];
}

/**
 * Does `path` match any of `globs`?
 */
export const matchesAny = (path: string, globs: readonly string[]): boolean =>
  globs.some((glob) => globToRegExp(glob).test(path));

/**
 * Decide whether the PR is allowed to touch a protected path.
 */
export const checkOracle = ({
  changedPaths,
  allCommitsHuman,
  hasOracleApproved,
  commitsAvailable,
}: OracleInput): OracleVerdict => {
  const violations: string[] = [];
  const warnings: string[] = [];

  const touchedProtected = changedPaths.filter((path) => matchesAny(path, PROTECTED_GLOBS));

  if (touchedProtected.length > 0) {
    if (!commitsAvailable) {
      violations.push(
        `The PR modifies an oracle path (${touchedProtected.join(', ')}) but the commit list could not be read. Failing closed: an oracle edit cannot be cleared without evidence of authorship.`,
      );
    } else if (!allCommitsHuman && !hasOracleApproved) {
      violations.push(
        `The PR modifies an oracle path (${touchedProtected.join(', ')}) and its commits are not human-authored and the PR is not labelled \`oracle-approved\`. An implementer may not edit the oracle that judges it (ADR-0005, I-10).`,
      );
    }
  }

  for (const path of changedPaths) {
    if (
      !matchesAny(path, PROTECTED_GLOBS) &&
      matchesAny(path, SENSITIVE_GLOBS) &&
      !allCommitsHuman &&
      !hasOracleApproved
    ) {
      warnings.push(
        `The PR touches a sensitive path (${path}) without human authorship or \`oracle-approved\`. The owner should review this explicitly.`,
      );
    }
  }

  return { ok: violations.length === 0, violations, warnings };
};

/** Render a verdict as the lines a CI job prints. */
export const formatVerdict = (verdict: OracleVerdict): string => {
  const lines: string[] = [];
  if (verdict.ok) {
    lines.push('oracle-guard: OK — no unauthorised oracle edit.');
  } else {
    lines.push('oracle-guard: FAIL');
    for (const violation of verdict.violations) {
      lines.push(`  - ${violation}`);
    }
  }
  for (const warning of verdict.warnings) {
    lines.push(`oracle-guard: warning — ${warning}`);
  }
  return lines.join('\n');
};
