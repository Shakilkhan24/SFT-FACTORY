/**
 * The schema registry — the single list of every contract this package
 * exports, and the source of the `/schemas` JSON Schema export.
 *
 * checklist 02 T-1.01: "`packages/contracts` — Zod schemas for every item in
 * `03` §3–§7. Export JSON Schema to `/schemas`."
 *
 * The registry is deliberately **explicit** rather than derived: a contract
 * that is not listed here is not exported, and the contract test asserts
 * that every item the checklist names is present. A derived list would let
 * a schema disappear by accident.
 */

import type { z } from 'zod';

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
} from './definitions.js';
import { ContextEnvelope, ContextItem, StageSpec, TaskInputs, RepoScope } from './context.js';
import {
  Cost,
  EventEnvelope,
  EventQuery,
  NewEvent,
  StageCompletedPayload,
  StageFailedPayload,
  ToolInvocationPayload,
  PolicyDeniedPayload,
} from './event-log.js';
import {
  Decision,
  PolicyBundle,
  PolicyInput,
  PolicyResource,
  PriorDenial,
  RequiredApproval,
} from './policy.js';
import {
  Approval,
  ApprovalType,
  ArtefactRef,
  EffectiveGrant,
  HarnessResult,
  InvocationContext,
  ModelRequest,
  ModelResponse,
  Msg,
  NewJob,
  Oracle,
  OracleRequest,
  Admission,
  GateReport,
  DiffSummary,
  TierScore,
  ReviewOutput,
  PanelPolicy,
  PanelResult,
  StageInput,
  StageOutput,
  ToolCall,
  ToolCapability,
  ToolResult,
  Usage,
  WebhookEvent,
  EnvSpec,
} from './services.js';
import {
  NodeState,
  TaskState,
  TaskSnapshot,
  TransitionCommand,
  TASK_STATES,
  NODE_STATES,
  TERMINAL,
} from './state.js';
import {
  Actor,
  Authority,
  Autonomy,
  EffectClass,
  EventId,
  FailureClass,
  GitSha,
  IsoInstant,
  NodeId,
  PrefixedUlid,
  Scope,
  Sha256,
  Tier,
  ULID,
  UsdMicros,
} from './shared.js';

/**
 * One exported contract: a name, the schema, and the pack section it comes
 * from.
 */
export interface ContractEntry {
  /** The file name under `/schemas`, without the extension. */
  readonly name: string;
  /** The schema. */
  readonly schema: z.ZodTypeAny;
  /** Where the contract is specified, for the generated index. */
  readonly source: string;
}

/**
 * Every exported contract.
 *
 * The `source` column is the traceability record: every schema points at the
 * pack section that defines it, so a reviewer can check the code against the
 * blueprint without hunting.
 */
