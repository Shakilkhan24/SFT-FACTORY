/**
 * `definition` — loading, validating, planning and applying the factory's
 * definition documents.
 *
 * pack 02 §4.1: "Definition store and applier [BP: ADR-0001, 09 §9, 07 §4.1]".
 *
 * The package has five parts:
 *
 * * `documents.ts` — the **pure** half: validate documents against the
 *   contracts and assemble them into a bundle with its digest.
 * * `loader.ts` — the **I/O** half: read the definition directory.
 * * `plan.ts` — the structured diff between two bundles.
 * * `apply.ts` — the applier, with its three preconditions.
 * * `drift.ts` — the **pure** half of the drift check.
 * * `drift-job.ts` — the drift job, which appends `definition.driftDetected`
 *   and never corrects.
 *
 * The package is **not** in the pure set (pack 02 §3): reading a definition
 * is I/O. The pure halves are still pure — `documents.ts`, `plan.ts`,
 * `apply.ts` and `drift.ts` take their inputs as values and do no I/O of
 * their own; the `DefinitionVersionStore` and `DefinitionScmCheck` ports are
 * how the applier reaches the database and the SCM without depending on
 * either.
 */

export {
  DEFINITION_SCHEMAS,
  claimedKind,
  definitionBundleCanonicalJson,
  definitionBundleSha256,
  validateBundle,
  validateDocument,
  type AnyDefinitionDocument,
  type BundleValidation,
  type DefinitionBundle,
  type DefinitionDocumentOf,
  type DocumentValidationFailure,
  type RawDocument,
} from './documents.js';

export {
  DEFINITION_ROOT,
  loadDefinition,
  readRawDocuments,
  type LoadFailure,
  type LoadResult,
} from './loader.js';

export {
  planBetween,
  renderPlan,
  type ChangeKind,
  type DefinitionChange,
  type DefinitionPlan,
} from './plan.js';

export {
  APPLIER_ROLE,
  APPLY_REFUSALS,
  applyDefinition,
  checkApproval,
  type ApplyOptions,
  type ApplyOutcome,
  type ApplyRefusal,
  type ApplyRefusalDetail,
  type DefinitionApprovalInput,
  type DefinitionScmCheck,
  type DefinitionVersionStore,
} from './apply.js';

export {
  DRIFT_KINDS,
  checkDrift,
  type DriftFinding,
  type DriftInputs,
  type DriftKind,
  type DriftReport,
} from './drift.js';

export {
  DRIFT_EVENT_TYPE,
  driftEventPayload,
  runDriftJob,
  type AppliedVersionReader,
  type DriftEventPayload,
  type DriftEventSink,
  type DriftJobInputs,
  type DriftJobOutcome,
  type DriftRepository,
} from './drift-job.js';

export { PostgresDefinitionVersionStore } from './postgres-store.js';

export {
  PostgresApprovalReader,
  rowToApproval,
  type ApprovalReader,
} from './approval-reader.js';

export {
  parsePolicyBundle,
  readPolicyBundle,
} from './policy-bundle.js';

export {
  buildCapabilityRegistry,
  type CapabilityProblem,
  type CapabilityRegistryEntry,
  type CapabilityRegistryLoad,
} from './capability-registry.js';
