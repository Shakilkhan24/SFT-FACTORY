/**
 * `artefacts` — the run record's vocabulary.
 *
 * ## What this is
 *
 * The **run artefact** is "the complete record of one execution" (blueprint
 * 15 §2.1). blueprint 15 §2.2 lists **twelve elements** it must contain,
 * and §2.3 gives the record's structure. This file is the TypeScript
 * spelling of both.
 *
 * ## Why the record's shape is copied rather than derived
 *
 * The twelve elements are the *object* side of the record; the `runs` table
 * (`migrations/0001_core.sql:118`) is the *index* side — `record_uri`,
 * `record_sha256`, `retention_class`, `retain_until`. The blueprint gives
 * the object; the DDL gives the index. Neither is derivable from the other,
 * so both are stated here and the two are joined by the store.
 *
 * ## The twelve elements, by number
 *
 * blueprint 15 §2.2 numbers them, and the numbering is kept because
 * A0.3 speaks of "every one of the 12 required elements" — a *count* of
 * named things, not a shape that could be satisfied by accident.
 *
 * | # | Element | Type here |
 * |---|---|---|
 * | 1 | task identity, workflow, specification version | {@link RunIdentity} |
 * | 2 | effective context manifest | {@link ContextManifest} |
 * | 3 | model, harness and configuration versions | {@link ConfigurationVersions} |
 * | 4 | every tool call | {@link ToolCallRecord}[] |
 * | 5 | all prompts and generated text | {@link PromptRecord}[] |
 * | 6 | verification results, per layer, with authorship | {@link VerificationResult}[] |
 * | 7 | artefacts produced, with hashes | {@link ProducedArtefact}[] |
 * | 8 | outcome, including the failure classification | {@link Outcome} |
 * | 9 | the approval and the authority under which the action occurred | {@link AuthorityRecord}[] |
 * | 10 | token counts and compute cost | {@link CostSummary} |
 * | 11 | budget consumption over time | {@link BudgetSummary} |
 * | 12 | policy decisions — allow, deny, escalate, with the rule | {@link PolicyDecisionRecord}[] |
 *
 * ## Why some elements are arrays and some are single values
 *
 * An element that the corpus describes as *"every"*, *"per layer"* or
 * *"decisions"* is a **list**: tool calls, verification layers, produced
 * artefacts, authorities, policy decisions. An element that describes
 * *one* thing is a **single value**: the identity, the context manifest,
 * the configuration, the outcome, the cost, the budget.
 *
 * A list may legitimately be **empty** — a run with no tool calls, a run
 * with no verification layers. That is why "present" and "non-empty" are
 * different properties, and why the completeness assertion treats them
 * differently. See `completeness.ts`.
 *
 * ## The record is the framework's, not the agent's
 *
 * blueprint 15 §2.4: "The runtime and control plane write the artefact. An
 * agent never writes it, and never writes a field of it (MEAS-02)." So
 * every type here is a **plain data shape** — no behaviour, no I/O, no
 * clock. The writer in `store.ts` is the only thing that assembles one, and
 * it assembles from what the framework observed.
 */

import type { ContextTrust, FailureClass, Sha256 } from '@factory/contracts';

/**
 * The twelve required elements, by number.
 *
 * The list is the *assertion's* subject: A0.3 is satisfied when every one of
 * these is present and non-empty. The names are stable — they appear in the
 * completeness report, which is read by auditors.
 */
export const REQUIRED_ELEMENTS = [
  'identity',
  'context',
  'configuration',
  'toolCalls',
  'prompts',
  'verification',
  'artefacts',
  'outcome',
  'authority',
  'cost',
  'budget',
  'policyDecisions',
] as const;

/** The name of one of the twelve required elements. */
export type RequiredElement = (typeof REQUIRED_ELEMENTS)[number];

/**
 * The twelve elements, **numbered**.
 *
 * The number is part of the identity, because blueprint 15 §2.2 numbers
 * them and a report that says "element 7 missing" is more useful than one
 * that says "artefacts missing" — the second could mean the element or the
 * artefacts it contains.
 */
export const ELEMENT_NUMBERS: Readonly<Record<RequiredElement, number>> = {
  identity: 1,
  context: 2,
  configuration: 3,
  toolCalls: 4,
  prompts: 5,
  verification: 6,
  artefacts: 7,
  outcome: 8,
  authority: 9,
  cost: 10,
  budget: 11,
  policyDecisions: 12,
};

