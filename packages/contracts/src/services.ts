/**
 * Service contracts — pack 03 §3, the blocks from `// ---------- tools ----------`
 * through `// ---------- SCM ----------`.
 *
 * These are the **interfaces** every implementation package satisfies. They
 * live in `contracts` because `contracts` is the only package every other
 * package may import (pack 02 §3: "contracts imports nothing internal"; the
 * dependency graph is `contracts → everything`, never the reverse).
 */

import { z } from 'zod';

import {
  Actor,
  Autonomy,
  EffectClass,
  FailureClass,
  NodeId,
  Scope,
  Sha256,
  Tier,
  UsdMicros,
} from './shared.js';
import type { StageKind } from './shared.js';
import { ContextEnvelope } from './context.js';

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

/** A tool call (pack 03 §3). */
export const ToolCall = z
  .object({
    capabilityId: z.string().min(1),
    args: z.unknown(),
    idempotencyExtra: z.string().min(1).optional(),
  })
  .strict();

export type ToolCall = z.infer<typeof ToolCall>;

/** The context an invocation runs in (pack 03 §3). */
export const InvocationContext = z
  .object({
    taskId: z.string().min(1),
    nodeId: NodeId,
    attempt: z.number().int().nonnegative(),
    runId: z.string().min(1),
    actor: Actor,
    workflow: z.string().min(1),
    stage: z.string().min(1),
    autonomy: Autonomy,
    tier: Tier.optional(),
  })
  .strict();

export type InvocationContext = z.infer<typeof InvocationContext>;

/** The result of a tool call (pack 03 §3). */
export const ToolResult = z
  .object({
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z
      .object({
        class: FailureClass,
        message: z.string().min(1),
      })
      .strict()
      .optional(),
    /** Whether the result may be trusted as a fact. */
    trust: z.enum(['trusted', 'untrusted']),
    invocationId: z.string().min(1),
    /** True when the result came from the idempotency cache. */
    replayed: z.boolean(),
  })
  .strict();

export type ToolResult = z.infer<typeof ToolResult>;

/** A resolved credential — never the secret material itself. */
export interface ResolvedCredential {
  readonly credId: string;
  readonly provider: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly expiresAt: string;
  /** The material, held only for the duration of one invocation. */
  readonly secret: string;
}

/**
 * The tool broker (pack 03 §3).
 *
 * The broker is the **only** path to a capability. Every method on
 * `ScmAdapter` is "reached ONLY via ToolBroker capabilities" (pack 03 §3).
 */
export interface ToolBroker {
  invoke(call: ToolCall, ctx: InvocationContext): Promise<ToolResult>;
}

/** The tool adapter (pack 03 §3). */
export interface ToolAdapter {
  describe(): ToolCapability[];
  invoke(
    capId: string,
    args: unknown,
    cred?: ResolvedCredential,
    signal?: AbortSignal,
  ): Promise<unknown>;
  health(): Promise<'healthy' | 'degraded' | 'unavailable' | 'unknown'>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// credentials
// ---------------------------------------------------------------------------

/** The credential scope a mint requests (pack 03 §3). */
export const CredentialScope = z
  .object({
    provider: z.literal('github'),
    repositories: z.array(z.string().min(1)),
    permissions: z.record(z.enum(['read', 'write'])),
    ttlSeconds: z.number().int().positive(),
  })
  .strict();

export type CredentialScope = z.infer<typeof CredentialScope>;

/**
 * The credential broker (pack 03 §3).
 *
 * `resolve` is INTERNAL: "callable only from broker step 7".
 */
export interface CredentialBroker {
  mint(
    taskId: string,
    scope: CredentialScope,
  ): Promise<{ credId: string; expiresAt: string }>;
  resolve(credId: string): ResolvedCredential;
  revokeAll(taskId: string): Promise<void>;
}

/**
 * The secret store (pack 03 §3).
 *
 * "loaded once at start; never logged".
 */
export interface SecretStore {
  get(name: string): string;
  has(name: string): boolean;
}

// ---------------------------------------------------------------------------
// model gateway
// ---------------------------------------------------------------------------

/** A message in a model request. */
export const Msg = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    /** Set on a `tool` message: the call this message answers. */
    toolCallId: z.string().min(1).optional(),
  })
  .strict();

