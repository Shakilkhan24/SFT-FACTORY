# 02 — Contracts, core, database and the policy engine

> **Phase W1 (5 days) · Tickets T-1.01 … T-1.05 · Gate: none (G1 rows begin in checklist 03)**
>
> This is the **foundation layer**. Every package in the factory imports
> `packages/contracts` and nothing imports it the other way round. If the contracts
> are wrong, every later ticket is wrong in the same way, and you cannot fix it
> without touching all 60 of them.
>
> **The rule that makes this phase work: contract changes are their own tiny ticket.**
> Never edit `packages/contracts` inside another ticket (`HR-12`, `05` §9 interface
> rule). A ticket that needs a contract change opens a `contracts` ticket (S, R3),
> waits for it to merge, rebases, and continues.

---

## PREREQUISITES

* Checklist 01 complete. `pnpm ci` green, scaffold in place.
* S-1 (Postgres append design) **done** — it blocks T-1.02 and T-1.03.
* `packages/contracts` is empty except for what T-1.01 creates.

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-1.01 | canonical-JSON test vectors (key order, unicode, numbers; **rejects NaN/Infinity**); **every YAML example in `03` §4 parses** and a variant with an unknown field is rejected; an unregistered event type is rejected | R-G |
| T-1.02 | **start from `reference/validate_ddl.sh`** (it already passes against the shipped DDL on PostgreSQL 16.15 — extend it, **never weaken it**); applies on an empty DB; as `factory_app`, UPDATE/DELETE/TRUNCATE on `events` **fail**; as `factory_edge`, only `edge_outbox` INSERT succeeds among writes; the partition job is idempotent; the default partition catches out-of-range rows | R-G |
| T-1.03 | 50 concurrent appends ⇒ gapless strictly-increasing `seq` in commit order; a CAS conflict ⇒ `ConcurrencyError` and **no event**; a rollback leaves no `seq` gap; tampering via the owner role is detected by `verifyChain` | R-G |
| T-1.04 | **property tests**: only table transitions succeed; every accepted transition appends ≥1 event; replaying events reproduces the state; `APPROVED→MERGING` refused at L2 unless the trigger is human-initiated with a matching SHA; ABANDONED reachable from any non-terminal; the node machine includes lease-expiry | R-G (property) |
| T-1.05 | unknown action ⇒ DENY; **deny dominates allow** (generated cases); an engine exception ⇒ DENY; autonomy above level ⇒ DENY; E3/E4 ⇒ REQUIRE_APPROVAL; identical input+bundle ⇒ identical decision (property); **the package has no I/O imports** | R-G (property) |

> **T-1.05's oracle is the security core of the whole system.** The property tests are
> what make "deny by default" a fact rather than an intention. Write them first.
>
> **T-1.02's oracle starts from a file that already passes.** Do not rewrite
> `reference/validate_ddl.sh` — extend it. It is the executable seed oracle for the
> DDL, and it is the one artefact in the pack that is already green.

---

## STAGE 1 — The work

### T-1.01 · Contracts and core · W1 · L · R3

**Open ONLY:** pack `03` (all of it — this is the file you code against), blueprint `09` §4.

**Build:**
* `packages/contracts` — Zod schemas for every item in `03` §3–§7. Export JSON Schema
  to `/schemas`.
* `packages/core` — pure helpers: `canonicalJson`, `sha256`, ULID/UUIDv7, `Result`.

**What `packages/contracts` must contain** (from `03` §3):

* **Shared:** `Sha256`, `UsdMicros` (integer micro-USD), `EffectClass` E0–E4, `Tier`
  R0–R4, `Autonomy` 0–4, `Actor`, `Authority` (`basis` ∈ human-access-point |
  policy-decision | approval | system-rule), `Result<T,E>`, `FailureClass` (10 members).
* **Event log:** `EventEnvelope`, `NewEvent`, `EventLog` interface.
* **State:** `StateMachine`.
* **Policy:** `PolicyInput`, `Decision`, `PolicyEngine` — **PURE, total, fail-closed**.
* **Tools:** `ToolCall`, `InvocationContext`, `ToolResult`, `ToolBroker`, `ToolAdapter`.
* **Credentials:** `CredentialBroker`, `SecretStore`.
* **Gateway:** `ModelRequest`, `ModelResponse`, `ModelGateway`, `ProviderAdapter`.
* **Scheduling:** `Scheduler`, `StageExecutor`, `StageInput`, `StageOutput`.
* **Context:** `ContextAssembler`, `ContextEnvelope`.
* **Isolation/harness:** `IsolationProvider`, `Environment`, `HarnessAdapter`.
* **Verification/review/approval/merge:** `OracleService`, `VerificationRuntime`,
  `BlastRadiusScorer`, `PanelAggregator`, `ApprovalService`, `MergeGate`.
* **SCM:** `ScmAdapter`.
* Plus the **definition document kinds** (`03` §4.1–4.11): `FactoryDefinition`,
  `WorkflowDefinition`, `RoleSpec`, `ToolCapability`, `CapabilityGrant`,
  `WorkflowEnvironment`, `RoutingPolicy`, `PolicyBundle`, `CriticalityMap`,
  `RepoOnboarding`, `AcceptanceOracle` manifest, `TaskGraph`.