/**
 * The retention classes (blueprint 15 §2.5).
 *
 * The names match the DDL: `runs.retention_class text NOT NULL DEFAULT
 * 'engineering'` (migrations/0001_core.sql:118). The class is a *policy*
 * decision — the run's own nature decides it — and it determines how long
 * the record is kept.
 */
export const RETENTION_CLASSES = [
  'engineering',
  'security-relevant',
  'incident',
  'evaluation',
  'sensitive',
  'debug',
] as const;

/** One of the six retention classes. */
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

/**
 * Element 1 — **task identity, workflow, and specification version**.
 *
 * "The unit of work" (blueprint 15 §2.2).
 */
export interface RunIdentity {
  /** The run's own id — `run_…` (pack 03 §1). */
  readonly runId: string;
  /** The task the run serves — `tsk_…`. */
  readonly taskId: string;
  /** The workflow the task follows. */
  readonly workflow: WorkflowRef;
  /**
   * The specification version the run executed against.
   *
   * A run against an unversioned specification is not reproducible, so the
   * version is required — never empty, never "latest".
   */
  readonly specVersion: string;
}

/** A workflow, by id and version. */
export interface WorkflowRef {
  readonly id: string;
  readonly version: string;
}

/**
 * Element 2 — **the effective context manifest**.
 *
 * blueprint 15 §2.2: "item identifiers, versions, `resolvedContextSha256`"
 * — "Reproducibility; ADR-0009's validation".
 */
export interface ContextManifest {
  /** The context envelope's id. */
  readonly envelopeId: string;
  /** The fingerprint of the resolved context. */
  readonly resolvedContextSha256: Sha256;
  /** The items the envelope resolved. */
  readonly items: readonly ContextItemRef[];
  /**
   * What could not be resolved.
   *
   * A gap is *recorded*, not fatal — the context assembler fails rather
   * than truncating, so a record with gaps is a record of a run that
   * proceeded without something it expected. That is worth seeing.
   */
  readonly gaps: readonly ContextGapRef[];
}

/** One pinned context item. */
export interface ContextItemRef {
  readonly id: string;
  readonly version: string;
  readonly sha256: Sha256;
  readonly trust: ContextTrust;
}

/** Something expected that could not be resolved. */
export interface ContextGapRef {
  readonly expected: string;
  readonly reason: string;
}

/**
 * Element 3 — **model, harness, and configuration versions**.
 *
 * "Replay; the configuration is the independent variable in every
 * experiment" (blueprint 15 §2.2). So each *node* names the model it used
 * — the configuration is per-node, not per-run.
 */
export interface ConfigurationVersions {
  /** The definition revision the run executed against. */
  readonly definitionRevision: string;
  /** The agent harness's version. */
  readonly harnessVersion: string;
  /** The routing policy the gateway applied — `default@3`. */
  readonly routingPolicy: string;
  /** The tool registry revision the broker consulted. */
  readonly toolRegistryRevision: string;
}

/**
 * The nodes of a run.
 *
 * blueprint 15 §2.3's `nodes[]` — each node is one agent's turn at the
 * work, with its own model, its own tool calls, its own verification.
 */
export interface NodeRecord {
  /** The node's id — `n_04`. */
  readonly nodeId: string;
  /** The role the node played — `worker`. */
  readonly role: string;
  /** The model the node used. */
  readonly model: ModelRef;
  /** How many attempts the node took. */
  readonly attempts: number;
  /** How many turns the node took. */
  readonly turns: number;
  /** How long the node ran, in milliseconds. */
  readonly durationMs: number;
  /** The node's tool calls (element 4). */
  readonly toolCalls: readonly ToolCallRecord[];
  /** The artefacts the node produced (element 7). */
  readonly artefacts: readonly ProducedArtefact[];
  /** The verification layers the node's output passed (element 6). */
  readonly verification: readonly VerificationResult[];
}

/** A model, by provider, id and version. */
export interface ModelRef {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
}

/**
 * Element 4 — **every tool call**.
 *
 * "tool identity and version, arguments summary, result summary, duration,
 * cost" (blueprint 15 §2.2). The summaries are **summaries**: the
 * arguments are captured as a redacted summary, not as the full call.
 */
export interface ToolCallRecord {
  /** The invocation's id — `inv_…`. */
  readonly invocationId: string;
  /** The capability that was invoked — `repo.read`. */
  readonly capabilityId: string;
  /** The capability's version. */
  readonly capabilityVersion: string;
  /** A summary of the arguments, already redacted. */
  readonly argumentsSummary: string;
  /** A summary of the result, already redacted. */
  readonly resultSummary: string;
  /** How long the call took, in milliseconds. */
  readonly durationMs: number;
  /** The call's cost, in integer micro-USD. */
  readonly costUsdMicros: number;
}

