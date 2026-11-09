# 06 — Requirements and Non-Functional Requirements

**Purpose:** the traceable requirement set the reference architecture must satisfy, with non-functional requirements and their verification method.

**Source of truth for:** requirement IDs and their acceptance criteria.
**Referenced by:** `07_REFERENCE_ARCHITECTURE.md`, `08_AGENT_CATALOG_AND_CONTRACTS.md`, `09_ORCHESTRATION_STATE_AND_EVENTS.md`, `14_QUALITY_TESTING_AND_EVALUATION.md`, `16_IMPLEMENTATION_ROADMAP.md`.

**Requirement type codes:** `FR` functional · `NFR` non-functional · `SEC` security · `GOV` governance · `OPS` operational · `MEAS` measurement.
**Derivation:** every requirement carries its source basis — `CP-*` (convergent principle), `D-*` (design claim), `CO-*` (complement), `ADR-*`, or `[E3]` for engineering judgement not traceable to a source.

---

## 1. Foundation requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-01 | The factory shall execute a complete software-delivery lifecycle from intent to production, with agents performing the work and humans providing intent and judgement. | FR | CP-1, CP-4, D-04, D-05 | Workflow A completes end-to-end in a staging environment with a recorded artefact chain |
| FR-02 | The factory's configuration shall be declared as version-controlled data, and all changes to it shall be reviewed before application. | FR | ADR-0001, D-26, D-57 | A change to any declared setting requires a merged change record before taking effect |
| FR-03 | The factory shall expose a small, enumerated set of typed access points through which humans act, and no other sanctioned human-to-factory channel. | FR | D-25, ADR-0002 | The access-point catalogue is complete; no other write path to control-plane authority exists |
| FR-04 | Every workflow shall be assignable an autonomy level, and the control plane shall refuse execution above the assigned level. | GOV | ADR-0003, D-52 | A level-violation attempt is rejected, logged, and surfaced |
| FR-05 | The factory shall support two workflows for every task: one producing a change for human review, and one producing a proposal for human application. | FR | CP-3, D-04 | Both paths are exercised in the acceptance suite |
| FR-06 | The factory shall treat a factory change, a skill change, and a policy change as change to the same reviewed definition, with scope-differentiated approval bars. | GOV | ADR-0007, D-24 | A harness-scope change cannot be merged without batch evidence and replay evaluation |

---

## 2. Context, skills and specification requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-10 | The factory shall maintain a versioned corpus of skills, each expressing either a workflow to complete or a standard to adhere to. | FR | D-17, D-19 | Skills are versioned, diffable, and reviewable as code |
| FR-11 | The factory shall maintain a specification for every task, carrying explicit acceptance criteria, before implementation begins. | FR | CP-1, D-13 | No task reaches the implementer without acceptance criteria |
| FR-12 | The factory shall maintain an acceptance oracle for each task, constituted by tests written against the specification and not against the implementation. | FR | D-12, ADR-0005 | The oracle's provenance is recorded and is independent of the implementing run |
| FR-13 | The factory shall maintain both repository-local and central context, resolve precedence deterministically, and pin the resolved context per run. | FR | ADR-0009, D-21, D-22 | Two runs of the same task resolve identical context; the resolution is reproducible |
| FR-14 | The factory shall continuously detect outdated, duplicate, and stale context across the estate and report remediation actions. | FR | D-21 | An inventory report is produced on a schedule and its counts are tracked over time |
| FR-15 | The factory shall provide a mechanism to promote a repository-local context artefact to central, and to demote a central artefact to local. | FR | ADR-0009 | Promotion produces a reviewed change and leaves a pointer at the local site |
| FR-16 | The factory shall ensure that context which changes what agents may or may not do is subject to security-relevant review, versioning, and provenance recording. | SEC | D-56, ADR-0004 | A context change cannot merge without the elevated review class |

---

