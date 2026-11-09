# Glossary

**Purpose:** short, consistent definitions for every term the blueprint uses.

**Source of truth for:** terminology only. The *structure* of these concepts — how they relate, and which source introduced each — is in `05_CONCEPT_TAXONOMY.md`. Where this glossary and the taxonomy appear to disagree, the taxonomy is correct.

**How to read the source column.** `V01`–`V15` mean the term comes from that transcript. `[synth]` means the term was introduced by this blueprint's cross-source analysis and appears in no source; every such term is [E3] engineering judgement. `directive` means the term comes from the assignment itself rather than the research corpus.

---

## A

**Access point** — A typed entry point through which a human acts on the control plane, carrying defined authority (e.g. define intent, approve, amend the factory). Six exist; there is no informal "chat with the agent" path. *V07.*

**Acceptance criterion** — A checkable condition that defines "done". Must be decided by an oracle, not by opinion. *V13, V01.*

**Acceptance oracle** — The trusted test set that decides whether a task is complete. Authored against the specification, not the implementation, and constructed before implementation begins. *V01, V12; independence rule is [synth].*

**Agent instruction file** — A repository-local context carrier (`AGENTS.md`, `CLAUDE.md`, `agents.md`) describing how agents should behave in that codebase. *V08, V13.*

**Agent** — A probabilistic component that interprets, generates, or judges within a scope the control plane has authorised. Never holds policy authority. *V12; split is [synth].*

**Approval fatigue** — The degradation of approval quality under high request volume. The blueprint's response is to raise the evidence bar, never to loosen the gate. *[synth].*

**Approval service** — The queue, channel, SLA, and identity infrastructure backing approvals. *V14.*

**Approval, plan-first** — A human approves the agent's plan before execution, preventing rather than detecting the wrong action. *V14.*

**Approval, tool-call gating** — Approval attached to an individual sensitive tool invocation rather than to a whole run. *V14.*

**Arbitration rule** — Where orchestration proposes an action and policy is uncertain, the resolution is deny-by-default and escalate, never "let it try". *ADR-0004; [synth].*

**Asymmetry rule** — Blast radius may be raised by a human at any time; it may be lowered only by a reviewed policy change. *13_... §5.*

**Authority record** — The record of what authority an actor held, under which grant, at which autonomy level, for which action. *09_... §4.1.*

**Autonomy level (L0–L4)** — The permission tier granted to a workflow: L0 read-only, L1 plans and suggestions, L2 isolated workspaces and pull requests, L3 merge/deploy after configured approvals, L4 authorised production operations. Earned per workflow, revoked on evidence. *V11, V13, V14, V07.*

---

## B

**Baseline** — The pre-change measurement against which all improvement is judged, on a stated window and the same workload. A change with no baseline is not evidence. *V09; policy in ADR-0011.*

**Blast radius** — The consequence surface of a change, scored across seven dimensions and tiered R0–R4. Determines review depth and approval requirement. *V13; tiering is [synth].*

**Blast-radius-proportional approval** — Review depth and approval requirement scaled to the consequence of the change. *V13.*

**Broker (tool)** — The single choke point through which every capability invocation passes, before any effect occurs. Decides scope, policy, approval, and credential. *11_... §6.*

**Budget-fails rule** — When a stage exceeds its turn, time, token, or cost budget, the run returns a labelled incomplete result to a human. Context and runs are never silently truncated. *08_...; [synth].*

---

## C

**Calibration corpus** — A labelled set of positive and negative samples used to establish that a verifier actually discriminates. The negative control is mandatory. *14_... §5.*

**Capability** — A callable operation registered in the tool registry, with a schema, a scope, an effect class, an owner, and a health check. *11_... §2.*

**Capability grant** — The declared set of capabilities a workflow or stage may invoke. Declared ≠ granted ≠ effective. *11_... §4.*

**Capability split** — The separation of deterministic policy authority from probabilistic orchestration authority, so that no component holds both. *ADR-0004; [synth] from V07.*

**Capability, MCP** — A capability reached through an MCP server. MCP is one transport, not a capability model. *V07, V09, V10, V13, V15.*

**Chunkability criterion** — The four-part test (disjoint files, independent checks, no coordination, cheaper concurrent) determining whether work may be fanned out to sub-agents. *V12.*

**Composition failure** — A failure caused by how stages are wired rather than by an agent's reasoning. The dominant failure class at run scale. *V02.*

**Confidence** — The aggregate belief that an output meets its acceptance criteria, aggregated from reporter verdicts. *V04.*

