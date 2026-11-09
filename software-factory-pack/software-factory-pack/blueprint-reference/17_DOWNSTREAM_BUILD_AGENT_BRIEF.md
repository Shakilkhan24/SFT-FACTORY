# 17 — Downstream Build Agent Brief

**Purpose:** the orientation document for the agent that will implement this factory. It says what to build, what not to build, what to read in what order, and what will make the work fail.

**Source of truth for:** the implementation contract given to a downstream build agent.
**Audience:** an AI engineering agent (or a small team) that will build the software factory described in this blueprint.

---

## 1. What you are building

You are building the **control plane and supporting infrastructure of an autonomous software-production organisation**. Not a chatbot, not an IDE plugin, not a prompt collection.

The factory executes real engineering work — specification, planning, implementation, verification, review, merge, deployment — with agents performing the work and humans providing intent and judgement. It runs against real repositories, real CI, and real production systems.

### 1.1 The three sentences that matter

1. **Agents propose; deterministic code decides.** A probabilistic component never holds authority. Every consequential action passes a deterministic policy evaluation, and irreversible actions require a human.
2. **The acceptance oracle is independent of the implementation.** A test written by the same run that wrote the code is not a test — it is a restatement. This single rule is what makes the rest of the system trustworthy.
3. **Measurement is a prerequisite, not a deliverable.** If you do not build the run-artefact store in the first phase, calibration, replay, promotion, cost attribution, and the improvement loop are all unbuildable afterwards.

### 1.2 The one-paragraph version

A declarative definition of workflows, skills, policies, and capabilities, reconciled by an applier; a control plane that holds authoritative state in a relational store and records every consequential action in an append-only event log; an orchestrator that runs task graphs through stages, where the majority of stages are deterministic code and the agent stages are bounded by turn, time, token, and cost budgets; a context assembler that deterministically resolves what an agent knows at the moment it acts, within a hard budget that fails rather than truncates; a tool broker that is the single choke point for every external effect, enforcing scope, injecting brokered credentials at the invocation boundary, and recording every call; a model gateway that makes model and provider a configuration matter; an execution substrate with tiered isolation (worktree, container, hardened sandbox); a verification runtime with a layered gate set and an explicit authorship policy; and a review and approval surface that is read-and-request only.

---

## 2. What you must not build

These are not omissions. Each is a decision with a reason, and violating it reintroduces a failure mode the design exists to prevent.

| Do not build | Why |
|---|---|
| **A "chat with the agent" interface** | It makes governance unenforceable and leaves no durable record of authority. Humans enter through a small, enumerated set of typed access points. |
| **An autonomous self-modifying factory** | A degraded skill produces degraded runs, which produce more degraded skill proposals. The improvement loop proposes; a human approves. |
| **A vector database as the context store** | Approximate retrieval must never be authoritative. Context selection is deterministic and precedence-based. |
| **A message broker, Kubernetes, or an event-streaming platform** | Not yet. Each has a *measured* deferral trigger, not a date. See ADR-0012. |
| **A general-purpose workflow engine** | Failure-mode opacity in the component where failures concentrate. You own the runner so you can understand it. |
| **A separate agent for every role** | Roles are specifications, not deployments. Merge identical specifications; split only when tools, authority, context, or evaluation genuinely differ. |
| **An LLM-based grader for every check** | Verification must be agent-independent. A probabilistic check cannot decide whether a probabilistic implementation is correct. |
| **A multi-tenant architecture** | Not designed in this blueprint. See `18_OPEN_QUESTIONS_AND_RISKS.md`. |
| **A "confidence score" that merges without calibration** | V04's merge policy depends on a confidence function the source never defines. Build the panel and measure its calibration before letting it gate anything. |

---

## 3. Reading order

Read these in order. Each depends on the one before it.