## 3. Orchestration, state and event requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-20 | The control plane shall hold the single authoritative state for tasks, workflows, approvals, and configuration. | FR | D-25, ADR-0002, ADR-0008 | The data plane contains no authoritative state; it cannot mutate control state except via a command |
| FR-21 | Every consequential action shall be appended to an immutable event log with actor, authority, correlation id, and outcome. | FR | D-59, ADR-0008, ADR-0011 | Every action has exactly one corresponding log entry |
| FR-22 | The factory shall persist workflow state after every step, such that an interrupted workflow resumes or fails explicitly. | FR | ADR-0008, CP-3 | Killing the control plane mid-run and restarting yields a resumed or explicitly failed task, never a silent loss |
| FR-23 | The factory shall represent every task as a graph whose edges are classified independent or dependent, with a recorded topology justification. | FR | ADR-0010, D-29 | Every fan-out edge carries a four-condition chunkability justification |
| FR-24 | The factory shall not fan out work that fails any chunkability condition. | FR | ADR-0010 | The planner refuses to emit a fan-out edge lacking a passing justification |
| FR-25 | Dependent stages shall execute sequentially with a context boundary between them; no stage shall inherit a predecessor's context. | FR | D-16, ADR-0010 | A test demonstrates the downstream context contains the upstream artefact and nothing else from the upstream run |
| FR-26 | The factory shall reconcile actual state to the declared definition, and shall report rather than silently correct divergence. | FR | ADR-0001, D-26 | Drift appears in the operational surface with a recommended action |

---

## 4. Agent runtime and organisation requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-30 | The factory shall define agents as specifications (responsibility, context scope, tool scope, model policy, evaluation, limits) rather than as fixed deployments. | FR | ADR-0010, V05/V10 staging argument | Role specifications are data; a workflow may realise a role as a distinct agent or a scoped stage |
| FR-31 | Where two role specifications are identical in context, tools, authority, and evaluation, the factory shall realise them as one. | FR | D-29, ADR-0010 | A duplicate-specification check runs over the catalogue at build time |
| FR-32 | Each agent run shall have a turn budget and a wall-clock budget; exceeding either shall return control to a human with partial artefacts preserved and labelled. | FR | D-37 | A run that exceeds its budget stops and yields a labelled partial result |
| FR-33 | Model selection shall be a runtime configuration decision, not a code change. | FR | D-23, ADR-0012 | A model substitution is a definition change, applied without a code deployment |
| FR-34 | The factory shall route model selection by task difficulty and context scope, with a fallback on failure, and shall enforce per-task and per-workflow budgets. | FR | D-32, D-23 | A budget breach halts the run with a recorded reason |
| FR-35 | The factory shall support an agent performing a review that is independent of the agent that produced the artefact under review. | FR | CP-3, D-33 | The reviewer identity differs from the implementer identity for every merge path |

---

## 5. Execution environment requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-40 | Every task shall execute in an isolated environment appropriate to its risk tier. | FR | CP-2, ADR-0006 | Every run records its isolation tier; T2+ is enforced for any task that executes code |
| FR-41 | No task shall modify a protected branch directly; all changes shall be delivered as reviewable change records. | FR | D-30 | A direct commit to a protected branch is rejected by the control plane |
| FR-42 | Execution environments, credentials, and worktrees shall be reclaimed when a task reaches a terminal state, including on failure. | FR | ADR-0006 | A leak detector confirms no orphaned resources after a fault-injection test |
| FR-43 | The factory shall support concurrent tasks without uncontrolled interference between them. | FR | CP-2 | A concurrency suite demonstrates no cross-task contamination at the configured concurrency limit |
| FR-44 | The execution environment shall be reconstructible from declared inputs, such that a failed run can be reproduced. | OPS | D-31, D-55 | A recorded run can be re-executed from its manifest with an equivalent result |

---