**Context** — The body of information an agent operates on. Assembled per stage from typed items; never the full repository. *V15, V10.*

**Context assembly** — The deterministic selection, ordering, and pinning of context items for a stage. *10_... §5.*

**Context boundary** — The typed interface between sequential stages, preventing one stage's context from bleeding into the next. *V10.*

**Context envelope** — The pinned, hashed result of context assembly for one stage, carrying the identity and version of every item included. *10_... §5.*

**Context inventory** — Estate-wide scanning that detects outdated, duplicate, and stale context items. *V15.*

**Context item** — A single addressable unit of context with metadata, scope, trigger, and trust classification. *[synth] from V10 + V15.*

**Context, deferred** — Context not loaded until a trigger fires. *V10.*

**Control plane** — The authoritative component that decides intent, policy, state, scheduling, and merges. It holds state; it never executes work. *V07.*

**Control surface** — The operational view: dashboards, boards, mission control. Reads and requests; does not write the definition. *V02, V04, V06, V15.*

**Corpus** — The fifteen source transcripts this blueprint was derived from. *directive.*

**Cost per accepted change** — Total inference, tool, and infrastructure cost divided by changes that landed. The business unit, and the metric that governs model routing. *directive, V09.*

**Credential broker** — The component that resolves a credential reference into a scoped, short-lived credential at invocation time. Never reachable by an agent. *11_... §7.*

**Criticality map** — The declared mapping from a resource to its blast-radius tier, which sets the approval requirement for changes affecting it. *13_... §5.*

---

## D

**Dark factory** — A factory with no human in the loop. Attempted and abandoned in the corpus; rejected by this blueprint. *V02, V15.*

**Data plane** — The execution fleet that acts on authorised work. It never writes task state, approval state, lease state, or definition state. *V07.*

**Definition, factory** — The declarative specification of the whole factory, as data. The only place configuration is written. *V09.*

**Deferred context** — See *Context, deferred*.

**Definition change** — Any change to the factory definition, including changes to the factory itself. It follows the same reviewed path as a code change. *ADR-0007.*

**Dependency edge (dependent)** — An edge where the downstream node consumes the upstream node's output artefact. The upstream *context* is not inherited. *09_... §3.*

**Dependency edge (independent)** — An edge where the nodes are concurrent and share no state. Requires a chunkability justification. *09_... §3.*

**Deployment, runbook-guarded** — Deployment performed only through an enumerated, pre-approved runbook. *SEC-08.*

**Derived-don't-inject rule** — A skill states a property and how to check it; it does not state a fact the agent could derive with its tools in one step. *10_... §4; [synth].*

**Discipline vs. structure** — The corpus's structural claims (how to organise agents) are more transferable than its disciplinary claims (what an agent should do). *04_... §3.*

**Drift** — Divergence between the declared factory state and the actual state. Detected and reported; corrected by the applier. *09_... §5; detection is [synth].*

**Durable execution** — Workflow execution whose state survives process failure, so a run resumes rather than restarting. *ADR-0008.*

---

## E

**E0–E4 effect classes** — The classification of a capability by consequence: E0 pure read, E1 reversible write, E2 external write, E3 destructive, E4 production. Determines which gates the capability passes through. *11_... §2.3.*

**Edge justification** — The mandatory rationale on every task-graph edge. Its absence is a validation failure, not a warning. *09_... §7.*

**Escalation** — Moving a task to a human with the last good state preserved, so it can be resumed. Not the same as failure. *09_... §2.1.*

**Eval** — A benchmark of expected behaviour, mined from historical runs where possible. *V15, V10, V11.*

**Event log** — The append-only record of every consequential action, with a correlation id, the actor, the authority, and the outcome. The substrate for audit, evaluation, cost attribution, and the improvement loops. *ADR-0008.*

**Execution-vs-approval binding** — The requirement that what executes matches what was approved, checked against the artefact's hash. *[synth].*

---

## F

**Faithful context** — Context assembled for a stage that contains everything and only what the stage needs. *[synth] from V10 + V13.*

**Factory** — An organisation in which the production cycle is performed by agents, with humans supplying intent and judgement rather than executing steps. The 1968 definition adds three components: a controlled programming environment, standardised development tools, and historical information for management and measurement. *V05, V01, V07, V08, V15.*

**Factory definition** — See *Definition, factory*.

**Fault localisation** — The ability of a test suite to identify *where* a defect is, not merely that one exists. *V06.*

