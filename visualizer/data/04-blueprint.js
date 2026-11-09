/* ============================================================
   SOFTWARE FACTORY — Part 4: ADRs, glossary, roadmap, risks, stack
   ============================================================ */

export const ADRS = [
  { n: "ADR-0001", title: "Adopt a declarative factory definition reconciled by an applier", decision: "The factory is defined by a declarative definition in a version-controlled repo, reconciled by an applier; the operational dashboard is read-and-request only.", hard: "The control surface may observe, pause, cancel, escalate and propose — but NEVER write to the definition directly.", consequence: "Every factory change, including permission changes, is a reviewable diff — privilege escalation cannot happen silently. But a reconciler will faithfully apply a WRONG declaration at scale, so the declaration must be reviewed.", ev: "E2" },
  { n: "ADR-0002", title: "Adopt the control plane / data plane / access point decomposition", decision: "Control plane (single authoritative state holder: task graph store, scheduler, policy engine, event log, orchestrator — the only component permitted to instruct the data plane) · Data plane (stateless workers in isolated environments, no authoritative state) · Access points (six typed entries).", consequence: "Governance becomes the system's topology and API rather than an ignorable policy document. But the control plane is a single point of failure, and 'access points' must be genuinely enumerable or the abstraction collapses into 'humans can do anything'.", ev: "E1+E2" },
  { n: "ADR-0003", title: "Adopt a staged, per-workflow autonomy ladder with mandatory human review of code", decision: "Autonomy is per-workflow, earned by demonstrated reliability and bounded by blast radius. Five levels L0–L4. THE FLOOR: human reading of code is mandatory until the workflow's verifier set is discriminator-calibrated. The default is L2.", consequence: "The blueprint deliberately gives up the corpus's headline throughput claims in exchange for a defensible quality position. The evidence bar for promotion (verifier suite + calibration corpus + observation window) is the largest single cost in the roadmap.", ev: "E2", critical: true },
  { n: "ADR-0004", title: "Split deterministic policy authority from probabilistic orchestration authority", decision: "No single component holds both. Policy as code makes every consequential decision and cannot be overridden by an agent's judgement; the orchestrator decides HOW and cannot widen scope, escalate autonomy, mint credentials, or bypass a gate. Arbitration rule: DENY BY DEFAULT AND ESCALATE. Untrusted content is DATA, never instruction.", consequence: "An orchestrator hallucination or injection cannot produce an unauthorised action, because authorisation is not the orchestrator's to give — the objection is structurally independent of the actor. But every tool call then requires a policy evaluation, and policy authoring becomes a first-class product surface.", ev: "E2", critical: true },
  { n: "ADR-0005", title: "Adopt a layered test strategy with an explicit authorship policy", decision: "Seven layers, each with an authorship policy: acceptance/black-box/E2E (written against the specification, PRIMARY GATE) · integration/contract · unit (NOT TRUSTED by default when agent-authored) · static/type/lint (always) · formal verification · security scanning · standards verifiers.", consequence: "The green signal becomes trustworthy — the precondition for any autonomy above L2. But a large fraction of agent output now requires review, which directly reduces throughput, and is why ADR-0003's default is L2 rather than L3.", ev: "E2", critical: true },
  { n: "ADR-0006", title: "Adopt tiered execution isolation with per-task credential scoping", decision: "Three tiers: T1 worktree (default) · T2 container (anything executing code or touching dependencies) · T3 hardened sandbox (untrusted inputs, production-adjacent, all L4). Credential scoping: ephemeral per-task, injected at the invocation boundary, never in context, revocable. Default-deny egress. Turn budget default 100.", consequence: "Blast radius is bounded structurally rather than by detection. But default-deny means every new integration requires a definition change and review — 'this is deliberate friction — it is the control.'", ev: "E2+E3" },
  { n: "ADR-0007", title: "All factory changes, including self-improvement, flow through reviewed definition changes", decision: "No self-modification outside the definition. The improvement loop PROPOSES; it does not apply. Four scopes, four approval bars (Run: automatic; Skill: automatic if additive below a risk threshold; Workflow: human review; Harness: human review always). Batch evidence, never single-run. The runtime surface is read-and-request only — there is NO privileged path.", consequence: "Improvement is slower than autonomous self-modification, deliberately — because slop applied to the rules themselves is not recoverable. And it makes the run-artefact store a hard prerequisite, not an optional analytics feature.", ev: "E2" },
  { n: "ADR-0008", title: "Use a relational store for authoritative state and an append-only event log for history", decision: "PostgreSQL for authoritative state. Append-only event log in the same DB. Object storage for artefacts. No vector DB at the core. No general-purpose broker — work distribution via a relational-backed job queue with leases. No third-party workflow engine — own runner over declared definitions. Realtime is a UI concern.", consequence: "Few components; exactly-once state transitions and audit become properties of the store. But a single relational DB is a scaling ceiling and availability dependency, and owning the workflow runner means owning its correctness.", ev: "E2" },
  { n: "ADR-0009", title: "Adopt a two-tier context model: repository-local by default, central for organisation-wide policy", decision: "Partition rule: context whose truth is a property of the REPOSITORY lives in the repository; context whose truth is a property of the ORGANISATION lives centrally. Precedence: (1) central security and compliance policy always wins — a repo cannot opt out; (2) otherwise repository-local overrides central; (3) gaps are flagged. Resolved in ONE place, deterministically.", consequence: "Repository context cannot drift from the code without a visible diff, and the promotion/demotion cycle turns duplicate detection into a mechanism. But there are two places to look for context, and promotion/demotion are process, not automation.", ev: "E2" },
  { n: "ADR-0010", title: "Adopt dependency-driven task topology with a chunkability rule for fan-out", decision: "Topology is chosen PER DEPENDENCY EDGE, not per task: independent → fan-out permitted; dependent → sequential with a FRESH CONTEXT (upstream artefact only, never upstream reasoning). Fan-out permitted only if all four chunkability conditions hold. The PLANNER IS A COMPONENT, NOT A PROMPT. Model tiering follows context scope, not prestige. Roles are specifications, not deployments.", consequence: "One rule covers both the context-hygiene concern and the agent-proliferation concern, and fan-out decisions are auditable after the fact. But the planner becomes a critical single point of failure, and sequential dependencies deliberately reduce wall-clock throughput.", ev: "E2" },
  { n: "ADR-0011", title: "Treat run artefacts, telemetry, and cost accounting as a prerequisite, not a deliverable", decision: "The factory CANNOT enter Phase 2 without a run-artefact store capturing, per run: task identity/workflow/effective context; model, harness and configuration versions; every tool call; prompts and generated text; verification results per layer; artefacts with hashes; outcome, approval and authority; token counts and compute cost. Telemetry is emitted by the framework, not by agents. Every experiment reports FOUR things: Baseline, Delta, Cost, Guardrail. Cost is attributed to the ACCEPTED CHANGE.", consequence: "Every architectural claim the factory makes about itself becomes falsifiable, and the improvement loops have a substrate by construction. But storing prompts and tool-call arguments has storage, privacy and licensing implications, and establishing a baseline is a deliberate delay.", ev: "E2", critical: true },
  { n: "ADR-0012", title: "Fix a minimal technology profile for the initial implementation", decision: "PostgreSQL-compatible managed DB · append-only event table in the same DB · S3-compatible object storage · relational-backed job queue with leases · OWN workflow runner over declared definitions · model gateway with routing/budgets/failover · tool registry + broker with MCP as ONE transport · T1 git worktree / T2 OCI container / T3 hardened sandbox · Kubernetes NOT adopted · vector DB NOT adopted · the control plane's own typed API as the gateway · in-process + managed KV caching · control-plane state as persistent execution state · existing CI provider · existing Git provider.", interfaceRule: "A component may be replaced without changing the factory definition, the workflows, the agent contracts, or the event schema. Any change that would require such edits is a defect in the interface, not a reason to keep the technology.", consequence: "The component count is small enough for a small team and every selection has a working precedent. But a single relational DB concentrates risk, building the workflow runner and tool broker is real work that a product would otherwise provide, and the container/sandbox substrate choice remains provider-sensitive.", ev: "E2+E3" },
];

export const ADR_CRITICAL = {
  "ADR-0003": "the human review floor",
  "ADR-0004": "the authority split",
  "ADR-0005": "oracle independence",
};

/* ---------- Roadmap: 8 weeks (pack) and 30 weeks (blueprint) ---------- */

export const WEEK_PLAN = [
  { wk: "W0", theme: "Decide, scaffold, bootstrap the manual factory, start the two day-one clocks", tickets: "T-0.01 – T-0.06", gate: "G0", exit: "Pre-flight" },
  { wk: "W1", theme: "Contracts, DB, event log, state machine, policy engine", tickets: "T-1.01 – T-1.05 (+ T-1.06 begins)", gate: "", exit: "Contract + unit gates green" },
  { wk: "W2", theme: "Definition applier, scheduler, broker, credentials, gateway, artefacts, T1, orchestrator, access points, projections, dashboard v0", tickets: "T-1.06 – T-1.17", gate: "G1", exit: "Phase-0 exit (A0.1–A0.10)" },
  { wk: "W3", theme: "Context assembler, skills, prompts, GitHub intake + tagging, triage, refinement, oracle, planner; start baseline + calibration", tickets: "T-2.01 – T-2.08, T-4.01, T-4.02", gate: "", exit: "Specs + oracles produced for a sandbox issue" },
  { wk: "W4", theme: "Approvals, T2 Docker + egress proxy, gateway passthrough + Claude Code harness, worker, verification runtime", tickets: "T-2.09 – T-2.13, T-4.03", gate: "", exit: "Worker produces a verified patch in T2" },
  { wk: "W5", theme: "Reviewer + panel, PR creation + check runs, blast radius, merge gate, knowledge, Workflow B wiring", tickets: "T-2.14 – T-2.19 (+ T-3.01 starts)", gate: "G2", exit: "Phase-1 exit (A1.1–A1.12). FIRST REAL ISSUE." },
  { wk: "W6", theme: "Safety hardening, Workflow C, first calibration reports; soak starts on real issues", tickets: "T-3.01 – T-3.06, T-5.01, T-4.04", gate: "", exit: "Red-team core green" },
  { wk: "W7", theme: "Fault injection, concurrency, Workflow D-1/D-2, inventory-lite, proposals, cost reports, production deploy, backups, self-observability", tickets: "T-3.07, T-3.08, T-5.02 – T-5.05, T-4.05, T-6.01 – T-6.03", gate: "G3", exit: "Safety + breadth exit" },
  { wk: "W8", theme: "Soak completion, drills, runbooks, readiness review, buffer", tickets: "T-6.04 – T-6.06", gate: "G4", exit: "Production readiness (PRD-1…10)" },
];

