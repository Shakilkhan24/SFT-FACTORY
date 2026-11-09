#!/usr/bin/env bash
# validate_ddl.sh — executable seed oracle for T-1.02 / T-1.03 (pack 03 §2).
# Extracts the SQL blocks from 03_CONTRACTS_AND_DATA_MODEL.md, applies them to a THROWAWAY database
# and checks the guarantees the architecture relies on. Exit code != 0 if any check fails.
# Verified: PostgreSQL 16.15 (Ubuntu 24.04), all checks PASS against the DDL as shipped in this pack.
# Prereqs: PostgreSQL 16+ running locally; the script uses `su postgres -c psql` (override with PGSUPER="psql -U postgres").
# NOTE: the T-1.02 implementer may EXTEND this file but may not weaken or delete a check (oracle rule, 07 HR-2).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; DOC="${DOC:-$HERE/../03_CONTRACTS_AND_DATA_MODEL.md}"
DB="${DB:-factory_ddl_test}"; PGSUPER="${PGSUPER:-su postgres -c}"
FAIL=0
sup()  { if [ "$PGSUPER" = "su postgres -c" ]; then su postgres -c "psql -q -tA $*"; else $PGSUPER -q -tA "$@"; fi; }
sql()  { # sql <role> <statement> -> prints psql output (errors included)
  local role="$1"; shift
  local f; f="$(mktemp)"; printf 'SET search_path TO factory, public;\nSET ROLE %s;\n%s\n' "$role" "$*" > "$f"; chmod 644 "$f"
  if [ "$PGSUPER" = "su postgres -c" ]; then su postgres -c "psql -q -tA -d $DB -f $f" 2>&1; else $PGSUPER -q -tA -d "$DB" -f "$f" 2>&1; fi
  rm -f "$f"; }
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; FAIL=1; }
expect_ok()    { out="$(sql "$2" "$3")"; if echo "$out" | grep -qiE 'error'; then bad "$1 -> $out"; else ok "$1"; fi; }
expect_error() { out="$(sql "$2" "$4")"; if echo "$out" | grep -qi "$3"; then ok "$1"; else bad "$1 (wanted '$3', got: $out)"; fi; }

python3 - "$DOC" <<'PY'
import re,sys
t=open(sys.argv[1],encoding='utf-8').read(); b=re.findall(r"```sql\n(.*?)```",t,flags=re.S)
open('/tmp/_ddl.sql','w').write(b[0]); open('/tmp/_privs.sql','w').write(b[1])
PY
chmod 644 /tmp/_ddl.sql /tmp/_privs.sql
sup -c "\"DROP DATABASE IF EXISTS $DB\"" >/dev/null 2>&1
sup -c "\"DO \\\$\\\$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['factory_owner','factory_app','factory_projector','factory_applier','factory_edge','factory_readonly'] LOOP IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF; END LOOP; END \\\$\\\$;\"" >/dev/null
sup -c "\"CREATE DATABASE $DB OWNER factory_owner\"" >/dev/null
out="$(sql factory_owner "\\i /tmp/_ddl.sql
SELECT factory.ensure_event_partitions(3);
SELECT factory.ensure_event_partitions(3);
\\i /tmp/_privs.sql" 2>&1)"
if echo "$out" | grep -qi 'error'; then bad "DDL + privileges apply cleanly -> $out"; else ok "DDL + privileges apply cleanly (ensure_event_partitions idempotent)"; fi
n="$(sql factory_owner "SELECT count(*) FROM pg_inherits WHERE inhparent='factory.events'::regclass;" | tail -1)"
[ "$n" = "5" ] && ok "events has default + 4 monthly partitions" || bad "partition count = $n (want 5)"

