/**
 * Kysely types for the `factory` schema.
 *
 * checklist 02 T-1.02: "Kysely types." The tables, columns and types here are
 * the ones in pack `03` §2 — the same DDL that `migrations/0001_core.sql`
 * applies verbatim. The types are *derived from the DDL by hand* once, so that
 * a query that names a column the DDL does not have fails at compile time
 * rather than at runtime.
 *
 * The DDL is the contract (pack 03 §2: "Core DDL below is normative — column
 * names/types/constraints"). When a later ticket adds a table, it adds a
 * migration AND its type here, in the same change.
 *
 * Column names are `snake_case` in SQL; the DDL mixes `snake_case` and
 * `camelCase` on purpose (`prev_hash`, `hash`, `occurred_at`,
 * `aggregate_version`). Both are typed as they are in the DDL — this file does
 * not normalise them, because normalising them would hide a mismatch with the
 * shipped DDL.
 */

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * `timestamptz` → a JS `Date`.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/**
 * `bytea` → a `Buffer`.
 */
type Bytes = ColumnType<Buffer, Buffer | Uint8Array | undefined, Buffer | Uint8Array>;

/**
 * `jsonb` → an unknown-shaped JSON value. The DDL does not constrain the
 * shape; the *contracts* do (pack 03 §3), and the packages that read these
 * columns parse them through the contract schemas.
 */
type Json = ColumnType<unknown, unknown, unknown>;

/**
 * `text[]` → a string array.
 */
type TextArray = ColumnType<string[], string[], string[]>;

export interface EventCounterTable {
  /** Always 1 — the single-row counter (ADR-0019). */
  id: number;
  /** The last assigned `seq`. Gapless: a rollback does not consume a value. */
  value: ColumnType<number, number | undefined, number>;
}

export interface EventsTable {
  /** Gapless, assigned under the counter row lock (ADR-0019). */
  seq: ColumnType<number, number, never>;
  /** UUIDv7. */
  event_id: string;
  occurred_at: ColumnType<Date, Date | string | undefined, Date | string>;
  event_type: string;
  schema_version: Generated<number>;
  aggregate_kind: 'task' | 'node' | 'approval' | 'definition' | 'run' | 'change' | 'system';
  aggregate_id: string;
  /** Version AFTER this event if it changed state, else the current version. */
  aggregate_version: number;
  correlation_id: string;
  causation_id: string | null;
  actor_kind: 'human' | 'agent' | 'system' | 'integration';
  actor_id: string;
  /** `{basis, approvalId?, policyDecisionId?, autonomyLevel?, violation?}`. */
  authority: Json;
  /** `{repo?, taskId?, nodeId?, changeId?, runId?}`. */
  subject: Generated<Json>;
  payload: Json;
  /** `{runId?, envelopeSha256?, definitionSha}`. */
  context: Generated<Json>;
  /** `{applied: [...]}`. */
  redaction: Generated<Json>;
  cost_usd_micros: number | null;
  duration_ms: number | null;
  /** The previous event hash in the same aggregate. */
  prev_hash: Bytes | null;
  /** `sha256(prev_hash ‖ canonicalJson(envelope w/o hash))`. */
  hash: Bytes;
}

export interface TasksTable {
  id: string;
  repo: string;
  workflow: string;
  state: string;
  version: Generated<number>;
  autonomy_level: number;
  risk_tier: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | null;
  /** `{kind, ref, authorLogin}`. */
  source: Json;
  spec: Json | null;
  spec_sha256: Bytes | null;
  graph: Json | null;
  graph_sha256: Bytes | null;
  oracle_id: string | null;
  definition_sha: string;
  correlation_id: string;
  budget_usd_micros: number;
  spent_usd_micros: Generated<number>;
  escalation: Json | null;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  terminal_at: Timestamp | null;
}