export const COMPRESSION_LEVERS = [
  { n: 1, t: "One owner, one repo, one workflow first", d: "The blueprint's own advice; everything after is configuration." },
  { n: 2, t: "Thin component, real interface", d: "Every Phase 0–3 component is built in its smallest correct form behind the real interface; the in-memory fake used by tests doubles as the I-12 proof." },
  { n: 3, t: "Boring off-the-shelf where the blueprint is silent", d: "Postgres, S3 API, Docker, GitHub App, Fastify, Vitest, Claude Code as a HarnessAdapter. Build bespoke only what encodes an invariant: policy, broker, event log, assembler, gate, scorer, approvals." },
  { n: 4, t: "AI agents implement; the owner writes and approves oracles and reviews every PR", d: "From Week 0 the build itself runs the factory's own discipline by hand — the 'manual factory'. By Week 5 the factory can take over part of its own backlog." },
  { n: 5, t: "Contract-first, parallel by disjoint file ownership", d: "packages/contracts lands first; tickets then run in parallel worktrees." },
  { n: 6, t: "A pre-agreed cut line", d: "So slippage removes breadth, never safety." },
];

export const NEVER_CUT = [
  "event log (T-1.02/1.03)", "state machine (1.04)", "policy engine (1.05)",
  "broker + credential broker (1.08/1.09)", "run artefacts (1.11)", "gateway budgets (1.10)",
  "T2 + egress (2.10)", "oracle admission (2.07)", "approval binding (2.09)",
  "verification + authorship flags (2.13)", "merge gate (2.17)", "untrusted tagging (2.04/3.01)",
  "red-team AT-1…AT-9, AT-13, AT-14 (3.02)", "audit tool (3.04)", "restore drill (6.02)", "kill switch (6.04)",
];

export const CUT_ORDER = [
  "T-5.05 proposals, T-5.04 inventory-lite",
  "T-5.03 (D-2) then T-5.02 (D-1)",
  "real second-provider adapter (keep interface + FakeProvider + failover test; NFR-09 gap recorded)",
  "T-5.01 Workflow C",
  "dashboard polish → CLI + three server-rendered pages",
  "calibration beyond one property",
];

/* Blueprint's 6 phases (30-week shape) */
export const BP_PHASES = [
  { n: "Phase 0", name: "Foundations", exit: "An unauthorised call is denied and logged; a run produces a complete artefact" },
  { n: "Phase 1", name: "First working slice", exit: "An issue becomes a reviewed PR with a passing independent oracle" },
  { n: "Phase 2", name: "Verification and gates", exit: "A verifier that misses a violation cannot gate a merge" },
  { n: "Phase 3", name: "Isolation and safety", exit: "The red-team suite passes; a credential cannot outlive its task" },
  { n: "Phase 4", name: "Scale the workflows", exit: "Six workflows run with recorded baselines" },
  { n: "Phase 5", name: "Self-improvement", exit: "A change is proposed from batch evidence, reviewed, applied, and automatically rolled back on a guardrail breach" },
];

export const PEAK_PHASES = [
  { id: "P6", name: "Ship at L2", win: "+0…+8 w", builds: "build → package → preview → staging deploy via GitOps PR → post-deploy verify → rollback proof", exit: "DORA baseline captured; ≥10 staging deploys with passing verification; one rollback drill", auto: "all L2" },
  { id: "P7", name: "Calibrate & promote code", win: "+4…+12 w", builds: "verifier calibration breadth; shadow mode; first L3 MERGE for low tiers", exit: "promotion bundle for D-1 (R0–R1) accepted", auto: "D-1 and simple bug-fix merge at L3 (deploy still L2)" },
  { id: "P8", name: "Deploy at L3", win: "+10…+20 w", builds: "production via GitOps with progressive delivery; IaC plan/apply", exit: "change-failure-rate ≤ baseline over window; rollback proofs current; IaC drills", auto: "prod deploy at L3 for stateless R0–R1; named approval R2+" },
  { id: "P9", name: "Operate", win: "+16…+30 w", builds: "T3, signals, Workflow E, runbook registry", exit: "incident drills; candidate-fix usefulness measured", auto: "L4 for 2–3 ENUMERATED runbooks" },
  { id: "P10", name: "Improve & scale", win: "+24 w …", builds: "replay, outer/meta loops (proposals only), multi-repo, more target profiles, team mode", exit: "≥100 completed runs; proposal evaluation results", auto: "per-workflow, evidence-gated" },
];

/* ---------- Decisions D1–D10 ---------- */

export const DECISIONS = [
  { id: "D1", q: "Target repo for the first slice (host, language, build/test/lint/typecheck commands, CI)", def: "NO DEFAULT. Fallback: create factory-sandbox (a small TS service with real tests) and proceed through W3. D1 must be answered by W4.", blocks: "T-0.05, T-2.x", matters: true },
  { id: "D2", q: "Confirm the TypeScript stack (ADR-0013) or choose Python", def: "TypeScript", blocks: "all paths" },
  { id: "D3", q: "Hosting (ADR-0025)", def: "One Linux VM + managed Postgres + S3-compatible bucket", blocks: "T-6.01" },
  { id: "D4", q: "Model provider accounts + monthly cap", def: "Anthropic primary; starting caps: $5/task, $50/day/workflow, owner-set monthly cap", blocks: "T-1.10" },
  { id: "D5", q: "Second provider", def: "OpenAI-compatible endpoint; if none, FakeProvider only (gap recorded)", blocks: "T-1.10" },
  { id: "D6", q: "Approvers", def: "The owner's GitHub login only", blocks: "T-1.14, T-2.09" },
  { id: "D7", q: "Notification channel", def: "None (dashboard only)", blocks: "T-3.05" },
  { id: "D8", q: "Secrets mechanism", def: "sops + age file on the host", blocks: "T-1.09" },
  { id: "D9", q: "Network exposure", def: "Private dashboard (VPN/tunnel); public /webhooks/github only; if no public endpoint is possible → polling intake", blocks: "T-2.04, T-6.01" },
  { id: "D10", q: "Daily review time", def: "2–3 h", blocks: "the whole plan", matters: true },
];

/* ---------- Risks ---------- */