## 6. Quality and verification requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-50 | The factory shall maintain a layered test suite with an explicit authorship policy per layer. | FR | ADR-0005, D-42, D-40, D-41 | The policy is enforced by the merge gate; violations are rejected |
| FR-51 | The acceptance oracle shall be the primary merge gate; a passing suite without a passing oracle shall not merge. | FR | D-12, ADR-0005 | A negative test confirms the merge is blocked |
| FR-52 | Agent-authored tests shall be marked untrusted until reviewed, and shall not alone satisfy an acceptance criterion. | FR | ADR-0005, D-41 | A test demonstrates the gate behaviour for an agent-authored acceptance test |
| FR-53 | The factory shall run static analysis, linting, type checking, and security scanning as mandatory merge gates. | FR | D-46 | These are required checks in the CI configuration |
| FR-54 | The factory shall provide a mechanism to generate narrow verifiers from written standards, runnable in CI. | FR | D-43 | A standard expressed as a skill produces a runnable verifier |
| FR-55 | A verifier shall be permitted to substitute for human review only after it has been demonstrated, on that repository and for that class of change, to fail when the property is violated. | GOV | ADR-0003, ADR-0005, D-47 | A calibration report exists and is current before the substitution takes effect |
| FR-56 | The factory shall distinguish review by specification conformance from review by observed behaviour. | FR | V01/V15 validation concepts | Review output records which validation mode was applied |
| FR-57 | The factory shall maintain a benchmark of known violations per verifier property, used for calibration and regression detection. | MEAS | ADR-0003, ADR-0005 | Each gated verifier has a calibration corpus with a recorded detection rate |
| FR-58 | The factory shall not merge a change that has not passed every mandatory gate applicable to its blast radius. | GOV | D-36, ADR-0003 | Blast-radius tiering determines the applicable gate set; bypass is rejected |

---

## 7. Tool and integration requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-60 | The factory shall maintain a registry of callable tools with owner, schema, scope, health, and version metadata. | FR | V10, V15, [E3] | Every invocable capability resolves to a registry entry |
| FR-61 | Tools shall be scoped per workflow and, where appropriate, per stage; an agent shall receive only the tools its stage requires. | SEC | D-15, ADR-0004, ADR-0006 | A test demonstrates a read-only stage cannot invoke a write tool |
| FR-62 | The registry shall support MCP as one transport among several; a capability shall be reachable regardless of its transport. | FR | D-15, ADR-0012 | A non-MCP tool is registered and invoked through the same broker path |
| FR-63 | The factory shall broker credentials so that secrets are never present in an agent's context or prompt. | SEC | ADR-0006, §4 evidence gaps | A test demonstrates absence of secret material in the assembled context |
| FR-64 | The factory shall health-check registered integrations and degrade gracefully when one is unavailable. | OPS | [E3], directive §6.5 | A failing integration produces a defined degraded mode, not a hang |
| FR-65 | The factory shall record every tool invocation with tool identity, argument summary, result summary, duration, and cost. | MEAS | ADR-0011 | The event log contains a complete tool-call trail for every run |
| FR-66 | The factory shall support an environment-declaration mechanism whereby a workflow declares its required integrations, schedule, and permissions. | FR | D-58 (V15 45:46) | A declared workflow is provisioned with exactly its declared capabilities |

---