/**
 * Element 5 — **all prompts and generated text**.
 *
 * "subject to a retention policy" (blueprint 15 §2.2) — "Diagnosis of a
 * bad run; the prompt is the primary input".
 *
 * The text is **free text**, so it is the field the redaction pipeline
 * exists for: a token pasted into a prompt is caught by the pattern layer.
 */
export interface PromptRecord {
  /** What the text is. */
  readonly kind: 'prompt' | 'generated';
  /** The role the text came from — `user`, `assistant`, `system`. */
  readonly role: string;
  /** The text itself, already redacted. */
  readonly text: string;
  /** The digest of the text before redaction, so the two can be compared. */
  readonly sha256: Sha256;
}

/**
 * Element 6 — **verification results, per layer, with authorship flags**.
 *
 * "The evidence for the merge decision" (blueprint 15 §2.2). The
 * authorship flag is not decoration: an *agent*-authored layer is not
 * trusted, and the record has to say which it was.
 */
export interface VerificationResult {
  /** The layer — `acceptance`, `unit`, `static`. */
  readonly layer: string;
  /** The layer's verdict — `pass`, `fail`. */
  readonly result: string;
  /** Who wrote the layer's check — `owner`, `generator`, `agent`, `deterministic`. */
  readonly authoredBy: string;
  /** Whether the layer's verdict is trusted. */
  readonly trusted: boolean;
}

/**
 * Element 7 — **artefacts produced, with hashes**.
 *
 * "The change; the hash is what the approval binds to" (blueprint 15 §2.2).
 */
export interface ProducedArtefact {
  /** What the artefact is — `patch`, `report`. */
  readonly kind: string;
  /** Where the artefact lives — `s3://factory-artifacts/chg_…/diff.patch`. */
  readonly uri: string;
  /** The artefact's content hash. */
  readonly sha256: Sha256;
  /** The artefact's size, in bytes. */
  readonly bytes: number;
}

/**
 * Element 8 — **outcome, including the failure classification**.
 *
 * "The signal for the improvement loop" (blueprint 15 §2.2).
 */
export interface Outcome {
  /** `success`, `failure`, `incomplete`. */
  readonly status: string;
  /**
   * The failure's class.
   *
   * `null` for a success. The classes are the ten of pack 03 §3; an
   * unclassified failure is `workflow.composition`, never left unclassified.
   */
  readonly failureClassification: FailureClass | null;
}

/**
 * Element 9 — **the approval and the authority under which the action
 * occurred**.
 *
 * "SEC-07; the audit backbone" (blueprint 15 §2.2). The
 * `artefactSha256` member is what binds the approval to the change: the
 * approval is *for this exact content*.
 */
export interface AuthorityRecord {
  /** What was authorised — `merge`. */
  readonly action: string;
  /** Where the authority came from — `accesspoint.approve`. */
  readonly source: string;
  /** Who gave it — `human:alice`. */
  readonly approver: string;
  /** The artefact the authority was given over. */
  readonly artefactSha256: Sha256;
}

/**
 * Element 10 — **token counts and compute cost**.
 *
 * "MEAS-04; the routing input" (blueprint 15 §2.2).
 *
 * The amounts are **integer micro-USD** (pack 04 §6), because a float
 * cost accumulates error and the error lands on the budget check.
 */
export interface CostSummary {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheWrite: number;
  /** The model's cost, in micro-USD. */
  readonly modelUsdMicros: number;
  /** The tools' cost, in micro-USD. */
  readonly toolUsdMicros: number;
  /** The infrastructure's cost, in micro-USD. */
  readonly infraUsdMicros: number;
  /** The total cost, in micro-USD. */
  readonly totalUsdMicros: number;
}

/**
 * Element 11 — **budget consumption over time**.
 *
 * "NFR-11's cost predictability" (blueprint 15 §2.2).
 */
export interface BudgetSummary {
  /** The budget declared for the run, in micro-USD. */
  readonly declaredUsdMicros: number;
  /** What the run consumed, in micro-USD. */
  readonly consumedUsdMicros: number;
  /** The turn budget declared. */
  readonly turnsDeclared: number;
  /** The turns used. */
  readonly turnsUsed: number;
}

