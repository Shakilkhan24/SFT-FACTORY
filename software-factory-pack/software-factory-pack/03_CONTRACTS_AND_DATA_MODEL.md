# 03 — Contracts and Data Model

> **Audience:** implementing agents. **This is the file you code against.** `packages/contracts` is generated from §3–§6 first (ticket T-1.01); everything else depends on it.
> Rules: Zod schemas are the source of truth → TS types + JSON Schema are derived. **Changing a contract = a contract-version bump + migration note + all contract tests updated.** Markers: `[BP]` blueprint · `[PACK]` pack addition · `[VERIFY]` re-check externally.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| IDs | Prefixed ULIDs, generated in the app: `tsk_`, `run_`, `apr_`, `chg_`, `orc_`, `gat_`, `crd_`, `cps_` (credential lease), `env_`. Node ids are slugs unique within a task (`n1-implement`). Event ids are UUIDv7. |
| Time | UTC, ISO-8601 in JSON, `timestamptz` in SQL. Time is **injected** (`Clock`) in pure packages. |
| Hashes | JSON: `"sha256:<64 hex>"`; SQL: `bytea`. All hashing is over **canonical JSON**: UTF-8, keys sorted recursively, no insignificant whitespace, numbers as JSON numbers, `NaN/Infinity` rejected (RFC 8785-style). One implementation in `core`, with published test vectors. |
| Money | **Integer micro-USD** (`usd_micros`). Never floats. |
| Versioning | Every YAML/JSON document carries `apiVersion: factory/v1` and `kind`. Unknown kinds/fields are **rejected** (`.strict()`). |
| Enums | String literal unions; exhaustive `switch` with `never` check. |
| Errors | `Result<T,E>` for expected failures; exceptions only for programmer errors. Every error maps to a failure class (§7). |
| Redaction | Applied *before* persistence; payloads record what was redacted (`redaction.applied[]`). |

---

## 2. PostgreSQL data model

SQL-first, forward-only migrations in `/migrations` (R4 path). Schema `factory`. Core DDL below is normative (column names/types/constraints); indexes beyond those shown may be added by tickets.

> **Validation status.** The DDL and the privilege script below were executed on PostgreSQL 16.15 and pass the 25 checks in `reference/validate_ddl.sh` (run `bash reference/validate_ddl.sh`): append-only for every role (privilege layer *and* trigger layer, including on the partitioned table), edge least-privilege, only the applier can write `definition_versions`, gapless `seq` under 20 concurrent writers, no gap after rollback, default-partition routing. Validating it caught three defects that are fixed here (missing `USAGE ON SCHEMA`, missing `SELECT` beside `UPDATE` on the counter row, missing sequence grants). **Not yet tested:** the projection/knowledge/calibration tables (DDL is written by their tickets), throughput at scale, and `pg_partman`-style retention.

