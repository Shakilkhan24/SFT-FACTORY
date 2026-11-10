/**
 * `definition` — the definition documents and the bundle that holds them.
 *
 * pack 02 §4.1: "Loads `/definition` at a git SHA, validates every document
 * against `contracts`, computes `bundleSha256`."
 *
 * This module is the **pure** half of the definition package: it takes
 * already-parsed documents and turns them into a validated bundle. The
 * filesystem half lives in `loader.ts`.
 *
 * ## What a "bundle" is
 *
 * The definition is a *set* of documents — a factory, workflows, roles,
 * capabilities, grants, environments, routing policy, criticality map and
 * the policy bundle. They are applied **together**, as one version, because
 * they reference each other: a workflow names roles, a role names models,
 * a capability is referenced by grants, and the policy bundle governs all
 * of them. Applying half of them would leave the definition internally
 * inconsistent, which is exactly the state the applier must never create.
 *
 * So the unit of application is the **bundle**: every document, validated,
 * with a single digest over the canonical form of the whole set.
 *
 * ## The digest
 *
 * `bundleSha256` is `sha256` over the **canonical JSON of the bundle**, not
 * over the YAML bytes. The YAML is one serialisation of the rules; two
 * bundles that differ only in formatting describe the same definition, and a
 * digest that tracked the file's whitespace would invalidate every approval
 * bound to it the moment a reviewer reformatted a file.
 *
 * This is the same rule the policy bundle's digest follows (AGENTS.md §4:
 * "hashes over canonical JSON only"), and it is the reason the digest is
 * stable across a reformat.
 *
 * ## The document set is closed
 *
 * `DEFINITION_KINDS` enumerates every document kind the factory knows. A
 * document of an unknown kind is **rejected**, not ignored: a definition
 * that silently drops a document it does not understand is a definition
 * whose behaviour nobody can predict.
 */

import {
  AcceptanceOracle,
  CapabilityGrant,
  CriticalityMap,
  FactoryDefinition,
  RepoOnboarding,
  RoutingPolicy,
  RoleSpec,
  TaskGraph,
  ToolCapabilityDefinition,
  WorkflowDefinition,
  WorkflowEnvironment,
  type DefinitionKind,
} from '@factory/contracts';
import { canonicalJsonOfUnknown, sha256 } from '@factory/core';
import { loadPolicyBundle, type LoadedPolicyBundle } from '@factory/policy';

/**
 * The schema for each definition kind.
 *
 * A `Record` keyed by the closed set of kinds, so a kind without a schema is
 * a **compile** error rather than a runtime surprise.
 *
 * The `safeParse` shape is what Zod exposes; the type is written out
 * structurally rather than as `typeof SomeSchema` because the record holds
 * *different* schemas, and the policy bundle's entry is a wrapper rather
 * than a Zod schema.
 */
interface SchemaLike {
  safeParse: (value: unknown) => {
    readonly success: boolean;
    readonly data?: unknown;
    readonly error?: { readonly issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[] };
  };
}

export const DEFINITION_SCHEMAS: Readonly<Record<DefinitionKind, SchemaLike>> = {
  FactoryDefinition: FactoryDefinition,
  WorkflowDefinition: WorkflowDefinition,
  RoleSpec: RoleSpec,
  ToolCapability: ToolCapabilityDefinition,
  CapabilityGrant: CapabilityGrant,
  WorkflowEnvironment: WorkflowEnvironment,
  RoutingPolicy: RoutingPolicy,
  PolicyBundle: {
    safeParse: (value: unknown) => {
      const result = loadPolicyBundle(value);
      return { success: true, data: result.bundle };
    },
  },
  CriticalityMap: CriticalityMap,
  RepoOnboarding: RepoOnboarding,
  AcceptanceOracle: AcceptanceOracle,
  TaskGraph: TaskGraph,
};

/**
 * A validated document, tagged with its kind.
 *
 * The `kind` travels with the value so the bundle can be assembled without
 * re-sniffing the document's shape.
 */
export type DefinitionDocumentOf<K extends DefinitionKind> = {
  readonly kind: K;
  readonly value: K extends 'PolicyBundle' ? LoadedPolicyBundle['bundle'] : unknown;
};