export type Msg = z.infer<typeof Msg>;

/** A system block in a model request. */
export const SystemBlock = z
  .object({
    id: z.string().min(1),
    body: z.string(),
    sha256: Sha256.optional(),
  })
  .strict();

export type SystemBlock = z.infer<typeof SystemBlock>;

/** A tool the model may call. */
export const ToolSpec = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.unknown(),
  })
  .strict();

export type ToolSpec = z.infer<typeof ToolSpec>;

/** A tool call the model requested. */
export const ToolUse = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
  })
  .strict();

export type ToolUse = z.infer<typeof ToolUse>;

/** Token usage (pack 03 §3). */
export const Usage = z
  .object({
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
    costUsdMicros: UsdMicros,
  })
  .strict();

export type Usage = z.infer<typeof Usage>;

/** A model request (pack 03 §3). */
export const ModelRequest = z
  .object({
    role: z.string().min(1),
    taskId: z.string().min(1),
    nodeId: NodeId,
    attempt: z.number().int().nonnegative(),
    messages: z.array(Msg),
    system: z.array(SystemBlock).optional(),
    tools: z.array(ToolSpec).optional(),
    responseFormat: z
      .object({
        kind: z.literal('json-schema'),
        schema: z.unknown(),
        name: z.string().min(1),
      })
      .strict()
      .optional(),
    routingHints: z
      .object({
        complexity: z.enum(['low', 'medium', 'high']).optional(),
      })
      .strict()
      .optional(),
    budget: z
      .object({
        maxUsdMicros: UsdMicros.optional(),
        maxTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    cachePolicy: z.enum(['prefix', 'none']).optional(),
  })
  .strict();

export type ModelRequest = z.infer<typeof ModelRequest>;

/** A model response (pack 03 §3). */
export const ModelResponse = z
  .object({
    content: z.string(),
    json: z.unknown().optional(),
    toolCalls: z.array(ToolUse).optional(),
    usage: Usage,
    model: z.string().min(1),
    provider: z.string().min(1),
    routingDecision: z
      .object({
        rule: z.string().min(1),
        fallbackUsed: z.boolean(),
      })
      .strict(),
    cached: z.boolean(),
  })
  .strict();

export type ModelResponse = z.infer<typeof ModelResponse>;

/** The model gateway (pack 03 §3). */
export interface ModelGateway {
  complete(req: ModelRequest): Promise<
    { readonly ok: true; readonly value: ModelResponse } | { readonly ok: false; readonly error: unknown }
  >;
}

/** A provider request — the adapter's own wire shape. */
export interface ProviderRequest {
  readonly model: string;
  readonly messages: readonly Msg[];
  readonly system?: readonly SystemBlock[];
  readonly tools?: readonly ToolSpec[];
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

/** A provider response — the adapter's own wire shape. */
export interface ProviderResponse {
  readonly content: string;
  readonly json?: unknown;
  readonly toolCalls?: readonly ToolUse[];
  readonly usage: Usage;
  readonly model: string;
}

/** A provider adapter (pack 03 §3). */
export interface ProviderAdapter {
  readonly id: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
  models(): Promise<string[]>;
  health(): Promise<'healthy' | 'degraded' | 'unavailable'>;
  estimateCostMicros(req: ProviderRequest): number;
}

// ---------------------------------------------------------------------------
// scheduling / orchestration
// ---------------------------------------------------------------------------

/** A job the scheduler can run (pack 03 §3). */
export const NewJob = z
  .object({
    taskId: z.string().min(1),
    nodeId: NodeId.optional(),
    kind: z.string().min(1),
    priority: z.number().int().optional(),
    availableAt: z.string().optional(),
    maxAttempts: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(1),
    payload: z.unknown().optional(),
  })
  .strict();

export type NewJob = z.infer<typeof NewJob>;

/** A claimed job (pack 03 §3). */
export interface Job {
  readonly id: number;
  readonly taskId: string;
  readonly nodeId?: string;
  readonly kind: string;
  readonly attempt: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
}

/** The scheduler (pack 03 §3). */
export interface Scheduler {
  enqueue(job: NewJob): Promise<void>;
  claim(owner: string, leaseSeconds: number): Promise<Job | null>;
  heartbeat(jobId: number, owner: string): Promise<boolean>;
  complete(jobId: number, owner: string): Promise<void>;
  reap(): Promise<number>;
}

/** A reference to an artefact (pack 03 §3, `ArtefactRef`). */
export const ArtefactRef = z
  .object({
    kind: z.string().min(1),
    uri: z.string().min(1),
    sha256: Sha256.optional(),
    bytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ArtefactRef = z.infer<typeof ArtefactRef>;

/** The effective grant a stage runs under. */
export const EffectiveGrant = z
  .object({
    capabilities: z.array(z.string().min(1)),
    scopes: z.array(Scope),
    resourceScope: z
      .object({
        repo: z.string().optional(),
        paths: z
          .object({
            writeGlobs: z.array(z.string()).default([]),
            denyGlobs: z.array(z.string()).default([]),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type EffectiveGrant = z.infer<typeof EffectiveGrant>;

/** The stage input (pack 03 §3). */
export const StageInput = z
  .object({
    taskId: z.string().min(1),
    nodeId: NodeId,
    attempt: z.number().int().nonnegative(),
    runId: z.string().min(1),
    spec: z.unknown(),
    context: ContextEnvelope,
    grant: EffectiveGrant,
    budget: z
      .object({
        maxUsdMicros: UsdMicros,
        maxTurns: z.number().int().nonnegative().optional(),
        wallClockSeconds: z.number().int().positive(),
      })
      .strict(),
    upstream: ArtefactRef.optional(),
    modelPolicy: z.string().min(1),
  })
  .strict();

export type StageInput = z.infer<typeof StageInput>;

/**
 * The stage output (pack 03 §3).
 *
 * ```ts
 * export interface StageOutput { status: 'success'|'failure'|'incomplete'; artefacts: ArtefactRef[]; verification?: unknown;
 *   failure?: { class: FailureClass; reason: string; retriable: boolean }; nextState?: string; confidence?: never }
 * ```
 *
 * `confidence?: never` is **deliberate and non-negotiable** (checklist 02
 * T-1.01: "`StageOutput` has `confidence?: never` — **no confidence-gated
 * merging exists** (the panel must not carry a confidence field; `07` §10)";
 * trap 5: "Adding a confidence field to `StageOutput`. `confidence?: never` is
 * deliberate — confidence-gated merging without calibration is on the
 * must-not-build list"). The pack's own inline annotation reads
 * "no confidence-gated merging" — reproduced here as prose because a nested
 * block comment would close this doc comment early.
 *
 * In Zod, `z.never()` is the way to make a field *unpresentable* — it is
 * stricter than `z.undefined()`, which would still accept `confidence: null`
 * in some shapes. A `.strict()` object with a `never` member rejects the key
 * whether it is present with any value or absent.
 */
export const StageOutput = z
  .object({
    status: z.enum(['success', 'failure', 'incomplete']),
    artefacts: z.array(ArtefactRef),
    verification: z.unknown().optional(),
    failure: z
      .object({
        class: FailureClass,
        reason: z.string().min(1),
        retriable: z.boolean(),
      })
      .strict()
      .optional(),
    nextState: z.string().min(1).optional(),
    /** The `never` type means the field may not be present at all. */
    confidence: z.never().optional(),
  })
  .strict();

export type StageOutput = z.infer<typeof StageOutput>;

/** The dependencies a stage executor is given. */
export interface StageDeps {
  readonly gateway?: ModelGateway;
  readonly broker?: ToolBroker;
  readonly logger?: (message: string) => void;
}

/** The stage executor (pack 03 §3). */
export interface StageExecutor {
  readonly kind: 'deterministic' | 'completion' | 'harness' | 'human';
  readonly stageKind: StageKind;
  run(input: StageInput, deps: StageDeps): Promise<StageOutput>;
}

// ---------------------------------------------------------------------------
// isolation / harness
// ---------------------------------------------------------------------------

/** The isolation tier (pack 03 §3, `IsolationProvider.tier`). */
export const IsolationTier = z.enum(['T1', 'T2']);

export type IsolationTier = z.infer<typeof IsolationTier>;

/** The specification an environment is provisioned from. */
export const EnvSpec = z
  .object({
    tier: IsolationTier,
    image: z.string().min(1),
    network: z
      .object({
        egress: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .optional(),
    resources: z
      .object({
        cpus: z.number().int().positive().optional(),
        memoryMb: z.number().int().positive().optional(),
        pids: z.number().int().positive().optional(),
        wallClockSeconds: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    env: z.record(z.string()).optional(),
  })
  .strict();

export type EnvSpec = z.infer<typeof EnvSpec>;

/** The result of running a command inside an environment. */
export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

/** A provisioned environment (pack 03 §3). */
export interface Environment {
  readonly id: string;
  readonly workdir: string;
  exec(
    argv: string[],
    opts: { timeoutMs: number; env?: Record<string, string>; stdin?: Uint8Array },
  ): Promise<ExecResult>;
  copyOut(paths: string[]): Promise<Map<string, Uint8Array>>;
  copyIn(files: Map<string, Uint8Array>, opts?: { readOnly?: boolean }): Promise<void>;
  /** Idempotent; ALWAYS called in a `finally`. */
  destroy(): Promise<void>;
}

/** The isolation provider (pack 03 §3). */
export interface IsolationProvider {
  readonly tier: IsolationTier;
  provision(spec: EnvSpec): Promise<Environment>;
}

/** A harness event, streamed from an agent harness. */
export interface HarnessEvent {
  readonly kind: 'message' | 'tool_use' | 'tool_result' | 'usage' | 'error';
  readonly payload: unknown;
}

/** The result of a harness run. */
export const HarnessResult = z
  .object({
    status: z.enum(['success', 'failure', 'incomplete']),
    content: z.string().default(''),
    toolCalls: z.array(ToolUse).default([]),
    usage: Usage.optional(),
    failure: z
      .object({
        class: FailureClass,
        reason: z.string().min(1),
        retriable: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type HarnessResult = z.infer<typeof HarnessResult>;

/** The harness adapter (pack 03 §3). */
export interface HarnessAdapter {
  readonly id: string;
  run(req: {
    env: Environment;
    prompt: string;
    model: string;
    limits: { maxTurns: number; wallClockSeconds: number; maxUsdMicros: number };
    allowedTools: string[];
    gatewayToken: string;
  }): AsyncIterable<HarnessEvent> & { readonly result: Promise<HarnessResult> };
}

// ---------------------------------------------------------------------------
// verification / review / approval / merge
// ---------------------------------------------------------------------------

/** A request to construct an acceptance oracle. */
export const OracleRequest = z
  .object({
    taskId: z.string().min(1),
    route: z.enum(['human', 'generated', 'agent']),
    spec: z.unknown(),
    implementationRunId: z.string().min(1).nullable().default(null),
  })
  .strict();

export type OracleRequest = z.infer<typeof OracleRequest>;

/** A constructed oracle (pack 03 §3). */
export const Oracle = z
  .object({
    oracleId: z.string().min(1),
    taskId: z.string().min(1),
    route: z.enum(['human', 'generated', 'agent']),
    manifestSha256: Sha256,
    implementationRunId: z.string().min(1).nullable(),
    objectUri: z.string().min(1),
  })
  .strict();

export type Oracle = z.infer<typeof Oracle>;

/** The admission report of an oracle (pack 03 §3, `Admission`). */
export const Admission = z
  .object({
    oracleId: z.string().min(1),
    beforeReportSha256: Sha256,
    perCheck: z.array(
      z
        .object({
          id: z.string().min(1),
          expected: z.string().min(1),
          observed: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type Admission = z.infer<typeof Admission>;

/** The oracle service (pack 03 §3). */
export interface OracleService {
  construct(req: OracleRequest): Promise<Oracle>;
  admit(
    oracleId: string,
  ): Promise<
    { readonly ok: true; readonly value: Admission } | { readonly ok: false; readonly error: 'oracle.admissionFailed' }
  >;
}

/** The gate report produced by the verification runtime. */
export const GateReport = z
  .object({
    gateReportId: z.string().min(1),
    taskId: z.string().min(1),
    headSha: z.string().min(1),
    tier: Tier,
    passed: z.boolean(),
    report: z.unknown(),
    reportSha256: Sha256,
  })
  .strict();

export type GateReport = z.infer<typeof GateReport>;

/** The verification runtime (pack 03 §3). */
export interface VerificationRuntime {
  run(req: {
    taskId: string;
    baseSha: string;
    patch: Uint8Array;
    oracleId: string;
    tier: Tier;
  }): Promise<GateReport>;
}

/** A summary of a diff, scored against the criticality map. */
export const DiffSummary = z
  .object({
    files: z.array(
      z
        .object({
          path: z.string().min(1),
          added: z.number().int().nonnegative().default(0),
          removed: z.number().int().nonnegative().default(0),
        })
        .strict(),
    ),
  })
  .strict();

export type DiffSummary = z.infer<typeof DiffSummary>;

/** The tier score of a diff. */
export const TierScore = z
  .object({
    tier: Tier,
    reasons: z.array(z.string().min(1)),
    score: z.number(),
  })
  .strict();

export type TierScore = z.infer<typeof TierScore>;

/** The blast-radius scorer (pack 03 §3) — PURE. */
export interface BlastRadiusScorer {
  score(
    diff: DiffSummary,
    map: unknown,
    repo: unknown,
    history: unknown,
  ): TierScore;
}

/** One reviewer's output. */
export const ReviewOutput = z
  .object({
    reviewerId: z.string().min(1),
    role: z.string().min(1),
    outcome: z.enum(['approve', 'reject', 'comment']),
    rationale: z.string().default(''),
    blocking: z.boolean().default(false),
  })
  .strict();

export type ReviewOutput = z.infer<typeof ReviewOutput>;

/** The panel's aggregation policy. */
export const PanelPolicy = z
  .object({
    requireUnanimousApproval: z.boolean().default(false),
    securityReviewerRequiredAtTier: Tier.optional(),
  })
  .strict();

export type PanelPolicy = z.infer<typeof PanelPolicy>;

/**
 * The panel result.
 *
 * **There is no `confidence` field.** checklist 02 T-1.01: "`StageOutput` has
 * `confidence?: never` — **no confidence-gated merging exists** (the panel
 * must not carry a confidence field; `07` §10)." The `.strict()` object makes
 * an added `confidence` member a validation failure rather than a silent
 * extra.
 */
export const PanelResult = z
  .object({
    outcome: z.enum(['approve', 'reject', 'escalate']),
    reasons: z.array(z.string().min(1)),
    blockingReviewers: z.array(z.string().min(1)),
  })
  .strict();

export type PanelResult = z.infer<typeof PanelResult>;

/** The panel aggregator (pack 03 §3) — PURE, no confidence. */
export interface PanelAggregator {
  aggregate(reviews: ReviewOutput[], gates: GateReport, policy: PanelPolicy): PanelResult;
}

/** The approval types (pack 03 §2, `approvals.type` CHECK constraint). */
export const ApprovalType = z.enum(['plan', 'merge', 'definition', 'temporary-grant']);

export type ApprovalType = z.infer<typeof ApprovalType>;

/** An approval (pack 03 §3). */
export const Approval = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    type: ApprovalType,
    artefactKind: z.string().min(1),
    artefactRef: z.string().min(1),
    artefactSha256: Sha256,
    approvers: z.array(z.string().min(1)),
    status: z.enum([
      'requested',
      'granted',
      'refused',
      'expired',
      'revoked',
      'consumed',
      'void',
    ]),
    requestedAt: z.string().min(1),
    expiresAt: z.string().min(1),
    decidedBy: z.string().min(1).optional(),
    securityScopeAck: z.boolean().default(false),
  })
  .strict();

export type Approval = z.infer<typeof Approval>;

/** The approval service (pack 03 §3). */
export interface ApprovalService {
  request(a: {
    taskId: string;
    type: ApprovalType;
    artefact: { kind: string; ref: string; value: unknown };
    approvers: string[];
    ttlSeconds: number;
  }): Promise<Approval>;
  decide(
    id: string,
    d: {
      decision: 'grant' | 'refuse';
      identity: string;
      comment?: string;
      securityScopeAck?: boolean;
    },
  ): Promise<
    | { readonly ok: true; readonly value: Approval }
    | {
        readonly ok: false;
        readonly error: 'NotApprover' | 'Expired' | 'HashMismatch' | 'Consumed' | 'CoolOff';
      }
  >;
  isValid(id: string, currentArtefact: unknown, now: Date): boolean;
  consume(id: string): Promise<void>;
  revoke(id: string, by: string): Promise<void>;
}

/** The merge gate (pack 03 §3). */
export interface MergeGate {
  evaluate(changeId: string): Promise<{ ready: boolean; blockers: string[]; headSha: string }>;
  publish(changeId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// SCM
// ---------------------------------------------------------------------------

/** A verified webhook event. */
export const WebhookEvent = z
  .object({
    deliveryId: z.string().min(1),
    event: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

export type WebhookEvent = z.infer<typeof WebhookEvent>;

/** Untrusted content — raw text from outside the trust boundary. */
export interface UntrustedContent {
  readonly text: string;
  readonly trust: 'untrusted-content';
  readonly sourceRef: string;
}

/** The arguments for opening a pull request. */
export interface OpenPrArgs {
  readonly repo: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly title: string;
  readonly body: string;
}

/**
 * The SCM adapter (pack 03 §3).
 *
 * "every method is reached ONLY via ToolBroker capabilities".
 */
export interface ScmAdapter {
  verifyWebhook(
    headers: Record<string, string>,
    rawBody: Uint8Array,
  ): { readonly ok: true; readonly value: WebhookEvent } | { readonly ok: false; readonly error: 'bad_signature' | 'replay' };
  getIssue(repo: string, n: number): Promise<UntrustedContent>;
  permissionOf(repo: string, login: string): Promise<'admin' | 'write' | 'read' | 'none'>;
  pushBranch(repo: string, branch: string, bareDir: string): Promise<void>;
  openPr(a: OpenPrArgs): Promise<{ number: number; url: string }>;
  publishCheck(a: {
    repo: string;
    headSha: string;
    name: string;
    conclusion: 'success' | 'failure' | 'neutral';
    summary: string;
    detailsUrl?: string;
  }): Promise<void>;
  comment(repo: string, n: number, body: string): Promise<void>;
}

/**
 * The capability descriptor (pack 03 §4.4, `ToolCapability`).
 *
 * Declared here because `ToolAdapter.describe()` returns them.
 */
export const ToolCapability = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    owner: z.string().min(1),
    kind: z.enum(['read', 'mutation', 'compute', 'communicate']),
    transport: z.enum(['inproc', 'http', 'cli', 'mcp', 'library']),
    effect: z
      .object({
        class: EffectClass,
        reversible: z.boolean(),
        undo: z.string().min(1).optional(),
        external: z.boolean(),
      })
      .strict(),
    scope: z
      .object({
        required: z.array(z.string().min(1)),
        resourcePattern: z.string().min(1),
        environment: z.string().min(1),
      })
      .strict(),
    credentials: z
      .object({
        provider: z.string().min(1),
        permissions: z.record(z.enum(['read', 'write'])),
        ttlSeconds: z.number().int().positive(),
      })
      .strict(),
    inputSchema: z.unknown().optional(),
    outputSchema: z.unknown().optional(),
    trust: z
      .object({
        inputTrust: z.enum(['trusted', 'untrusted']),
        resultTrust: z.enum(['trusted', 'untrusted']),
      })
      .strict(),
    health: z
      .object({
        check: z.string().min(1),
        timeoutMs: z.number().int().positive(),
        degraded: z.string().min(1),
      })
      .strict(),
    observability: z
      .object({
        redactArguments: z.array(z.string()),
      })
      .strict(),
    cost: z
      .object({
        unit: z.string().min(1),
        usdMicros: UsdMicros,
      })
      .strict(),
  })
  .strict();

export type ToolCapability = z.infer<typeof ToolCapability>;