export interface NodesTable {
  task_id: string;
  node_id: string;
  kind: string;
  state: string;
  version: Generated<number>;
  attempt: Generated<number>;
  depends_on: Generated<TextArray>;
  spec: Json;
  result: Json | null;
}

export interface JobsTable {
  id: Generated<number>;
  task_id: string;
  node_id: string | null;
  kind: string;
  status: Generated<'ready' | 'leased' | 'done' | 'failed' | 'dead'>;
  priority: Generated<number>;
  available_at: Generated<Timestamp>;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  attempt: Generated<number>;
  max_attempts: Generated<number>;
  idempotency_key: string;
  payload: Generated<Json>;
  created_at: Generated<Timestamp>;
}

export interface ApprovalsTable {
  id: string;
  task_id: string;
  type: 'plan' | 'merge' | 'definition' | 'temporary-grant';
  artefact_kind: string;
  artefact_ref: string;
  artefact_sha256: Bytes;
  approvers: TextArray;
  status: 'requested' | 'granted' | 'refused' | 'expired' | 'revoked' | 'consumed' | 'void';
  requested_at: Generated<Timestamp>;
  expires_at: Timestamp;
  decided_at: Timestamp | null;
  decided_by: string | null;
  comment: string | null;
  review_minutes: number | null;
  security_scope_ack: Generated<boolean>;
  cool_off_until: Timestamp | null;
  consumed_at: Timestamp | null;
}

export interface RunsTable {
  run_id: string;
  task_id: string;
  node_id: string | null;
  attempt: number;
  role: string;
  stage_kind: string;
  executor_kind: 'deterministic' | 'completion' | 'harness' | 'human';
  route: Json | null;
  status: string;
  outcome: string | null;
  failure_class: string | null;
  started_at: Generated<Timestamp>;
  ended_at: Timestamp | null;
  record_uri: string | null;
  record_sha256: Bytes | null;
  context_envelope_id: string | null;
  cost_usd_micros: Generated<number>;
  tokens: Generated<Json>;
  retention_class: Generated<string>;
  retain_until: Generated<Date>;
}

export interface ToolInvocationsTable {
  id: string;
  run_id: string | null;
  task_id: string;
  node_id: string | null;
  attempt: number;
  capability_id: string;
  effect_class: 'E0' | 'E1' | 'E2' | 'E3' | 'E4';
  transport: string;
  args_sha256: Bytes;
  args_summary: Json | null;
  result_summary: Json | null;
  policy_decision_id: string | null;
  approval_id: string | null;
  status: string;
  idempotency_key: string;
  duration_ms: number | null;
  cost_usd_micros: number | null;
  started_at: Generated<Timestamp>;
}

export interface PolicyDecisionsTable {
  id: string;
  task_id: string | null;
  action: string;
  input_sha256: Bytes;
  outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'ESCALATE';
  rule_ids: TextArray;
  reason: string;
  bundle_sha256: Bytes;
  decided_at: Generated<Timestamp>;
}

export interface ModelCallsTable {
  id: string;
  run_id: string | null;
  task_id: string;
  provider: string;
  model: string;
  route_rule: string | null;
  prompt_sha256: Bytes | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  cost_usd_micros: number;
  latency_ms: number | null;
  status: string;
  cached: Generated<boolean>;
  via: Generated<'complete' | 'passthrough'>;
  idempotency_key: string;
  created_at: Generated<Timestamp>;
}

export interface ContextEnvelopesTable {
  id: string;
  task_id: string;
  run_id: string | null;
  stage: string;
  resolved_sha256: Bytes;
  items: Json;
  truncations: Generated<Json>;
  gaps: Generated<Json>;
  bytes: number;
  budget_bytes: number;
  object_uri: string | null;
}