```sql
-- 0001_core.sql
CREATE SCHEMA IF NOT EXISTS factory; SET search_path TO factory, public;

CREATE TABLE event_counter (id smallint PRIMARY KEY CHECK (id = 1), value bigint NOT NULL);
INSERT INTO event_counter VALUES (1, 0);

CREATE TABLE events (
  seq               bigint       NOT NULL,                 -- gapless, assigned under counter row lock (ADR-0019)
  event_id          uuid         NOT NULL,                 -- UUIDv7; global uniqueness by construction + audit query
  occurred_at       timestamptz  NOT NULL DEFAULT now(),
  event_type        text         NOT NULL,
  schema_version    smallint     NOT NULL DEFAULT 1,
  aggregate_kind    text         NOT NULL CHECK (aggregate_kind IN ('task','node','approval','definition','run','change','system')),
  aggregate_id      text         NOT NULL,
  aggregate_version integer      NOT NULL,                 -- version AFTER this event if it changed state, else current
  correlation_id    text         NOT NULL,
  causation_id      text,
  actor_kind        text         NOT NULL CHECK (actor_kind IN ('human','agent','system','integration')),
  actor_id          text         NOT NULL,
  authority         jsonb        NOT NULL,                 -- {basis, approvalId?, policyDecisionId?, autonomyLevel?, violation?}
  subject           jsonb        NOT NULL DEFAULT '{}',    -- {repo?, taskId?, nodeId?, changeId?, runId?}
  payload           jsonb        NOT NULL,
  context           jsonb        NOT NULL DEFAULT '{}',    -- {runId?, envelopeSha256?, definitionSha}
  redaction         jsonb        NOT NULL DEFAULT '{"applied":[]}',
  cost_usd_micros   bigint,
  duration_ms       integer,
  prev_hash         bytea,                                 -- previous event hash in the same aggregate
  hash              bytea        NOT NULL,                 -- sha256(prev_hash || canonicalJson(envelope w/o hash))
  PRIMARY KEY (seq, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE events_default PARTITION OF events DEFAULT;
CREATE INDEX events_agg_idx  ON events (aggregate_kind, aggregate_id, seq);
CREATE INDEX events_corr_idx ON events (correlation_id, seq);
CREATE INDEX events_type_idx ON events (event_type, seq);

CREATE FUNCTION ensure_event_partitions(months_ahead int DEFAULT 3) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m date; pname text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    pname := 'events_' || to_char(m, 'YYYY_MM');
    IF to_regclass('factory.' || pname) IS NULL THEN
      EXECUTE format('CREATE TABLE factory.%I PARTITION OF factory.events FOR VALUES FROM (%L) TO (%L)',
                     pname, m, (m + interval '1 month')::date);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION events_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'factory.events is append-only'; END $$;
CREATE TRIGGER events_no_update_delete BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_reject_mutation();      -- defence in depth; REVOKE below is primary
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION events_reject_mutation();

CREATE TABLE tasks (
  id text PRIMARY KEY, repo text NOT NULL, workflow text NOT NULL, state text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  autonomy_level smallint NOT NULL CHECK (autonomy_level BETWEEN 0 AND 4),
  risk_tier text CHECK (risk_tier IN ('R0','R1','R2','R3','R4')),
  source jsonb NOT NULL,                       -- {kind:'github-issue'|'manual'|'cron'|'ci-failure', ref, authorLogin}
  spec jsonb, spec_sha256 bytea, graph jsonb, graph_sha256 bytea, oracle_id text,
  definition_sha text NOT NULL, correlation_id text NOT NULL,
  budget_usd_micros bigint NOT NULL, spent_usd_micros bigint NOT NULL DEFAULT 0,
  escalation jsonb, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), terminal_at timestamptz
);
CREATE INDEX tasks_open_idx ON tasks (state) WHERE terminal_at IS NULL;

CREATE TABLE nodes (
  task_id text NOT NULL REFERENCES tasks(id), node_id text NOT NULL, kind text NOT NULL, state text NOT NULL,
  version integer NOT NULL DEFAULT 0, attempt integer NOT NULL DEFAULT 0,
  depends_on text[] NOT NULL DEFAULT '{}', spec jsonb NOT NULL, result jsonb,
  PRIMARY KEY (task_id, node_id)
);

CREATE TABLE jobs (
  id bigserial PRIMARY KEY, task_id text NOT NULL, node_id text, kind text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','leased','done','failed','dead')),
  priority smallint NOT NULL DEFAULT 100, available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text, lease_expires_at timestamptz,
  attempt integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
  idempotency_key text NOT NULL UNIQUE, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim_idx ON jobs (priority, available_at) WHERE status = 'ready';

CREATE TABLE approvals (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id),
  type text NOT NULL CHECK (type IN ('plan','merge','definition','temporary-grant')),
  artefact_kind text NOT NULL, artefact_ref text NOT NULL, artefact_sha256 bytea NOT NULL,
  approvers text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','granted','refused','expired','revoked','consumed','void')),
  requested_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  decided_at timestamptz, decided_by text, comment text, review_minutes integer,
  security_scope_ack boolean NOT NULL DEFAULT false, cool_off_until timestamptz, consumed_at timestamptz
);

CREATE TABLE runs (
  run_id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), node_id text, attempt int NOT NULL,
  role text NOT NULL, stage_kind text NOT NULL, executor_kind text NOT NULL CHECK (executor_kind IN ('deterministic','completion','harness','human')),
  route jsonb, status text NOT NULL, outcome text, failure_class text,
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  record_uri text, record_sha256 bytea, context_envelope_id text,
  cost_usd_micros bigint NOT NULL DEFAULT 0, tokens jsonb NOT NULL DEFAULT '{}',
  retention_class text NOT NULL DEFAULT 'engineering', retain_until date
);

CREATE TABLE tool_invocations (
  id text PRIMARY KEY, run_id text REFERENCES runs(run_id), task_id text NOT NULL, node_id text, attempt int NOT NULL,
  capability_id text NOT NULL, effect_class text NOT NULL CHECK (effect_class IN ('E0','E1','E2','E3','E4')),
  transport text NOT NULL, args_sha256 bytea NOT NULL, args_summary jsonb, result_summary jsonb,
  policy_decision_id text, approval_id text, status text NOT NULL,
  idempotency_key text NOT NULL UNIQUE, duration_ms integer, cost_usd_micros bigint,
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_decisions (
  id text PRIMARY KEY, task_id text, action text NOT NULL, input_sha256 bytea NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ALLOW','DENY','REQUIRE_APPROVAL','ESCALATE')),
  rule_ids text[] NOT NULL, reason text NOT NULL, bundle_sha256 bytea NOT NULL, decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_calls (                      -- the cost ledger
  id text PRIMARY KEY, run_id text, task_id text NOT NULL, provider text NOT NULL, model text NOT NULL,
  route_rule text, prompt_sha256 bytea, tokens_in int, tokens_out int, tokens_cache_read int, tokens_cache_write int,
  cost_usd_micros bigint NOT NULL, latency_ms int, status text NOT NULL, cached boolean NOT NULL DEFAULT false,
  via text NOT NULL DEFAULT 'complete' CHECK (via IN ('complete','passthrough')),
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE context_envelopes (
  id text PRIMARY KEY, task_id text NOT NULL, run_id text, stage text NOT NULL,
  resolved_sha256 bytea NOT NULL, items jsonb NOT NULL, truncations jsonb NOT NULL DEFAULT '[]', gaps jsonb NOT NULL DEFAULT '[]',
  bytes integer NOT NULL, budget_bytes integer NOT NULL, object_uri text
);

CREATE TABLE oracles (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id),
  route text NOT NULL CHECK (route IN ('human','generated','agent')),
  provenance jsonb NOT NULL,                    -- {author, runId|null, generator?, commitSha?, implementationRunId: null}
  manifest jsonb NOT NULL, manifest_sha256 bytea NOT NULL, object_uri text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','admitted','rejected')), admission_report jsonb, admitted_at timestamptz
);

CREATE TABLE changes (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), repo text NOT NULL,
  pr_number integer, branch text NOT NULL, base_sha text NOT NULL, head_sha text,
  status text NOT NULL, merge_sha text, merged_by text, merged_at timestamptz
);

CREATE TABLE gate_reports (
  id text PRIMARY KEY, task_id text NOT NULL, change_id text, head_sha text NOT NULL, tier text NOT NULL,
  report jsonb NOT NULL, report_sha256 bytea NOT NULL, passed boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE definition_versions (
  sha text PRIMARY KEY, bundle_sha256 bytea NOT NULL, bundle jsonb NOT NULL, plan jsonb,
  approval_id text, applied_at timestamptz NOT NULL DEFAULT now(), applied_by text NOT NULL, active boolean NOT NULL DEFAULT false
);

CREATE TABLE credential_leases (                -- NEVER stores secret material
  id text PRIMARY KEY, task_id text NOT NULL, provider text NOT NULL, scope jsonb NOT NULL,
  minted_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz
);

CREATE TABLE egress_tokens (
  task_id text PRIMARY KEY, token_hash bytea NOT NULL, allow jsonb NOT NULL, expires_at timestamptz NOT NULL
);

CREATE TABLE gateway_tokens (
  task_id text PRIMARY KEY, token_hash bytea NOT NULL, model_allowlist text[] NOT NULL,
  max_tokens_cap int NOT NULL, expires_at timestamptz NOT NULL
);

CREATE TABLE edge_outbox (                     -- written ONLY by edge containers (factory_edge); drained by the worker into events/model_calls
  id bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('model_usage','egress_denied','egress_summary')),
  task_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), drained_at timestamptz
);

CREATE TABLE kill_switch (id smallint PRIMARY KEY CHECK (id = 1), engaged boolean NOT NULL DEFAULT false,
  engaged_by text, engaged_at timestamptz, reason text);
INSERT INTO kill_switch (id) VALUES (1);

CREATE TABLE projection_cursors (name text PRIMARY KEY, last_seq bigint NOT NULL DEFAULT 0);
```