## 8. Security and governance requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| SEC-01 | The control plane shall evaluate policy for every consequential action, and no agent shall be able to bypass that evaluation. | SEC | ADR-0004 | A test demonstrates that a direct capability call without a policy decision fails |
| SEC-02 | Deterministic policy authority shall be separate from probabilistic orchestration authority, and no agent shall widen its own scope or autonomy. | SEC | ADR-0004 | A scope-escalation attempt is denied and logged |
| SEC-03 | Content originating outside the trusted boundary shall be tagged untrusted, passed in a marked envelope, and never treated as instruction. | SEC | ADR-0004, [E3] | The red-team suite demonstrates injected instructions cannot alter an action |
| SEC-04 | Credentials shall be ephemeral, per-task, least-privilege, brokered, and revoked at task end. | SEC | ADR-0006 | A test demonstrates a task cannot use a credential after termination |
| SEC-05 | Network egress from execution environments shall be default-deny, with per-workflow allow-lists declared and reviewed. | SEC | ADR-0006 | A test demonstrates an undeclared destination is unreachable |
| SEC-06 | The factory shall enforce least privilege for agents, skills, workflows, and tools. | SEC | CP-3, D-25, ADR-0004 | Each principal holds only its declared capabilities |
| SEC-07 | The factory shall maintain an immutable audit trail of every consequential action, with the authority that authorised it. | SEC | D-59, ADR-0002 | An auditor can reconstruct any action's authorisation |
| SEC-08 | Production access shall be restricted to enumerated, runbook-backed operations, with abort conditions and post-hoc review. | SEC | ADR-0003 | An operation outside the enumerated set is refused |
| SEC-09 | Dependency integrity shall be verified, and context/skill artefacts shall be provenance-recorded and integrity-checked. | SEC | D-56, [E3] | A tampered context artefact is detected and rejected |
| SEC-10 | The factory shall support rollback of any deployed change, including agent-made changes. | SEC | [E3], evidence gaps | A rollback drill restores a known-good state within an agreed time |
| SEC-11 | No agent shall be able to modify the factory definition, policy set, skill corpus, or verifier set outside the reviewed-change process. | SEC | ADR-0007 | An attempted write through every available tool path is rejected |
| SEC-12 | The factory shall support repository isolation, such that an agent in one repository cannot access another's artefacts or credentials. | SEC | ADR-0006 | A cross-repository access attempt is refused and recorded |

---

## 9. Human control plane requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-70 | The factory shall provide an operational surface showing work in flight, state, cost, and outcome, and permitting pause, cancel, and escalation. | FR | CP-12, D-25 | The surface covers all in-flight work |
| FR-72 | The factory shall provide a review queue ordered by blast radius, not by arrival time. | FR | CP-7, D-35, D-36 | Queue ordering is explained by the recorded risk score |
| FR-73 | Approval requests shall be risk-prioritised, and the factory shall detect and surface approval-fatigue indicators (volume, latency, rubber-stamp rate). | GOV | ADR-0003, [E3] | Metrics exist and are surfaced |
| FR-74 | The factory shall support plan-first approval, where a human approves an agent's plan before execution. | FR | D-53 | The approval artefact is the plan, and execution is checked against it |
| FR-75 | The factory shall support approval attached to an individual sensitive tool invocation. | FR | D-39 | A sensitive tool call blocks pending approval |
| FR-76 | During incident response, the alert shall carry the agent's candidate fix and reasoning, so human effort is spent on judgement rather than diagnosis. | FR | D-38 | An incident drill demonstrates the alert contents |
| FR-77 | The factory shall support humans contributing to the codebase through the factory, with such contributions subjected to the same quality gates. | FR | D-61, M-09 | A non-engineering contribution follows the standard merge path |

---

## 10. Delivery and operations requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-80 | The factory shall maintain a versioned, reviewable context corpus that is versioned with the product code where it is repository-local. | FR | D-19, D-22, ADR-0009 | A context change is reviewed alongside code changes |
| FR-81 | The factory shall maintain a searchable engineering-knowledge store recording decisions, rationale, and outcomes. | FR | D-28 (V13 knowledge agent) | A decision is retrievable by topic and linked to the change that implemented it |
| FR-82 | The factory shall maintain documentation as an automated artefact of the change, not a separate manual task. | FR | D-28 (V13 docs agent) | A merged change produces or updates the corresponding documentation |
| FR-83 | The factory shall support multi-repository work by decomposing a cross-repository task into per-repository changes with an explicit integration plan. | FR | D-28 (V13) | A cross-repo task produces the expected per-repo changes and an integration sequence |
| FR-84 | The factory shall expose production health signals back into the control plane, and shall be able to create maintenance loops from recurring signals. | FR | D-58, D-60 | A production signal can trigger a maintenance workflow |
| FR-85 | The factory shall support recurring maintenance loops covering dependency upgrades, flaky tests, coverage gaps, and conformance sweeps. | FR | D-60 (V15 35:03–35:14) | Each loop type runs on schedule and reports |
| FR-86 | The factory shall not permit an agent to act on production systems except through an enumerated, runbook-backed operation. | SEC | ADR-0003, SEC-08 | Enforced and audited |

---