export const CONTRACTS: readonly ContractEntry[] = [
  // ---- shared (pack 03 §3) ----
  { name: 'shared.actor', schema: Actor, source: '03 §3 shared' },
  { name: 'shared.authority', schema: Authority, source: '03 §3 shared' },
  { name: 'shared.sha256', schema: Sha256, source: '03 §3 shared' },
  { name: 'shared.usd-micros', schema: UsdMicros, source: '03 §3 shared' },
  { name: 'shared.effect-class', schema: EffectClass, source: '03 §3 shared, §7' },
  { name: 'shared.tier', schema: Tier, source: '03 §3 shared, §7' },
  { name: 'shared.autonomy', schema: Autonomy, source: '03 §3 shared, §7' },
  { name: 'shared.failure-class', schema: FailureClass, source: '03 §3 shared, §7' },
  { name: 'shared.iso-instant', schema: IsoInstant, source: '03 §1 Time' },
  { name: 'shared.preferred-ulid', schema: PrefixedUlid, source: '03 §1 IDs' },
  { name: 'shared.ulid', schema: ULID, source: '03 §1 IDs' },
  { name: 'shared.node-id', schema: NodeId, source: '03 §1 IDs' },
  { name: 'shared.event-id', schema: EventId, source: '03 §1 IDs' },
  { name: 'shared.git-sha', schema: GitSha, source: '03 §1 Hashes' },
  { name: 'shared.scope', schema: Scope, source: '03 §7 scope vocabulary' },

  // ---- event log (pack 03 §3, §5) ----
  { name: 'events.envelope', schema: EventEnvelope, source: '03 §3 event log' },
  { name: 'events.new-event', schema: NewEvent, source: '03 §3 event log' },
  { name: 'events.query', schema: EventQuery, source: '03 §3 event log' },
  { name: 'events.cost', schema: Cost, source: '09 §4.1' },
  { name: 'events.payload.tool-invoked', schema: ToolInvocationPayload, source: '03 §5' },
  { name: 'events.payload.stage-completed', schema: StageCompletedPayload, source: '03 §5, 09 §4.4' },
  { name: 'events.payload.stage-failed', schema: StageFailedPayload, source: '03 §5' },
  { name: 'events.payload.policy-denied', schema: PolicyDeniedPayload, source: '03 §5, 09 §4.4' },

  // ---- state (pack 03 §3, §6) ----
  { name: 'state.task-state', schema: TaskState, source: '03 §6' },
  { name: 'state.node-state', schema: NodeState, source: '03 §6' },
  { name: 'state.transition-command', schema: TransitionCommand, source: '03 §3 state' },
  { name: 'state.task-snapshot', schema: TaskSnapshot, source: '03 §3 state' },

  // ---- policy (pack 03 §3, §4.7) ----
  { name: 'policy.input', schema: PolicyInput, source: '03 §3 policy' },
  { name: 'policy.decision', schema: Decision, source: '03 §3 policy' },
  { name: 'policy.resource', schema: PolicyResource, source: '03 §3 policy' },
  { name: 'policy.prior-denial', schema: PriorDenial, source: '03 §3 policy (AT-14)' },
  { name: 'policy.required-approval', schema: RequiredApproval, source: '03 §3 policy' },
  { name: 'policy.bundle', schema: PolicyBundle, source: '03 §4.7' },

  // ---- tools (pack 03 §3) ----
  { name: 'tools.call', schema: ToolCall, source: '03 §3 tools' },
  { name: 'tools.invocation-context', schema: InvocationContext, source: '03 §3 tools' },
  { name: 'tools.result', schema: ToolResult, source: '03 §3 tools' },
  { name: 'tools.capability', schema: ToolCapability, source: '03 §4.4' },

  // ---- gateway (pack 03 §3) ----
  { name: 'gateway.request', schema: ModelRequest, source: '03 §3 model gateway' },
  { name: 'gateway.response', schema: ModelResponse, source: '03 §3 model gateway' },
  { name: 'gateway.message', schema: Msg, source: '03 §3 model gateway' },
  { name: 'gateway.usage', schema: Usage, source: '03 §3 model gateway' },

  // ---- scheduling (pack 03 §3) ----
  { name: 'scheduler.job', schema: NewJob, source: '03 §3 scheduling' },
  { name: 'scheduler.stage-input', schema: StageInput, source: '03 §3 scheduling' },
  { name: 'scheduler.stage-output', schema: StageOutput, source: '03 §3 scheduling' },
  { name: 'scheduler.effective-grant', schema: EffectiveGrant, source: '03 §3 scheduling' },
  { name: 'scheduler.artefact-ref', schema: ArtefactRef, source: '03 §3 scheduling' },

  // ---- context (pack 03 §3) ----
  { name: 'context.envelope', schema: ContextEnvelope, source: '03 §3 context' },
  { name: 'context.item', schema: ContextItem, source: '03 §3 context' },
  { name: 'context.stage-spec', schema: StageSpec, source: '03 §3 context' },
  { name: 'context.task-inputs', schema: TaskInputs, source: '03 §3 context' },
  { name: 'context.repo-scope', schema: RepoScope, source: '03 §3 context' },

  // ---- isolation / harness (pack 03 §3) ----
  { name: 'isolation.env-spec', schema: EnvSpec, source: '03 §3 isolation' },
  { name: 'harness.result', schema: HarnessResult, source: '03 §3 harness' },

  // ---- verification / review / approval / merge (pack 03 §3) ----
  { name: 'oracle.request', schema: OracleRequest, source: '03 §3 verification' },
  { name: 'oracle.oracle', schema: Oracle, source: '03 §3 verification' },
  { name: 'oracle.admission', schema: Admission, source: '03 §3 verification' },
  { name: 'verify.gate-report', schema: GateReport, source: '03 §3 verification' },
  { name: 'review.diff-summary', schema: DiffSummary, source: '03 §3 review' },
  { name: 'review.tier-score', schema: TierScore, source: '03 §3 review' },
  { name: 'review.output', schema: ReviewOutput, source: '03 §3 review' },
  { name: 'review.panel-policy', schema: PanelPolicy, source: '03 §3 review' },
  { name: 'review.panel-result', schema: PanelResult, source: '03 §3 review' },
  { name: 'approvals.approval', schema: Approval, source: '03 §3 approval' },
  { name: 'approvals.type', schema: ApprovalType, source: '03 §2 approvals' },

  // ---- SCM (pack 03 §3) ----
  { name: 'scm.webhook-event', schema: WebhookEvent, source: '03 §3 SCM' },

  // ---- definition documents (pack 03 §4) ----
  { name: 'definition.factory', schema: FactoryDefinition, source: '03 §4.1' },
  { name: 'definition.workflow', schema: WorkflowDefinition, source: '03 §4.2' },
  { name: 'definition.role', schema: RoleSpec, source: '03 §4.3' },
  { name: 'definition.tool-capability', schema: ToolCapabilityDefinition, source: '03 §4.4' },
  { name: 'definition.capability-grant', schema: CapabilityGrant, source: '03 §4.5' },
  { name: 'definition.workflow-environment', schema: WorkflowEnvironment, source: '03 §4.5' },
  { name: 'definition.routing-policy', schema: RoutingPolicy, source: '03 §4.6' },
  { name: 'definition.policy-bundle', schema: PolicyBundle, source: '03 §4.7' },
  { name: 'definition.criticality-map', schema: CriticalityMap, source: '03 §4.8' },
  { name: 'definition.repo-onboarding', schema: RepoOnboarding, source: '03 §4.9' },
  { name: 'definition.acceptance-oracle', schema: AcceptanceOracle, source: '03 §4.10' },
  { name: 'definition.task-graph', schema: TaskGraph, source: '03 §4.11' },
] as const;

/**
 * The state tables, exported as data rather than schemas (pack 03 §6).
 *
 * These are not documents — they are the machine-readable tables the state
 * machine (T-1.04) reads.
 */
export const STATE_TABLES = {
  TASK_STATES,
  TERMINAL,
  NODE_STATES,
} as const;