export interface OraclesTable {
  id: string;
  task_id: string;
  route: 'human' | 'generated' | 'agent';
  /** `{author, runId|null, generator?, commitSha?, implementationRunId: null}`. */
  provenance: Json;
  manifest: Json;
  manifest_sha256: Bytes;
  object_uri: string;
  status: 'draft' | 'admitted' | 'rejected';
  admission_report: Json | null;
  admitted_at: Timestamp | null;
}

export interface ChangesTable {
  id: string;
  task_id: string;
  repo: string;
  pr_number: number | null;
  branch: string;
  base_sha: string;
  head_sha: string | null;
  status: string;
  merge_sha: string | null;
  merged_by: string | null;
  merged_at: Timestamp | null;
}

export interface GateReportsTable {
  id: string;
  task_id: string;
  change_id: string | null;
  head_sha: string;
  tier: string;
  report: Json;
  report_sha256: Bytes;
  passed: boolean;
  created_at: Generated<Timestamp>;
}

export interface DefinitionVersionsTable {
  sha: string;
  bundle_sha256: Bytes;
  bundle: Json;
  plan: Json | null;
  approval_id: string | null;
  applied_at: Generated<Timestamp>;
  applied_by: string;
  active: Generated<boolean>;
}

export interface CredentialLeasesTable {
  id: string;
  task_id: string;
  provider: string;
  scope: Json;
  minted_at: Generated<Timestamp>;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface EgressTokensTable {
  task_id: string;
  token_hash: Bytes;
  allow: Json;
  expires_at: Timestamp;
}

export interface GatewayTokensTable {
  task_id: string;
  token_hash: Bytes;
  model_allowlist: TextArray;
  max_tokens_cap: number;
  expires_at: Timestamp;
}

export interface EdgeOutboxTable {
  id: Generated<number>;
  kind: 'model_usage' | 'egress_denied' | 'egress_summary';
  task_id: string;
  payload: Json;
  created_at: Generated<Timestamp>;
  drained_at: Timestamp | null;
}

export interface KillSwitchTable {
  id: number;
  engaged: Generated<boolean>;
  engaged_by: string | null;
  engaged_at: Timestamp | null;
  reason: string | null;
}

export interface ProjectionCursorsTable {
  name: string;
  last_seq: Generated<number>;
}

/**
 * The `factory` schema, as Kysely sees it.
 */
export interface FactoryDatabase {
  event_counter: EventCounterTable;
  events: EventsTable;
  tasks: TasksTable;
  nodes: NodesTable;
  jobs: JobsTable;
  approvals: ApprovalsTable;
  runs: RunsTable;
  tool_invocations: ToolInvocationsTable;
  policy_decisions: PolicyDecisionsTable;
  model_calls: ModelCallsTable;
  context_envelopes: ContextEnvelopesTable;
  oracles: OraclesTable;
  changes: ChangesTable;
  gate_reports: GateReportsTable;
  definition_versions: DefinitionVersionsTable;
  credential_leases: CredentialLeasesTable;
  egress_tokens: EgressTokensTable;
  gateway_tokens: GatewayTokensTable;
  edge_outbox: EdgeOutboxTable;
  kill_switch: KillSwitchTable;
  projection_cursors: ProjectionCursorsTable;
}

export type SelectedEvents = Selectable<EventsTable>;
export type NewEvents = Insertable<EventsTable>;
export type UpdatedEvents = Updateable<EventsTable>;
export type SelectedTasks = Selectable<TasksTable>;
export type NewTasks = Insertable<TasksTable>;
export type UpdatedTasks = Updateable<TasksTable>;
export type SelectedPolicyDecisions = Selectable<PolicyDecisionsTable>;
export type NewPolicyDecisions = Insertable<PolicyDecisionsTable>;
export type SelectedEdgeOutbox = Selectable<EdgeOutboxTable>;
export type NewEdgeOutbox = Insertable<EdgeOutboxTable>;
export type SelectedDefinitionVersions = Selectable<DefinitionVersionsTable>;
export type NewDefinitionVersions = Insertable<DefinitionVersionsTable>;