**Further tables (columns normative, DDL written in the owning ticket):**

| Table | Columns | Ticket |
|---|---|---|
| `task_current` (projection) | `task_id pk, repo, workflow, state, risk_tier, needs_human bool, last_activity_at, spent_usd_micros, budget_usd_micros, summary jsonb` | T-1.15 |
| `review_queue` | `task_id pk, change_id, tier, score jsonb, rationale jsonb, queued_at, position_key` | T-2.16 |
| `approval_queue` | `approval_id pk, task_id, type, requested_at, expires_at, urgency` | T-2.09 |
| `cost_attribution` | `day, workflow, role, model, tokens_in, tokens_out, usd_micros, accepted_change_count` | T-4.05 |
| `workflow_performance`, `agent_performance` | per-window counters + failure-class split | T-4.01 |
| `knowledge_records` | `id, change_id, task_id, repo, title, body, tags text[], tsv tsvector (GIN)` | T-2.18 |
| `calibration_corpora`, `calibration_reports` | corpus manifest + sample refs; report `{verifier, property, detection_rate, fp_rate, corpus_sha256, valid_until}` | T-4.02/4.04 |
| `skills`, `context_items` | content-addressed items `{id, version, sha256, tier, kind, trust, scope, body_uri}` | T-2.01/2.02 |
| `webhook_deliveries` | `delivery_id pk, event, received_at, status` (idempotency) | T-2.04 |
| `proposals` | `id, kind, evidence jsonb, expected_effect, measurement_plan, rollback_plan, status` | T-5.05 |

**Roles and privileges (normative):**
```sql
-- roles: factory_owner (DDL), factory_app, factory_projector, factory_applier, factory_edge, factory_readonly
GRANT USAGE ON SCHEMA factory TO factory_app, factory_projector, factory_applier, factory_edge, factory_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA factory FROM PUBLIC;
GRANT SELECT, INSERT ON events TO factory_app;                          -- no UPDATE/DELETE/TRUNCATE, ever
GRANT SELECT ON events TO factory_projector;                            -- projector reads the log, never writes it
GRANT SELECT, INSERT, UPDATE ON tasks, nodes, jobs, approvals, runs, tool_invocations, policy_decisions,
      model_calls, context_envelopes, oracles, changes, gate_reports, credential_leases, egress_tokens, gateway_tokens
      TO factory_app;
GRANT SELECT, UPDATE ON event_counter, kill_switch TO factory_app;     -- UPDATE ... RETURNING also needs SELECT
GRANT SELECT, UPDATE ON edge_outbox TO factory_app;                    -- drain
GRANT SELECT ON definition_versions TO factory_app;
GRANT SELECT, INSERT, UPDATE ON projection_cursors TO factory_projector;
GRANT SELECT ON egress_tokens, gateway_tokens, kill_switch TO factory_edge;
GRANT SELECT (id, state, budget_usd_micros, spent_usd_micros) ON tasks TO factory_edge;
GRANT SELECT, INSERT ON edge_outbox TO factory_edge;                   -- SELECT = pending usage for budget checks; INSERT is the edge's ONLY write
GRANT SELECT, INSERT, UPDATE ON definition_versions TO factory_applier;  -- ONLY the applier may write it (A0.7)
GRANT SELECT ON ALL TABLES IN SCHEMA factory TO factory_readonly;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA factory TO factory_app;
GRANT USAGE ON SEQUENCE edge_outbox_id_seq TO factory_edge;
-- ensure_event_partitions() needs CREATE on the schema: run it ONLY under factory_owner (migration runner / `factory db partitions`).
-- Every later migration that adds a table adds its own explicit GRANTs in the same file; default privileges are NOT used.
```
The **data plane has no database role** (I-1).

---

## 3. Core TypeScript contracts (`packages/contracts/src`)

> TypeScript is used here as an **interface-definition notation**. Render it into your language with the rules in `A1` §5; names, operations, error cases and invariants must stay identical.