**FDLC** — "Factory development lifecycle": the loop-maintenance lifecycle that parallels the SDLC. *V15.*

**Four memory classes** — Run artefacts, context/skills, knowledge, and local repository context. Conflating them is the most common context-architecture error. *05_... §4; [synth].*

---

## G

**Gate, merge** — The set of checks a change must pass before merge, scaled by blast-radius tier. Gate weakening is itself a change. *14_... §6.*

**Guardrail metric** — A metric that must not degrade when another improves — e.g. revert rate holding steady. *V09; policy in ADR-0011.*

**Guardrails** — The eight standing guardrails checked on every configuration change: defect escape rate, revert rate, human intervention rate, cost per accepted change, context budget compliance, approval rubber-stamp rate, gate failure rate, total system cost. *14_... §7.6.*

**Harness** — Everything around the model that makes the model useful: instructions, tool surface, context assembly, retry and escalation logic, evaluation. *V11.*

**Harness engineering / loop engineering** — The discipline of engineering the harness. The two terms are converging. *V11.*

**Human control plane** — The single operational view through which humans observe, intervene, and approve. Six access points, one surface. *13_... §8.*

---

## I

**Independent edge** — See *Dependency edge (independent)*.

**Isolation tier (T1–T3)** — The execution isolation stack: T1 worktree (file-level), T2 container (process and network), T3 sandbox (hostile/untrusted). The tier may be escalated but never lowered. *ADR-0006; [synth] from V08 + V03 + V14.*

**Improvement loop, inner** — The loop that fixes a failure within the current run, under the current configuration. *V11.*

**Improvement loop, outer** — The loop that changes configuration based on accumulated run evidence. *V11.*

**Improvement loop, meta** — The loop that changes the harness itself — the machinery that runs the loops. *V11.*

**Independence** — The requirement that a judge is not the same agent that produced what it judges. *08_...; ADR-0004.*

**Intent** — A human's natural-language goal, submitted through the access-point API. The only sanctioned entry into the factory. *12_... §2.2.*

**Isolated workspace** — The disposable working environment in which an agent performs a task: worktree, container, or sandbox depending on the tier. *13_... §7.*

---

## J

**Job, relational-backed queue** — The work-distribution mechanism: a queue in the relational store, using leases. Chosen over a general broker at this scale. *ADR-0008.*

---

## K

**Kaizen / kaikaku** — Incremental continuous improvement versus discontinuous redesign. The blueprint takes the kaizen path for the factory's own evolution. *V01.*

**Knowledge store** — The durable record of decisions, their rationale, and their outcomes, owned by humans. One of the four memory classes. *V13; classification is [synth].*

---

## L

**Laptop problem** — The unit of production is a fleet on remote disposable infrastructure, not a developer machine. *V03.*

**Lens** — A skill scoped to a file pattern or component, applied automatically when matching changes appear. *V15.*

**Loop** — An automated skill that runs without immediate human initiation and improves itself for subsequent runs. *V15.*

---

## M

**Machine that builds the thing** — The reframe of factory-building as continued engineering one level up: the factory builds the next version of itself. *V01.*

**Manager / coordinator / worker hierarchy** — The model-tier hierarchy in which a manager decomposes and dispatches, a coordinator sequences, and a worker executes one bounded task. *V12.*

**MCP** — Model Context Protocol: a protocol for exposing tools and resources to agents. Convenient, not universal. Not the registry, the policy layer, the credential store, the audit record, or the scope boundary. *V07, V09, V10, V13, V15.*

**MCP server registry** — The catalogue of MCP integrations, with trust level, health, and reconciliation state. *[synth].*

**Memory, four classes** — See *Four memory classes*.

**Mission control** — The supervisory view of a running fleet. *V02.*

**Model gateway** — The abstraction layer that makes model choice a configuration matter, handling routing, budgets, failover, and caching. *V07, V09, V15.*

**Model routing** — Selecting a model per task by difficulty and cost. A routing hint, not a capability grant. *V09, V12, V15.*

---

## N

**Node** — A work item in a task graph, independently leased and executed. *09_... §3.*

---

## O

**Oracle coverage** — The fraction of acceptance criteria that have a check. A prerequisite for autonomy promotion. *14_... §3.*

**Outcome (verdict)** — A reviewer's judgement with locations, rationale, and validation mode. *08_... §4.*

---

## P

**Panic / fail-closed** — The rule that the policy engine and the tool broker deny on uncertainty rather than permit. *11_... TL-7.*

**Panel** — The component aggregating multiple reporter verdicts into a confidence-bearing decision. Deterministic policy, not a second agent. *V04.*