export const RISKS = [
  { id: "R-01", t: "The oracle-first discipline is abandoned", l: "High", i: "Critical", m: "Make the oracle cheap (deterministic generators). Make its cost visible as a metric. Enforce the ordering mechanically, not by exhortation: provenance records a null implementation run, and the merge gate rejects a same-run-authored oracle.", res: "Medium" },
  { id: "R-02", t: "The calibration corpus is never funded", l: "High", i: "High", m: "Assign a named owner in Phase 1. Mine the repository's existing fix history — the corpus largely already exists. Make calibration currency a reported metric with a threshold.", res: "Medium" },
  { id: "R-03", t: "Review capacity saturates", l: "High", i: "High", m: "Measure review capacity from day one. Ration by blast-radius tiering. When the queue saturates, the response is to reduce scope or fix the workflow — NEVER to loosen the gate.", res: "High" },
  { id: "R-04", t: "The measurement layer is under-built because it is not visibly valuable", l: "Med", i: "Critical", m: "ADR-0011 makes it a Phase 0 deliverable. Every component writes its own artefact slice as a by-product of its work.", res: "Low" },
  { id: "R-05", t: "The value proposition turns out to be weak (Q-05)", l: "Med", i: "Critical", m: "Measure accepted throughput from Phase 1, not from Phase 4. Be willing to report a negative result.", res: "Medium" },
  { id: "R-06", t: "A workflow is promoted too early", l: "Med", i: "High", m: "The calibration bar and the escape-rate threshold are GATES, not guidance. Promotion is a reviewed change. Revocation is a normal path, not a crisis.", res: "Low" },
  { id: "R-07", t: "Infrastructure creep", l: "Med", i: "Med", m: "Deferral triggers are measured, not scheduled. Adding a broker, a cluster, or a vector store requires demonstrating the trigger.", res: "Low–Med" },
  { id: "R-08", t: "The factory is built and not used", l: "Low–Med", i: "Critical", m: "The operational surface is built in Phase 0, not last. The factory must be the default path for eligible work.", res: "Medium" },
  { id: "R-09", t: "A single provider failure or behaviour change degrades the factory", l: "Med", i: "Med", m: "Two providers from the start; provider-independent interfaces; replay evaluation detects quality changes; routing policy is configuration.", res: "Low" },
  { id: "R-10", t: "The scope grows faster than the team's ability to maintain it", l: "Med", i: "Med", m: "The context inventory tracks corpus growth; the duplicate-and-stale count must be non-increasing; each new workflow starts at L2.", res: "Medium" },
  { id: "R-11", t: "Prompt injection succeeds", l: "Med", i: "Critical", m: "Structural, not probabilistic: untrusted content is tagged at ingest and is never instruction-bearing; the agent can only propose; every consequential action is policy-checked. The red-team suite is a required check.", res: "Medium" },
  { id: "R-12", t: "A compromised dependency", l: "Med", i: "Critical", m: "T2/T3 isolation, default-deny egress, per-task scoped credentials, image pinning by digest, lockfiles, dependency review by criticality tier.", res: "Medium" },
  { id: "R-13", t: "A credential leaks", l: "Low–Med", i: "Critical", m: "Ephemeral, per-task, least-privilege, brokered credentials; never in context, prompt, arguments, results, or artefacts; revoked at task end; the leak check scans all of those.", res: "Low" },
  { id: "R-14", t: "The network allow-list grows into a permissive one", l: "High", i: "High", m: "Per-capability rather than per-host allow-lists; every addition is a security-relevant reviewed change; the allow-list size is a reported metric.", res: "Medium" },
  { id: "R-15", t: "An insider uses the control surface to widen permissions", l: "Low", i: "High", m: "ADR-0001's read-and-request rule; definition changes are reviewed; the audit trail reconstructs every action.", res: "Low" },
  { id: "R-16", t: "Untrusted-content tagging is missed at one ingest path", l: "Med", i: "High", m: "The trust classification is a required field of the adapter contract, so an adapter without one is a registration error rather than a silent omission.", res: "Low–Med" },
  { id: "R-17", t: "A gate is bypassed under pressure", l: "Med", i: "Critical", m: "Gate weakening is itself R3 and requires security-scope approval; bypass attempts are security events; a gate that never fails is suspect.", res: "Low–Med" },
  { id: "R-18", t: "The control plane becomes a single point of failure", l: "Low", i: "High", m: "Durable transactional store; stateless data-plane workers; recovery by replay; managed-service replicas.", res: "Low" },
  { id: "R-19", t: "Environment provisioning becomes the throughput bottleneck", l: "Med", i: "Med", m: "Warm image pools for T2; hibernation for T3; provisioning time is a measured metric.", res: "Low" },
  { id: "R-20", t: "The event log grows beyond what the relational store can serve", l: "Low–Med", i: "Med", m: "Partitioning by time and aggregate kind; projections are disposable and rebuildable.", res: "Low" },
  { id: "R-21", t: "A bad deployment reaches production", l: "Med", i: "High", m: "Enumerated runbooks with abort conditions; tested rollbacks; canary where supported; the deployment gate refuses an unenumerated operation.", res: "Low" },
  { id: "R-22", t: "The drift between the declared definition and reality goes unnoticed", l: "Med", i: "Med", m: "The applier reconciles and reports; drift is on the operational surface; unresolved drift beyond its window is an alert.", res: "Low" },
];

export const PACK_RISKS = [
  { id: "RP-1", t: "Owner review capacity saturates", l: "High", i: "High", m: "≤3 open build PRs at once; risk-tiered review; reviewer-agent pre-pass; cut order.", sig: "PRs waiting >24 h" },
  { id: "RP-2", t: "Oracle authoring cost makes tasks not worth running", l: "Med", i: "Critical", m: "R-G generators for common criteria; R-A + owner review at plan approval; track oracle coverage and cost per oracle.", sig: "share of tasks escalating 'criteria not expressible' >40%" },
  { id: "RP-3", t: "Harness CLI/SDK flags or stream format drift", l: "Med", i: "Med", m: "Spike S-4 pins the CLI version; the adapter has a golden-stream contract test; the adapter is the only code that knows the flags.", sig: "contract test red after an upgrade" },
  { id: "RP-4", t: "Gateway passthrough accounting wrong for streaming", l: "Med", i: "High", m: "Reconcile gateway-counted usage against provider usage fields on every run; alert on >2% drift.", sig: "reconciliation alert" },
  { id: "RP-5", t: "Security regressions introduced by AI-written code in trust-bearing packages", l: "Med", i: "Critical", m: "R4 paths are human-only; the red-team suite is required in CI from W3; mutation check for invariants.", sig: "any AT test flakes" },
  { id: "RP-6", t: "Scope creep ('one more workflow')", l: "High", i: "High", m: "The cut order is pre-agreed; backlog changes only at the Friday checkpoint.", sig: "tickets added mid-week" },
  { id: "RP-7", t: "Provider outage / cost spike mid-soak", l: "Med", i: "Med", m: "Fallback route; per-task/day caps; circuit breaker.", sig: "spend rate >2× trailing mean" },
  { id: "RP-8", t: "Built but not used", l: "Med", i: "High", m: "First real issue by end of W5; weekly 'what did the factory merge' review.", sig: "zero merged factory PRs in a week after W5" },
];

export const QUESTIONS = [
  { id: "Q-01", q: "Is multi-tenancy required?", why: "Changes the isolation model fundamentally: shared control plane with tenant partitioning vs. per-tenant control planes. Every table needs a tenant key.", handle: "NOT designed. The blueprint assumes a single organisation. Cross-repo isolation within an organisation is designed and tested (SEC-12); cross-organisation isolation is not.", resolve: "A decision BEFORE Phase 0. Retrofitting a tenant key across every table and projection is expensive." },
  { id: "Q-02", q: "What is the regulatory and compliance posture?", why: "Determines what evidence the audit trail must retain, how long, in what form, and whether a model's output can be part of a regulated decision.", handle: "The audit trail satisfies a general reconstructability requirement (SEC-07). Whether that satisfies a specific regime is unknown.", resolve: "An explicit compliance requirement BEFORE Phase 1." },
  { id: "Q-03", q: "How is the oracle authored for properties that cannot be mechanised?", why: "'The UX must feel trustworthy' — the oracle is the primary gate, so a property with no oracle is either ungated or gated by a human.", handle: "Gated by the reviewer, who is explicitly told they are asked what the gates cannot check. Honest, but it moves the load onto review capacity — the binding constraint.", resolve: "Per workflow: (a) accept human review, (b) define a mechanisable proxy, (c) reformulate the criterion so it is checkable. (c) is preferred." },
  { id: "Q-04", q: "How much does the reviewer's context cost the reviewer, and does it scale?", why: "If each review takes 30 minutes, throughput is capped regardless of agent speed.", handle: "Blast-radius tiering rations it; the panel and deterministic gates reduce what the reviewer must check. But per-item cost is not yet measured.", resolve: "Measure it in Phase 1. The pre-factory baseline should include human review time per change." },
  { id: "Q-05", q: "What is the real relationship between agent throughput and accepted throughput?", why: "THE most important open question about the programme's value. If agent throughput is 10× but accepted throughput is 1.2×, the economics are different.", handle: "The blueprint refuses to adopt the corpus's figures (MEAS-06) and measures both. Cost-per-accepted-change settles it.", resolve: "Measure in Phase 1 and Phase 4.", key: true },
  { id: "Q-06", q: "What is the optimal oracle-to-implementation ratio?", why: "A rigorous oracle is expensive; a thin one is weak. The oracle's cost is the largest early cost, and it gates everything above L2.", handle: "The blueprint specifies the PROPERTIES the oracle must have and the COST of the discipline, but not the optimal investment level.", resolve: "Experiment in Phase 2: vary the oracle's depth on a fixed workload." },
  { id: "Q-07", q: "Does the fresh-context rule scale to very large tasks?", why: "The blueprint assumes decomposition into bounded work items. A task too large to decompose is a re-plan trigger — but what if it genuinely cannot be decomposed?", handle: "The chunkability rule and the planner's escalation handle it: a task that cannot be decomposed into independently verifiable items escalates to a human.", resolve: "Observe in Phase 4. The frequency of un-decomposable tasks is itself a metric worth tracking." },
  { id: "Q-08", q: "What happens to the calibration corpus as the codebase changes fastest?", why: "A corpus built for today's code may be irrelevant next quarter. If it decays silently, calibration becomes fiction and the safety property above L2 degrades without anyone noticing.", handle: "Re-calibration on a schedule and on every skill change; an expired calibration removes the verifier from the gating set; calibration currency is a reported metric.", resolve: "Measure the corpus's decay rate in Phase 2 and adjust the re-calibration window." },
  { id: "Q-09", q: "Is there a point where the control plane itself becomes the bottleneck?", why: "If every tool call and every state transition goes through it, it is on the hot path for everything.", handle: "The control plane's write path is small. But this is a design intent, not a measurement.", resolve: "Measure in Phase 4 as concurrency rises." },
  { id: "Q-10", q: "How are model capability changes handled?", why: "Models improve, are deprecated, and change behaviour silently. A workflow calibrated against one model's behaviour may not hold for another.", handle: "The routing policy is configuration and the replay evaluator can test a model change against the historical run set. But the INTERACTION between calibration and model change is not specified.", resolve: "Decide in Phase 5. The conservative answer is yes — which would make model updates expensive." },
  { id: "Q-11", q: "What is the acceptable rate of false-positive findings?", why: "Too many and the team ignores the gate; too few and defects escape. The AGGREGATE noise across all gates has no target.", handle: "Per-property thresholds only.", resolve: "Measure the aggregate noise in Phase 2 and set a budget." },
  { id: "Q-12", q: "Does the factory work for tasks that are not code?", why: "Design review, data analysis, incident postmortems, documentation architecture. The design is not code-specific in principle.", handle: "The capability and gate model generalises. Whether the IMPLEMENTATION does is untested.", resolve: "A deliberate experiment in Phase 4 with one non-code workflow." },
  { id: "Q-13", q: "How do we know the human reviewers are good?", why: "The blueprint assumes human review is a valid oracle substitute until calibrated verifiers exist. It never checks whether human review is itself effective.", handle: "The post-hoc defect rate is the indirect measure — it detects when review is failing, but not why.", resolve: "A defect-postmortem process asking 'would our review have caught this?' once a quarter." },
  { id: "Q-14", q: "What is the organisational adoption path?", why: "The factory's value depends on engineers using it. A technically excellent factory that nobody uses has no value.", handle: "The operational surface is built early (Phase 0) and the workflows must be the default path.", resolve: "Measure in Phase 4: what fraction of eligible work goes through the factory?" },
  { id: "Q-15", q: "Does the improvement loop actually improve things?", why: "It is the last phase and the most speculative.", handle: "ADR-0007's guards: batch evidence, replay evaluation, guardrails, automatic rollback, and the loop's own cost accounting.", resolve: "Phase 5 measures the loop's net effect against its cost. If net negative, that is a finding and the loop should be scaled back." },
  { id: "Q-16", q: "What is the right model tier per task?", why: "The threshold itself must be measured per role.", handle: "Until then, the routing policy uses conservative defaults.", resolve: "Measure per role." },
  { id: "Q-17", q: "How does deferred context actually behave?", why: "Deferred context could reduce cost AND reduce correctness. The trade-off is unquantified.", handle: "The fresh-context and oracle rules are the mitigation.", resolve: "Measure the quality interaction." },
  { id: "Q-18", q: "How are evers mined from historical behaviour?", why: "Correctness can be extracted from history rather than written from scratch — but the failure rate on a codebase with a poor history is unspecified.", handle: "The mechanism is unspecified. Phase 2 task T2.4 is where this gets built.", resolve: "Phase 2." },
  { id: "Q-19", q: "What is the real cost of a calibration corpus?", why: "Called 'the largest single cost of the roadmap' without a figure.", handle: "No figure.", resolve: "Measured in Phase 2 as the loop's own cost." },
  { id: "Q-20", q: "Does the panel's aggregation actually predict correctness?", why: "Confidence-gated merge depends on it; the corpus never defines the confidence function, so there is nothing to reproduce.", handle: "The blueprint measures it (ADR-0011's calibration).", resolve: "The calibration measurement (A2.11)." },
  { id: "Q-21", q: "How do agents handle a task with no clear owner or specification?", why: "The Refinement role escalates — but the corpus says nothing about how often, so the escalation rate is unpredicted.", handle: "The Refinement role escalates.", resolve: "It is one of the workflow's completion criteria to report it." },
];