| # | Document | What you get from it |
|---|---|---|
| 1 | `00_START_HERE.md` | The orientation and the map |
| 2 | `01_EXECUTIVE_VISION.md` | Why the factory exists and what it is not |
| 3 | `06_REQUIREMENTS_AND_NFRS.md` | The requirement set with acceptance criteria — **your contract** |
| 4 | `07_REFERENCE_ARCHITECTURE.md` | The component specifications you implement against |
| 5 | `09_ORCHESTRATION_STATE_AND_EVENTS.md` | The state machine and the event schema |
| 6 | `08_AGENT_CATALOG_AND_CONTRACTS.md` | The role specifications and the agent contract |
| 7 | `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md` | The context model, the skill corpus, prompt construction |
| 8 | `11_TOOLS_MCP_AND_INTEGRATIONS.md` | The registry, the broker, MCP, credentials, the model gateway |
| 9 | `12_END_TO_END_WORKFLOWS.md` | What the factory actually does, step by step |
| 10 | `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` | The authority model, the gates, the threat model |
| 11 | `14_QUALITY_TESTING_AND_EVALUATION.md` | The gate set, calibration, the evaluation framework |
| 12 | `15_OBSERVABILITY_COST_AND_FEEDBACK.md` | The run artefact, telemetry, cost, the feedback loops |
| 13 | `16_IMPLEMENTATION_ROADMAP.md` | The phases and the exit criteria |
| 14 | `architecture-decisions/ADR-0001…0012` | The decisions and their reasoning — **read these before you argue** |

**If you read only five things:** ADR-0004 (the authority split), ADR-0005 (the authorship policy), ADR-0003 (the autonomy ladder), ADR-0011 (measurement as a prerequisite), and `12_END_TO_END_WORKFLOWS.md`.

**Also read, if you have the transcripts:** `research/V02_analysis.md` (where failures concentrate), `research/V05_analysis.md` (the 1968 definition — the shape of the whole thing), `research/V12_analysis.md` (the slop finding and the chunkability rule), `research/V14_analysis.md` (the unattended-degradation finding).

---

## 4. The implementation contract

### 4.1 The interfaces you must honour

These are the seams. Everything else is replaceable; these are not.

```
Control plane
  DefinitionStore        load() -> FactoryDefinition
  Applier                apply(FactoryDefinition) -> ApplyReport
  EventLog               append(EventEnvelope) -> Receipt
  PolicyEngine           evaluate(Action, Context) -> allow | allow-with-approval | deny | escalate
  Orchestrator           run(TaskGraph) -> TaskResult
  Scheduler              lease(NodeRef, Capability) -> Lease
  ContextAssembler       assemble(StageSpec) -> ContextEnvelope       # PURE
  ToolBroker             invoke(InvocationRequest) -> InvocationResult
  CredentialBroker       mint(Capability, Resource, Task) -> Credential
  ModelGateway           complete(CompletionRequest) -> CompletionResponse
  SkillRegistry          resolve(Scope) -> SkillVersion
  RunArtifactStore       write(RunArtifact)
  ReplayEvaluator        replay(RunSet, CandidateConfig) -> EvaluationReport
  AccessPointAPI         submit(AccessPointCall) -> Result            # read-and-request

Data plane
  AgentRunner            run(StageSpec, ContextEnvelope, Grant) -> StageResult
  IsolationProvider      provision(Tier, Spec) -> Environment
  VerificationRuntime    verify(Change, Tier) -> GateReport
  MergeGate              evaluate(Change, Tier) -> MergeDecision
  DeploymentController   deploy(Release, Runbook) -> DeployResult

Domain (no LLM)
  PanelAggregator        aggregate(Verdicts, Policy) -> Decision
  BlastRadiusScorer      score(Change, CriticalityMap) -> Tier
  ContextInventory       scan(Estate) -> Findings
  KnowledgeStore         record(KnowledgeRecord), retrieve(Query) -> Records
  CalibrationHarness      calibrate(Property, Corpus) -> CalibrationReport
```

**The two pure functions** — `ContextAssembler.assemble` and `PolicyEngine.evaluate` — are the most important in the list. They are deterministic, they are the audit backbone, and they must have exhaustive unit tests.

### 4.2 The data contracts you must honour

| Contract | Where it is specified |
|---|---|
| The event envelope | `09_ORCHESTRATION_STATE_AND_EVENTS.md` §4.1 |
| The task graph | `09_ORCHESTRATION_STATE_AND_EVENTS.md` §7 |
| The context item and the context envelope | `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md` §2.1, §5.2 |
| The skill schema | `10_...` §4.2 |
| The tool capability record | `11_TOOLS_MCP_AND_INTEGRATIONS.md` §2.1 |
| The capability grant | `11_...` §4.1 |
| The invocation record | `11_...` §6.5 |
| The routing policy | `11_...` §9.3 |
| The environment declaration | `11_...` §10 |
| The run artefact | `15_...` §2.3 |
| The acceptance oracle | `14_...` §3.5 |
| The calibration corpus | `14_...` §5.2 |
| The improvement proposal | `09_...` §4.4 (`proposal.created`) |
| The role specification | `08_...` §8, `templates/AGENT_SPEC.md` |
| The workflow definition | `templates/WORKFLOW.md` |
| The MCP integration | `templates/MCP_INTEGRATION.md` |

