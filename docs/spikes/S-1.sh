#!/usr/bin/env bash
# docs/spikes/S-1.sh — the S-1 spike: Postgres append design.
#
# S-1 must confirm (pack 05 §1):
#   1. gapless `seq` under 50 concurrent writers
#   2. row triggers fire on partitions
#   3. the app role truly cannot UPDATE/DELETE/TRUNCATE
#   4. NOTIFY payload carries only `seq` (size limit)
#
# This script is the throwaway proof. It creates a scratch schema, exercises the four
# claims, and prints what it observed. It writes no production code.
#
# Run against the dev cluster:  bash docs/spikes/S-1.sh

set -euo pipefail

PSQL="docker exec -i factory-postgres-dev psql -v ON_ERROR_STOP=1 -U factory -d factory"

banner() { printf '\n=== %s ===\n' "$1"; }

banner "S-1.0 — Postgres version and server settings"
$PSQL -c "select version();"
$PSQL -c "show max_connections;"

banner "S-1.1 — scratch schema (throwaway)"
$PSQL <<'SQL'
DROP SCHEMA IF EXISTS spike_s1 CASCADE;
CREATE SCHEMA spike_s1;

-- The counter row: `seq` comes from here, under a row lock.
CREATE TABLE spike_s1.counter (
  id     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value  bigint  NOT NULL DEFAULT 0
);
INSERT INTO spike_s1.counter (id, value) VALUES (1, 0);