## 11. Measurement requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| MEAS-01 | The factory shall record a complete run artefact for every run, capturing inputs, context versions, model and configuration versions, tool calls, verification results, artefacts, outcome, and cost. | MEAS | ADR-0011, D-59 | A run is fully reconstructible from its artefact |
| MEAS-02 | Telemetry shall be emitted by the framework, not by agents. | MEAS | ADR-0011 | No metric originates from an agent's self-report |
| MEAS-03 | Every factory change shall be reported with a baseline, a delta, a cost, and at least one guardrail metric. | MEAS | ADR-0011, D-59 (M-02 method) | A change without all four cannot be merged |
| MEAS-04 | Cost shall be attributable to the accepted change. | MEAS | ADR-0011, D-59 | Cost per accepted change is computable and reconciled with billing |
| MEAS-05 | The factory shall measure the metrics enumerated in `14_QUALITY_TESTING_AND_EVALUATION.md` §2, each with a definition, collection point, owner, and threshold. | MEAS | directive §10 | The metric catalogue is complete and populated |
| MEAS-06 | No target shall be set from any figure reported in the research corpus. | MEAS | ADR-0011, evidence ledger §2 | Targets are traceable to the factory's own baseline only |
| MEAS-07 | The factory shall support replaying a historical run against a candidate harness or configuration change. | MEAS | ADR-0007, D-50 | Replay produces a comparable result set |
| MEAS-08 | The factory shall measure and report agent failure rate with a taxonomy separating model-reasoning failures from workflow-composition failures. | MEAS | D-49, M-03 | Failures are classifiable and the split is reported |

---

## 12. Continuous improvement requirements

| ID | Requirement | Type | Derivation | Acceptance |
|---|---|---|---|---|
| FR-90 | The factory shall implement an outer loop that improves a skill from batch evidence of completed runs. | FR | D-18, D-50 | A skill change proposal is produced from ≥N runs and is not applied automatically |
| FR-91 | The factory shall implement a meta loop that proposes harness changes from systemic analysis, subject to human review and replay evaluation. | FR | ADR-0007, D-24 | A harness-scope proposal cannot merge without batch evidence and a passing replay |
| FR-92 | The improvement lifecycle shall provide evaluation, testing, approval, versioning, and rollback for every change. | FR | ADR-0007 | The five capabilities exist and are exercised |
| FR-93 | Improvement proposals shall be grounded in batch evidence across many runs, never a single run. | FR | D-50, ADR-0007 | A single-run proposal is rejected by the review interface |
| FR-94 | The factory shall support reverting a promoted change automatically on a guardrail breach. | FR | ADR-0007, ADR-0011 | A deliberate guardrail breach triggers an automatic revert |
| FR-95 | The factory shall allocate surplus agent capacity deliberately, including to codebase-quality backlog work, rather than defaulting to feature throughput. | FR | D-60, M-09 | Capacity allocation is a configured policy and is reported |

---

## 13. Cross-cutting non-functional requirements

| ID | Requirement | Target | Verification |
|---|---|---|---|
| NFR-01 | **Modularity.** Every component replaceable behind a declared interface, per ADR-0012's interface rule. | No factory-definition, workflow, or agent-contract edit required to substitute a component | Replaceability test suite per component |
| NFR-02 | **Reproducibility.** A recorded run is re-executable from its manifest. | Equivalent outcome on re-execution, or an explicit, recorded divergence reason | Replay suite over a sampled run set |
| NFR-03 | **Observability.** Every in-flight task is visible with state, cost, and last activity. | No task invisible for longer than the declared staleness threshold | Continuous monitoring assertion |
| NFR-04 | **Durability.** No task, approval, or artefact is silently lost. | Zero silent losses under fault injection | Chaos/fault-injection suite |
| NFR-05 | **Concurrency safety.** No cross-task interference at the configured limit. | Zero contamination events in the concurrency suite | Concurrency suite |
| NFR-06 | **Auditability.** Any action can be reconstructed with its authorising authority. | 100% of consequential actions reconstructible | Periodic audit reconstruction test |
| NFR-07 | **Accessibility of the operational surface.** A human must be able to answer "what is the factory doing now and what does it need from me" in one view. | The control surface answers this without navigating further than two levels | Usability review per release |
| NFR-08 | **Data locality and retention.** Run artefacts may contain sensitive material; retention and redaction are policy-driven and enforced. | Secrets absent from stored artefacts; retention applied per policy | Redaction and retention tests |
| NFR-09 | **Provider independence.** No correctness or governance property depends on one model provider. | All provider-specific behaviour isolated behind the model gateway | Provider-failover test |
| NFR-10 | **Graceful degradation.** The loss of any optional component degrades a documented capability without breaking the core path. | Documented degradation modes per component; core path survives the loss of any optional component | Component-failure drills |
| NFR-11 | **Cost predictability.** A task's cost is bounded before it starts and observable while it runs. | A per-task budget is declared; a breach halts the run | Budget-enforcement tests |
| NFR-12 | **Change safety.** No change to the factory takes effect without review, evaluation, and a rollback path. | 100% of definition changes reviewed | Change-management audit |

