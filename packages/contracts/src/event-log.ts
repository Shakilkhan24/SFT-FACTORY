/**
 * Event-log contracts — pack 03 §3 (the `// ---------- event log ----------`
 * block), the §5 vocabulary, and blueprint `09` §4.
 *
 * ```ts
 * export interface EventEnvelope<P = unknown> {
 *   eventId: string; seq: number; occurredAt: string; eventType: string; schemaVersion: number;
 *   aggregate: { kind: 'task'|'node'|'approval'|'definition'|'run'|'change'|'system'; id: string; version: number };
 *   correlationId: string; causationId?: string; actor: Actor; authority: Authority;
 *   subject: Record<string, string>; payload: P; context: Record<string, unknown>;
 *   redaction: { applied: string[] }; costUsdMicros?: number; durationMs?: number; prevHash?: Sha256; hash: Sha256;
 * }
 * export type NewEvent<P=unknown> = Omit<EventEnvelope<P>, 'eventId'|'seq'|'occurredAt'|'prevHash'|'hash'|'schemaVersion'|'redaction'>
 *   & { bumpsVersion?: boolean };
 * export interface EventLog {
 *   append(events: NewEvent[], opts?: { expectedVersions?: Record<string, number> }): Promise<EventEnvelope[]>;
 *   read(q: { aggregate?: { kind: string; id: string }; correlationId?: string; types?: string[]; afterSeq?: number; limit?: number }): AsyncIterable<EventEnvelope>;
 *   verifyChain(aggregate: { kind: string; id: string }): Promise<{ ok: boolean; brokenAtSeq?: number }>;
 * }
 * ```
 *
 * **I-3 (attributability).** blueprint `09` §4.2: "`actor` | Yes | Who acted"
 * and "`authority` | Yes | **Under what grant.** Required for every `type:
 * agent` and `type: human` event. This is the audit backbone (SEC-07)."
 *
 * pack 03 §2 (`events` table) makes `authority jsonb NOT NULL` for **every**
 * event, which is stricter than the blueprint. The stricter reading wins:
 * `authority` is required on every envelope here.
 */

import { z } from 'zod';

import {
  Actor,
  Authority,
  EffectClass,
  FailureClass,
  IsoInstant,
  Sha256,
  UsdMicros,
} from './shared.js';

/**
 * Aggregate kinds (pack 03 §2, `events.aggregate_kind` CHECK constraint).
 *
 * The SQL constraint is normative: `('task','node','approval','definition',
 * 'run','change','system')`.
 */
export const AggregateKind = z.enum([
  'task',
  'node',
  'approval',
  'definition',
  'run',
  'change',
  'system',
]);

export type AggregateKind = z.infer<typeof AggregateKind>;

/**
 * The aggregate reference on an event.
 *
 * `version` is the optimistic-concurrency token: "version supports
 * optimistic concurrency" (blueprint `09` §4.2). The DDL comment says
 * "version AFTER this event if it changed state, else current" — so a
 * state-changing event carries the *new* version.
 */
export const AggregateRef = z
  .object({
    kind: AggregateKind,
    id: z.string().min(1),
    version: z.number().int().nonnegative(),
  })
  .strict();

export type AggregateRef = z.infer<typeof AggregateRef>;

/**
 * The redaction record (pack 03 §1, Redaction row: "Applied *before*
 * persistence; payloads record what was redacted (`redaction.applied[]`)").
 *
 * The list names the *paths* that were redacted, not the redacted values.
 */
export const Redaction = z
  .object({
    applied: z.array(z.string()),
    policyRef: z.string().min(1).optional(),
  })
  .strict();

export type Redaction = z.infer<typeof Redaction>;

/**
 * The cost record (blueprint `09` §4.2: "`cost` | Required where money was
 * spent | Token and currency amounts.").
 *
 * The DDL stores `cost_usd_micros bigint` and `duration_ms integer` as
 * columns; the envelope carries them as optional members.
 */
export const Cost = z
  .object({
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    usd: UsdMicros,
  })
  .strict();

export type Cost = z.infer<typeof Cost>;