```ts
// ---------- shared ----------
export type Sha256 = `sha256:${string}`;
export type UsdMicros = number & { __brand: 'usdMicros' };
export type EffectClass = 'E0'|'E1'|'E2'|'E3'|'E4';
export type Tier = 'R0'|'R1'|'R2'|'R3'|'R4';
export type Autonomy = 0|1|2|3|4;
export type Actor = { kind: 'human'|'agent'|'system'|'integration'; id: string };
export type Authority = { basis: 'human-access-point'|'policy-decision'|'approval'|'system-rule';
  policyDecisionId?: string; approvalId?: string; autonomyLevel?: Autonomy; violation?: boolean };
export type Result<T, E = FactoryError> = { ok: true; value: T } | { ok: false; error: E };
export type FailureClass = 'model.reasoning'|'model.capability'|'workflow.composition'|'context.insufficient'
  |'verification.failure'|'environment.failure'|'policy.denied'|'budget.exhausted'|'tool.unavailable'|'unknown';

// ---------- event log ----------
export interface EventEnvelope<P = unknown> {
  eventId: string; seq: number; occurredAt: string; eventType: string; schemaVersion: number;
  aggregate: { kind: 'task'|'node'|'approval'|'definition'|'run'|'change'|'system'; id: string; version: number };
  correlationId: string; causationId?: string; actor: Actor; authority: Authority;
  subject: Record<string, string>; payload: P; context: Record<string, unknown>;
  redaction: { applied: string[] }; costUsdMicros?: number; durationMs?: number; prevHash?: Sha256; hash: Sha256;
}
export type NewEvent<P=unknown> = Omit<EventEnvelope<P>, 'eventId'|'seq'|'occurredAt'|'prevHash'|'hash'|'schemaVersion'|'redaction'>
  & { bumpsVersion?: boolean };
export interface EventLog {
  append(events: NewEvent[], opts?: { expectedVersions?: Record<string, number> }): Promise<EventEnvelope[]>; // ONE tx; CAS on aggregates
  read(q: { aggregate?: { kind: string; id: string }; correlationId?: string; types?: string[]; afterSeq?: number; limit?: number }): AsyncIterable<EventEnvelope>;
  verifyChain(aggregate: { kind: string; id: string }): Promise<{ ok: boolean; brokenAtSeq?: number }>;
}

// ---------- state ----------
export interface StateMachine {
  transition(cmd: { taskId: string; to: TaskState; trigger: string; actor: Actor; authority: Authority;
    expectedVersion: number; payload?: unknown }): Promise<Result<TaskSnapshot, 'IllegalTransition'|'GuardFailed'|'ConcurrencyError'>>;
}

// ---------- policy ----------
export interface PolicyInput { action: string; capabilityId?: string; effectClass?: EffectClass; actor: Actor;
  taskId?: string; workflow: string; stage?: string; autonomy: Autonomy; tier?: Tier;
  resource?: { kind: string; ref: string; paths?: string[]; host?: string }; approvalId?: string; args?: unknown;
  priorDenials?: Array<{ effectClass: EffectClass; resourceKey: string; capabilityId: string }>; }   // AT-14 equivalent-effect check
export interface Decision { outcome: 'ALLOW'|'DENY'|'REQUIRE_APPROVAL'|'ESCALATE'; ruleIds: string[]; reason: string;
  bundleSha256: Sha256; requiredApproval?: { type: string; scope?: 'security' } }
export interface PolicyEngine { evaluate(input: PolicyInput, bundle: PolicyBundle): Decision }  // PURE, total, fail-closed

// ---------- tools ----------
export interface ToolCall { capabilityId: string; args: unknown; idempotencyExtra?: string }
export interface InvocationContext { taskId: string; nodeId: string; attempt: number; runId: string; actor: Actor; workflow: string; stage: string; autonomy: Autonomy; tier?: Tier }
export interface ToolResult { ok: boolean; value?: unknown; error?: { class: FailureClass; message: string };
  trust: 'trusted'|'untrusted'; invocationId: string; replayed: boolean }
export interface ToolBroker { invoke(call: ToolCall, ctx: InvocationContext): Promise<ToolResult> }
export interface ToolAdapter { describe(): ToolCapability[]; invoke(capId: string, args: unknown, cred?: ResolvedCredential, signal?: AbortSignal): Promise<unknown>;
  health(): Promise<'healthy'|'degraded'|'unavailable'|'unknown'>; close(): Promise<void> }

// ---------- credentials ----------
export interface CredentialBroker {
  mint(taskId: string, scope: { provider: 'github'; repositories: string[]; permissions: Record<string,'read'|'write'>; ttlSeconds: number }): Promise<{ credId: string; expiresAt: string }>;
  resolve(credId: string): ResolvedCredential;            // INTERNAL: callable only from broker step 7
  revokeAll(taskId: string): Promise<void>;
}
export interface SecretStore { get(name: string): string; has(name: string): boolean }   // loaded once at start; never logged

// ---------- model gateway ----------
export interface ModelRequest { role: string; taskId: string; nodeId: string; attempt: number;
  messages: Msg[]; system?: SystemBlock[]; tools?: ToolSpec[]; responseFormat?: { kind: 'json-schema'; schema: object; name: string };
  routingHints?: { complexity?: 'low'|'medium'|'high' }; budget?: { maxUsdMicros?: number; maxTokens?: number }; cachePolicy?: 'prefix'|'none' }
export interface ModelResponse { content: string; json?: unknown; toolCalls?: ToolUse[]; usage: Usage; model: string;
  provider: string; routingDecision: { rule: string; fallbackUsed: boolean }; cached: boolean }
export interface ModelGateway { complete(req: ModelRequest): Promise<Result<ModelResponse, FactoryError>> }
export interface ProviderAdapter { id: string; complete(req: ProviderRequest): Promise<ProviderResponse>;
  models(): Promise<string[]>; health(): Promise<'healthy'|'degraded'|'unavailable'>; estimateCostMicros(req: ProviderRequest): number }

// ---------- scheduling / orchestration ----------
export interface Scheduler { enqueue(job: NewJob): Promise<void>; claim(owner: string, leaseSeconds: number): Promise<Job | null>;
  heartbeat(jobId: number, owner: string): Promise<boolean>; complete(jobId: number, owner: string): Promise<void>; reap(): Promise<number> }
export interface StageExecutor { kind: 'deterministic'|'completion'|'harness'|'human'; stageKind: StageKind;
  run(input: StageInput, deps: StageDeps): Promise<StageOutput> }
export interface StageInput { taskId: string; nodeId: string; attempt: number; runId: string; spec: unknown; context: ContextEnvelope;
  grant: EffectiveGrant; budget: { maxUsdMicros: number; maxTurns?: number; wallClockSeconds: number }; upstream?: ArtefactRef; modelPolicy: string }
export interface StageOutput { status: 'success'|'failure'|'incomplete'; artefacts: ArtefactRef[]; verification?: unknown;
  failure?: { class: FailureClass; reason: string; retriable: boolean }; nextState?: string; confidence?: never /* no confidence-gated merging */ }

// ---------- context ----------
export interface ContextAssembler { resolve(stage: StageSpec, inputs: TaskInputs, repo: RepoScope, store: ContextStore): Result<ContextEnvelope, 'context.budget_exceeded'|'context.invalid'> } // PURE
export interface ContextEnvelope { envelopeId: string; items: Array<{ id: string; version: string; sha256: Sha256; trust: 'trusted'|'untrusted-content'|'derived'; bytes: number }>;
  resolvedContextSha256: Sha256; truncations: never[]; gaps: Array<{ expected: string; reason: string }>; budget: { bytes: number; limit: number }; rendered: string }

// ---------- isolation / harness ----------
export interface IsolationProvider { tier: 'T1'|'T2'; provision(spec: EnvSpec): Promise<Environment> }
export interface Environment { id: string; workdir: string;
  exec(argv: string[], opts: { timeoutMs: number; env?: Record<string,string>; stdin?: Uint8Array }): Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }>;
  copyOut(paths: string[]): Promise<Map<string, Uint8Array>>; copyIn(files: Map<string, Uint8Array>, opts?: { readOnly?: boolean }): Promise<void>;
  destroy(): Promise<void> }                     // idempotent; ALWAYS called in finally
export interface HarnessAdapter { id: string;
  run(req: { env: Environment; prompt: string; model: string; limits: { maxTurns: number; wallClockSeconds: number; maxUsdMicros: number };
             allowedTools: string[]; gatewayToken: string }): AsyncIterable<HarnessEvent> & { result: Promise<HarnessResult> } }

// ---------- verification / review / approval / merge ----------
export interface OracleService { construct(req: OracleRequest): Promise<Oracle>; admit(oracleId: string): Promise<Result<Admission, 'oracle.admissionFailed'>> }
export interface VerificationRuntime { run(req: { taskId: string; baseSha: string; patch: Uint8Array; oracleId: string; tier: Tier }): Promise<GateReport> }
export interface BlastRadiusScorer { score(diff: DiffSummary, map: CriticalityMap, repo: RepoConfig, history: ChangeHistory): TierScore }   // PURE
export interface PanelAggregator { aggregate(reviews: ReviewOutput[], gates: GateReport, policy: PanelPolicy): PanelResult }              // PURE, no confidence
export interface ApprovalService {
  request(a: { taskId: string; type: ApprovalType; artefact: { kind: string; ref: string; value: unknown }; approvers: string[]; ttlSeconds: number }): Promise<Approval>;
  decide(id: string, d: { decision: 'grant'|'refuse'; identity: string; comment?: string; securityScopeAck?: boolean }): Promise<Result<Approval, 'NotApprover'|'Expired'|'HashMismatch'|'Consumed'|'CoolOff'>>;
  isValid(id: string, currentArtefact: unknown, now: Date): boolean; consume(id: string): Promise<void>; revoke(id: string, by: string): Promise<void> }
export interface MergeGate { evaluate(changeId: string): Promise<{ ready: boolean; blockers: string[]; headSha: string }>; publish(changeId: string): Promise<void> }

// ---------- SCM ----------
export interface ScmAdapter { verifyWebhook(headers: Record<string,string>, rawBody: Uint8Array): Result<WebhookEvent, 'bad_signature'|'replay'>;
  getIssue(repo: string, n: number): Promise<UntrustedContent>; permissionOf(repo: string, login: string): Promise<'admin'|'write'|'read'|'none'>;
  pushBranch(repo: string, branch: string, bareDir: string): Promise<void>; openPr(a: OpenPrArgs): Promise<{ number: number; url: string }>;
  publishCheck(a: { repo: string; headSha: string; name: string; conclusion: 'success'|'failure'|'neutral'; summary: string; detailsUrl?: string }): Promise<void>;
  comment(repo: string, n: number, body: string): Promise<void> }   // every method is reached ONLY via ToolBroker capabilities
```

