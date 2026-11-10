/**
 * `definition` — the structured diff between two definition bundles.
 *
 * pack 02 §4.1: "`plan(sha)` = structured diff vs the latest applied version."
 *
 * ## What a plan is for
 *
 * The plan is what a human reads before approving an apply. It must answer
 * "**what changes if this is applied**" precisely enough that the reader can
 * notice a capability appearing that nobody asked for.
 *
 * So a plan is a list of **changes**, each naming the document kind, the
 * document's identity, and whether it is added, changed or removed. It is
 * *structured*, not a textual diff, because a textual diff of a bundle that
 * has been canonicalised into JSON is unreadable — every document is one
 * line, and every reordering looks like a rewrite.
 *
 * ## Identity, not position
 *
 * A document is identified by its **name** (its `metadata.name`, or its
 * path when it has none). Diffing by identity rather than by array position
 * is what makes the plan readable: reordering a list of capabilities is not
 * a change to any capability.
 *
 * ## A change carries enough to be reviewable
 *
 * Each change records the **digest** of the document before and after. A
 * reviewer can therefore confirm that the thing they read is the thing that
 * will be applied, and the applier can re-check that the applied bundle is
 * the one that was planned.
 */

import { canonicalJsonOfUnknown, sha256 } from '@factory/core';

import type { DefinitionBundle } from './documents.js';

/**
 * The three ways a document can differ between two bundles.
 */
export type ChangeKind = 'added' | 'changed' | 'removed';

/**
 * One document's change.
 */
export interface DefinitionChange {
  readonly kind: ChangeKind;
  /** The document's kind — `ToolCapability`, `WorkflowDefinition`, … */
  readonly documentKind: string;
  /** The document's identity — its `metadata.name`, or its path. */
  readonly name: string;
  /** The digest of the document before the change. */
  readonly beforeSha256: string | undefined;
  /** The digest of the document after the change. */
  readonly afterSha256: string | undefined;
}

/**
 * The plan — a structured diff between two bundles.
 */
export interface DefinitionPlan {
  readonly changes: readonly DefinitionChange[];
  /** The digest of the bundle the plan was computed against. */
  readonly fromSha256: `sha256:${string}`;
  /** The digest of the bundle the plan proposes. */
  readonly toSha256: `sha256:${string}`;
  /** Whether the plan would change anything at all. */
  readonly isEmpty: boolean;
}

/**
 * The digest of one document's canonical form.
 *
 * The digest is over the canonical JSON of the document **value**, so a
 * document's identity and its content are hashed independently of how the
 * file that carried it was formatted.
 */
const documentSha256 = (value: unknown): string => sha256(canonicalJsonOfUnknown(value));

/**
 * The identity of a document.
 *
 * The name is what a human refers to it by, so it is the right diff key.
 * A document with no name falls back to its kind and index, which keeps it
 * addressable without pretending it has a stable identity.
 */
const documentName = (value: unknown, kind: string, index: number): string => {
  if (typeof value === 'object' && value !== null) {
    const metadata = (value as { metadata?: unknown }).metadata;
    if (typeof metadata === 'object' && metadata !== null) {
      const name = (metadata as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }
    }
  }
  return `${kind}#${index}`;
};

/**
 * The document lists of a bundle, keyed by kind.
 *
 * The order is the bundle's, which is the order the documents were read in
 * — deterministic by construction (see `loader.ts`).
 */
interface BundleDocuments {
  readonly [kind: string]: readonly unknown[];
}

const documentsOf = (bundle: DefinitionBundle): BundleDocuments => ({
  FactoryDefinition: [bundle.factory],
  WorkflowDefinition: bundle.workflows,
  RoleSpec: bundle.roles,
  ToolCapability: bundle.capabilities,
  CapabilityGrant: bundle.grants,
  WorkflowEnvironment: bundle.environments,
  RoutingPolicy: bundle.routingPolicy,
  PolicyBundle: [bundle.policyBundle],
  CriticalityMap: bundle.criticalityMaps,
  RepoOnboarding: bundle.repoOnboardings,
  AcceptanceOracle: bundle.oracles,
  TaskGraph: bundle.taskGraphs,
});

/**
 * Compute the structured diff between two bundles.
 *
 * @param from the currently applied bundle.
 * @param to the bundle that would be applied.
 */
export const planBetween = (
  from: DefinitionBundle,
  to: DefinitionBundle,
  fromSha256: `sha256:${string}`,
  toSha256: `sha256:${string}`,
): DefinitionPlan => {
  const fromDocs = documentsOf(from);
  const toDocs = documentsOf(to);
  const changes: DefinitionChange[] = [];

  // The kinds are walked in a fixed order so the plan reads the same way
  // every time — a reviewer should not have to hunt for the one changed
  // capability among an unordered list.
  for (const kind of Object.keys(toDocs)) {
    const before = fromDocs[kind] ?? [];
    const after = toDocs[kind] ?? [];

    const beforeByName = indexByName(before, kind);
    const afterByName = indexByName(after, kind);

    for (const [name, afterValue] of afterByName) {
      const beforeValue = beforeByName.get(name);
      if (beforeValue === undefined) {
        changes.push({
          kind: 'added',
          documentKind: kind,
          name,
          beforeSha256: undefined,
          afterSha256: documentSha256(afterValue),
        });
        continue;
      }
      const beforeDigest = documentSha256(beforeValue);
      const afterDigest = documentSha256(afterValue);
      if (beforeDigest !== afterDigest) {
        changes.push({
          kind: 'changed',
          documentKind: kind,
          name,
          beforeSha256: beforeDigest,
          afterSha256: afterDigest,
        });
      }
    }

    for (const [name, beforeValue] of beforeByName) {
      if (!afterByName.has(name)) {
        changes.push({
          kind: 'removed',
          documentKind: kind,
          name,
          beforeSha256: documentSha256(beforeValue),
          afterSha256: undefined,
        });
      }
    }
  }

  return {
    changes,
    fromSha256,
    toSha256,
    isEmpty: changes.length === 0,
  };
};

/**
 * Index a document list by identity.
 *
 * Two documents with the same name would collide, so the later one wins
 * with a suffix — the bundle is *invalid* in that case, but the plan must
 * still render rather than throw, because the plan is what tells the
 * operator what is wrong.
 */
const indexByName = (documents: readonly unknown[], kind: string): Map<string, unknown> => {
  const index = new Map<string, unknown>();
  const counts = new Map<string, number>();

  documents.forEach((value, position) => {
    const base = documentName(value, kind, position);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    const name = seen === 0 ? base : `${base}#${seen}`;
    index.set(name, value);
  });

  return index;
};

/**
 * Render a plan as a human-readable summary.
 *
 * Used by `factory definition plan`, and by the approval request's comment.
 */
export const renderPlan = (plan: DefinitionPlan): string => {
  if (plan.isEmpty) {
    return 'the bundle is identical to the currently applied version';
  }

  const lines: string[] = [`${plan.changes.length} change(s):`];
  for (const change of plan.changes) {
    const marker = change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : '~';
    lines.push(`  ${marker} ${change.documentKind}/${change.name}`);
  }
  return lines.join('\n');
};