export const HYPOTHESES = [
  { id: "H-01", t: "An agent-independent acceptance oracle can be built for a substantial fraction of real tasks at acceptable cost.", why: "The foundation of everything above L2.", wrong: "If the fraction is small, most tasks fall back to human review and the factory's value collapses to a code generator.", test: "Measure the oracle coverage rate in Phase 1." },
  { id: "H-02", t: "The fresh-context rule does not materially hurt quality.", why: "It makes cost predictable and enables the chunkability rule.", wrong: "If dependent stages genuinely need shared context, every dependent edge is a quality risk.", test: "Compare dependent-edge defect rates against a controlled subset in Phase 2." },
  { id: "H-03", t: "Human review can be reduced to a well-chosen subset without reducing the defect escape rate.", why: "It is what makes the economics work (Q-05).", wrong: "If the subset misses correlated defects, the escape rate rises even as review volume falls.", test: "The escape rate tracked against the review volume in Phase 4. THE DECISIVE TEST." },
  { id: "H-04", t: "The panel's confidence correlates with correctness well enough to gate.", why: "The mechanism for reducing review at scale.", wrong: "A poorly-calibrated panel produces confident wrong agreement — the worst outcome.", test: "The calibration measurement (A2.11)." },
  { id: "H-05", t: "A model-tier routing policy can find the cheapest sufficient model per task class.", why: "The main cost lever.", wrong: "The cheapest sufficient model may be task-specific in a way that resists a static policy.", test: "Routing policy per-class thresholds, tuned from measured data in Phase 4." },
  { id: "H-06", t: "The context inventory's promotion/demotion cycle keeps the corpus bounded in practice.", why: "Without it, the corpus grows and selection becomes arbitrary.", wrong: "The 'outdated' detection requires knowing what an item references; implicitly-referenced moving targets are missed.", test: "The duplicate-and-stale count is tracked as a non-increasing metric." },
  { id: "H-07", t: "The improvement loop produces net-positive changes.", why: "The programme's compounding-value mechanism.", wrong: "It could consume more capacity than it returns, or over-fit the replay set.", test: "The loop's cost accounting against the value of what it promotes (Phase 5)." },
  { id: "H-08", t: "The blast-radius scorer is a good enough proxy for risk to ration review correctly.", why: "It determines the gate set and the review depth.", wrong: "A systematically under-estimating scorer erodes the governance model silently.", test: "Track predicted against observed tiers; the observed tier is set by post-hoc defect analysis." },
  { id: "H-09", t: "Two implementation providers give genuine failover diversity.", why: "NFR-09 requires no dependency on one provider.", wrong: "If both route to the same underlying model family, the diversity is nominal.", test: "The failover test (I-9), plus an inspection of what the fallback actually is." },
  { id: "H-10", t: "The chunkability rule's fourth condition can be judged accurately enough to be useful.", why: "The rule that prevents the proliferation objection.", wrong: "It is a judgement call in every case, and it is made by a model.", test: "The recorded justifications are audited against outcomes." },
  { id: "H-11", t: "The team will sustain the oracle-first discipline under schedule pressure.", why: "Everything depends on it.", wrong: "The most likely single point of failure in the programme.", test: "Track the SAME-RUN-AUTHORED ORACLE RATE — a direct measure of whether the discipline holds.", key: true },
  { id: "H-12", t: "Default-deny egress can be maintained without excessive friction.", why: "The exfiltration control.", wrong: "The friction accumulates and the allow-lists grow.", test: "Report the allow-list size and the number of additions per month." },
];

/* ---------- A1 stack neutrality ---------- */

export const STACK_TIERS = [
  {
    id: "fixed", name: "FIXED", sub: "non-negotiable", color: "#fb7185",
    items: [
      "Architecture, trust zones, invariants, flows, security model",
      "Data model (SQL) + validation script — PostgreSQL 16+",
      "Definition kinds (YAML), event vocabulary, state-machine tables",
      "Interface contracts — fixed SEMANTICS, parametric notation",
      "The architecture's guarantees: role privileges, append-only enforcement, SKIP LOCKED leases",
    ],
  },
  {
    id: "profile", name: "PROFILE", sub: "swappable, one column of a table", color: "#fbbf24",
    items: [
      "Repo layout",
      "Build / test / lint commands",
      "Code conventions",
      "The factory-stack language itself (TypeScript = reference rendering; Python / Go / .NET / Java also provided)",
    ],
  },
  {
    id: "adapter", name: "ADAPTER", sub: "swappable behind an interface (I-12)", color: "#a78bfa",
    items: [
      "SCM + review", "CI visibility/trigger", "Isolation", "Harness", "Model provider",
      "Secrets", "Object store", "Identity", "Notifier", "Database (PostgreSQL — none recommended as an alternative)",
      "Deploy / IaC / observability signals (peak path, GitOps-first)",
    ],
  },
  {
    id: "target", name: "TARGET PROFILE", sub: "what the factory builds", color: "#7dd3fc",
    items: [".factory/repo.yml in the target repository — its language, build commands, oracle paths, CI checks, path conventions"],
  },
];

export const FACTORY_PROFILES = [
  { lang: "TypeScript", sub: "reference rendering", stack: "Node LTS · pnpm workspaces · Vitest + fast-check · Zod → JSON Schema · Kysely · Fastify · React + Vite" },
  { lang: "Python", sub: "equally valid", stack: "FastAPI · Pydantic · pytest · Alembic · uv" },
  { lang: "Go", sub: "profile", stack: "net/http or chi · sqlc · table-driven tests" },
  { lang: ".NET", sub: "profile", stack: "ASP.NET Core · xUnit · EF Core" },
  { lang: "Java", sub: "profile", stack: "Spring Boot · JUnit 5 · Flyway" },
];

export const TARGET_STACKS = [
  { name: "Node / TypeScript", install: "npm ci", static: "eslint . && prettier --check .", type: "tsc --noEmit", test: "vitest run", oracle: "vitest run --dir tests/acceptance" },
  { name: "Python", install: "uv sync --frozen", static: "ruff check . && ruff format --check .", type: "mypy .", test: "pytest -q", oracle: "pytest tests/acceptance -q" },
  { name: "Go", install: "go mod download", static: "gofmt -l . && golangci-lint run", type: "go vet ./...", test: "go test ./...", oracle: "go test ./tests/acceptance/..." },
  { name: "Rust", install: "cargo fetch --locked", static: "cargo fmt --check && cargo clippy", type: "cargo check", test: "cargo test", oracle: "cargo test --test acceptance" },
  { name: "Java / Maven", install: "mvn -B dependency:go-offline", static: "spotless:check", type: "mvn -B -q compile", test: "mvn -B test", oracle: "mvn -B test -Dtest='acceptance/**'" },
  { name: ".NET", install: "dotnet restore", static: "dotnet format --verify-no-changes", type: "dotnet build", test: "dotnet test", oracle: "dotnet test --filter Acceptance" },
  { name: "Ruby", install: "bundle install", static: "rubocop", type: "steep check", test: "rspec", oracle: "rspec spec/acceptance" },
  { name: "Terraform / OpenTofu", install: "terraform init -backend=false", static: "terraform fmt -check -recursive && tflint", type: "terraform validate", test: "terraform test (if used)", oracle: "terraform test / policy tests" },
  { name: "Helm charts", install: "helm dependency build", static: "helm lint .", type: "helm template . > /dev/null", test: "helm unittest .", oracle: "helm unittest + policy tests" },
  { name: "CI-only repo", install: "—", static: "actionlint", type: "—", test: "the CI harness itself", oracle: "the CI harness's own checks" },
  { name: "Docs / Markdown", install: "—", static: "markdownlint", type: "—", test: "link checker", oracle: "link + structure assertions" },
];