---

## 4. Definition document kinds (`/definition`, all `apiVersion: factory/v1`)

### 4.1 `FactoryDefinition` — `definition/factory.yaml`
```yaml
apiVersion: factory/v1
kind: FactoryDefinition
metadata: { name: personal-factory }
spec:
  owner: { githubLogin: <owner> }                  # approvers.default
  global: { maxConcurrentTasks: 3, killSwitch: { honour: true }, dailyBudgetUsdMicros: 50000000 }
  defaults: { autonomyLevel: 2, gateRetryBudget: 2, taskBudgetUsdMicros: 5000000 }
  repos: [ { ref: repos/main-app.yaml } ]
  workflows: [ B.issue-to-pr, C.bug-fix, D1.dependency-upgrade, D2.ci-repair ]
```

### 4.2 `WorkflowDefinition` (slim from `blueprint-reference/templates/WORKFLOW.md`)
```yaml
apiVersion: factory/v1
kind: WorkflowDefinition
metadata: { name: B.issue-to-pr }
spec:
  autonomy: { level: 2, ceiling: 2 }                                  # FR-04
  trigger: { kind: event, source: github, event: issues.labeled, label: "factory:ready", requesterAllowList: owner }
  planApproval: required                                              # FR-74
  stages:                                                             # ordered; deterministic stages may be implicit
    - { id: triage,   kind: specify,      role: triage,     executor: completion, model: triage }
    - { id: refine,   kind: specify,      role: refinement, executor: completion, model: strong }
    - { id: oracle,   kind: specify,      role: oracle-author, executor: completion, model: strong, whenRoute: agent }
    - { id: plan,     kind: plan,         role: planner,    executor: completion, model: strong }
    - { id: approve-plan, kind: approve,  approval: plan }
    - { id: implement, kind: implement,   role: worker,     executor: harness,    model: worker, isolation: T2 }
    - { id: verify,   kind: verify,       executor: deterministic, isolation: T2 }
    - { id: review,   kind: review,       role: reviewer,   executor: completion, model: strong, requireDifferentModel: true }
    - { id: aggregate, kind: aggregate,   executor: deterministic }
    - { id: approve-merge, kind: approve, approval: merge }
    - { id: record,   kind: record,       executor: deterministic }
  limits: { maxConcurrent: 2, reworkLoops: 2, maxWallClockSeconds: 5400, maxUsdMicrosPerTask: 5000000 }
  completion: [ oracle.passed, gates.passed, review.nonBlocking, change.merged-by-human ]
```