* Plus the **event vocabulary** (`03` §5), the **state-machine tables** (`03` §6) and
  the **enumerations** (`03` §7).

**Non-negotiable details:**
* `StageOutput` has `confidence?: never` — **no confidence-gated merging exists** (the
  panel must not carry a confidence field; `07` §10).
* `ContextEnvelope.truncations: never[]` — the assembler **fails**, never truncates.
* `EventEnvelope` carries `actor` **and** `authority` on every event (I-3).
* Schema **versioning is mandatory**: add fields, never repurpose a field. The event
  log and the run-artefact store are historical records (blueprint `17` §4.2).

**Stop if:** a blueprint field and `03` disagree → raise it. Do not pick a winner.

---

### T-1.02 · Database schema and migrations · W1 · M · R4

**Open ONLY:** pack `03` §2 (the DDL, **verbatim**), blueprint ADR-0008, pack `01` §6 ADR-0019.

**Build:**
* `migrations/0001_core.sql` — the DDL from `03` §2 **verbatim**. Migrations are
  **forward-only**; never edit an applied migration.
* Roles and grants: `factory_owner` (migrations), `factory_app`, `factory_projector`,
  `factory_applier`, `factory_edge`, `factory_readonly`.
* `ensure_event_partitions` job (monthly partitions created ahead + a default partition).
* `factory db migrate | status | partitions`. Kysely types.

**The append-only design** (ADR-0019, and the reason S-1 exists):

> A plain `bigserial` leaves gaps on rollback and can commit out of order → false
> "lost write" alarms and skipped events in cursor projectors. Instead: a **counter row
> updated under `FOR UPDATE`** (commit-ordered, gapless `seq`) + **per-aggregate `version`
> CAS** on the aggregate row. Projectors read by `seq`. Monthly time partitions.
>
> *Revisit trigger:* if p95 append >50 ms or >200 events/s sustained → switch to
> sequence + snapshot-safe reader.

**Append-only is enforced in three layers:** the DB role has no UPDATE/DELETE/TRUNCATE
on `events`; triggers raise; partitions are pre-created.

**This ticket is R4.** The owner reads every line of the DDL and the grants.

---

### T-1.03 · Event log · W1 · M · R4

**Open ONLY:** pack `02` §4.2, blueprint `09` §4–6.

**Build** `packages/eventlog`:

* `append(events[], expectedVersions)` in **one DB transaction**:
  take the counter row `FOR UPDATE` → assign gapless `seq` → CAS-bump the aggregate row
  version where the event changes state → insert → compute
  `hash = sha256(prev_hash ‖ canonicalJson(envelope))` (chain **per aggregate**) →
  `NOTIFY factory_events`.
* `read` — by aggregate, by correlation id, by `seq` range, by type.
* `verifyChain(aggregate)`.
* A **redaction hook** applied **before insert** (`redaction.applied[]` lists what).
* Atomic multi-append.

**Failure behaviour:** a transaction rollback leaves no partial state; an append failure
aborts the surrounding operation — **state and event are never separated**. Gaps in `seq`
or non-contiguous state-changing aggregate versions raise a monitor alert.

**This ticket is R4.**

---

### T-1.04 · State machines · W1 · M · R3

**Open ONLY:** pack `03` §6 (the machine-readable tables), blueprint `09` §2–§3.

**Build** `packages/state`: the transition tables + **pure guards** + `transition()` over
the event log.

* **19 task states and 8 node states**, and the transition table, **verbatim** from
  `09` §2.2/§3.
  > The roadmap text says "20 states"; `09` §2.1 lists 19 and **is authoritative**.
  > This is a known discrepancy in the corpus — do not "fix" it by inventing a state.
* `transition(cmd)`: lock the aggregate row → check `(from,to)` is allowed → evaluate the
  named guard (a pure function over the snapshot + policy decision) → update state and
  version → append event(s) → return.
* An illegal transition ⇒ `ConcurrencyError | IllegalTransition`, **no state change**, and
  a `policy.denied`-class event.

**The `APPROVED → MERGING` guard is where the autonomy ladder is enforced.** At L2 the
only accepted trigger is a **human-initiated action** — a webhook from a human merge
whose PR head SHA equals the approved SHA (blueprint `09` §2.3, ADR-0003).

---

### T-1.05 · Policy engine · W1 · M · R4

**Open ONLY:** blueprint ADR-0004, blueprint `13` §2, blueprint `11` §4, pack `02` §4.4,
pack `03` §3 + §4.7.

**Build** `packages/policy/**` + `definition/policy-bundle.yaml` v1.

**The algorithm, fail-closed, in this order:**

1. Validate the input against the schema → invalid ⇒ `DENY(invalid_input)`.
2. Any matching **deny rule** (path deny, action deny, forbidden scope) ⇒ `DENY` listing
   **every** matched rule id. **Deny dominates.**