**Schema versioning is mandatory.** Add fields; never repurpose a field. The event log and the run-artefact store are historical records.

### 4.3 The invariants you must preserve

These are tested. A build that violates one is defective, regardless of how well it works otherwise.

| From `07_...` §11 | |
|---|---|
| I-1 | The data plane cannot mutate control-plane state except through an authorised command. |
| I-2 | No agent can widen its own scope, autonomy level, or credential set. |
| I-3 | Every consequential action is attributable to an authority and is in the event log. |
| I-4 | No merge occurs without a passing acceptance oracle and the applicable approval. |
| I-5 | No factory change takes effect without a reviewed, evaluated, reversible change. |
| I-6 | Untrusted content cannot become instruction. |
| I-7 | No production write occurs outside an enumerated runbook. |
| I-8 | Every run's context is pinned and recoverable. |
| I-9 | No dependency on a single model provider for correctness or governance. |
| I-10 | No agent-authored test can alone satisfy an acceptance criterion. |
| I-11 | Surplus capacity is allocated by policy, not by default. |
| I-12 | Every architectural component is replaceable without changing the definition, workflows, or agent contracts. |

Plus the per-layer invariants: `09_...` §1 (I-1 restated), `10_...` §10 (CX-1…CX-9), `11_...` §12 (TL-1…TL-10), `12_...` §10 (WF-1…WF-10), `13_...` §10 (SG-1…SG-12), `14_...` §11 (QE-1…QE-12), `15_...` §9 (OB-1…OB-12).

---

## 5. The rules that will make or break the build

### 5.1 The determinism rule

**Anything that can be specified exactly must be code, not a model call.**

The blueprint's stage vocabulary (`09_...` §8.1) has 14 stage kinds, and only 6 of them are agent stages. That ratio is the design, not an accident. Every time you reach for a model where a function would do, you add cost, non-determinism, and a way to be wrong.

### 5.2 The context rule

> A stage receives its own specification, its own inputs, and — for a dependent edge — the upstream artefact. It never receives a sibling's context, a predecessor's transcript, or the full task graph.

And: **if the assembled context exceeds the budget, the stage fails.** It does not truncate. Silent truncation produces confident wrong output, which is the exact failure this whole system is built to prevent.

### 5.3 The oracle rule

The acceptance oracle is written against the specification, not the implementation. It is constructed **before** the implementer runs. And:

> A regression test that does not fail on the unfixed code is rejected.

That single check catches a fix that changes nothing, a test that asserts the implementation rather than the behaviour, and a misdiagnosis — all at once. Implement it early.

### 5.4 The authority rule

When you are unsure whether an action is permitted: **deny by default and escalate.** Never "let the orchestrator try and see". The agent proposes; the deterministic layer disposes.

### 5.5 The measurement rule

Every component writes its own artefact slice, as a by-product of doing its work. Do not add instrumentation later; you cannot retrofit it, because by then you will not know where the information went.

### 5.6 The change rule

Every change to the definition, a skill, a workflow, the harness, a policy, or an autonomy level goes through review. **Including the ones you think are obviously right.** The mechanism is the same one that governs the product.

### 5.7 The scope rule

**Roles are specifications, not deployments.** Before creating an agent, check whether an existing role specification covers it — identical context scope, tool scope, authority, and evaluation means merge. If two roles differ only in model tier, that is a routing decision, not a second role.

### 5.8 The deferral rule

When you want a broker, a Kubernetes cluster, a vector database, or a workflow engine: **measure first.** ADR-0012 gives the trigger for each. Adding infrastructure ahead of its trigger is the failure mode the directive explicitly warns about.

---

## 6. The build order

Follow `16_IMPLEMENTATION_ROADMAP.md`. In brief:

| Phase | Build | Exit condition (abbreviated) |
|---|---|---|
| **0** | The definition, the event log, the policy engine, the broker, the gateway, the run-artefact store, the scheduler, the access points, T1 isolation, the orchestrator | An unauthorised call is denied and logged; a run produces a complete artefact |
| **1** | The context assembler, the skill registry, the prompt builder, the refine/plan/work stages, the oracle generator, the verification runtime, the reviewer, the panel, the merge gate | An issue becomes a reviewed PR with a passing independent oracle |
| **2** | The full gate set, the authorship policy, the calibration harness, the violation-injection harness, standards verifiers, blast-radius scoring, the approval service | A verifier that misses a violation cannot gate a merge |
| **3** | T2/T3 isolation, the credential broker, default-deny egress, the fetching service, untrusted-content tagging, the red-team suite, supply-chain controls | The red-team suite passes; a credential cannot outlive its task |
| **4** | Workflows A, C, D, E, F; the context inventory; the knowledge store; the maintenance loops; production runbooks; the complete surface | Six workflows run with recorded baselines |
| **5** | The replay evaluator; the outer and meta loops; the proposal and review interfaces; autonomy promotion and revocation; the evaluation suites | A change is proposed from batch evidence, reviewed, applied, and automatically rolled back on a guardrail breach |

### 6.1 Two things start on day one

Both are wall-clock bound, and both gate later phases:

1. **The pre-factory baseline** — measure the human team's current cycle time, defect rate, and review load. Measured once, before the factory's output is mixed in.
2. **The first calibration corpus** — mine the repository's own fix history for real violations, add conforming samples, and measure the detection rate. The corpus largely already exists in the git history.

### 6.2 What "done" means for a phase

Not "the features exist". **The phase's exit criteria in `16_...` pass.** A phase that has not met them does not enable the next one's risk.

---

## 7. The failure modes you should expect

| Failure | How it shows up | The defence |
|---|---|---|
| **The oracle gets written after the code** | "Just this once" | The oracle's provenance must record a null implementation run at construction; the merge gate rejects a same-run-authored oracle. |
| **Context silently truncates** | The agent produces confident, wrong output | The budget rule fails rather than truncates. |
| **The review queue saturates** | Approvals take days; people stop reading them | Measure review capacity from day one. Ration by tier. Never loosen the gate. |
| **The gates get bypassed under pressure** | A CI config change disables a failing check | Gate weakening is itself R3 and needs security-scope approval. Track bypass attempts. |
| **The improvement loop over-fits** | Every proposal passes the replay and nothing improves in production | Hold out part of the run set; refresh it periodically. |
| **The calibration corpus rots** | A verifier that used to catch things stops catching them | Re-calibrate on a schedule and on every skill change. An expired calibration removes the verifier from the gate set. |
| **A dependency is compromised** | An agent suddenly exfiltrates something | T2/T3 isolation, default-deny egress, per-task scoped credentials, dependency integrity checks. |
| **An issue body carries an injection** | The agent does something strange | Untrusted content is tagged at ingest, placed last in the envelope, and — critically — the agent can only *propose* actions. |
| **Scope creep in the definition** | Thirty workflows, none calibrated | Each workflow starts at L2. Promotion needs evidence. |
| **You trust a corpus metric** | "The research says 10×" | No figure from the corpus is a target. Establish your own baseline. |

---

## 8. Working with this blueprint

### 8.1 The evidence discipline

The blueprint distinguishes four kinds of statement, and the distinction is load-bearing:

| Class | Meaning | How to treat it |
|---|---|---|
| **[E1] Direct transcript evidence** | A source said it, with a timestamp | Citable. The ledger gives the file path and timestamp. |
| **[E2] Cross-source interpretation** | Derived from several sources | Citable as interpretation. The derivation is in `04_...`. |
| **[E3] Engineering recommendation** | The blueprint's own judgement, not a source's | **Not attributable to any creator.** Implement it because it is sound, not because a source said so. |
| **[E4] Unverified hypothesis** | Open question | Do not build on it without validating it. |

**The most important E3 contributions** — because no source in the corpus addresses them, and you will not find them elsewhere: untrusted-content tagging (ADR-0004), secret scoping (ADR-0006), the four memory classes (`10_...` §7), the discriminator calibration requirement (ADR-0003 §3), the tiered isolation model (ADR-0006), the capability-grant model (`11_...` §4), the scope model (`11_...` §4.2), the approval-fatigue indicators (`13_...` §6.4).

### 8.2 When the blueprint is wrong

It will be wrong in places. The blueprint is a design produced from 15 transcripts plus engineering judgement; it is a starting point, not scripture.

**When you find an error, change the blueprint and record why.** The blueprint is version-controlled in the same way as the product. A defect in the design is fixed by a reviewed change to the design, not by a divergence between the design and the code.