/**
 * The pinned-context manifest (blueprint `09` §4.2: "`context` | Required
 * for agent events | The pinned context manifest. Enables exact replay
 * (I-8)").
 */
export const ContextRef = z
  .object({
    envelopeId: z.string().min(1).optional(),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1),
            version: z.string().min(1),
            sha256: Sha256,
          })
          .strict(),
      )
      .default([]),
    resolvedContextSha256: Sha256.optional(),
  })
  .strict();

export type ContextRef = z.infer<typeof ContextRef>;

/**
 * The event vocabulary — blueprint `09` §4.3 (61 types) plus the pack
 * additions (pack 03 §5).
 *
 * pack 03 §5: "v1 uses the blueprint's 61-type vocabulary [BP: 09 §4.3] plus
 * the **pack additions** below (each addition must be listed in
 * `packages/contracts/events.md` — adding an event without an entry fails
 * the contract test)."
 */
export const BLUEPRINT_EVENT_TYPES = [
  // Intake
  'intent.recorded',
  'intent.rejected',
  'request.triaged',
  'request.classified',
  // Specification
  'spec.refined',
  'spec.accepted',
  'spec.escalated',
  'spec.criteriaAdded',
  // Planning
  'plan.produced',
  'plan.validated',
  'plan.rejected',
  'plan.replanned',
  // Execution
  'node.ready',
  'node.leased',
  'node.executionStarted',
  'stage.completed',
  'stage.failed',
  'stage.incomplete',
  'tool.invoked',
  'tool.denied',
  'tool.failed',
  'model.requested',
  'model.failed',
  'model.failedOver',
  // Verification
  'gate.started',
  'gate.passed',
  'gate.failed',
  'verification.blocked',
  'calibration.completed',
  // Review
  'review.queued',
  'review.opened',
  'review.commentAdded',
  'review.approved',
  'review.rejected',
  'review.deferred',
  'review.escalated',
  // Integration
  'change.merged',
  'change.mergeFailed',
  'release.deployed',
  'release.failed',
  'release.rolledBack',
  // Governance
  'policy.allowed',
  'policy.denied',
  'policy.escalated',
  'approval.requested',
  'approval.granted',
  'approval.expired',
  'approval.revoked',
  'autonomy.promoted',
  'autonomy.revoked',
  // Improvement
  'proposal.created',
  'proposal.evaluated',
  'proposal.approved',
  'proposal.rejected',
  'harness.changeRolledBack',
  // System
  'definition.applied',
  'definition.driftDetected',
  'environment.provisioned',
  'environment.cleaned',
  'budget.exhausted',
  'run.replayed',
] as const;

/**
 * The pack additions (pack 03 §5, `[PACK]`).
 *
 * "`webhook.received`, `webhook.rejected` · `oracle.constructed`,
 * `oracle.admitted`, `oracle.admissionFailed` · `patch.extracted`,
 * `patch.rejected` · `gate.weakeningDetected` · `change.opened`,
 * `change.updated` · `credential.minted`, `credential.revoked` ·
 * `net.egress.denied` (security event), `net.egress.summary` ·
 * `kill.switch.engaged`, `kill.switch.released`."
 */
export const PACK_EVENT_TYPES = [
  'webhook.received',
  'webhook.rejected',
  'oracle.constructed',
  'oracle.admitted',
  'oracle.admissionFailed',
  'patch.extracted',
  'patch.rejected',
  'gate.weakeningDetected',
  'change.opened',
  'change.updated',
  'credential.minted',
  'credential.revoked',
  'net.egress.denied',
  'net.egress.summary',
  'kill.switch.engaged',
  'kill.switch.released',
] as const;

/**
 * The full v1 vocabulary.
 *
 * The pack's `§5` payload list also mentions `node.duplicateExecution`,
 * `kill.switch.engaged` and `kill.switch.released`. `node.duplicateExecution`
 * is in blueprint `09` §3 ("recorded as `node.duplicateExecution`") but not
 * in the `09` §4.3 table — it is a blueprint-internal type, so it is listed
 * here as a pack addition.
 */