EVC="(seq,event_id,occurred_at,event_type,aggregate_kind,aggregate_id,aggregate_version,correlation_id,actor_kind,actor_id,authority,payload,hash)"
EV() { echo "INSERT INTO events $EVC VALUES ($1,gen_random_uuid(),${2:-now()},'t','system','x',0,'c','system','s','{}','{}','\\x00');"; }
expect_ok    "factory_app can INSERT events"                       factory_app "$(EV 1)"
expect_error "factory_app cannot UPDATE events"        factory_app "permission denied" "UPDATE events SET event_type='x';"
expect_error "factory_app cannot DELETE events"        factory_app "permission denied" "DELETE FROM events;"
expect_error "factory_app cannot TRUNCATE events"      factory_app "permission denied" "TRUNCATE events;"
expect_error "owner UPDATE blocked by trigger (defence in depth)"   factory_owner "append-only" "UPDATE events SET event_type='x';"
expect_error "owner DELETE blocked by trigger"                      factory_owner "append-only" "DELETE FROM events;"
expect_error "owner TRUNCATE blocked by trigger"                    factory_owner "append-only" "TRUNCATE events;"
expect_error "projector cannot INSERT events"          factory_projector "permission denied" "$(EV 2)"
expect_ok    "projector can SELECT events"             factory_projector "SELECT count(*) FROM events;"
expect_ok    "edge can INSERT edge_outbox (bigserial grant)"       factory_edge "INSERT INTO edge_outbox(kind,task_id,payload) VALUES ('model_usage','tsk_1','{}');"
expect_error "edge_outbox rejects unknown kind"        factory_edge "check constraint" "INSERT INTO edge_outbox(kind,task_id,payload) VALUES ('bogus','t','{}');"
expect_ok    "edge can SELECT task budget columns only" factory_edge "SELECT id,state,budget_usd_micros,spent_usd_micros FROM tasks;"
expect_error "edge cannot SELECT * FROM tasks"         factory_edge "permission denied" "SELECT * FROM tasks;"
expect_error "edge cannot INSERT events"               factory_edge "permission denied" "$(EV 3)"
expect_error "edge cannot UPDATE gateway_tokens"       factory_edge "permission denied" "UPDATE gateway_tokens SET max_tokens_cap=1;"
expect_error "factory_app cannot write definition_versions (A0.7)" factory_app "permission denied" "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('a','\\x00','{}','x');"
expect_ok    "factory_applier can write definition_versions"       factory_applier "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('a','\\x00','{}','x');"
expect_ok    "factory_app can INSERT jobs (sequence grant)"        factory_app "INSERT INTO jobs(task_id,kind,idempotency_key) VALUES ('t','node','k1');"
expect_error "jobs.idempotency_key is unique"          factory_app "duplicate key" "INSERT INTO jobs(task_id,kind,idempotency_key) VALUES ('t','node','k1');"

# gapless counter under concurrency: 20 parallel sessions x 5 transactions
sql factory_owner "ALTER TABLE events DISABLE TRIGGER events_no_update_delete; DELETE FROM events; ALTER TABLE events ENABLE TRIGGER events_no_update_delete; UPDATE event_counter SET value=0;" >/dev/null
for p in $(seq 1 20); do ( for k in 1 2 3 4 5; do sql factory_app "BEGIN;
WITH c AS (UPDATE event_counter SET value = value + 1 RETURNING value)
INSERT INTO events $EVC SELECT value, gen_random_uuid(), now(),'t','system','x',0,'c','system','s','{}','{}','\\x00' FROM c; COMMIT;" >/dev/null; done ) & done; wait
r="$(sql factory_owner "SELECT count(*)||' '||min(seq)||' '||max(seq)||' '||count(DISTINCT seq) FROM events;" | tail -1)"
[ "$r" = "100 1 100 100" ] && ok "gapless strictly-unique seq under concurrency (count/min/max/distinct = $r)" || bad "seq not gapless: $r"
sql factory_app "BEGIN; UPDATE event_counter SET value = value + 1; ROLLBACK;" >/dev/null
r="$(sql factory_owner "SELECT (SELECT value FROM event_counter)||' '||max(seq) FROM events;" | tail -1)"
[ "$r" = "100 100" ] && ok "rollback leaves no seq gap ($r)" || bad "rollback gap: $r"
expect_ok    "far-future event accepted" factory_app "$(EV 500 "'2099-01-01'")"
r="$(sql factory_owner "SELECT count(*) FROM events_default;" | tail -1)"
[ "$r" = "1" ] && ok "out-of-range timestamp lands in the default partition" || bad "default partition rows = $r"
sup -c "\"DROP DATABASE IF EXISTS $DB\"" >/dev/null 2>&1
[ "$FAIL" = "0" ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"; exit "$FAIL"