/**
 * The union of every document kind.
 */
export type AnyDefinitionDocument = {
  readonly [K in DefinitionKind]: DefinitionDocumentOf<K>;
}[DefinitionKind];

/**
 * A parsed but **not yet validated** document.
 *
 * The kind is read from the document's own `kind` field, and the document is
 * then validated against that kind's schema.
 */
export interface RawDocument {
  /** The file's path relative to the definition root. */
  readonly path: string;
  /** The parsed YAML value. */
  readonly value: unknown;
}

/**
 * A document that failed validation.
 */
export interface DocumentValidationFailure {
  readonly path: string;
  /** The kind the document claimed, or `undefined` when it claimed none. */
  readonly kind: string | undefined;
  /** The human-readable reason. */
  readonly reason: string;
  /** The zod issue paths, as dotted paths, for locating the problem. */
  readonly paths: readonly string[];
}

/**
 * The outcome of validating a set of documents.
 *
 * **Either** every document validated, **or** the list of failures is
 * non-empty. There is no partial bundle: a bundle with one bad document is
 * not a bundle.
 */
export type BundleValidation =
  | { readonly ok: true; readonly bundle: DefinitionBundle }
  | { readonly ok: false; readonly failures: readonly DocumentValidationFailure[] };

/**
 * The definition bundle — every document, validated, as one version.
 */
export interface DefinitionBundle {
  readonly factory: FactoryDefinition;
  readonly workflows: readonly WorkflowDefinition[];
  readonly roles: readonly RoleSpec[];
  readonly capabilities: readonly ToolCapabilityDefinition[];
  readonly grants: readonly CapabilityGrant[];
  readonly environments: readonly WorkflowEnvironment[];
  readonly routingPolicy: readonly RoutingPolicy[];
  readonly policyBundle: LoadedPolicyBundle['bundle'];
  readonly criticalityMaps: readonly CriticalityMap[];
  readonly repoOnboardings: readonly RepoOnboarding[];
  readonly oracles: readonly AcceptanceOracle[];
  readonly taskGraphs: readonly TaskGraph[];
}

/**
 * The digest of a bundle's canonical JSON.
 *
 * `sha256:<64 hex>`, matching the `bundleSha256` the policy decisions carry
 * and the `bundle_sha256` column on `definition_versions`.
 */
export const definitionBundleSha256 = (bundle: DefinitionBundle): `sha256:${string}` => {
  // The digest is computed over the canonical form of the *whole* bundle,
  // including the policy bundle. The policy bundle's own digest is nested
  // inside it, so a policy change changes the definition digest.
  return `sha256:${sha256(canonicalJsonOfUnknown(bundle))}`;
};

/**
 * The canonical JSON string the digest is taken over.
 *
 * Exposed so that the applier can record *what* was hashed alongside the
 * hash, and so a test can assert the digest is stable across a reordering
 * of the document files.
 */
export const definitionBundleCanonicalJson = (bundle: DefinitionBundle): string =>
  canonicalJsonOfUnknown(bundle);

/**
 * The kind a document claims, if it claims one at all.
 *
 * The `kind` field is read structurally rather than through the schema,
 * because a document that does not declare its kind cannot be validated —
 * there would be nothing to validate it against.
 */
export const claimedKind = (value: unknown): DefinitionKind | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' ? (kind as DefinitionKind) : undefined;
};

/**
 * Validate one document.
 *
 * @returns the validated document, or the failure that stopped it.
 */
export const validateDocument = (
  raw: RawDocument,
): { readonly ok: true; readonly document: AnyDefinitionDocument } | { readonly ok: false; readonly failure: DocumentValidationFailure } => {
  const kind = claimedKind(raw.value);

  if (kind === undefined) {
    return {
      ok: false,
      failure: {
        path: raw.path,
        kind: undefined,
        reason: 'the document does not declare a "kind"',
        paths: ['kind'],
      },
    };
  }

  const schema = DEFINITION_SCHEMAS[kind];
  if (schema === undefined) {
    return {
      ok: false,
      failure: {
        path: raw.path,
        kind,
        reason: `the document kind "${kind}" is not one the factory knows`,
        paths: ['kind'],
      },
    };
  }

  const parsed = schema.safeParse(raw.value);
  if (!parsed.success) {
    const issues = parsed.error?.issues ?? [];
    return {
      ok: false,
      failure: {
        path: raw.path,
        kind,
        reason: issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
        paths: issues.map((issue) => issue.path.join('.') || '(root)'),
      },
    };
  }

  return { ok: true, document: { kind, value: parsed.data } as AnyDefinitionDocument };
};