export const EVENT_TYPES = [
  ...BLUEPRINT_EVENT_TYPES,
  ...PACK_EVENT_TYPES,
  'node.duplicateExecution',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * The registered vocabulary as a Zod enum.
 *
 * "all payloads are Zod-validated and registered by `eventType@schemaVersion`"
 * (pack 03 §5). An event type that is not registered is rejected — the
 * contract test for T-1.01 requires exactly that.
 *
 * The schema is named `EventTypeSchema` because a Zod schema and a TypeScript
 * type cannot share a name in one module scope.
 */
export const EventTypeSchema = z.enum(EVENT_TYPES);

export type EventTypeSchema = z.infer<typeof EventTypeSchema>;

/**
 * Security events (pack 03 §5).
 *
 * "`tool.denied`, `policy.denied`, `net.egress.denied`, `patch.rejected`,
 * `webhook.rejected` are **security events**: counted, alerted on, shown on
 * the Health region."
 */
export const SECURITY_EVENT_TYPES = [
  'tool.denied',
  'policy.denied',
  'net.egress.denied',
  'patch.rejected',
  'webhook.rejected',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const SecurityEventType = z.enum(SECURITY_EVENT_TYPES);

/**
 * The event envelope (pack 03 §3).
 *
 * The DDL (`events` table) is the authority on which fields are NOT NULL:
 * `actor_kind`, `actor_id`, `authority`, `subject`, `payload`, `context`,
 * `redaction` are all `NOT NULL`; `causation_id`, `cost_usd_micros`,
 * `duration_ms` and `prev_hash` are nullable.
 *
 * `eventType` is checked against the **registered vocabulary**, not a free
 * string: pack 03 §5 says "all payloads are Zod-validated and registered by
 * `eventType@schemaVersion`". An unregistered type is a contract violation,
 * not a value to be stored and discovered later.
 */
export const EventEnvelope = z
  .object({
    eventId: z.string().uuid(),
    seq: z.number().int().positive(),
    occurredAt: IsoInstant,
    eventType: EventTypeSchema,
    schemaVersion: z.number().int().positive(),
    aggregate: AggregateRef,
    correlationId: z.string().min(1),
    causationId: z.string().min(1).optional(),
    actor: Actor,
    authority: Authority,
    subject: z.record(z.string()),
    payload: z.unknown(),
    context: ContextRef,
    redaction: Redaction,
    costUsdMicros: UsdMicros.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    prevHash: Sha256.optional(),
    hash: Sha256,
  })
  .strict();

export type EventEnvelope<P = unknown> = Omit<z.infer<typeof EventEnvelope>, 'payload'> & {
  payload: P;
};

/**
 * An event before the log assigns its identity.
 *
 * `Omit<EventEnvelope<P>, 'eventId'|'seq'|'occurredAt'|'prevHash'|'hash'|'schemaVersion'|'redaction'>`
 * — the log owns `eventId`, `seq`, `occurredAt`, `prevHash`, `hash` and
 * `schemaVersion`; the redaction hook is applied **before insert**
 * (pack 03 §1, Redaction row), so the caller does not set it either.
 *
 * `bumpsVersion` says whether the event changes its aggregate's state. The
 * log bumps the aggregate version only for those events, so a read-only event
 * appended in the same transaction does not consume a version number.
 */
export const NewEvent = z
  .object({
    eventType: z.string().min(1),
    aggregate: AggregateRef,
    correlationId: z.string().min(1),
    causationId: z.string().min(1).optional(),
    actor: Actor,
    authority: Authority,
    subject: z.record(z.string()).default({}),
    payload: z.unknown(),
    context: ContextRef.default({ items: [] }),
    costUsdMicros: UsdMicros.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    bumpsVersion: z.boolean().optional(),
  })
  .strict();

export type NewEvent<P = unknown> = Omit<z.infer<typeof NewEvent>, 'payload'> & {
  payload: P;
};

/**
 * A query for reading events (pack 03 §3, `EventLog.read`).
 */
export const EventQuery = z
  .object({
    aggregate: z
      .object({
        kind: AggregateKind,
        id: z.string().min(1),
      })
      .strict()
      .optional(),
    correlationId: z.string().min(1).optional(),
    types: z.array(z.string().min(1)).optional(),
    afterSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(10_000).optional(),
  })
  .strict();

export type EventQuery = z.infer<typeof EventQuery>;

/** The result of a chain verification (pack 03 §3, `verifyChain`). */
export const ChainVerification = z
  .object({
    ok: z.boolean(),
    brokenAtSeq: z.number().int().positive().optional(),
  })
  .strict();

export type ChainVerification = z.infer<typeof ChainVerification>;

/**
 * The event-log interface (pack 03 §3).
 *
 * `append` runs **one transaction** with CAS on the aggregates: "ONE tx; CAS
 * on aggregates" (pack 03 §3) and checklist 02 trap 4 — "Putting state
 * changes and event appends in separate transactions. They must be one.
 * Otherwise I-3 ... is false under crash."
 */
export interface EventLog {
  append(
    events: NewEvent[],
    opts?: { expectedVersions?: Record<string, number> },
  ): Promise<EventEnvelope[]>;
  read(q: EventQuery): AsyncIterable<EventEnvelope>;
  verifyChain(aggregate: { kind: string; id: string }): Promise<ChainVerification>;
}



export const isSecurityEvent = (eventType: string): eventType is SecurityEventType =>
  (SECURITY_EVENT_TYPES as readonly string[]).includes(eventType);

/**
 * The registered payload shapes (pack 03 §5).
 *
 * The pack lists "minimum fields" for each event type. They are recorded
 * here as a map from event type to its minimum-field list, so the contract
 * test can assert that every registered type has an entry and that the
 * documented minimum fields are the ones the schemas actually require.
 */
export const EVENT_PAYLOAD_FIELDS: Readonly<Record<EventType, readonly string[]>> = {
  'intent.recorded': ['source', 'repo'],
  'intent.rejected': ['reason', 'ruleIds'],
  'request.triaged': ['workflow', 'rationale', 'runId'],
  'request.classified': [],
  'spec.refined': ['specSha256', 'criteriaCount', 'openQuestions'],
  'spec.accepted': ['specSha256'],
  'spec.escalated': ['reason', 'gaps'],
  'spec.criteriaAdded': [],
  'plan.produced': ['graphSha256', 'nodeCount', 'topology'],
  'plan.validated': ['graphSha256', 'checks'],
  'plan.rejected': [],
  'plan.replanned': [],
  'node.ready': [],
  'node.leased': ['nodeId', 'attempt', 'leaseOwner', 'leaseExpiresAt'],
  'node.executionStarted': [],
  'node.duplicateExecution': ['nodeId', 'attempt', 'winnerRunId'],
  'stage.completed': ['runId', 'nodeId', 'outcome', 'artefactRefs'],
  'stage.failed': ['runId', 'failureClass', 'retriable'],
  'stage.incomplete': ['runId', 'reason', 'partialRefs'],
  'tool.invoked': [
    'runId',
    'capabilityId',
    'effectClass',
    'argsSha256',
    'argsSummary',
    'resultSummary',
    'transport',
    'idempotencyKey',
    'durationMs',
  ],
  'tool.denied': ['runId', 'capabilityId', 'step', 'ruleIds', 'reason'],
  'tool.failed': [],
  'model.requested': [
    'runId',
    'provider',
    'model',
    'routeRule',
    'promptSha256',
    'tokens',
    'costUsdMicros',
    'cached',
    'via',
  ],
  'model.failed': [],
  'model.failedOver': ['from', 'to', 'trigger'],
  'gate.started': [],
  'gate.passed': ['gateReportId', 'checkId', 'layer', 'authorship'],
  'gate.failed': ['gateReportId', 'checkId', 'layer', 'authorship'],
  'gate.weakeningDetected': ['signals', 'tierRaisedTo'],
  'verification.blocked': [],
  'calibration.completed': [],
  'review.queued': [],
  'review.opened': [],
  'review.commentAdded': [],
  'review.approved': [],
  'review.rejected': [],
  'review.deferred': [],
  'review.escalated': [],
  'change.opened': ['changeId', 'prNumber', 'branch', 'baseSha', 'headSha'],
  'change.updated': [],
  'change.merged': ['changeId', 'mergeSha', 'mergedBy'],
  'change.mergeFailed': [],
  'release.deployed': [],
  'release.failed': [],
  'release.rolledBack': [],
  'policy.allowed': ['decisionId', 'action', 'ruleIds', 'reason'],
  'policy.denied': ['decisionId', 'action', 'ruleIds', 'reason'],
  'policy.escalated': ['decisionId', 'action', 'ruleIds', 'reason'],
  'approval.requested': [
    'approvalId',
    'type',
    'artefactKind',
    'artefactSha256',
    'approvers',
    'expiresAt',
  ],
  'approval.granted': ['approvalId', 'decidedBy', 'artefactSha256', 'securityScopeAck'],
  'approval.expired': ['approvalId', 'reason'],
  'approval.revoked': ['approvalId', 'reason'],
  'autonomy.promoted': [],
  'autonomy.revoked': [],
  'proposal.created': [],
  'proposal.evaluated': [],
  'proposal.approved': [],
  'proposal.rejected': [],
  'harness.changeRolledBack': [],
  'definition.applied': ['sha', 'bundleSha256', 'approvalId'],
  'definition.driftDetected': ['expectedSha', 'observedSha', 'diff'],
  'environment.provisioned': ['envId', 'tier', 'imageDigest', 'limits'],
  'environment.cleaned': ['envId', 'reason'],
  'budget.exhausted': ['scope', 'limitUsdMicros', 'spentUsdMicros'],
  'run.replayed': [],
  'webhook.received': [],
  'webhook.rejected': [],
  'oracle.constructed': ['oracleId', 'route', 'manifestSha256', 'author', 'implementationRunId'],
  'oracle.admitted': ['oracleId', 'beforeReportSha256', 'perCheck'],
  'oracle.admissionFailed': ['oracleId', 'mismatches'],
  'patch.extracted': ['runId', 'files', 'bytes', 'patchSha256'],
  'patch.rejected': ['reasons'],
  'credential.minted': ['credId', 'provider', 'scope', 'expiresAt'],
  'credential.revoked': ['credId', 'reason'],
  'net.egress.denied': ['envId', 'host', 'port', 'reason'],
  'net.egress.summary': ['envId', 'hosts'],
  'kill.switch.engaged': ['by', 'reason'],
  'kill.switch.released': ['by', 'reason'],
};

/**
 * The effect class carried on a `tool.invoked` payload.
 */
export const ToolInvocationPayload = z
  .object({
    runId: z.string().min(1),
    capabilityId: z.string().min(1),
    effectClass: EffectClass,
    argsSha256: z.string().min(1),
    argsSummary: z.unknown().optional(),
    resultSummary: z.unknown().optional(),
    transport: z.string().min(1),
    idempotencyKey: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type ToolInvocationPayload = z.infer<typeof ToolInvocationPayload>;

/**
 * The `stage.completed` payload (blueprint `09` §4.4, with pack 03 §5's
 * minimum fields).
 */
export const StageCompletedPayload = z
  .object({
    runId: z.string().min(1),
    nodeId: z.string().min(1),
    outcome: z.enum(['success', 'failure', 'incomplete']),
    artefactRefs: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type StageCompletedPayload = z.infer<typeof StageCompletedPayload>;

/**
 * The `policy.denied` payload (blueprint `09` §4.4).
 */
export const PolicyDeniedPayload = z
  .object({
    decisionId: z.string().min(1),
    action: z.string().min(1),
    ruleIds: z.array(z.string().min(1)),
    reason: z.string().min(1),
  })
  .strict();

export type PolicyDeniedPayload = z.infer<typeof PolicyDeniedPayload>;

/**
 * The `stage.failed` payload (pack 03 §5).
 */
export const StageFailedPayload = z
  .object({
    runId: z.string().min(1),
    failureClass: FailureClass,
    retriable: z.boolean(),
  })
  .strict();

export type StageFailedPayload = z.infer<typeof StageFailedPayload>;
