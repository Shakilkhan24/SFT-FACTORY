-- 0001_grants.sql — roles and privileges.
--
-- PROVENANCE (checklist 02 T-1.02): the body is the privilege block from
-- pack `03` §2 (the second ```sql block), extracted programmatically and
-- copied VERBATIM. It is not re-typed.
--
-- The role list is normative: `factory_owner` (migrations), `factory_app`,
-- `factory_projector`, `factory_applier`, `factory_edge`, `factory_readonly`.
--
-- The `factory_owner` role must exist before this file runs; the migration
-- runner creates it (see `tools/migrate.ts`). The other five are created by
-- the same runner and are NOLOGIN in the dev cluster — the `factory` login
-- role is granted each of them.
--
-- `ensure_event_partitions()` needs CREATE on the schema, so it runs ONLY
-- under `factory_owner` — never as `factory_app`.

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