### 4.3 `RoleSpec` [BP: 08 §8]
```yaml
apiVersion: factory/v1
kind: RoleSpec
metadata: { name: worker }
spec:
  responsibility: "Implement the approved plan node so the acceptance oracle passes."
  contextScope: { include: [policy, acceptance, standards, procedures, repo-local, reference, untrusted-envelope], exclude: [other-runs, transcripts] }
  toolScope: { grant: [shell.sandboxed, repo.read, repo.write:path:<allowed-globs>], deny: [net.fetch, secret.read, factory.write, git.push.protected] }
  modelPolicy: { class: worker, fallbacks: [worker-b] }
  limits: { turns: 100, wallClockSeconds: 3000, costBudgetUsdMicros: 4000000, contextBudgetBytes: 120000 }
  autonomy: { maxLevel: 2 }
  spawning: { allowed: false }
```
Roles in v1: `triage, refinement, oracle-author, planner, worker, reviewer (spec-conformance), reviewer-quality, security-reviewer, sweep(D-1), ci-repair(D-2)`; Prioritiser is deterministic code (queue order), Panel is code. [BP: 08 §2–3]

### 4.4 `ToolCapability` [BP: 11 §2.1]
```yaml
apiVersion: factory/v1
kind: ToolCapability
metadata: { name: github.pr.create, version: 1.0.0 }
spec:
  owner: platform
  kind: mutation                      # read | mutation | compute | communicate
  transport: http                     # inproc | http | cli | mcp | library
  effect: { class: E2, reversible: true, undo: github.pr.close, external: true }
  scope: { required: [git.write.pr], resourcePattern: "repo:{repo}", environment: any }
  credentials: { provider: github, permissions: { pull_requests: write, contents: read }, ttlSeconds: 900 }
  inputSchema: { $ref: "schemas/github.pr.create.in.json" }
  outputSchema: { $ref: "schemas/github.pr.create.out.json" }
  trust: { inputTrust: trusted, resultTrust: trusted }
  health: { check: http, timeoutMs: 3000, degraded: queue-retry }
  observability: { redactArguments: [] }
  cost: { unit: call, usdMicros: 0 }
```
The initial v1 capability set (ids, effect classes, scopes) is the table in `04_…` §5.

### 4.5 `CapabilityGrant`, `WorkflowEnvironment`
```yaml
apiVersion: factory/v1
kind: CapabilityGrant
metadata: { name: B.worker }
spec: { workflow: B.issue-to-pr, stage: implement, allow: [shell.sandboxed, repo.read],
        resourceScope: { repo: "{task.repo}", paths: { writeGlobs: ["src/**","test/**"], denyGlobs: [".github/**",".factory/**","tests/acceptance/**"] } },
        deny: [secret.read, factory.write, git.push.protected] }
---
apiVersion: factory/v1
kind: WorkflowEnvironment
metadata: { name: B.worker.env }
spec: { isolation: T2, image: "ghcr.io/<you>/factory-node@sha256:<digest>",
        network: { egress: [ "registry.npmjs.org", "*.npmjs.org" ] },   # allow-list; grows only via reviewed change; size is a tracked metric (H-12)
        resources: { cpus: 2, memoryMb: 4096, pids: 512, wallClockSeconds: 3000 } }
```

### 4.6 `RoutingPolicy` [BP: 11 §9.3] — names are examples, `[VERIFY]` at startup
```yaml
apiVersion: factory/v1
kind: RoutingPolicy
spec:
  providers: { anthropic: { adapter: anthropic }, secondary: { adapter: openai-compatible } }
  classes:
    triage:  { primary: { provider: anthropic, model: claude-haiku-5-5 } }
    strong:  { primary: { provider: anthropic, model: claude-opus-5-5 },  fallbacks: [ { provider: secondary, model: "<configured>" } ] }
    worker:  { primary: { provider: anthropic, model: claude-sonnet-5-5 }, fallbacks: [ { provider: secondary, model: "<configured>" } ] }
  rules:
    - { match: { role: triage },                       use: triage }
    - { match: { role: [refinement, oracle-author, planner, reviewer, reviewer-quality, security-reviewer] }, use: strong }
    - { match: { role: [worker, sweep, ci-repair] },   use: worker }
  reviewerIndependence: { requireDifferentRunAndContext: true, preferDifferentModelFromWorker: true }
  budgets: { perRequestUsdMicros: 1500000, perTaskUsdMicros: 5000000, perWorkflowDayUsdMicros: 50000000 }
  failover: { on: [provider-error, rate-limited, schema-invalid-twice], neverOn: [budget-exhausted] }
  caching: { prefix: true }
```

### 4.7 `PolicyBundle` — `definition/policy-bundle.yaml`
```yaml
apiVersion: factory/v1
kind: PolicyBundle
spec:
  denyRules:
    - { id: deny-factory-write,       when: { capability: factory.write } }
    - { id: deny-protected-merge,     when: { capability: git.push.protected, autonomyBelow: 3 } }
    - { id: deny-secret-read-agent,   when: { capability: secret.read, actorKind: agent } }
    - { id: deny-agent-protected-paths, when: { action: repo.write, actorKind: agent, pathsMatch: "@protectedPaths" } }
    - { id: deny-egress-private,      when: { action: net.egress, hostClass: [private, loopback, linkLocal, metadata] } }
  protectedPaths: [ ".github/**", "CODEOWNERS", ".factory/**", "tests/acceptance/**", "**/migrations/**", "Dockerfile*", "docker-compose*.y*ml" ]
  effectRules: { E0: allow, E1: allow, E2: allowIfResourceScoped, E3: requireApproval, E4: requireApproval }
  tierRules:   { R3: { approveActions: requireApproval-security }, R4: { agentChange: deny } }
  default: deny
```

### 4.8 `CriticalityMap` — `definition/criticality/<repo>.yaml` [BP: 13 §5.5]
```yaml
apiVersion: factory/v1
kind: CriticalityMap
metadata: { repo: <owner>/<name> }
spec:
  paths:
    - { glob: "src/auth/**",          tier: R3, reason: "authentication" }
    - { glob: "src/payments/**",      tier: R4, reason: "money movement; human-only" }
    - { glob: "**/migrations/**",     tier: R3, reason: "irreversible data" }
    - { glob: "docs/**",              tier: R0, reason: "documentation" }
  default: R2
  dataClasses: [ { glob: "src/users/**", class: pii } ]
```