-- The partitioned event table.
--
-- The PK is (seq, occurred_at), NOT (seq) alone: Postgres requires a unique constraint
-- on a partitioned table to include every partitioning column. The pack's DDL
-- (pack 03 §2) already has it this way — `PRIMARY KEY (seq, occurred_at)`.
CREATE TABLE spike_s1.events (
  seq         bigserial   NOT NULL,
  task_id     text        NOT NULL,
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seq, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE spike_s1.events_2026_11 PARTITION OF spike_s1.events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

-- The default partition: out-of-range rows must land somewhere, not vanish.
CREATE TABLE spike_s1.events_default PARTITION OF spike_s1.events DEFAULT;

-- A row-level trigger on the partitioned parent.
CREATE TABLE spike_s1.trigger_log (
  seq     bigint,
  at      timestamptz DEFAULT now()
);
CREATE FUNCTION spike_s1.log_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO spike_s1.trigger_log (seq) VALUES (NEW.seq);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_log_insert
  AFTER INSERT ON spike_s1.events
  FOR EACH ROW EXECUTE FUNCTION spike_s1.log_insert();
SQL

banner "S-1.2 — does the row trigger fire on the PARTITION?"
$PSQL <<'SQL'
INSERT INTO spike_s1.events (task_id, payload)
  VALUES ('t-1', '{"a":1}');
SELECT count(*) AS trigger_rows FROM spike_s1.trigger_log;
SQL

banner "S-1.3 — the append function: counter lock → gapless seq"
$PSQL <<'SQL'
CREATE OR REPLACE FUNCTION spike_s1.append(p_task_id text, p_payload jsonb)
RETURNS bigint AS $$
DECLARE
  v_seq bigint;
BEGIN
  -- The counter row is locked FOR UPDATE, so concurrent callers serialise here.
  UPDATE spike_s1.counter SET value = value + 1 WHERE id = 1 RETURNING value INTO v_seq;
  INSERT INTO spike_s1.events (seq, task_id, payload) VALUES (v_seq, p_task_id, p_payload);
  PERFORM pg_notify('spike_s1_events', v_seq::text);
  RETURN v_seq;
EXCEPTION WHEN OTHERS THEN
  -- A rollback must NOT consume a seq value: the UPDATE is rolled back with the
  -- transaction, so the counter goes back too.
  RAISE;
END;
$$ LANGUAGE plpgsql;
SQL

banner "S-1.4 — 50 concurrent writers: is seq gapless and strictly increasing?"
$PSQL <<'SQL'
DO $$
DECLARE
  i int;
BEGIN
  FOR i IN 1..50 LOOP
    PERFORM spike_s1.append('task-' || i, jsonb_build_object('i', i));
  END LOOP;
END $$;
SQL

echo "--- 50 sequential appends above. Now the concurrent case. ---"

# 50 concurrent sessions, each appending once.
for i in $(seq 1 50); do
  $PSQL -c "SELECT spike_s1.append('concurrent-$i', '{\"i\":$i}');" > /dev/null 2>&1 &
done
wait

$PSQL <<'SQL'
-- `gapless` means: the seq values present form a contiguous run. With one event
-- deliberately rolled back (S-1.5), the counter also rolls back, so the run stays
-- contiguous — that is the property being tested.
SELECT
  count(*)                     AS total,
  count(DISTINCT seq)          AS distinct_seq,
  min(seq)                     AS min_seq,
  max(seq)                     AS max_seq,
  (max(seq) - min(seq) + 1)    AS span,
  (max(seq) - min(seq) + 1) = count(DISTINCT seq) AS gapless
FROM spike_s1.events;
SQL

banner "S-1.5 — does a ROLLBACK leave a seq gap?"
# The append and the deliberate rollback are in ONE transaction, so the transaction rolls
# back — including the counter UPDATE. The seq value must not be consumed.
#
# The rollback is done in a plpgsql block with an exception handler, so the failure does
# not abort the surrounding psql session.
$PSQL <<'SQL'
SELECT spike_s1.append('before-rollback', '{}');

DO $$
BEGIN
  BEGIN
    PERFORM spike_s1.append('in-rollback', '{}');
    RAISE EXCEPTION 'deliberate rollback';
  EXCEPTION WHEN OTHERS THEN
    -- Swallow the error; the subtransaction rolls back to the savepoint, undoing
    -- BOTH the insert and the counter increment.
    NULL;
  END;
END $$;

SELECT value AS counter_after_rollback FROM spike_s1.counter;
SELECT count(*) AS total_events FROM spike_s1.events;
SELECT count(DISTINCT seq) AS distinct_seq FROM spike_s1.events;
SELECT max(seq) - min(seq) + 1 AS span,
       max(seq) - min(seq) + 1 = count(DISTINCT seq) AS still_gapless
FROM spike_s1.events;
SQL

banner "S-1.6 — the app role: can it UPDATE/DELETE/TRUNCATE the events table?"
$PSQL <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_app') THEN
    CREATE ROLE factory_app LOGIN PASSWORD 'dev-only-not-a-secret';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factory_edge') THEN
    CREATE ROLE factory_edge LOGIN PASSWORD 'dev-only-not-a-secret';
  END IF;
END $$;

GRANT USAGE ON SCHEMA spike_s1 TO factory_app, factory_edge;
GRANT SELECT, INSERT ON spike_s1.events TO factory_app;
GRANT SELECT, INSERT ON spike_s1.events TO factory_edge;
GRANT USAGE, SELECT ON SEQUENCE spike_s1.events_seq_seq TO factory_app, factory_edge;
GRANT EXECUTE ON FUNCTION spike_s1.append(text, jsonb) TO factory_app, factory_edge;
SQL

echo "--- as factory_app: UPDATE ---"
$PSQL -c "SET ROLE factory_app; UPDATE spike_s1.events SET payload = '{\"tampered\":true}';" 2>&1 | head -3 || true
echo "--- as factory_app: DELETE ---"
$PSQL -c "SET ROLE factory_app; DELETE FROM spike_s1.events;" 2>&1 | head -3 || true
echo "--- as factory_app: TRUNCATE ---"
$PSQL -c "SET ROLE factory_app; TRUNCATE spike_s1.events;" 2>&1 | head -3 || true

banner "S-1.7 — the NOTIFY payload"
# A NOTIFY is delivered at COMMIT, so the listener must already be waiting. The listener
# runs in the background; the append happens after it is connected.
( timeout 8 $PSQL <<'SQL' 2>&1 || true
LISTEN spike_s1_events;
SELECT pg_sleep(6);
SQL
) &
sleep 2
# The payload is deliberately large: the point is that only `seq` is carried, not the
# event body.
$PSQL -c "SELECT spike_s1.append('notify-test', jsonb_build_object('payload', repeat('x', 5000)));" > /dev/null
wait

banner "S-1.8 — NOTIFY payload size"
$PSQL <<'SQL'
-- What the factory actually sends: the seq as text.
SELECT length('1234567890') AS notify_payload_bytes;
-- The size of the event body that was NOT sent.
SELECT pg_column_size(repeat('x', 5000)) AS event_body_bytes;
SQL

banner "S-1.8 — NOTIFY payload size"
$PSQL -c "SELECT pg_column_size(1::text) AS one_char, length('x' || repeat('y', 8000)) AS big_payload;"

banner "S-1.9 — cleanup"
$PSQL -c "DROP SCHEMA IF EXISTS spike_s1 CASCADE;"
$PSQL -c "DROP ROLE IF EXISTS factory_app; DROP ROLE IF EXISTS factory_edge;"

echo
echo "S-1 spike script complete."