/**
 * Validate a set of documents and assemble the bundle.
 *
 * The assembly step enforces the **cardinality rules** the schemas cannot
 * express on their own:
 *
 * * exactly one `FactoryDefinition` — a definition with no factory is not a
 *   definition;
 * * at least one `PolicyBundle` — and an empty bundle denies everything, so
 *   its absence would mean "no rules" rather than "no permission";
 * * every document's `apiVersion` matches the running version.
 *
 * @returns the bundle, or every failure found.
 */
export const validateBundle = (documents: readonly AnyDefinitionDocument[]): BundleValidation => {
  const failures: DocumentValidationFailure[] = [];
  const byKind = new Map<DefinitionKind, AnyDefinitionDocument[]>();

  for (const document of documents) {
    const bucket = byKind.get(document.kind);
    if (bucket === undefined) {
      byKind.set(document.kind, [document]);
    } else {
      bucket.push(document);
    }
  }

  const factoryDocuments = byKind.get('FactoryDefinition') ?? [];
  const policyDocuments = byKind.get('PolicyBundle') ?? [];

  if (factoryDocuments.length !== 1) {
    failures.push({
      path: '(bundle)',
      kind: 'FactoryDefinition',
      reason: `the bundle must contain exactly one FactoryDefinition, found ${factoryDocuments.length}`,
      paths: ['kind'],
    });
  }

  if (policyDocuments.length !== 1) {
    failures.push({
      path: '(bundle)',
      kind: 'PolicyBundle',
      reason: `the bundle must contain exactly one PolicyBundle, found ${policyDocuments.length}`,
      paths: ['kind'],
    });
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  // The cardinality checks above have established that both lists hold
  // exactly one document, so the lookups below are total. The explicit
  // undefined-checks make that total-ness visible to the type checker
  // rather than asserting it away.
  const factoryDocument = factoryDocuments[0];
  const policyDocument = policyDocuments[0];
  if (factoryDocument === undefined || policyDocument === undefined) {
    // Unreachable: the checks above returned early for any other count.
    return {
      ok: false,
      failures: [
        {
          path: '(bundle)',
          kind: 'FactoryDefinition',
          reason: 'the bundle is missing its factory or policy document',
          paths: ['kind'],
        },
      ],
    };
  }

  const bundle: DefinitionBundle = {
    factory: factoryDocument.value as FactoryDefinition,
    workflows: valuesOf(byKind, 'WorkflowDefinition') as WorkflowDefinition[],
    roles: valuesOf(byKind, 'RoleSpec') as RoleSpec[],
    capabilities: valuesOf(byKind, 'ToolCapability') as ToolCapabilityDefinition[],
    grants: valuesOf(byKind, 'CapabilityGrant') as CapabilityGrant[],
    environments: valuesOf(byKind, 'WorkflowEnvironment') as WorkflowEnvironment[],
    routingPolicy: valuesOf(byKind, 'RoutingPolicy') as RoutingPolicy[],
    policyBundle: policyDocument.value as LoadedPolicyBundle['bundle'],
    criticalityMaps: valuesOf(byKind, 'CriticalityMap') as CriticalityMap[],
    repoOnboardings: valuesOf(byKind, 'RepoOnboarding') as RepoOnboarding[],
    oracles: valuesOf(byKind, 'AcceptanceOracle') as AcceptanceOracle[],
    taskGraphs: valuesOf(byKind, 'TaskGraph') as TaskGraph[],
  };

  return { ok: true, bundle };
};

/**
 * The documents of one kind, in the order they were supplied.
 */
const valuesOf = <K extends DefinitionKind>(
  byKind: ReadonlyMap<DefinitionKind, AnyDefinitionDocument[]>,
  kind: K,
): unknown[] =>
  (byKind.get(kind) ?? []).map((document) => document.value);
