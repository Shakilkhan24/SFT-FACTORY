/**
 * `cli` — the wiring for `factory definition`.
 *
 * The applier's logic lives in `@factory/definition`; this module resolves
 * the *environment* into the ports it needs: the database handle, the
 * applier's role, the approval, and the SCM provenance check.
 *
 * ## The SCM check is deliberately absent
 *
 * The provenance check ("is this SHA on the protected default branch, with
 * its checks green?") needs a real SCM client, which arrives with the
 * GitHub App integration. Until then, the CLI **refuses to apply** rather
 * than assuming the answer is yes — a CLI that applied an unverified SHA
 * would be a hole straight through the first precondition.
 *
 * `validate` and `plan` do not need the SCM, so they work today.
 */

import type { Approval } from '@factory/contracts';

import { createDatabase, destroyDatabase, type FactoryRole } from '@factory/db';
import {
  PostgresApprovalReader,
  PostgresDefinitionVersionStore,
  type ApprovalReader,
  type DefinitionScmCheck,
  type DefinitionVersionStore,
} from '@factory/definition';

/**
 * The SCM check that refuses everything.
 *
 * It is the honest default when no SCM client is wired: the SHA's
 * provenance is *unknown*, and unknown is not on the protected branch.
 */
export const refusingScmCheck = (): DefinitionScmCheck => ({
  checkProtectedBranch: (sha: string) =>
    Promise.resolve({
      ok: false,
      onProtectedBranch: false,
      checksGreen: false,
      reason:
        `no SCM client is wired, so the provenance of ${sha} cannot be confirmed; ` +
        'the apply is refused rather than assumed',
    }),
});

/**
 * The environment the definition commands read.
 */
export interface DefinitionEnvironment {
  readonly definitionRoot: string;
  readonly connectionString: string | undefined;
  readonly mode: 'direct' | 'assume';
  readonly appliedBy: string | undefined;
  readonly approvalId: string | undefined;
  readonly sha: string | undefined;
}

/**
 * The store, backed by the database.
 *
 * When no connection string is available, a store is still needed — the
 * `validate` and `plan` commands must work without a database. So an
 * **in-memory** store stands in, which reports "no active version" and
 * refuses to write. That way `factory definition plan` shows the diff
 * against nothing, which is exactly right for a first apply.
 */
export interface DefinitionStores {
  readonly store: DefinitionVersionStore;
  readonly approvals: ApprovalReader;
  readonly destroy: () => Promise<void>;
}

/**
 * Build the store for the definition commands.
 */
export const buildDefinitionStore = (
  environment: DefinitionEnvironment,
): DefinitionStores => {
  if (environment.connectionString === undefined) {
    return {
      store: emptyStore(),
      approvals: emptyApprovalReader(),
      destroy: () => Promise.resolve(),
    };
  }

  const db = createDatabase({
    connectionString: environment.connectionString,
    role: 'factory_applier' as FactoryRole,
    mode: environment.mode,
  });

  return {
    store: new PostgresDefinitionVersionStore(db, 'factory_applier'),
    approvals: new PostgresApprovalReader(db),
    destroy: () => destroyDatabase(db),
  };
};

/**
 * A store for when there is no database.
 *
 * It reports no active version and refuses to apply — the refusal is the
 * point. A CLI that appeared to apply a definition without a database would
 * be lying about the factory's state.
 */
const emptyStore = (): DefinitionVersionStore => ({
  applyVersion: () =>
    Promise.reject(
      new Error('no database is configured, so no definition can be applied'),
    ),
  activeBundle: () => Promise.resolve(undefined),
  activeSha256: () => Promise.resolve(undefined),
  currentRole: () => 'none',
});

/**
 * An approval reader for when there is no database.
 *
 * It finds no approval. That is the honest answer: without a database there
 * is no approval row, and the applier's refusal (`no_approval`) is the
 * correct outcome rather than a bypass.
 */
const emptyApprovalReader = (): ApprovalReader => ({
  byId: () => Promise.resolve(undefined),
});

/**
 * Parse `--key value` and `--flag` arguments.
 *
 * The CLI's argument grammar is deliberately tiny: `--key value` pairs and
 * `--flag` switches. Anything else is ignored rather than guessed at.
 */
export interface ParsedArgs {
  readonly flags: Readonly<Record<string, string | true>>;
  readonly positional: readonly string[];
}

export const parseArgs = (args: readonly string[]): ParsedArgs => {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }

    const name = argument.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    index += 1;
  }

  return { flags, positional };
};

/**
 * The approval the operator named, if any.
 *
 * The approval is read from the `approvals` table by id — it is **not**
 * supplied by the caller. The whole point of the approval precondition is
 * that the thing being applied was approved by a human; a CLI that accepted
 * an approval from its own arguments would make the check vacuous.
 *
 * A missing id means no approval, and a missing row means no approval. Both
 * lead to the same place: the applier refuses with `no_approval`.
 */
export const resolveApproval = async (
  approvalId: string | undefined,
  approvals: ApprovalReader,
): Promise<Approval | undefined> => {
  if (approvalId === undefined || approvalId === '') {
    return undefined;
  }
  return approvals.byId(approvalId);
};