2b. **Equivalent-effect check (AT-14):** if `priorDenials` — supplied by the broker from
   this task's recorded denials — already contains the same
   `(effectClass, resourceKey)` pair via a *different* capability ⇒ `ESCALATE` (the
   task is flagged to a human; the second attempt is **not** executed).
3. Autonomy check: the action's required level > the workflow's level ⇒ `DENY(autonomy)`.
4. Grant check: effective grant = `workflow ∩ stage ∩ resource`; capability or scope
   absent ⇒ `DENY(no_grant)`.
5. Effect class: E0/E1 ⇒ allow; E2 ⇒ allow only if the resource scope matches;
   **E3/E4 ⇒ `REQUIRE_APPROVAL` (artefact-bound)**. v1 registers **no** E3/E4 capability.
6. Tier rule: tier ≥ R3 on approve/merge-class actions ⇒ `REQUIRE_APPROVAL(security-scope)`.
7. Default ⇒ **`DENY(default)`**.

Any thrown error ⇒ `DENY(engine_error)`.

**Output:** `{outcome, ruleIds[], reason, bundleSha256, requiredApproval?}`. Every decision
is persisted (`policy_decisions`) and emitted (`policy.allowed | denied | escalated`).

**Enforcement points** (these are where the engine is *called*): broker step 5,
state-transition guards, scheduler admission, approval decide, definition apply, and
the egress proxy (host allow-list derived from grants).

**Pure:** no `node:fs/net/child_process`, no `pg`, no network, no clock, no randomness
except injected. Enforced by `pnpm lint:deps`.

**Stop if:** a rule seems to need model output. Then the rule is wrong, not the engine.

**This ticket is R4.**

---

## STAGE 2 — Review

Standard reviewer pass (`PROTOCOL.md`, Stage 2). T-1.02, T-1.03 and T-1.05 are **R4** —
the owner reads every line, and the owner may **apply a mutation to the main guard and
watch a test fail** (see checklist 14).

---

## GATE ROWS

No gate rows are closed by this phase alone — G1 is closed in checklist 03. But this
phase **creates** rows that checklist 03 depends on:

| Row (closed later) | Statement | Closed in |
|---|---|---|
| CL-G1-11 | INV-1, 2, 3, 5, 8, 9, 12 exist and pass | checklist 03 |
| CL-G1-07 🔒 | **A0.7** a control-surface write to the definition without a reviewed change is rejected | checklist 03 (T-1.06) |
| CL-G1-18 🔒 | The DDL oracle passes on the migrated database: append-only for every role, edge least-privilege, gapless `seq` under concurrency | checklist 03 (T-1.17) |

---

## EXIT CRITERIA — before checklist 03

- [ ] `packages/contracts` exports every schema listed above; `pnpm ci` green.
- [ ] **Every YAML example in `03` §4 parses**, and an unknown field is rejected.
- [ ] Canonical-JSON vectors pass; NaN/Infinity rejected.
- [ ] `migrations/0001_core.sql` applied to a throwaway Postgres; `reference/validate_ddl.sh`
      passes **as extended**, with no weakening.
- [ ] As `factory_app`, UPDATE/DELETE/TRUNCATE on `events` **fail**.
- [ ] As `factory_edge`, only `edge_outbox` INSERT succeeds among writes.
- [ ] 50 concurrent appends ⇒ gapless, strictly-increasing `seq` in commit order.
- [ ] `verifyChain` detects owner-role tampering.
- [ ] Property tests green: only table transitions succeed; replay reproduces state;
      `APPROVED→MERGING` refused at L2 without a human-initiated matching SHA.
- [ ] Policy property tests green: unknown ⇒ DENY; deny dominates; exception ⇒ DENY;
      identical input ⇒ identical decision. **No I/O imports in `packages/policy`.**
- [ ] `docs/build-metrics.csv` has a row for each of the five tickets.

---

## TRAPS

1. **Editing `packages/contracts` from another ticket.** Forbidden (`HR-12`). Open a tiny
   `contracts` ticket, wait for it to merge, rebase.
2. **Hand-writing the DDL instead of using `03` §2 verbatim.** The pack's DDL is the
   contract; `validate_ddl.sh` is written against it. A re-typed DDL drifts.
3. **Using `bigserial`.** ADR-0019 explains exactly why it fails: gaps on rollback,
   out-of-order commits, false "lost write" alarms, skipped events in cursor projectors.
4. **Putting state changes and event appends in separate transactions.** They must be
   one. Otherwise I-3 (every consequential action is attributable and in the log) is
   false under crash.
5. **Adding a confidence field to `StageOutput`.** `confidence?: never` is deliberate —
   confidence-gated merging without calibration is on the must-not-build list.
6. **Implementing the 20th task state** because the roadmap says 20. `09` §2.1 lists 19
   and is authoritative. Inventing a state breaks the table.
7. **Making the policy engine do work a model should do** ("if the rule is ambiguous,
   ask the model"). Commitment 2: policy is deterministic, orchestration is probabilistic,
   and they are never the same component. A model in the policy path breaks I-2, I-3 and
   every invariant that depends on them.
8. **Allowing by default at the end of the algorithm.** The default branch is `DENY`.
   If you find yourself writing `else ALLOW`, stop.