Three things are *not* yours to change without discussion:
1. The **authority split** (ADR-0004) — it is the foundation of every safety property.
2. The **oracle independence** rule (ADR-0005) — without it, nothing above L2 is defensible.
3. The **human review floor** (ADR-0003) — it is the price of the corpus's central contradiction being resolved honestly.

If you believe one of these is wrong, say so explicitly and argue it. Do not quietly work around it.

### 8.3 Do not introduce technology ahead of its trigger

ADR-0012's minimal profile is a constraint. When you need a capability that the profile does not include, the answer is usually an implementation within the profile, or a measured justification for the deferral trigger.

---

## 9. The questions the blueprint answers

The directive (§18) listed twenty questions the architecture must answer. Here is where each is answered, so you can check the blueprint against its own contract.

| # | Question | Answered in |
|---|---|---|
| 1 | What is a software factory, precisely? | `01_EXECUTIVE_VISION.md` §1; V05's 1968 definition in `research/V05_analysis.md` |
| 2 | How is intent turned into a plan? | `12_END_TO_END_WORKFLOWS.md` §2, steps 2–7 |
| 3 | What does an agent know, and how is that decided? | `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md` §5 |
| 4 | How does the factory know a change is correct? | `14_QUALITY_TESTING_AND_EVALUATION.md` §2, §3 |
| 5 | How is trust earned rather than assumed? | `14_...` §5 (calibration); ADR-0003 |
| 6 | Who decides, and who decides who decides? | `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` §2 |
| 7 | What can an agent do without asking? | `13_...` §4 (the ladder); `11_...` §2.3 (effect classes) |
| 8 | How are capabilities granted and revoked? | `11_...` §4; `13_...` §7.1 |
| 9 | How are credentials handled? | `11_...` §7; `13_...` §7.2 |
| 10 | How is untrusted content handled? | `13_...` §1.4, §7.7 |
| 11 | How does the factory isolate concurrent work? | ADR-0006; `13_...` §7.3, §7.4 |
| 12 | What happens when a stage fails? | `08_...` §4.3 (the taxonomy); `12_...` per workflow |
| 13 | How does the factory avoid doing the same mistake twice? | `12_...` §8 (Workflow G); `15_...` §5 |
| 14 | How is the factory's own configuration changed? | ADR-0001; ADR-0007; `13_...` §9 |
| 15 | What prevents the factory from rewriting its own rules? | ADR-0007 §1; `13_...` §9.3 |
| 16 | How does a human intervene? | `13_...` §8.3; `15_...` §6.3 |
| 17 | How is cost measured and controlled? | `15_...` §4 |
| 18 | How is productivity measured without inventing numbers? | `14_...` §8, §9; ADR-0011 §6 |
| 19 | What happens when the model provider changes? | `11_...` §9.8; I-9 |
| 20 | What would make this fail, and how would we know? | `18_OPEN_QUESTIONS_AND_RISKS.md`; the known-limitations sections of each document |

---

## 10. The definition of done for the whole build

The factory is done when:

1. **An intent becomes a production release**, with a complete artefact chain (`FR-01`).
2. **An unauthorised action is denied and logged**, every time (`SEC-01`).
3. **A change cannot merge without an independent, passing oracle** and the applicable approval (`I-4`).
4. **A verifier that cannot discriminate cannot gate a merge** (`FR-55`).
5. **A human can answer "what is the factory doing and what does it need from me"** in one view (`NFR-07`).
6. **Any consequential action can be reconstructed** with its authority and its context (`SEC-07`).
7. **The factory proposes changes to itself and never applies them** (`SEC-11`, ADR-0007).
8. **The factory has measured its own baseline**, and reports honestly against it (`MEAS-03`, `MEAS-06`).
9. **A human's code review remains mandatory** until the calibration evidence says otherwise (`ADR-0003` §3).
10. **The factory could be replaced** component by component without editing the definition, the workflows, or the agent contracts (`I-12`).

If any of these is false, the factory is not done — regardless of how much code exists.

---

## 11. A final note on tone

The blueprint's own tone is its design instruction. It is deliberately conservative where the evidence is weak and specific where it is strong. It says "we do not know" in nine explicit "known limitations" sections, a programme risk register, and a register of twenty-one open questions. It refuses the corpus's most attractive numbers.

**Build the same way.** Do not claim a productivity improvement you have not measured. Do not let a green build stand in for evidence that the behaviour is correct. Do not promote a workflow's autonomy because the demo worked.

The value of this system is that a human can trust what it tells them. That is a property you maintain or you destroy, and it is destroyed by exactly one thing: a confident claim that was not measured.