/**
 * Element 12 — **policy decisions**.
 *
 * "allow, deny, escalate, with the rule" (blueprint 15 §2.2). "The
 * security trail."
 */
export interface PolicyDecisionRecord {
  /** The decision's id. */
  readonly id: string;
  /** What was decided about — `repo.write`. */
  readonly action: string;
  /** The outcome — `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, `ESCALATE`. */
  readonly outcome: string;
  /** The rules that produced the decision. */
  readonly ruleIds: readonly string[];
  /** Why the decision was made. */
  readonly reason: string;
}

/**
 * The redaction receipt (blueprint 15 §2.5).
 *
 * "The redaction is itself recorded — `redaction.applied` and
 * `redaction.policyRef` — so a reader knows that something was removed
 * rather than assuming it was never there."
 *
 * The receipt names the **paths** and the **rules**, never the values.
 */
export interface RedactionReceipt {
  /** What was redacted, and where. */
  readonly applied: readonly AppliedRedaction[];
  /** The policy the redaction ran under — `redaction.v1`. */
  readonly policyRef: string;
}

/**
 * One redaction.
 *
 * The `path` says *where*; the `rule` says *which layer* caught it; the
 * `digest` is a fingerprint of the removed value. No member of this
 * interface can carry the secret itself.
 */
export interface AppliedRedaction {
  /** Where in the record the redaction happened — `nodes[0].toolCalls[2].argumentsSummary`. */
  readonly path: string;
  /** Which rule caught it — `exact.minted`, `pattern.token`, `deny.env-name`. */
  readonly rule: string;
  /** A digest of the removed value. */
  readonly digest: string;
}

/**
 * The **retention** of the record (blueprint 15 §2.3's `retention`).
 */
export interface Retention {
  /** The class the record falls under. */
  readonly class: RetentionClass;
  /** When the record expires — an ISO instant. */
  readonly expiresAt: string;
}

/**
 * The **run record** — the whole artefact.
 *
 * The structure follows blueprint 15 §2.3. The member names are the
 * blueprint's, so a reader holding the blueprint can read this record.
 */
export interface RunRecord {
  /** Element 1. */
  readonly identity: RunIdentity;
  /** Element 2. */
  readonly context: ContextManifest;
  /** Element 3. */
  readonly configuration: ConfigurationVersions;
  /** The run's nodes, each with its own model, tool calls and verification. */
  readonly nodes: readonly NodeRecord[];
  /** Element 4 — every tool call, flattened across the nodes. */
  readonly toolCalls: readonly ToolCallRecord[];
  /** Element 5. */
  readonly prompts: readonly PromptRecord[];
  /** Element 6 — every verification layer, flattened across the nodes. */
  readonly verification: readonly VerificationResult[];
  /** Element 7 — every artefact produced, flattened across the nodes. */
  readonly artefacts: readonly ProducedArtefact[];
  /** Element 8. */
  readonly outcome: Outcome;
  /** Element 9. */
  readonly authority: readonly AuthorityRecord[];
  /** Element 10. */
  readonly cost: CostSummary;
  /** Element 11. */
  readonly budget: BudgetSummary;
  /** Element 12. */
  readonly policyDecisions: readonly PolicyDecisionRecord[];
  /** The redaction receipt. */
  readonly redaction: RedactionReceipt;
  /** The retention class and expiry. */
  readonly retention: Retention;
  /** When the run started — an ISO instant. */
  readonly startedAt: string;
  /** When the run completed — an ISO instant. */
  readonly completedAt: string;
  /**
   * The record's content hash.
   *
   * blueprint 15 §2.4: "The artefact has a content hash". It is the
   * hash of the record **without** this member, so the hash is a function
   * of the content and not of itself.
   */
  readonly sha256: Sha256;
}

/**
 * A run record **without** its hash — the shape the hash is computed over.
 *
 * Kept as a distinct type so that the hash cannot accidentally be computed
 * over a record that already carries one.
 */
export type RunRecordContent = Omit<RunRecord, 'sha256'>;

/**
 * Where a record's bytes live.
 *
 * The DDL stores `runs.record_uri text`, and blueprint 15 §2.3 shows
 * `s3://factory-artifacts/chg_…/diff.patch` for a *produced* artefact. The
 * record itself goes to `runs/<runId>/…` (pack 02 §4.11), so its URI is
 * `s3://<bucket>/runs/<runId>/record.json`.
 */
export interface RecordLocation {
  /** The object key — `runs/<runId>/record.json`. */
  readonly key: string;
  /** The full URI. */
  readonly uri: string;
}