**Permission scope** — See *Scope*.

**Plan-first approval** — See *Approval, plan-first*.

**Planning** — Producing the task graph: decomposition, topology, and per-node context and tool scopes. *V03, V12, V13.*

**Policy as code** — Deterministic enforcement rules that gate consequential actions regardless of an agent's confidence. *[synth] from V07 + V09.*

**Privilege-bearing artefact** — Any artefact whose modification changes what agents are permitted or instructed to do. Context artefacts, skill artefacts, and policy files all qualify. *[synth] from V11 + V15.*

**Proceduralisation** — The transformation of an agent's experiential knowledge into explicit procedure. The improvement loop's actual output. *V15.*

**Projected context** — Context selected and ordered for a stage, before the envelope is pinned. *10_... §5.*

**Progressive tool disclosure** — Advertising only the tools relevant to the current stage. *V10.*

**Proposal** — A proposed change to the factory definition, with a measurement plan, a replay plan, a rollback plan, and an approval class. *09_... §4.4.*

**Pinned context** — Context fixed by identifier and version for the life of a run, so that a replay resolves the same items. *10_... §5.*

---

## Q

**Quality gate** — See *Gate, merge*.

---

## R

**Reconciler / applier** — The component that makes actual state converge on the declared factory state. *V09.*

**Red-team suite** — The 15 attacks the factory must withstand, run as a CI check on the factory itself. *14_... §10.*

**Refinement** — Turning a raw request into a specified task with checkable acceptance criteria. *V13.*

**Regression test requirement** — For a bug fix, the test must fail against the pre-fix revision and pass against the fixed revision. *12_... §3.*

**Reporter** — An agent that evaluates an output against stated criteria and emits a verdict. *V04.*

**Repository isolation** — The rule that a task may not read or write outside the repositories in its declared scope. *SEC-12.*

**Reproducibility** — The same task produces the same result in any environment. *V03, V14.*

**Replay** — Re-running a historical task against a candidate configuration. The specification, context manifest, and gates are replayed; model outputs are regenerated. *15_... §7.*

**Runner** — The execution harness that prepares the environment, invokes an agent, and collects results. Writes no code itself. *V04.*

---

## S

**Scope (permission scope)** — The hierarchical, prefix-matched vocabulary describing what a capability may act on: `repo:read`, `repo:write:path:<glob>`, `git.write.pr`, `shell.sandboxed`, `db.migrate:local`, `prod.write`, and so on. *11_... §4.2.*

**Scope, three-scope rule** — Every invocation is checked against workflow scope, stage scope, and resource scope; the narrowest wins, and deny always wins. *11_... §4.3.*

**Scope model (run / skill / workflow / harness)** — The four levels at which an improvement may be attributed and proposed. *09_... §9; [synth] from V11 + V15 + V02.*

**Scrutiny validator** — A reviewer checking the change against the stated intent. *[synth].*

**Security reviewer** — A reviewer specialised for security, separate from the general reviewer. *V13.*

**Sealed (verdict)** — A review outcome that passes the acceptance criteria and every applicable gate. *08_... §4.*

**Secret scoping** — Per-task, short-lived, least-privilege credentials. Silent in every source. *[synth].*

**Signal / noise budget** — The tolerance for false positives in automated judgement, and the escalation path when it is exceeded. *13_... §6.*

**Skill** — A unit of work for agents: either a **procedure** (how to do something) or a **standard** (what must be true). *V15; procedure/standard split is [synth].*

**Skill corpus** — The versioned, reviewed collection of skills. *10_... §4.*

**Sovereignty of local context** — The precedence rule that a repository's own context outranks central context, and central security context always wins. *ADR-0009.*

**Specification** — The structured, acceptance-criteria-bearing statement of what to build. *V13.*

**Specificity** — The degree to which a review or verification is narrowly scoped; "the ruler of all quality". *V15.*

**Stage kind** — The vocabulary of workflow stages: specify, plan, implement, verify, review, aggregate, approve, merge, deploy, sweep, investigate, record, evaluate, propose. *09_... §8.1.*

**Standards** — The written expression of what correct looks like. *V15, V09.*

**State machine (task)** — The 19-state lifecycle: DRAFT, TRIAGED, REFINED, PLANNED, QUEUED, RUNNING, VERIFYING, AWAITING_REVIEW, AWAITING_APPROVAL, APPROVED, MERGING, MERGED, DEPLOYING, DEPLOYED, REJECTED, FAILED, ABANDONED, INCOMPLETE, ESCALATED. *09_... §2.1.*