---

## 14. Requirement-to-source traceability (summary)

| Source | Requirements primarily derived from it |
|---|---|
| V01 | FR-12, FR-50, FR-56, MEAS-05 |
| V02 | FR-22, FR-26, MEAS-08, NFR-04 |
| V03 | FR-40, FR-43, FR-44, FR-34 |
| V04 | FR-35, FR-70, FR-72, MEAS-03 |
| V05 | FR-01, FR-10, MEAS-01, MEAS-03 |
| V06 | FR-50, FR-56 |
| V07 | FR-03, FR-20, FR-21, SEC-01, SEC-06 |
| V08 | FR-10, FR-13, FR-41, FR-80, FR-82 |
| V09 | FR-02, FR-26, FR-33, NFR-01 |
| V10 | FR-25, FR-61, FR-62, FR-13 |
| V11 | FR-06, FR-90, FR-91, FR-93, MEAS-07 |
| V12 | FR-24, FR-31, FR-50, FR-52, FR-72 |
| V13 | FR-11, FR-32, FR-50, FR-53, FR-81, FR-82, FR-83 |
| V14 | FR-04, FR-55, FR-74, FR-75, FR-76, SEC-08, SEC-10 |
| V15 | FR-10, FR-14, FR-15, FR-54, FR-70, FR-85, FR-95 |

---

## 15. Requirements explicitly **not** in scope for the initial implementation

These are recorded to prevent scope creep and to make deferral explicit (per the directive's §17 restriction against unnecessary infrastructure):

| Requirement deferred | Reason | Revisit trigger |
|---|---|---|
| Autonomous production operations (L4) beyond an initial enumerated set | ADR-0003's ladder; V02's abandoned dark factory | After L3 workflows demonstrate a measured, calibrated defect-escape rate |
| Vector-database-backed semantic retrieval | ADR-0008 — approximate component must not carry correctness | Measured retrieval-precision limit on task success |
| Cross-organisation / multi-tenant factory hosting | No source addresses it; flagged in `18_OPEN_QUESTIONS_AND_RISKS.md` | A concrete multi-org requirement appears |
| Kubernetes-based scheduling | ADR-0012 deferral | Managed container compute proves insufficient |
| General message broker / event-driven backbone | ADR-0008 deferral | Measured queue latency at p95 breaches workflow deadlines |
| Automated promotion of skills without review | ADR-0007's safety bar | Skill-scope risk threshold is defined and demonstrably safe |
| Formal verification beyond a pilot | V13 mentions the capability without specifics | A property class is identified where proof is tractable and valuable |

---

## 16. Related documents

- `04_CROSS_SOURCE_SYNTHESIS.md` — CP/CO/D identifiers used in the derivation column
- `07_REFERENCE_ARCHITECTURE.md` — the architecture that satisfies these requirements
- `08_AGENT_CATALOG_AND_CONTRACTS.md` — role specifications
- `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` — security and governance design
- `14_QUALITY_TESTING_AND_EVALUATION.md` — metric definitions and verification procedures