### 4.9 `RepoOnboarding` — `<target-repo>/.factory/repo.yml` (privileged; changes = R3) **[PACK]**
```yaml
apiVersion: factory/v1
kind: RepoOnboarding
spec:
  repo: <owner>/<name>
  defaultBranch: main
  language: typescript
  image: ghcr.io/<you>/factory-node@sha256:<digest>
  commands:                                   # run in T2 only; argv arrays, no shell strings
    install:   [pnpm, install, --frozen-lockfile]
    static:    [pnpm, run, lint]
    typecheck: [pnpm, run, typecheck]
    test:      [pnpm, run, test]
    oracle:    [pnpm, vitest, run, "{oraclePath}"]     # {oraclePath} substituted by the factory
    securityScan: [ [pnpm, audit, --audit-level, high], [gitleaks, detect, --no-banner] ]   # [VERIFY] tool availability in image
  oracle: { paths: ["tests/acceptance/**"], generatorKinds: [command-check, behavior-table, file-assertion] }
  paths: { src: ["src/**"], tests: ["test/**","tests/**"], publicInterface: ["src/index.ts","src/api/**"],
           migrations: ["**/migrations/**"], security: ["src/auth/**"], docs: ["docs/**","README.md"] }
  docs: { requiredWhenTag: public-interface }
  context: { files: ["AGENTS.md","CLAUDE.md",".factory/context/*.md"] }
  ci: { requiredChecks: ["ci/build","ci/test"], provider: github-actions }
```

### 4.10 `AcceptanceOracle` manifest [BP: 14 §3.1]
```yaml
apiVersion: factory/v1
kind: AcceptanceOracle
metadata: { oracleId: orc_01H..., taskId: tsk_01H... }
spec:
  route: agent                       # human | generated | agent
  provenance: { author: "run_01H..." , implementationRunId: null, createdAt: "2026-..-..T..Z" }
  criteria:
    - id: AC-1
      statement: "GET /health returns 200 and {status:'ok'}"
      tags: [public-interface]
      checks:
        - { id: AC-1.c1, kind: behavior-table, files: ["tests/acceptance/health/health.test.ts"], expectedBefore: fail, visibility: visible }
        - { id: AC-1.c2, kind: command-check,  argv: [pnpm, run, build], expectedBefore: pass, visibility: holdout }
```

### 4.11 `TaskGraph` (v1 subset of [BP: 09 §7])
```yaml
apiVersion: factory/v1
kind: TaskGraph
metadata: { taskId: tsk_01H... }
spec:
  nodes:
    - { id: n1-implement, kind: implement, role: worker, oracleRef: orc_01H..., capabilities: [shell.sandboxed], budget: { usdMicros: 4000000, turns: 100 } }
  edges: []                                     # [{ from, to, classification: independent|dependent, justification }]
  topology: single                              # single | sequential | fan-out (fan-out requires all 4 chunkability conditions)
  integrationOrder: [n1-implement]
```
**Admission:** acyclic · every node has `oracleRef` · every fan-out edge carries a valid chunkability justification (`independent`, verifiable alone, bounded context, cheaper separately than inline) · every node's capabilities ⊆ workflow grant. [BP: 09 §2.3, FR-23/24/25]

---

## 5. Event vocabulary

v1 uses the blueprint's 61-type vocabulary [BP: 09 §4.3] plus the **pack additions** below (each addition must be listed in `packages/contracts/events.md` — adding an event without an entry fails the contract test).

**Pack additions `[PACK]`:** `webhook.received`, `webhook.rejected` · `oracle.constructed`, `oracle.admitted`, `oracle.admissionFailed` · `patch.extracted`, `patch.rejected` · `gate.weakeningDetected` · `change.opened`, `change.updated` · `credential.minted`, `credential.revoked` · `net.egress.denied` (security event), `net.egress.summary` · `kill.switch.engaged`, `kill.switch.released`.

**Payload shapes (minimum fields; all payloads are Zod-validated and registered by `eventType@schemaVersion`):**
```
intent.recorded       {source{kind,ref,authorLogin}, repo, workflowHint?, untrustedRef?}   // raw text is an object ref, never inline
intent.rejected       {reason:'author_not_allowlisted'|'out_of_scope'|'duplicate'|'kill_switch', ruleIds[]}
request.triaged       {workflow, rationale, runId}
spec.refined          {specSha256, criteriaCount, openQuestions[]}      spec.accepted {specSha256}      spec.escalated {reason, gaps[]}
oracle.constructed    {oracleId, route, manifestSha256, author, implementationRunId:null}
oracle.admitted       {oracleId, beforeReportSha256, perCheck[{id, expected, observed}]}
oracle.admissionFailed{oracleId, mismatches[{id, expected, observed}]}
plan.produced         {graphSha256, nodeCount, topology}     plan.validated {graphSha256, checks{acyclic,chunkability,grants}}
approval.requested    {approvalId, type, artefactKind, artefactSha256, approvers[], expiresAt}
approval.granted      {approvalId, decidedBy, artefactSha256, securityScopeAck, reviewMinutes?}
approval.expired|revoked {approvalId, reason}
node.leased           {nodeId, attempt, leaseOwner, leaseExpiresAt}      node.duplicateExecution {nodeId, attempt, winnerRunId}
stage.completed       {runId, nodeId, outcome, artefactRefs[]}   stage.failed {runId, failureClass, retriable}
stage.incomplete      {runId, reason:'budget'|'turns'|'wallclock', partialRefs[]}
tool.invoked          {runId, capabilityId, effectClass, argsSha256, argsSummary, resultSummary, transport, idempotencyKey, durationMs}
tool.denied           {runId, capabilityId, step, ruleIds[], reason}                     // SECURITY EVENT
model.requested       {runId, provider, model, routeRule, promptSha256, tokens{in,out,cacheRead,cacheWrite}, costUsdMicros, cached, via}
model.failedOver      {from, to, trigger}
gate.passed|failed    {gateReportId, checkId, layer, authorship}       gate.weakeningDetected {signals[], tierRaisedTo}
patch.extracted       {runId, files, bytes, patchSha256}               patch.rejected {reasons[]}
change.opened         {changeId, prNumber, branch, baseSha, headSha}   change.merged {changeId, mergeSha, mergedBy}
policy.allowed|denied|escalated {decisionId, action, ruleIds[], reason}
environment.provisioned {envId, tier, imageDigest, limits}              environment.cleaned {envId, reason}
credential.minted     {credId, provider, scope, expiresAt}             credential.revoked {credId, reason}     // never secret material
net.egress.denied     {envId, host, port, reason}                       net.egress.summary {envId, hosts[{host,count}]}
budget.exhausted      {scope:'request'|'task'|'workflow-day', limitUsdMicros, spentUsdMicros}
definition.applied    {sha, bundleSha256, approvalId}                   definition.driftDetected {expectedSha, observedSha, diff[]}
kill.switch.engaged   {by, reason}
```
`tool.denied`, `policy.denied`, `net.egress.denied`, `patch.rejected`, `webhook.rejected` are **security events**: counted, alerted on, shown on the Health region.