**State machine (node)** — The 8-state work-item lifecycle: PENDING, READY, LEASED, RUNNING, SUCCEEDED, FAILED, INCOMPLETE, BLOCKED. *09_... §3.*

**Surface, operational** — See *Control surface*.

**Sweep** — A recurring repository-wide search for non-conformance, producing findings rather than changes. *V15.*

**Systemic vs. local** — Whether a change's consequence is contained to one repository/component or propagates across the organisation. A blast-radius dimension. *13_... §5.*

---

## T

**Task graph** — A directed graph of work items with dependencies, produced by planning and executed under the topology rule. *09_... §7.*

**Three-scope rule** — See *Scope, three-scope rule*.

**Tool registry** — The catalogue of callable capabilities with metadata, schemas, and ownership. Authoritative over what any server advertises. *[synth] from V10 + V07.*

**Tool-call gating** — See *Approval, tool-call gating*.

**Topology, hybrid** — Choosing fan-out or sequencing per dependency edge in the task graph. *[synth].*

**Traceability matrix** — The map from source evidence to architectural decision, used to check that no claim outruns its evidence. *04_... §5.5.*

**Trust classification (three levels)** — `trusted`, `untrusted-content`, `derived`. Content from outside the trusted boundary is data, never instruction. *ADR-0004.*

**Trust level (MCP servers)** — `internal`, `external`, `untrusted`. An `untrusted` server's tools are never offered to an agent. *11_... §3.2.*

---

## U

**Untrusted content** — Content originating outside the trusted boundary — issue text, PR descriptions, code comments, documentation, web pages, dependency files, external tool output. Tagged, quarantined, and passed as data. *ADR-0004; threat silent in every source.*

**User-testing validator** — A reviewer checking the change against observed user-visible behaviour. *[synth].*

---

## V

**Verdict** — The reviewer's output: findings with locations, rationale, and validation mode. *08_... §4.*

**Verifier** — A narrow, cheap check — deterministic or LLM-judge — generated from a skill, run in CI. *V15.*

**Verifier calibration** — The state of a verifier's measured ability to discriminate: `uncalibrated`, `calibrated`, `expired`, with detection and false-positive rates against a corpus. *14_... §5.*

---

## W

**Waypoint** — A checkpoint in a long-running workflow where state is persisted and a human may inspect or take over. *04_...; [synth].*

**Worktree** — A separate working directory sharing one git object store: cheap, isolated, branch-scoped. The T1 isolation form. *V08, V13.*

**Workflow** — A durable, resumable machine composing stages, gates, and state transitions. *09_...; the seven canonical ones are in 12_... .*

**Working agreement** — A repository document specifying how agents should behave in that codebase. *V08.*

---

## X

**X-factor (factory)** — The factor that turns an agent collection into a factory: the control plane, the durable workflows, the calibrated gates, and the measurement. *04_...; [synth].*

---

## Acronyms and identifiers

| Identifier | Meaning |
|---|---|
| **ADR** | Architecture Decision Record. Numbered, immutable in history, superseded rather than edited. |
| **AP** | Access point. AP-1 define-intent … AP-6 amend-factory. |
| **CI** | Continuous integration. |
| **E0–E4** | Capability effect classes. |
| **E1–E4 (evidence)** | Evidence classes: direct transcript evidence, cross-source synthesis, engineering judgement, unresolved hypothesis. Distinct from the effect classes. |
| **FR / NFR / SEC / MEAS** | Requirement, non-functional requirement, security requirement, measurement requirement. All in `06_REQUIREMENTS_AND_NFRS.md`. |
| **L0–L4** | Autonomy levels. |
| **MCP** | Model Context Protocol. |
| **R0–R4** | Blast-radius tiers. |
| **T1–T3** | Isolation tiers. |
| **V01–V15** | The source transcripts. Individual analyses in `research/`. |
| **WF / CX / TL / SG / QE / OB** | Invariant prefixes: workflows, context, tools, security, quality, observability. |
| **12-factor** | The configuration discipline for agentic systems (V14). |

---

## Related documents

- `05_CONCEPT_TAXONOMY.md` — the structure behind these definitions
- `03_EVIDENCE_LEDGER.md` — the evidence behind each claim
- `08_AGENT_CATALOG_AND_CONTRACTS.md` — the roles and their outputs
- `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` — the authority model and risk model
- `18_OPEN_QUESTIONS_AND_RISKS.md` — what is still unknown