export const CANONICAL_TASKS = ["ci", "lint", "lint-deps", "typecheck", "test", "test-acceptance", "test-invariants", "test-redteam", "test-fault", "test-concurrency", "test-e2e", "mutation"];

export const ADAPTER_SWAPS = [
  { from: "GitHub App", to: "GitLab / Bitbucket", why: "ScmAdapter is the interface" },
  { from: "GitHub Actions", to: "Any CI provider", why: "CI visibility/trigger adapter" },
  { from: "Rootless Docker (T2)", to: "Kubernetes Jobs / Firecracker", why: "IsolationProvider — T3 deferred" },
  { from: "Claude Code CLI", to: "Any coding harness", why: "HarnessAdapter + golden-stream contract test" },
  { from: "Anthropic", to: "Any OpenAI-compatible provider", why: "ProviderAdapter + routing-policy.yaml" },
  { from: "sops + age file", to: "Any cloud secret manager", why: "SecretStore" },
  { from: "S3 API", to: "Any S3-compatible store", why: "RunArtifactStore adapter" },
  { from: "GitHub OAuth", to: "Any OIDC provider", why: "Access-point API auth" },
  { from: "Generic webhook", to: "Slack / Telegram / Discord / email", why: "notify.send capability" },
  { from: "Direct apply (kubectl/helm)", to: "GitOps controller", why: "DeploymentController — GitOps-first" },
];

/* ---------- Package layout ---------- */

export const PACKAGES = [
  { g: "core", list: ["contracts", "core", "policy", "state", "eventlog", "db", "definition", "broker", "credentials", "gateway", "artefacts", "isolation", "harness", "context", "oracle", "verify", "review", "approvals", "merge", "scm-github", "calibration", "orchestrator"], note: "contracts imports nothing internal. policy, state, context(assembler), review(scorer, panel), merge(rules) are PURE — no fs/net/child_process, no pg, no network, no clock/randomness except injected. Packages never import apps/*." },
];

export const APPS = [
  { n: "apps/api", d: "Fastify: access points, GitHub webhooks, SSE, static dashboard" },
  { n: "apps/worker", d: "Orchestrator loop, scheduler, projector, reaper, cron, edge-outbox drain" },
  { n: "apps/egress-proxy", d: "Edge container entrypoint (factory-egress)" },
  { n: "apps/gateway", d: "Edge container entrypoint (factory-gateway)" },
  { n: "apps/cli", d: "CLI binary 'factory'" },
  { n: "apps/dashboard", d: "Static dashboard" },
];

/* ---------- Database tables ---------- */

export const TABLES = [
  { n: "event_counter", d: "id smallint PK CHECK (id=1), value bigint NOT NULL", role: "Sequence source" },
  { n: "events", d: "PARTITION BY RANGE (occurred_at). seq bigint (gapless), event_id uuid (UUIDv7), occurred_at, event_type, aggregate_kind, aggregate_id, aggregate_version, correlation_id, causation_id, actor_kind, actor_id, authority jsonb, subject jsonb, payload jsonb, context jsonb, redaction jsonb, cost_usd_micros, duration_ms, prev_hash bytea, hash bytea. PK (seq, occurred_at).", role: "The append-only record", key: true },
  { n: "tasks", d: "id, repo, workflow, state, version, autonomy_level, risk_tier, source jsonb, spec jsonb, spec_sha256, graph jsonb, graph_sha256, oracle_id, definition_sha, correlation_id, budget_usd_micros, spent_usd_micros, escalation jsonb, created_by, created_at, updated_at, terminal_at", role: "Authoritative task state" },
  { n: "nodes", d: "task_id FK, node_id, kind, state, version, attempt, depends_on text[], spec jsonb, result jsonb. PK (task_id, node_id)", role: "Work items in the graph" },
  { n: "jobs", d: "id bigserial, task_id, node_id, kind, status (ready/leased/done/failed/dead), priority, available_at, lease_owner, lease_expires_at, attempt, max_attempts, idempotency_key UNIQUE, payload", role: "Relational-backed work queue with leases" },
  { n: "approvals", d: "id, task_id FK, type (plan/merge/definition/temporary-grant), artefact_kind, artefact_ref, artefact_sha256, approvers text[], status, requested_at, expires_at, decided_at, decided_by, comment, review_minutes, security_scope_ack, cool_off_until, consumed_at", role: "Artefact-bound human decisions" },
  { n: "runs", d: "run_id PK, task_id FK, node_id, attempt, role, stage_kind, executor_kind (deterministic/completion/harness/human), route jsonb, status, outcome, failure_class, started_at, ended_at, record_uri, record_sha256, context_envelope_id, cost_usd_micros, tokens jsonb, retention_class, retain_until", role: "One execution of one stage" },
  { n: "tool_invocations", d: "id, run_id FK, task_id, node_id, attempt, capability_id, effect_class (E0–E4), transport, args_sha256, args_summary, result_summary, policy_decision_id, approval_id, status, idempotency_key UNIQUE, duration_ms, cost_usd_micros, started_at", role: "Every capability call, recorded" },
  { n: "policy_decisions", d: "id, task_id, action, input_sha256, outcome (ALLOW/DENY/REQUIRE_APPROVAL/ESCALATE), rule_ids text[], reason, bundle_sha256, decided_at", role: "Why each action was permitted or not" },
  { n: "model_calls", d: "id, run_id, task_id, provider, model, route_rule, prompt_sha256, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, cost_usd_micros, latency_ms, status, cached, via (complete/passthrough), idempotency_key UNIQUE", role: "THE COST LEDGER" },
  { n: "context_envelopes", d: "id, task_id, run_id, stage, resolved_sha256, items jsonb, truncations jsonb, gaps jsonb, bytes, budget_bytes, object_uri", role: "Pinned, recoverable context (I-8)" },
  { n: "oracles", d: "id, task_id FK, route (human/generated/agent), provenance jsonb {author, runId|null, implementationRunId: null}, manifest jsonb, manifest_sha256, object_uri, status (draft/admitted/rejected), admission_report, admitted_at", role: "The acceptance oracle + its independence proof" },
  { n: "changes", d: "id, task_id FK, repo, pr_number, branch, base_sha, head_sha, status, merge_sha, merged_by, merged_at", role: "The pull request" },
  { n: "gate_reports", d: "id, task_id, change_id, head_sha, tier, report jsonb, report_sha256, passed, created_at", role: "The merge gate's sole input" },
  { n: "definition_versions", d: "sha PK, bundle_sha256, bundle jsonb, plan jsonb, approval_id, applied_at, applied_by, active bool", role: "Applied factory definitions" },
  { n: "credential_leases", d: "id, task_id, provider, scope jsonb, minted_at, expires_at, revoked_at", role: "NEVER stores secret material" },
  { n: "egress_tokens", d: "task_id PK, token_hash, allow jsonb, expires_at", role: "Task-bound proxy credentials" },
  { n: "gateway_tokens", d: "task_id PK, token_hash, model_allowlist text[], max_tokens_cap int, expires_at", role: "Task-bound model access" },
  { n: "edge_outbox", d: "id bigserial, kind (model_usage/egress_denied/egress_summary), task_id, payload, created_at, drained_at", role: "Written ONLY by edge containers. The edge's ONLY write." },
  { n: "kill_switch", d: "id smallint PK CHECK (id=1), engaged bool, engaged_by, engaged_at, reason", role: "The global stop" },
  { n: "projection_cursors", d: "name PK, last_seq bigint DEFAULT 0", role: "Durable projector cursors" },
];

export const DB_ROLES = [
  { n: "factory_owner", d: "DDL" },
  { n: "factory_app", d: "SELECT + INSERT on events. No UPDATE, no DELETE, no TRUNCATE." },
  { n: "factory_projector", d: "SELECT only" },
  { n: "factory_applier", d: "The ONLY writer of definition_versions" },
  { n: "factory_edge", d: "SELECT on egress_tokens/gateway_tokens/kill_switch; limited SELECT on tasks; SELECT + INSERT on edge_outbox (its ONLY write)" },
  { n: "factory_readonly", d: "Read-only for reporting" },
];

