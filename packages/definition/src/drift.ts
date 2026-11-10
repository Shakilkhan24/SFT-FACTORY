/**
 * `definition` — the drift job.
 *
 * pack 02 §4.1: "Drift job (nightly): compare the applied bundle to the git
 * SHA it claims; emit `definition.driftDetected`; **never auto-correct**
 * (FR-26)."
 *
 * ## What drift is
 *
 * The applied definition records the git SHA it was built from. If the
 * repository has moved on — the branch was rebased, the file was edited in
 * place, the commit was garbage-collected — then the *applied* bundle and
 * the *claimed* SHA no longer describe the same thing.
 *
 * The applied bundle is still the one running. That is the point: the
 * factory keeps running on a definition that is known and approved, rather
 * than silently picking up whatever the repository now says.
 *
 * ## Why it never auto-corrects
 *
 * FR-26 says it outright, and the reason is structural. Auto-correcting
 * would mean re-reading the repository and applying what it says — which
 * means the applied definition would follow the repository without passing
 * the three preconditions (provenance, approval, role) that the *human*
 * path requires. The apply would be a bypass of the apply.
 *
 * So the drift job **reports**. It emits `definition.driftDetected` and
 * leaves the decision to a human, who goes through the ordinary apply
 * path with an ordinary approval.
 *
 * ## The comparison
 *
 * The comparison is between the applied bundle's digest and the digest of
 * the bundle the repository *would* produce at the claimed SHA. If they
 * differ, the repository at that SHA no longer yields the applied bundle.
 *
 * It is not enough to compare SHAs: a SHA can be rewritten (a force-push,
 * an amended commit) while keeping its name. Comparing the *content digest*
 * catches that, because the digest is over the canonical form of the
 * documents.
 */

import { definitionBundleSha256, type DefinitionBundle } from './documents.js';

/**
 * The kinds of drift the job can find.
 */
export const DRIFT_KINDS = ['content_changed', 'sha_unreadable'] as const;

export type DriftKind = (typeof DRIFT_KINDS)[number];

/**
 * A drift finding.
 */
export interface DriftFinding {
  readonly kind: DriftKind;
  /** The SHA the applied version claims to come from. */
  readonly claimedSha: string;
  /** The digest of the applied bundle. */
  readonly appliedSha256: `sha256:${string}`;
  /** The digest the repository produces at the claimed SHA, when it could be read. */
  readonly repositorySha256: `sha256:${string}` | undefined;
  /** The human-readable explanation. */
  readonly detail: string;
}

/**
 * What the drift job needs from the outside world.
 */
export interface DriftInputs {
  /** The SHA the applied version claims to come from. */
  readonly claimedSha: string;
  /** The applied bundle. */
  readonly appliedBundle: DefinitionBundle;
  /**
   * Load the bundle the repository produces at the claimed SHA.
   *
   * Returns `undefined` when the SHA can no longer be read.
   */
  readonly loadAtSha: (sha: string) => Promise<DefinitionBundle | undefined>;
}

/**
 * The outcome of a drift check.
 */
export interface DriftReport {
  /** The findings. Empty means no drift. */
  readonly findings: readonly DriftFinding[];
  /** Whether the applied definition is still faithful to its claimed SHA. */
  readonly drifted: boolean;
  /**
   * Whether the job changed anything.
   *
   * Always `false`. The field exists so that a caller cannot accidentally
   * "correct" drift, and so the evidence for FR-26 is explicit.
   */
  readonly autoCorrected: false;
}

/**
 * Check the applied definition for drift.
 *
 * **Never corrects.** The report is the output; the applied version is left
 * exactly as it was.
 */
export const checkDrift = async (inputs: DriftInputs): Promise<DriftReport> => {
  const { claimedSha, appliedBundle, loadAtSha } = inputs;
  const appliedSha256 = definitionBundleSha256(appliedBundle);
  const findings: DriftFinding[] = [];

  let repositoryBundle: DefinitionBundle | undefined;
  try {
    repositoryBundle = await loadAtSha(claimedSha);
  } catch (error) {
    findings.push({
      kind: 'sha_unreadable',
      claimedSha,
      appliedSha256,
      repositorySha256: undefined,
      detail: `the repository could not be read at ${claimedSha}: ${describe(error)}`,
    });
    return { findings, drifted: true, autoCorrected: false };
  }

  if (repositoryBundle === undefined) {
    findings.push({
      kind: 'sha_unreadable',
      claimedSha,
      appliedSha256,
      repositorySha256: undefined,
      detail: `the repository no longer contains ${claimedSha}`,
    });
    return { findings, drifted: true, autoCorrected: false };
  }

  const repositorySha256 = definitionBundleSha256(repositoryBundle);
  if (repositorySha256 !== appliedSha256) {
    findings.push({
      kind: 'content_changed',
      claimedSha,
      appliedSha256,
      repositorySha256,
      detail:
        `the bundle at ${claimedSha} is ${repositorySha256}, but the applied version is ${appliedSha256}; ` +
        'the applied definition is still running and has not been changed',
    });
  }

  return { findings, drifted: findings.length > 0, autoCorrected: false };
};

/**
 * Describe an error without leaking its payload.
 */
const describe = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
