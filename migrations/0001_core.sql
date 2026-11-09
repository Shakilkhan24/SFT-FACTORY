-- 0001_core.sql — the core data model.
--
-- PROVENANCE (checklist 02 T-1.02, trap 2): the body of this file is the
-- DDL from pack `03` §2, extracted programmatically from
-- `software-factory-pack/software-factory-pack/03_CONTRACTS_AND_DATA_MODEL.md`
-- (the first ```sql block) and copied VERBATIM. It is not re-typed.
--
-- The pack's DDL is the contract; `reference/validate_ddl.sh` is written
-- against it. `tools/extract-pack-ddl.ts` re-extracts it and
-- `pnpm ddl:check` fails if this file has drifted from the pack.
--
-- Forward-only (pack 03 §2): never edit an applied migration. A change is a
-- new `0002_*.sql`.
--
-- Append-only is enforced in three layers (ADR-0019):
--   1. privileges — no role has UPDATE/DELETE/TRUNCATE on `events`;
--   2. triggers   — `events_reject_mutation` raises on UPDATE/DELETE/TRUNCATE,
--                   including on the partitioned parent;
--   3. structure  — `events` is partitioned by time, partitions pre-created.

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