export const CAPABILITIES = [
  { id: "repo.snapshot.read", kind: "read", eff: "E0", tr: "inproc", scope: "repo:read", cred: "—", trust: "trusted", used: "assembler, completion stages" },
  { id: "repo.search", kind: "read", eff: "E0", tr: "inproc", scope: "repo:read", cred: "—", trust: "trusted", used: "assembler (deterministic)" },
  { id: "git.worktree.create", kind: "compute", eff: "E1", tr: "inproc", scope: "git.write.branch", cred: "—", trust: "trusted", used: "patch path" },
  { id: "git.patch.apply", kind: "mutation", eff: "E1", tr: "inproc", scope: "repo:write:path:<glob>", cred: "—", trust: "trusted", used: "patch path" },
  { id: "git.commit", kind: "mutation", eff: "E1", tr: "inproc", scope: "git.write.commit", cred: "—", trust: "trusted", used: "patch path" },
  { id: "git.push.branch", kind: "mutation", eff: "E2", tr: "cli (git)", scope: "git.write.branch (refs/heads/factory/*)", cred: "contents:write", trust: "trusted", used: "patch path" },
  { id: "github.pr.create / .update", kind: "mutation", eff: "E2", tr: "http", scope: "git.write.pr", cred: "pull_requests:write", trust: "trusted", used: "PR stage" },
  { id: "github.pr.read", kind: "read", eff: "E0", tr: "http", scope: "repo:read", cred: "pull_requests:read", trust: "UNTRUSTED", used: "review, D-2" },
  { id: "github.issue.read", kind: "read", eff: "E0", tr: "http", scope: "repo:read", cred: "issues:read", trust: "UNTRUSTED", used: "intake" },
  { id: "github.issue.comment", kind: "communicate", eff: "E2", tr: "http", scope: "git.write.pr", cred: "issues:write", trust: "trusted (own text)", used: "status/escalation notes" },
  { id: "github.permission.read", kind: "read", eff: "E0", tr: "http", scope: "—", cred: "metadata:read", trust: "trusted", used: "intake auth" },
  { id: "github.checks.publish", kind: "mutation", eff: "E2", tr: "http", scope: "git.write.pr", cred: "checks:write", trust: "trusted", used: "merge gate" },
  { id: "github.ci.read", kind: "read", eff: "E0", tr: "http", scope: "repo:read", cred: "actions:read", trust: "UNTRUSTED", used: "D-2, merge-gate" },
  { id: "github.advisories.read", kind: "read", eff: "E0", tr: "http", scope: "net.fetch", cred: "dependabot_alerts:read", trust: "UNTRUSTED", used: "D-1" },
  { id: "net.fetch", kind: "read", eff: "E0", tr: "inproc (fetch service)", scope: "net.fetch + host allow-list", cred: "—", trust: "UNTRUSTED", used: "D-1" },
  { id: "shell.sandboxed", kind: "compute", eff: "E1", tr: "inproc → T2 exec", scope: "shell.sandboxed", cred: "—", trust: "trusted (content-checked)", used: "verify, harness (recorded)" },
  { id: "artefact.write", kind: "mutation", eff: "E1", tr: "inproc", scope: "framework-only", cred: "—", trust: "trusted", used: "run store" },
  { id: "knowledge.write", kind: "mutation", eff: "E1", tr: "inproc", scope: "framework-only", cred: "—", trust: "trusted", used: "record stage" },
  { id: "notify.send", kind: "communicate", eff: "E2", tr: "http", scope: "notify.send", cred: "—", trust: "trusted", used: "ops" },
  { id: "mcp.fixture.echo", kind: "read", eff: "E0", tr: "mcp", scope: "test env only", cred: "—", trust: "untrusted", used: "contract test (FR-62)" },
];

export const ABSENT_CAPABILITIES = ["prod.*", "deploy.*", "git.push.protected", "git.merge", "secret.read", "factory.write"];

/* ---------- API endpoints ---------- */

export const API = [
  { ap: "AP-1", m: "POST", p: "/v1/intents", d: "Create an intent → 202 {taskId}" },
  { ap: "AP-2", m: "GET", p: "/v1/approvals?status=requested", d: "The approval queue" },
  { ap: "AP-2", m: "GET", p: "/v1/approvals/{id}", d: "Artefact view incl. RAW UNTRUSTED CONTENT BLOCKS (flagged) + oracle manifest + diff" },
  { ap: "AP-2", m: "POST", p: "/v1/approvals/{id}/decision", d: "grant | refuse → 200 / 409 hash_mismatch / 410 expired" },
  { ap: "AP-2", m: "POST", p: "/v1/approvals/{id}/revoke", d: "Revoke with a reason" },
  { ap: "AP-3", m: "GET", p: "/v1/reviews", d: "Risk-ordered queue with rationale[]" },
  { ap: "AP-3", m: "GET", p: "/v1/reviews/{taskId}", d: "Evidence bundle: spec, oracle result, gate report, panel result, blast radius, diff link — NO implementer transcript unless ?include=transcript (audited)" },
  { ap: "AP-3", m: "POST", p: "/v1/reviews/{taskId}/decision", d: "approve | reject | defer" },
  { ap: "AP-4", m: "GET", p: "/v1/views/overview", d: "THE ONE VIEW — needs-you, in-flight, recent outcomes, health, cost" },
  { ap: "AP-4", m: "GET", p: "/v1/tasks, /v1/tasks/{id}, /v1/tasks/{id}/events, /v1/tasks/{id}/runs", d: "Filters: state, repo, workflow" },
  { ap: "AP-4", m: "GET", p: "/v1/runs/{id}, /v1/runs/{id}/artefacts/{name}", d: "Run record; short-lived signed object URL" },
  { ap: "AP-4", m: "GET", p: "/v1/metrics/summary, /v1/audit/explain?eventId=…", d: "Metrics subset; audit walk" },
  { ap: "AP-4", m: "GET", p: "/v1/stream", d: "SSE: task.updated, approval.requested, review.queued, health.changed, cost.updated, killswitch.changed. id: = event seq for Last-Event-ID resume" },
  { ap: "AP-5", m: "POST", p: "/v1/tasks/{id}/{pause|resume|cancel|escalate|rerun}", d: "With a reason" },
  { ap: "AP-5", m: "POST", p: "/v1/factory/kill-switch", d: "engage:boolean, reason" },
  { ap: "AP-5", m: "POST", p: "/v1/grants/temporary", d: "taskId, capability, scope, ttlSeconds ≤ 3600, reason → creates a temporary-grant approval" },
  { ap: "AP-5", m: "POST", p: "/v1/tasks/{id}/defect-flag", d: "note — feeds the defect-escape proxy" },
  { ap: "AP-6", m: "GET/POST", p: "/v1/definition/plan?sha= · /v1/definition/apply", d: "Plan diff · {sha, approvalId}. Applies ONLY a merged SHA." },
  { ap: "—", m: "POST", p: "/webhooks/github", d: "GitHub webhooks — THE ONLY PUBLIC ROUTE" },
  { ap: "—", m: "GET", p: "/healthz, /readyz, /metrics", d: "Liveness · readiness (DB, object store, active definition, kill-switch, Docker reachable via worker heartbeat) · Prometheus (private)" },
];

/* ---------- Integrations ---------- */

export const INTEGRATIONS = [
  { id: "INT-01", n: "GitHub App", dir: "both", used: "intake, branches, PRs, checks, CI read", auth: "App JWT → per-task installation tokens; webhook HMAC", caps: "github.*, git.push.branch", fails: "intake pauses; writes retried with idempotency keys" },
  { id: "INT-02", n: "GitHub OAuth", dir: "in", used: "owner login to dashboard/CLI", auth: "OAuth code flow, owner allow-list", caps: "— (AP auth)", fails: "CLI tokens still work" },
  { id: "INT-03", n: "Git CLI", dir: "local", used: "snapshots, clean worktrees, patch apply, commit", auth: "argv arrays; hooks disabled", caps: "git.*", fails: "task fails environment.failure" },
  { id: "INT-04", n: "Anthropic Messages API", dir: "out", used: "all completion stages; harness via passthrough", auth: "x-api-key held by worker/edge only", caps: "model.complete", fails: "failover per routing policy" },
  { id: "INT-05", n: "Second provider (OpenAI-compatible)", dir: "out", used: "failover; I-9 proof", auth: "API key (worker only)", caps: "model.complete", fails: "none (gap recorded)" },
  { id: "INT-06", n: "Docker Engine (rootless)", dir: "local", used: "T2 sandboxes, edge containers", auth: "docker CLI via execa, argv arrays", caps: "shell.sandboxed", fails: "NO FALLBACK to unsandboxed execution" },
  { id: "INT-07", n: "PostgreSQL 16+", dir: "local", used: "log, state, queue, projections", auth: "role-per-component DSNs", caps: "—", fails: "system stops claiming work" },
  { id: "INT-08", n: "S3-compatible object store", dir: "out", used: "run artefacts, oracles, patches", auth: "S3 API, versioned bucket", caps: "artefact.write", fails: "spool locally, then fail stage" },
  { id: "INT-09", n: "Claude Code CLI", dir: "local", used: "the harness executor", auth: "env + flags [VERIFY]", caps: "(harness-internal)", fails: "adapter-level retry" },
  { id: "INT-10", n: "Notification webhook(s)", dir: "out", used: "'needs you' pings", auth: "HMAC-signed JSON POST", caps: "notify.send", fails: "dashboard still shows everything" },
  { id: "INT-11", n: "OSV / GitHub advisories", dir: "out", used: "D-1 candidate + advisory data", auth: "via control-plane fetch service", caps: "net.fetch, github.advisories.read", fails: "D-1 skips advisory enrichment" },
  { id: "INT-12", n: "Package registries", dir: "out", used: "install inside T2", auth: "via egress proxy allow-list only", caps: "—", fails: "install fails closed" },
  { id: "INT-13", n: "MCP servers", dir: "both", used: "transport-only adapter; fixture in v1", auth: "official MCP client [VERIFY]", caps: "mcp.* (fixture)", fails: "capability marked degraded" },
  { id: "INT-14", n: "Secret store", dir: "local", used: "sops+age file or cloud manager", auth: "read at process start", caps: "—", fails: "process refuses to start" },
  { id: "INT-15", n: "Metrics/logs", dir: "out", used: "Prometheus scrape, pino JSON logs", auth: "/metrics (private), stdout", caps: "—", fails: "alerts degrade" },
];

