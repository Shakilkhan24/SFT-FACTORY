/**
 * `factory definition` — validate, plan and apply a definition.
 *
 * pack 04 §9: "`factory definition validate|plan|apply --sha …`" (AP-6).
 *
 * ## The three subcommands
 *
 * * `validate` — read the definition at a SHA and check every document
 *   against its contract. Exits non-zero on the first invalid document.
 * * `plan` — the structured diff against the currently applied version.
 * * `apply` — apply a SHA, through the three preconditions.
 *
 * ## Why `apply` needs an approval id
 *
 * The apply cannot self-approve. The CLI takes `--approval <id>` and passes
 * it to the applier, which checks it against the bundle's digest. Without a
 * valid approval the apply is refused — and the CLI's exit code says so.
 *
 * ## Exit codes
 *
 * `0` success · `1` the operation was refused (a validation failure, a plan
 * with changes where none were expected, or a refused apply) · `2` a usage
 * error.
 *
 * The distinction between 1 and 2 matters to a script: 2 means "you asked
 * wrong", 1 means "the factory said no".
 */

import type { Approval } from '@factory/contracts';

import {
  applyDefinition,
  checkApproval,
  definitionBundleSha256,
  loadDefinition,
  planBetween,
  renderPlan,
  type DefinitionBundle,
  type DefinitionScmCheck,
  type DefinitionVersionStore,
} from '@factory/definition';

export interface CliResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

/**
 * What the definition commands need from the outside world.
 *
 * The CLI is the wiring layer: it reads the environment, resolves the
 * approval, and hands the applier the ports it needs. The applier's own
 * logic does not live here.
 */
export interface DefinitionCommandContext {
  /** The directory holding the definition documents. */
  readonly definitionRoot: string;
  /** The SCM provenance check. */
  readonly scm: DefinitionScmCheck;
  /** The store to write through. */
  readonly store: DefinitionVersionStore;
  /** The approval, if one was resolved. */
  readonly approval: Approval | undefined;
  /** The login of the human performing the operation. */
  readonly appliedBy: string;
  /** The SHA to operate on, when the command names one. */
  readonly sha: string | undefined;
}

/**
 * Run `factory definition <subcommand>`.
 */
export const runDefinitionCommand = async (
  subcommand: string,
  context: DefinitionCommandContext,
): Promise<CliResult> => {
  switch (subcommand) {
    case 'validate':
      return validate(context);
    case 'plan':
      return plan(context);
    case 'apply':
      return apply(context);
    default:
      return {
        lines: [
          `unknown subcommand \`factory definition ${subcommand}\``,
          '',
          'usage: factory definition validate | plan | apply [--sha <sha>] [--approval <id>]',
        ],
        exitCode: 2,
      };
  }
};

/**
 * `factory definition validate`.
 *
 * Reads the definition and reports every document that does not conform.
 * The exit code is 1 when the definition is invalid — the definition stays
 * as it is, because validation never writes.
 */
const validate = async (context: DefinitionCommandContext): Promise<CliResult> => {
  const result = await loadDefinition(context.definitionRoot);

  if (!result.ok) {
    return {
      lines: [
        `the definition is invalid (${result.failures.length} problem(s)):`,
        ...result.failures.map((failure) => `  ${failure.path}: ${failure.reason}`),
      ],
      exitCode: 1,
    };
  }

  const digest = definitionBundleSha256(result.bundle);
  return {
    lines: [
      'the definition is valid.',
      `  bundleSha256: ${digest}`,
      `  documents:    ${countDocuments(result.bundle)}`,
    ],
    exitCode: 0,
  };
};

/**
 * `factory definition plan`.
 *
 * The structured diff against the currently applied version. The plan is
 * printed in full — this is what a human reads before approving.
 */
const plan = async (context: DefinitionCommandContext): Promise<CliResult> => {
  const result = await loadDefinition(context.definitionRoot);
  if (!result.ok) {
    return {
      lines: [
        `the definition is invalid (${result.failures.length} problem(s)):`,
        ...result.failures.map((failure) => `  ${failure.path}: ${failure.reason}`),
      ],
      exitCode: 1,
    };
  }

  const candidate = result.bundle;
  const candidateSha256 = definitionBundleSha256(candidate);
  const active = await context.store.activeBundle();
  const activeSha256 = await context.store.activeSha256();

  const computed = planBetween(
    active ?? emptyLike(candidate),
    candidate,
    activeSha256 ?? EMPTY_DIGEST,
    candidateSha256,
  );

  return {
    lines: [
      `from: ${computed.fromSha256}`,
      `to:   ${computed.toSha256}`,
      '',
      renderPlan(computed),
      '',
      `to apply this, obtain a "definition" approval bound to ${computed.toSha256}`,
    ],
    exitCode: 0,
  };
};

/**
 * `factory definition apply`.
 *
 * Applies the definition at the named SHA, through the applier's three
 * preconditions.
 */
const apply = async (context: DefinitionCommandContext): Promise<CliResult> => {
  if (context.sha === undefined) {
    return {
      lines: ['factory definition apply requires --sha <sha>'],
      exitCode: 2,
    };
  }

  const result = await loadDefinition(context.definitionRoot);
  if (!result.ok) {
    return {
      lines: [
        `the definition is invalid (${result.failures.length} problem(s)):`,
        ...result.failures.map((failure) => `  ${failure.path}: ${failure.reason}`),
      ],
      exitCode: 1,
    };
  }

  const outcome = await applyDefinition({
    sha: context.sha,
    bundle: result.bundle,
    approval: context.approval,
    appliedBy: context.appliedBy,
    scm: context.scm,
    store: context.store,
  });

  if (!outcome.ok) {
    return {
      lines: [
        `the apply was refused: ${outcome.detail.refusal}`,
        `  ${outcome.detail.message}`,
        `  remedy: ${outcome.detail.remedy}`,
        '',
        'the previously applied version is still active.',
      ],
      exitCode: 1,
    };
  }

  return {
    lines: [
      `applied ${outcome.sha}`,
      `  bundleSha256: ${outcome.bundleSha256}`,
      `  changes:      ${outcome.plan.changes.length}`,
    ],
    exitCode: 0,
  };
};

/**
 * The count of documents in a bundle — for the validate summary.
 */
const countDocuments = (bundle: DefinitionBundle): number =>
  1 + // the factory
  bundle.workflows.length +
  bundle.roles.length +
  bundle.capabilities.length +
  bundle.grants.length +
  bundle.environments.length +
  bundle.routingPolicy.length +
  1 + // the policy bundle
  bundle.criticalityMaps.length +
  bundle.repoOnboardings.length +
  bundle.oracles.length +
  bundle.taskGraphs.length;

/**
 * An empty bundle of the same shape — the diff base for the first apply.
 */
const emptyLike = (bundle: DefinitionBundle): DefinitionBundle => ({
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
const EMPTY_DIGEST = 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

export { checkApproval };
