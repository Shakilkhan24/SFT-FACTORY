-- 0002_projections.sql — the `task_current` projection table.
--
-- PROVENANCE (checklist 03 T-1.15): pack `03` §2's "Further tables" table
-- says the columns are **normative** and the DDL is "written in the owning
-- ticket". The column list below is that table's row for `task_current`,
-- transcribed verbatim:
--
--   task_current (projection) — task_id pk, repo, workflow, state, risk_tier,
--   needs_human bool, last_activity_at, spent_usd_micros, budget_usd_micros,
--   summary jsonb
--
-- The types are this ticket's own choice; the pack fixes the columns, not
-- the SQL types. The rules the pack's own tables follow are followed here:
-- a `text` primary key, `timestamptz` for a timestamp, `bigint` for money
-- (integer micro-USD, per AGENTS.md §4), `jsonb` for the free-form view.
--
-- WHY ONLY THIS ONE TABLE:
-- pack `03` §2 assigns the other projection tables to later tickets —
-- `review_queue` → T-2.16, `approval_queue` → T-2.09,
-- `cost_attribution` → T-4.05, `workflow_performance`/`agent_performance` →
-- T-4.01, `calibration_*` → T-4.02/T-4.04. T-1.15 owns `task_current` and
-- only `task_current`. The projector computes the other two as **shells**
-- (the reduction and the cursor are real; the table is not), so writing
-- those tables here would take a DDL away from its owner.
--
-- FORWARD-ONLY (pack `03` §2): never edit an applied migration. A change is
-- a new `0003_*.sql`.
--
-- PRIVILEGES: every later migration that adds a table adds its own explicit
-- GRANTs in the same file; default privileges are NOT used. The projector
-- reads the log and writes **only** its own views — it never writes `events`.
-- It needs UPDATE because a projection row is rewritten as the task moves;
-- it does NOT need DELETE, because a row is never deleted (the log is
-- append-only, so a "removal" is a projection of a removal **event**, and
-- the row is left with the state that event produced).

CREATE SCHEMA IF NOT EXISTS factory; SET search_path TO factory, public;

CREATE TABLE task_current (
  task_id           text        PRIMARY KEY,               -- the task's id
  repo              text        NOT NULL,
  workflow          text        NOT NULL,
  state             text        NOT NULL,
  risk_tier         text        CHECK (risk_tier IN ('R0','R1','R2','R3','R4')),
  needs_human       boolean     NOT NULL DEFAULT false,
  last_activity_at  timestamptz NOT NULL,
  spent_usd_micros  bigint      NOT NULL DEFAULT 0,       -- integer micro-USD
  budget_usd_micros bigint      NOT NULL DEFAULT 0,       -- integer micro-USD
  summary           jsonb       NOT NULL DEFAULT '{}'     -- the free-form view
);
CREATE INDEX task_current_state_idx     ON task_current (state);
CREATE INDEX task_current_last_act_idx  ON task_current (last_activity_at);
CREATE INDEX task_current_needs_human_idx ON task_current (needs_human) WHERE needs_human;

GRANT SELECT, INSERT, UPDATE ON task_current TO factory_projector;
GRANT SELECT ON task_current TO factory_readonly;