export const DEFERRED_INTEGRATIONS = [
  "Linear/Jira issue adapters", "Slack-interactive approvals", "Sentry/PostHog signals (Workflow E)",
  "cloud deploy APIs (Workflow A/E)", "T3 sandbox provider", "replay/eval tooling",
  "external reviewers/marketplaces",
];

/* ---------- Metrics ---------- */

export const METRICS = [
  { g: "Flow", m: ["lead time", "task completion time", "PR cycle time", "accepted-PR rate"] },
  { g: "Quality", m: ["first-pass success", "human intervention frequency", "agent failure rate", "retry frequency"] },
  { g: "Cost", m: ["cost per accepted change", "token consumption", "tool execution cost"] },
  { g: "Oracle", m: ["oracle coverage", "same-run-authored oracle rate (must be 0)"] },
  { g: "Human", m: ["approval latency by tier", "rubber-stamp rate"] },
  { g: "Context", m: ["context-budget compliance", "defect-escape proxy", "calibration currency"] },
];

export const FOUR_REPORTS = [
  { k: "Baseline", v: "The same metric, before the change, over a stated window, on the same workload" },
  { k: "Delta", v: "The change in the metric, with confidence information where the sample permits" },
  { k: "Cost", v: "Total cost — inference, tools, infrastructure, and the evaluation's own cost" },
  { k: "Guardrail", v: "At least one metric that must not degrade" },
];

export const GUARDRAILS = [
  "defect escape rate", "revert rate", "human intervention rate", "cost per accepted change",
  "context budget compliance", "approval rubber-stamp rate", "gate failure rate", "total system cost",
];

export const DEFERRED_TECH = [
  { t: "Message broker", phase: "Phase 4", trigger: "Measured queue latency at p95 exceeding the workflow's deadline, or write contention on the queue tables" },
  { t: "Kubernetes", phase: "Phase 5+", trigger: "T2 workload count or resource diversity exceeding managed container compute's capability" },
  { t: "Vector database", phase: "Phase 5", trigger: "Retrieval precision demonstrably limiting agent task success in a measured way" },
  { t: "Durable-execution platform", phase: "Phase 4", trigger: "The own runner failing a stated resumability or determinism requirement under load" },
  { t: "Event streaming platform", phase: "Phase 5", trigger: "Event log volume exceeding what partition-and-archive can serve for the required query patterns" },
];

export const MUST_NOT_BUILD = [
  "chat-with-the-agent interface", "autonomous self-modifying factory", "vector DB as context store",
  "message broker / Kubernetes / event-streaming platform", "general-purpose workflow engine",
  "one agent per role", "LLM grader for every check", "multi-tenancy",
  "confidence-score merging without calibration",
];

export const TEST_SUITES = [
  { n: "Contract tests", p: 0, d: "The interfaces hold" },
  { n: "Policy tests", p: 0, d: "Denials, escalations, scope, fail-closed" },
  { n: "Authorisation tests", p: 0, d: "The un-bypassable evaluation point" },
  { n: "Durability tests", p: 0, d: "Fault injection, no silent loss" },
  { n: "Concurrency tests", p: 1, d: "No cross-task contamination" },
  { n: "Replay tests", p: 1, d: "Reproducibility" },
  { n: "Gate tests", p: 2, d: "The merge gate's negative cases" },
  { n: "Calibration tests", p: 2, d: "The discrimination requirement" },
  { n: "Red-team tests", p: 3, d: "The 15 attacks" },
  { n: "Isolation tests", p: 3, d: "The tier properties" },
  { n: "Drift tests", p: 3, d: "Report, then correct" },
  { n: "Audit tests", p: 3, d: "Reconstruction" },
  { n: "Evaluation tests", p: 5, d: "The four evaluation suites" },
];

export const REVIEWS = [
  { n: "Definition review", c: "On every change", a: "Platform + the affected owner" },
  { n: "Autonomy review", c: "Monthly", a: "Engineering leadership + platform + security" },
  { n: "Calibration review", c: "Quarterly", a: "Quality + the verifier owners" },
  { n: "Threat model review", c: "Quarterly, and on every new adapter or capability", a: "Security + platform" },
  { n: "Baseline review", c: "Quarterly", a: "Engineering leadership" },
  { n: "Post-incident review", c: "On every incident", a: "The incident team + platform" },
];

/* ---------- Glossary (a curated but substantial subset) ---------- */

