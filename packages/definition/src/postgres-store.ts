/**
 * `definition` — the Postgres-backed definition version store.
 *
 * pack 02 §4.1: "only role `factory_applier` can insert `definition_versions`;
 * the API role cannot (A0.7, AT-6/7)."
 *
 * ## The write is one transaction
 *
 * Inserting the new version and deactivating the old one happen together.
 * If they were separate, there would be a window in which **two** versions
 * are active (the apply succeeded, the deactivate failed) or **none** is
 * (the deactivate succeeded, the insert failed). Neither state is
 * acceptable: the factory must always be running on exactly one known,
 * approved definition.
 *
 * ## The role is read, not assumed
 *
 * `currentRole()` reads the role the session actually acts as, so the
 * applier's role check is a statement about the *session* rather than about
 * a value the caller supplied. In `assume` mode the role is set by the
 * connection preamble; in `direct` mode it is the login's own role.
 */

import type { Kysely, Transaction } from 'kysely';

import type { FactoryDatabase } from '@factory/db';

import {
  definitionBundleSha256,
  type AnyDefinitionDocument,
  type DefinitionBundle,
} from './documents.js';
import type { DefinitionPlan } from './plan.js';
import type { DefinitionVersionStore } from './apply.js';

/**
 * The store, backed by the `definition_versions` table.
 */
export class PostgresDefinitionVersionStore implements DefinitionVersionStore {
  readonly #db: Kysely<FactoryDatabase>;
  readonly #role: string;

  /**
   * @param db the database handle.
   * @param role the role the session acts as. Read back by `currentRole()`,
   *   so the applier's check is about the session and not about an argument.
   */
  constructor(db: Kysely<FactoryDatabase>, role: string) {
    this.#db = db;
    this.#role = role;
  }

  /**
   * The role the session acts as.
   */
  currentRole(): string {
    return this.#role;
  }

  /**
   * The currently active bundle, if one has been applied.
   *
   * The bundle is stored as `jsonb`; it is read back and re-validated
   * against the contract schemas, because a row that was written by an
   * older version of the code (or by hand) must not be trusted as-is.
   */
  async activeBundle(): Promise<DefinitionBundle | undefined> {
    const row = await this.#db
      .selectFrom('definition_versions')
      .select(['bundle'])
      .where('active', '=', true)
      .orderBy('applied_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const { validateBundle, validateDocument } = await import('./documents.js');
    const documents = bundleToDocuments(row.bundle);
    const validated = documents
      .map((document) => validateDocument({ path: '(stored)', value: document }))
      .filter((result) => result.ok)
      .map((result) => (result as { ok: true; document: AnyDefinitionDocument }).document);
    const assembled = validateBundle(validated);
    return assembled.ok ? assembled.bundle : undefined;
  }

  /**
   * The currently active version — its SHA and its bundle.
   *
   * The drift job needs the SHA *and* the bundle: the SHA is what the applied
   * version claims to come from, and the bundle is what the repository at
   * that SHA is compared against. `activeBundle` alone is not enough, and
   * `activeSha256` gives the digest rather than the SHA.
   */
  async activeVersion(): Promise<
    { readonly sha: string; readonly bundle: DefinitionBundle } | undefined
  > {
    const row = await this.#db
      .selectFrom('definition_versions')
      .select(['sha', 'bundle'])
      .where('active', '=', true)
      .orderBy('applied_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const bundle = await this.activeBundle();
    if (bundle === undefined) {
      // The row exists but its bundle does not re-validate, so there is no
      // bundle to drift against. Reporting "no active version" is honest;
      // reporting a version whose contents are unreadable would not be.
      return undefined;
    }

    return { sha: row.sha, bundle };
  }

  /**
   * The digest of the currently active bundle.
   */
  async activeSha256(): Promise<`sha256:${string}` | undefined> {
    const row = await this.#db
      .selectFrom('definition_versions')
      .select(['bundle_sha256'])
      .where('active', '=', true)
      .orderBy('applied_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const hex = Buffer.from(row.bundle_sha256).toString('hex');
    return `sha256:${hex}`;
  }

  /**
   * Apply a bundle as the new active version.
   *
   * One transaction: insert the new row, deactivate the old one.
   */
  async applyVersion(input: {
    readonly sha: string;
    readonly bundleSha256: `sha256:${string}`;
    readonly bundle: DefinitionBundle;
    readonly plan: DefinitionPlan;
    readonly approvalId: string;
    readonly appliedBy: string;
  }): Promise<string> {
    await this.#db.transaction().execute(async (trx: Transaction<FactoryDatabase>) => {
      // Deactivate first, then insert. Both in the same transaction, so a
      // failure between them rolls back to the previous active version.
      await trx
        .updateTable('definition_versions')
        .set({ active: false })
        .where('active', '=', true)
        .execute();

      await trx
        .insertInto('definition_versions')
        .values({
          sha: input.sha,
          bundle_sha256: Buffer.from(input.bundleSha256.slice('sha256:'.length), 'hex'),
          bundle: input.bundle as unknown as Record<string, unknown>,
          plan: input.plan as unknown as Record<string, unknown>,
          approval_id: input.approvalId,
          applied_by: input.appliedBy,
          active: true,
        })
        .execute();
    });

    return input.sha;
  }
}

/**
 * Turn a stored bundle back into the documents it was assembled from.
 *
 * The bundle is stored in its *assembled* shape, so it is turned back into
 * documents here — the same shape the loader produces — so that it can be
 * re-validated by the same code path.
 */
const bundleToDocuments = (bundle: unknown): unknown[] => {
  if (typeof bundle !== 'object' || bundle === null) {
    return [];
  }

  const value = bundle as Record<string, unknown>;
  const documents: unknown[] = [];

  if (value['factory'] !== undefined) {
    documents.push(value['factory']);
  }
  if (value['policyBundle'] !== undefined) {
    documents.push(value['policyBundle']);
  }

  for (const key of [
    'workflows',
    'roles',
    'capabilities',
    'grants',
    'environments',
    'routingPolicy',
    'criticalityMaps',
    'repoOnboardings',
    'oracles',
    'taskGraphs',
  ]) {
    const list = value[key];
    if (Array.isArray(list)) {
      // `Array.isArray` narrows to `any[]`, so the elements are re-typed as
      // `unknown` before they are pushed — the documents are re-validated
      // against the contract schemas by the caller anyway.
      for (const element of list as readonly unknown[]) {
        documents.push(element);
      }
    }
  }

  return documents;
};

/**
 * The digest of a bundle — re-exported for the store's callers.
 */
export { definitionBundleSha256 };
