/**
 * `artefacts` — the **run-artefact store and redaction** (checklist 03,
 * T-1.11).
 *
 * pack 02 §4.11: "One **run record** per stage execution with the 12
 * required elements… Written by the framework (never by agents),
 * **incrementally** and atomically with the outcome; objects go to
 * `runs/<runId>/…` in the object store; Postgres `runs` indexes sha256 and
 * cost. **Redaction at capture**… Retention classes per `15 §2.5`;
 * implement `retain_until` and a purge job that never touches `events`."
 *
 * ## The package holds
 *
 * * the **record's vocabulary** (`types.ts`) — the twelve elements of
 *   blueprint 15 §2.2, in the structure of §2.3;
 * * the **record builder** (`record.ts`) — the assembly and the content
 *   hash;
 * * the **completeness assertion** (`completeness.ts`) — A0.3;
 * * the **capture-time redaction** (`redaction.ts`) — the composition of
 *   the credentials registry's textual pass and the event log's
 *   structural pass;
 * * the **retention classes** (`retention.ts`) — blueprint 15 §2.5's six,
 *   and the purge selection;
 * * the **ports** (`ports.ts`) — the object store, the spool, the index;
 * * the **record writer** (`store.ts`) — incremental, atomic with the
 *   outcome, spool-then-fail;
 * * the **purge job** (`purge.ts`) — deletes objects, marks rows, and
 *   never touches `events`;
 * * the **S3 adapter** (`object-store.ts`) — with an injected transport,
 *   so no test reaches the network;
 * * the **doubles** (`fakes/`) — where the oracle lives.
 */

export {
  ELEMENT_NUMBERS,
  REQUIRED_ELEMENTS,
  RETENTION_CLASSES,
  type AppliedRedaction,
  type AuthorityRecord,
  type BudgetSummary,
  type ConfigurationVersions,
  type ContextGapRef,
  type ContextItemRef,
  type ContextManifest,
  type CostSummary,
  type ModelRef,
  type NodeRecord,
  type Outcome,
  type PolicyDecisionRecord,
  type ProducedArtefact,
  type PromptRecord,
  type RecordLocation,
  type RedactionReceipt,
  type RequiredElement,
  type Retention,
  type RetentionClass,
  type RunIdentity,
  type RunRecord,
  type RunRecordContent,
  type ToolCallRecord,
  type VerificationResult,
  type WorkflowRef,
} from './types.js';

export {
  buildRecord,
  hashRecord,
  hashRecordContent,
  recordHashVerifies,
  type PartialRunRecord,
  type RecordDigest,
  type RecordParts,
} from './record.js';

export {
  MAY_BE_EMPTY,
  assertComplete,
  incompletenessMessage,
  isComplete,
  type CompletenessReport,
  type ElementVerdict,
} from './completeness.js';

export {
  DEFAULT_CAPTURE_POLICY_REF,
  STRUCTURAL_RULE,
  capturePolicy,
  emptyReceipt,
  redactAtCapture,
  type CaptureRedaction,
} from './redaction.js';

export {
  DEFAULT_PERIODS,
  DEFAULT_RETENTION_CLASS,
  addPeriod,
  expiryFor,
  isRetentionClass,
  retainUntilDate,
  selectPurgeCandidates,
  type PurgeCandidate,
  type PurgeRow,
  type RetentionPeriod,
} from './retention.js';

export {
  IncompleteRecordError,
  ObjectStoreError,
  type ArtefactEvent,
  type ArtefactEventSink,
  type FinaliseResult,
  type ObjectLocation,
  type ObjectStore,
  type PurgeCandidateRow,
  type RunIndexEntry,
  type RunRecordStore,
  type Spool,
} from './ports.js';

export {
  RunArtifactStore,
  recordKey,
  storedBytesDigest,
  type RunArtifactStoreOptions,
} from './store.js';

export { PurgeJob, type PurgeJobOptions, type PurgeResult } from './purge.js';

export {
  S3ObjectStore,
  type ObjectSigner,
  type ObjectTransport,
  type S3ObjectStoreOptions,
} from './object-store.js';

export { InMemorySpool } from './spool.js';

export {
  InMemoryObjectStore,
  type InMemoryObjectStoreOptions,
} from './fakes/in-memory-object-store.js';

export { InMemoryRunRecordStore } from './fakes/in-memory-run-record-store.js';

export {
  PostgresRunRecordStore,
  type PostgresRunRecordStoreOptions,
} from './postgres/run-record-store.js';