export const GLOSSARY = [
  { t: "Acceptance oracle", d: "The trusted test set that decides whether a task is complete. Authored against the specification, not the implementation, and constructed before implementation begins.", k: "core" },
  { t: "Acceptance criterion", d: "A checkable condition that defines 'done'. Must be decided by an oracle, not by opinion.", k: "core" },
  { t: "Access point", d: "A typed entry point through which a human acts on the control plane, carrying defined authority. Six exist; there is no informal 'chat with the agent' path.", k: "core" },
  { t: "Agent", d: "A probabilistic component that interprets, generates, or judges within a scope the control plane has authorised. Never holds policy authority.", k: "core" },
  { t: "Approval fatigue", d: "The degradation of approval quality under high request volume. The response is to raise the evidence bar, never to loosen the gate.", k: "risk" },
  { t: "Arbitration rule", d: "Where orchestration proposes an action and policy is uncertain, the resolution is deny-by-default and escalate, never 'let it try'.", k: "core" },
  { t: "Asymmetry rule", d: "Blast radius may be raised by a human at any time; it may be lowered only by a reviewed policy change.", k: "core" },
  { t: "Authority record", d: "The record of what authority an actor held, under which grant, at which autonomy level, for which action.", k: "core" },
  { t: "Autonomy level (L0–L4)", d: "The permission tier granted to a workflow: L0 read-only, L1 plans and suggestions, L2 isolated workspaces and pull requests, L3 merge/deploy after configured approvals, L4 authorised production operations. Earned per workflow, revoked on evidence.", k: "core" },
  { t: "Baseline", d: "The pre-change measurement against which all improvement is judged, on a stated window and the same workload. A change with no baseline is not evidence.", k: "measurement" },
  { t: "Blast radius", d: "The consequence surface of a change, scored across seven dimensions and tiered R0–R4. Determines review depth and approval requirement.", k: "core" },
  { t: "Broker (tool)", d: "The single choke point through which every capability invocation passes, before any effect occurs. Decides scope, policy, approval, and credential.", k: "core" },
  { t: "Budget-fails rule", d: "When a stage exceeds its turn, time, token, or cost budget, the run returns a labelled incomplete result to a human. Context and runs are never silently truncated.", k: "core" },
  { t: "Calibration corpus", d: "A labelled set of positive and negative samples used to establish that a verifier actually discriminates. The negative control is mandatory.", k: "quality" },
  { t: "Capability", d: "A callable operation registered in the tool registry, with a schema, a scope, an effect class, an owner, and a health check.", k: "core" },
  { t: "Capability grant", d: "The declared set of capabilities a workflow or stage may invoke. Declared ≠ granted ≠ effective.", k: "core" },
  { t: "Capability split", d: "The separation of deterministic policy authority from probabilistic orchestration authority, so that no component holds both.", k: "core" },
  { t: "Chunkability criterion", d: "The four-part test (disjoint files, independent checks, no coordination, cheaper concurrent) determining whether work may be fanned out to sub-agents.", k: "core" },
  { t: "Composition failure", d: "A failure caused by how stages are wired rather than by an agent's reasoning. The dominant failure class at run scale.", k: "risk" },
  { t: "Context", d: "The body of information an agent operates on. Assembled per stage from typed items; never the full repository.", k: "core" },
  { t: "Context assembly", d: "The deterministic selection, ordering, and pinning of context items for a stage.", k: "core" },
  { t: "Context envelope", d: "The pinned, hashed result of context assembly for one stage, carrying the identity and version of every item included.", k: "core" },
  { t: "Context inventory", d: "Estate-wide scanning that detects outdated, duplicate, and stale context items.", k: "core" },
  { t: "Control plane", d: "The authoritative component that decides intent, policy, state, scheduling, and merges. It holds state; it never executes work.", k: "core" },
  { t: "Control surface", d: "The operational view: dashboards, boards, mission control. Reads and requests; does not write the definition.", k: "core" },
  { t: "Cost per accepted change", d: "Total inference, tool, and infrastructure cost divided by changes that landed. The business unit, and the metric that governs model routing.", k: "measurement" },
  { t: "Credential broker", d: "The component that resolves a credential reference into a scoped, short-lived credential at invocation time. Never reachable by an agent.", k: "security" },
  { t: "Criticality map", d: "The declared mapping from a resource to its blast-radius tier, which sets the approval requirement for changes affecting it.", k: "core" },
  { t: "Dark factory", d: "A factory with no human in the loop. Attempted and abandoned in the corpus; rejected by this blueprint.", k: "context" },
  { t: "Data plane", d: "The execution fleet that acts on authorised work. It never writes task state, approval state, lease state, or definition state.", k: "core" },
  { t: "Definition, factory", d: "The declarative specification of the whole factory, as data. The only place configuration is written.", k: "core" },
  { t: "Deferred context", d: "Context not loaded until a trigger fires.", k: "core" },
  { t: "Dependency edge (dependent)", d: "An edge where the downstream node consumes the upstream node's output artefact. The upstream CONTEXT is not inherited.", k: "core" },
  { t: "Dependency edge (independent)", d: "An edge where the nodes are concurrent and share no state. Requires a chunkability justification.", k: "core" },
  { t: "Deployment, runbook-guarded", d: "Deployment performed only through an enumerated, pre-approved runbook.", k: "security" },
  { t: "Drift", d: "Divergence between the declared factory state and the actual state. Detected and reported; corrected by the applier.", k: "core" },
  { t: "E0–E4 effect classes", d: "The classification of a capability by consequence: E0 pure read, E1 reversible write, E2 external write, E3 destructive, E4 production. Determines which gates the capability passes through.", k: "core" },
  { t: "Edge justification", d: "The mandatory rationale on every task-graph edge. Its absence is a validation failure, not a warning.", k: "core" },
  { t: "Escalation", d: "Moving a task to a human with the last good state preserved, so it can be resumed. Not the same as failure.", k: "core" },
  { t: "Event log", d: "The append-only record of every consequential action, with a correlation id, the actor, the authority, and the outcome. The substrate for audit, evaluation, cost attribution, and the improvement loops.", k: "core" },
  { t: "Execution-vs-approval binding", d: "The requirement that what executes matches what was approved, checked against the artefact's hash.", k: "core" },
  { t: "Factory", d: "An organisation in which the production cycle is performed by agents, with humans supplying intent and judgement rather than executing steps. The 1968 definition adds three components: a controlled programming environment, standardised development tools, and historical information for management and measurement.", k: "core" },
  { t: "Fault localisation", d: "The ability of a test suite to identify WHERE a defect is, not merely that one exists.", k: "quality" },
  { t: "FDLC", d: "'Factory development lifecycle': the loop-maintenance lifecycle that parallels the SDLC.", k: "context" },
  { t: "Four memory classes", d: "Run artefacts, context/skills, knowledge, and local repository context. Conflating them is the most common context-architecture error.", k: "core" },
  { t: "Gate, merge", d: "The set of checks a change must pass before merge, scaled by blast-radius tier. Gate weakening is itself a change.", k: "quality" },
  { t: "Guardrail metric", d: "A metric that must not degrade when another improves — e.g. revert rate holding steady.", k: "measurement" },
  { t: "Harness", d: "Everything around the model that makes the model useful: instructions, tool surface, context assembly, retry and escalation logic, evaluation.", k: "core" },
  { t: "Human control plane", d: "The single operational view through which humans observe, intervene, and approve. Six access points, one surface.", k: "core" },
  { t: "Improvement loop, inner", d: "The loop that fixes a failure within the current run, under the current configuration.", k: "context" },
  { t: "Improvement loop, outer", d: "The loop that changes configuration based on accumulated run evidence.", k: "context" },
  { t: "Improvement loop, meta", d: "The loop that changes the harness itself — the machinery that runs the loops.", k: "context" },
  { t: "Independence", d: "The requirement that a judge is not the same agent that produced what it judges.", k: "core" },
  { t: "Intent", d: "A human's natural-language goal, submitted through the access-point API. The only sanctioned entry into the factory.", k: "core" },
  { t: "Isolated workspace", d: "The disposable working environment in which an agent performs a task: worktree, container, or sandbox depending on the tier.", k: "security" },
  { t: "Isolation tier (T1–T3)", d: "The execution isolation stack: T1 worktree (file-level), T2 container (process and network), T3 sandbox (hostile/untrusted). The tier may be escalated but never lowered.", k: "security" },
  { t: "Machine that builds the thing", d: "The reframe of factory-building as continued engineering one level up: the factory builds the next version of itself.", k: "context" },
  { t: "MCP", d: "Model Context Protocol: a protocol for exposing tools and resources to agents. Convenient, not universal. NOT the registry, the policy layer, the credential store, the audit record, or the scope boundary.", k: "core" },
  { t: "Model gateway", d: "The abstraction layer that makes model choice a configuration matter, handling routing, budgets, failover, and caching.", k: "core" },
  { t: "Model routing", d: "Selecting a model per task by difficulty and cost. A routing hint, not a capability grant.", k: "core" },
  { t: "Node", d: "A work item in a task graph, independently leased and executed.", k: "core" },
  { t: "Oracle coverage", d: "The fraction of acceptance criteria that have a check. A prerequisite for autonomy promotion.", k: "quality" },
  { t: "Panic / fail-closed", d: "The rule that the policy engine and the tool broker deny on uncertainty rather than permit.", k: "security" },
  { t: "Panel", d: "The component aggregating multiple reporter verdicts into a confidence-bearing decision. Deterministic policy, not a second agent.", k: "quality" },
  { t: "Policy as code", d: "Deterministic enforcement rules that gate consequential actions regardless of an agent's confidence.", k: "core" },
  { t: "Privilege-bearing artefact", d: "Any artefact whose modification changes what agents are permitted or instructed to do. Context artefacts, skill artefacts, and policy files all qualify.", k: "security" },
  { t: "Proceduralisation", d: "The transformation of an agent's experiential knowledge into explicit procedure. The improvement loop's actual output.", k: "context" },
  { t: "Projected context", d: "Context selected and ordered for a stage, before the envelope is pinned.", k: "core" },
  { t: "Progressive tool disclosure", d: "Advertising only the tools relevant to the current stage.", k: "core" },
  { t: "Proposal", d: "A proposed change to the factory definition, with a measurement plan, a replay plan, a rollback plan, and an approval class.", k: "core" },
  { t: "Pinned context", d: "Context fixed by identifier and version for the life of a run, so that a replay resolves the same items.", k: "core" },
  { t: "Red-team suite", d: "The 15 attacks the factory must withstand, run as a CI check on the factory itself.", k: "security" },
  { t: "Refinement", d: "Turning a raw request into a specified task with checkable acceptance criteria.", k: "core" },
  { t: "Regression test requirement", d: "For a bug fix, the test must fail against the pre-fix revision and pass against the fixed revision.", k: "core" },
  { t: "Repository isolation", d: "The rule that a task may not read or write outside the repositories in its declared scope.", k: "security" },
  { t: "Reproducibility", d: "The same task produces the same result in any environment.", k: "core" },
  { t: "Replay", d: "Re-running a historical task against a candidate configuration. The specification, context manifest, and gates are replayed; model outputs are regenerated.", k: "measurement" },
  { t: "Runner", d: "The execution harness that prepares the environment, invokes an agent, and collects results. Writes no code itself.", k: "core" },
  { t: "Scope (permission scope)", d: "The hierarchical, prefix-matched vocabulary describing what a capability may act on: repo:read, repo:write:path:<glob>, git.write.pr, shell.sandboxed, db.migrate:local, prod.write, and so on.", k: "core" },
  { t: "Scope, three-scope rule", d: "Every invocation is checked against workflow scope, stage scope, and resource scope; the narrowest wins, and deny always wins.", k: "core" },
  { t: "Secret scoping", d: "Per-task, short-lived, least-privilege credentials.", k: "security" },
  { t: "Skill", d: "A unit of work for agents: either a PROCEDURE (how to do something) or a STANDARD (what must be true).", k: "core" },
  { t: "Sovereignty of local context", d: "The precedence rule that a repository's own context outranks central context, and central security context always wins.", k: "core" },
  { t: "Specificity", d: "The degree to which a review or verification is narrowly scoped; 'the ruler of all quality'.", k: "quality" },
  { t: "Stage kind", d: "The vocabulary of workflow stages: specify, plan, implement, verify, review, aggregate, approve, merge, deploy, sweep, investigate, record, evaluate, propose.", k: "core" },
  { t: "State machine (task)", d: "The 19-state lifecycle: DRAFT, TRIAGED, REFINED, PLANNED, QUEUED, RUNNING, VERIFYING, AWAITING_REVIEW, AWAITING_APPROVAL, APPROVED, MERGING, MERGED, DEPLOYING, DEPLOYED, REJECTED, FAILED, ABANDONED, INCOMPLETE, ESCALATED.", k: "core" },
  { t: "State machine (node)", d: "The 8-state work-item lifecycle: PENDING, READY, LEASED, RUNNING, SUCCEEDED, FAILED, INCOMPLETE, BLOCKED.", k: "core" },
  { t: "Sweep", d: "A recurring repository-wide search for non-conformance, producing findings rather than changes.", k: "context" },
  { t: "Task graph", d: "A directed graph of work items with dependencies, produced by planning and executed under the topology rule.", k: "core" },
  { t: "Tool registry", d: "The catalogue of callable capabilities with metadata, schemas, and ownership. Authoritative over what any server advertises.", k: "core" },
  { t: "Topology, hybrid", d: "Choosing fan-out or sequencing per dependency edge in the task graph.", k: "core" },
  { t: "Trust classification (three levels)", d: "trusted, untrusted-content, derived. Content from outside the trusted boundary is DATA, never instruction.", k: "security" },
  { t: "Untrusted content", d: "Content originating outside the trusted boundary — issue text, PR descriptions, code comments, documentation, web pages, dependency files, external tool output. Tagged, quarantined, and passed as data.", k: "security" },
  { t: "Verdict", d: "The reviewer's output: findings with locations, rationale, and validation mode.", k: "quality" },
  { t: "Verifier", d: "A narrow, cheap check — deterministic or LLM-judge — generated from a skill, run in CI.", k: "quality" },
  { t: "Verifier calibration", d: "The state of a verifier's measured ability to discriminate: uncalibrated, calibrated, expired, with detection and false-positive rates against a corpus.", k: "quality" },
  { t: "Waypoint", d: "A checkpoint in a long-running workflow where state is persisted and a human may inspect or take over.", k: "core" },
  { t: "Workflow", d: "A durable, resumable machine composing stages, gates, and state transitions.", k: "core" },
  { t: "Worktree", d: "A separate working directory sharing one git object store: cheap, isolated, branch-scoped. The T1 isolation form.", k: "security" },
  { t: "X-factor (factory)", d: "The factor that turns an agent collection into a factory: the control plane, the durable workflows, the calibrated gates, and the measurement.", k: "context" },
];