---

## 6. State machine tables (machine-readable) [BP: 09 §2–3]

```ts
export const TASK_STATES = ['DRAFT','TRIAGED','REFINED','PLANNED','QUEUED','RUNNING','VERIFYING','AWAITING_REVIEW',
  'AWAITING_APPROVAL','APPROVED','MERGING','MERGED','DEPLOYING','DEPLOYED','REJECTED','FAILED','ABANDONED','INCOMPLETE','ESCALATED'] as const; // 19
export const TERMINAL = ['MERGED'/*code path*/,'DEPLOYED','REJECTED','FAILED','ABANDONED','INCOMPLETE'] as const;                              // ESCALATED is resumable
export const NODE_STATES = ['PENDING','READY','LEASED','RUNNING','SUCCEEDED','FAILED','INCOMPLETE','BLOCKED'] as const;                         // 8

// [from, to, guard]
export const TASK_TRANSITIONS: Array<[string,string,string|null]> = [
 ['DRAFT','TRIAGED',null], ['DRAFT','REJECTED',null],
 ['TRIAGED','REFINED','specHasCheckableCriterionAndOracleRef'], ['TRIAGED','FAILED',null],
 ['REFINED','PLANNED',null], ['REFINED','ESCALATED',null],
 ['PLANNED','QUEUED','graphAdmissible+oracleAdmitted+planApprovalValid'],      // [BP 09 §2.3 + 14 §3.4 + 11 §5.3]
 ['PLANNED','ESCALATED',null],
 ['QUEUED','RUNNING',null], ['RUNNING','QUEUED',null],
 ['RUNNING','VERIFYING','allNodesTerminal'], ['RUNNING','ESCALATED',null], ['RUNNING','INCOMPLETE',null],
 ['VERIFYING','AWAITING_REVIEW','allApplicableGatesPassedIncludingOracle'], ['VERIFYING','RUNNING','iterationBudgetRemains'], ['VERIFYING','FAILED','iterationBudgetExhausted'],
 ['AWAITING_REVIEW','AWAITING_APPROVAL','requiredApprovalClassIdentified'], ['AWAITING_REVIEW','REJECTED',null], ['AWAITING_REVIEW','ESCALATED','reviewFatigueThreshold'],
 ['AWAITING_APPROVAL','APPROVED','approvalValidUnexpiredBound'], ['AWAITING_APPROVAL','REJECTED',null],
 ['APPROVED','MERGING','autonomyPermitsOrHumanInitiated'],                    // the L2 enforcement point
 ['MERGING','MERGED',null], ['MERGING','FAILED',null],
 ['MERGED','DEPLOYING','deploymentTargetInRunbookSet'],                        // v1: guard is hard-false (no deploy capability exists)
 ['DEPLOYING','DEPLOYED',null], ['DEPLOYING','FAILED',null],
 ['ESCALATED','QUEUED',null], ['ESCALATED','REJECTED',null], ['INCOMPLETE','ESCALATED',null],
 // [PACK] ABANDONED has no incoming edge in the blueprint diagram; "cancelled or superseded" implies:
 ['*nonTerminal*','ABANDONED','cancelledByHumanOrSuperseded'],
 // any non-terminal -> ESCALATED when an escalation trigger fires [BP 09 §2.3]
];
export const NODE_TRANSITIONS: Array<[string,string]> = [
 ['PENDING','READY'],['PENDING','BLOCKED'],['READY','LEASED'],['LEASED','RUNNING'],['LEASED','READY'],
 ['RUNNING','SUCCEEDED'],['RUNNING','FAILED'],['RUNNING','INCOMPLETE'],['RUNNING','BLOCKED'],['FAILED','READY']];   // retry only if policy permits
```
Escalation triggers (any → `ESCALATED`): review-fatigue threshold, unresolvable conflict, policy escalation, repeated classification, `resume_failed`, `not_reproducible`.

---

## 7. Enumerations

* **Stage kinds** (14) [BP: 09 §8.1]: `specify, plan, implement, verify, review, aggregate, approve, merge, deploy, sweep, investigate, record, evaluate, propose` — v1 implements all but `deploy`, `investigate`; `evaluate`/`propose` minimal.
* **Failure classes** (10): see `FailureClass` above; unknown ⇒ `workflow.composition`. [BP: 08 §4.3]
* **Effect classes:** E0 pure read · E1 reversible write · E2 external write · E3 destructive · E4 production. [BP: 11 §2.3]
* **Scope vocabulary** [BP: 11 §4.2]: `repo:read`, `repo:write:path:<glob>`, `git.write.branch`, `git.write.commit`, `git.write.pr`, `git.push.protected` (never < L3), `shell.sandboxed`, `net.fetch`, `net.egress:<host>`, `db.read|write|migrate:local`, `prod.read|write` (none registered in v1), `secret.read` (never agent), `factory.write` (never agent).
* **Autonomy:** L0 research · L1 propose · **L2 execute isolated (PR; human reviews code) — all v1 workflows** · L3 merge after approval · L4 operate production.
* **Tiers:** R0 trivial · R1 low · R2 moderate · R3 high · R4 critical (human-only for the factory's own R4 paths; per `CriticalityMap` for target repos).
