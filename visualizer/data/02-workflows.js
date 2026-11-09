/* ============================================================
   SOFTWARE FACTORY — Part 2: workflows, states, agents, levels
   ============================================================ */

/* ---------- Workflows A–G ---------- */

export const WORKFLOWS = [
  {
    id: "B",
    name: "Issue to pull request",
    file: "B.issue-to-pr",
    status: "IN v1",
    statusKind: "in",
    spine: true,
    summary:
      "The spine of the factory. A reviewed issue becomes a verified pull request — with the acceptance oracle written before the implementation, and a human merging every change.",
    steps: [
      { n: 1, title: "Owner labels issue", exec: "webhook / AP-1", state: "DRAFT", ev: ["webhook.received", "intent.recorded"], fail: "non-allow-listed author ⇒ intent.rejected" },
      { n: 2, title: "Triage — classify and route", exec: "completion (cheap)", state: "TRIAGED", ev: ["request.triaged"], fail: "out of scope ⇒ REJECTED" },
      { n: 3, title: "Refinement — spec + checkable criteria", exec: "completion (strong)", state: "REFINED", ev: ["spec.refined", "spec.accepted"], fail: "not expressible ⇒ ESCALATED" },
      { n: 4, title: "Oracle construction + admission", exec: "human / deterministic / completion", state: "REFINED", ev: ["oracle.constructed", "oracle.admitted"], fail: "admission fail ⇒ repair once, else ESCALATED", key: true, note: "The oracle runs against the BASE commit before any code exists. expectedBefore: fail for new behaviour." },
      { n: 5, title: "Planning — task graph", exec: "completion (strong)", state: "PLANNED", ev: ["plan.produced", "plan.validated"], fail: "invalid ⇒ ESCALATED" },
      { n: 6, title: "Plan approval", exec: "human (AP-2)", state: "QUEUED", ev: ["approval.requested", "approval.granted"], fail: "refused ⇒ REJECTED", key: true, note: "The plan and the oracle are approved together as one artefact." },
      { n: 7, title: "Implement in T2 via harness", exec: "harness", state: "RUNNING", ev: ["node.leased", "environment.provisioned", "model.requested", "tool.invoked"], fail: "budget ⇒ INCOMPLETE; env failure ⇒ retry" },
      { n: 8, title: "Patch extraction + scope validation + push", exec: "deterministic + broker", state: "RUNNING", ev: ["patch.extracted", "tool.invoked"], fail: "violation ⇒ patch.rejected, node failed" },
      { n: 9, title: "Verify in fresh T2", exec: "deterministic", state: "VERIFYING", ev: ["gate.passed", "gate.failed"], fail: "fail with iterations left (≤2) ⇒ RUNNING; else FAILED" },
      { n: 10, title: "Review + panel, open PR", exec: "completion + deterministic", state: "AWAITING_REVIEW", ev: ["review.queued", "change.opened"], fail: "blockers ⇒ one rework loop, then flagged to owner" },
      { n: 11, title: "Owner reviews, approves, merges", exec: "human (AP-3/AP-2 + GitHub)", state: "APPROVED → MERGING → MERGED", ev: ["review.approved", "approval.granted", "change.merged"], fail: "refuse ⇒ REJECTED", key: true, note: "At L2 the merge must arrive through a human access point. The policy engine enforces it at the APPROVED → MERGING guard." },
      { n: 12, title: "Record knowledge, reclaim environment", exec: "deterministic", state: "terminal", ev: ["environment.cleaned", "credential.revoked"], fail: "cleanup failure ⇒ reaper + alert" },
    ],
  },
  {
    id: "C",
    name: "Autonomous bug fixing",
    file: "C.bug-fix",
    status: "IN v1 (W6)",
    statusKind: "in",
    summary:
      "Same spine, with one extra gate: a reproduction node must produce a failing regression test that becomes the oracle.",
    steps: [
      { n: 1, title: "Issue labelled bug + factory:ready", exec: "webhook", state: "DRAFT", ev: ["webhook.received"], fail: "" },
      { n: 2, title: "Reproduction node", exec: "harness", state: "REFINED", ev: ["oracle.constructed"], fail: "cannot reproduce within budget ⇒ ESCALATED(not_reproducible)", key: true, note: "NO SPECULATIVE FIX. A bug that cannot be reproduced is escalated, not guessed at." },
      { n: 3, title: "Regression test becomes the oracle", exec: "deterministic", state: "REFINED", ev: ["oracle.admitted"], fail: "a regression test that PASSES on the unfixed code is rejected", key: true, note: "expectedBefore: fail. If the test passes before the fix, it asserts nothing." },
      { n: 4, title: "…then Workflow B from step 5", exec: "—", state: "PLANNED →", ev: ["plan.produced"], fail: "" },
    ],
  },
  {
    id: "D1",
    name: "Automated dependency upgrades",
    file: "D1.dependency-upgrade",
    status: "IN v1 (W7)",
    statusKind: "in",
    summary:
      "Weekly cron. Deterministic candidate scan, chunked into bounded groups, one task per chunk. The oracle is the existing suite plus lockfile integrity.",
    steps: [
      { n: 1, title: "Cron trigger", exec: "cron", state: "DRAFT", ev: ["intent.recorded"], fail: "" },
      { n: 2, title: "Candidate scan in T2 + advisory data", exec: "deterministic + net.fetch", state: "TRIAGED", ev: ["model.requested"], fail: "advisory enrichment unavailable ⇒ skip it" },
      { n: 3, title: "Chunk by group (≤K per run)", exec: "deterministic", state: "PLANNED", ev: ["plan.produced"], fail: "candidates ≫ expected ⇒ STOP and escalate instead of fanning out", key: true, note: "expectedBefore: pass — the existing suite must still pass after the upgrade." },
      { n: 4, title: "One task per chunk", exec: "harness", state: "RUNNING", ev: ["patch.extracted"], fail: "" },
    ],
  },
  {
    id: "D2",
    name: "Self-healing CI",
    file: "D2.ci-repair",
    status: "IN v1 (W7)",
    statusKind: "in",
    summary:
      "Triggered when CI fails on a factory-authored PR branch. Two attempts, hard cap — and the gate-weakening detector rejects any fix that edits the tests.",
    steps: [
      { n: 1, title: "workflow_run failure on factory-authored branch", exec: "webhook", state: "DRAFT", ev: ["webhook.received"], fail: "not factory-authored ⇒ ignored" },
      { n: 2, title: "Worker fixes — hard cap of 2 attempts", exec: "harness", state: "RUNNING", ev: ["patch.extracted"], fail: "exhausted ⇒ ESCALATED" },
      { n: 3, title: "Gate-weakening detector", exec: "deterministic", state: "VERIFYING", ev: ["gate.weakeningDetected"], fail: "edits CI/test/lint config or removes tests ⇒ AUTOMATIC REJECTION", key: true, note: "A fix that removes the test that caught the failure is not a fix." },
    ],
  },
  {
    id: "A",
    name: "Idea to production",
    file: "A",
    status: "OUT of v1",
    statusKind: "out",
    summary:
      "Deploy to production. Deferred because production writes need calibrated verifiers and a tested rollback.",
    steps: [
      { n: 1, title: "GitOps-first deploy (peak path)", exec: "DeploymentController", state: "DEPLOYING", ev: ["change.merged"], fail: "no enumerated runbook ⇒ refused", key: true, note: "A2 §3: the factory opens a digest-bump PR; a human merges it until L3 is earned." },
    ],
    trigger: "Calibrated verifiers + tested rollback + owner opts into L3/L4.",
  },
  {
    id: "E",
    name: "Production incident response",
    file: "E",
    status: "OUT of v1",
    statusKind: "out",
    summary: "Incident response with a candidate fix on the pager. Needs T3 isolation and enumerated runbooks.",
    steps: [{ n: 1, title: "Candidate fix on the pager", exec: "Workflow E", state: "—", ev: [], fail: "non-runbook case ⇒ human decides", key: true, note: "L4 is narrow: 2–3 enumerated runbooks, not a general 'deploy to production' permission." }],
    trigger: "T3 isolation + incident drills + runbook registry (phase P9).",
  },
  {
    id: "F",
    name: "Multi-repository engineering",
    file: "F",
    status: "OUT of v1",
    statusKind: "out",
    summary: "Changes spanning more than one repository. Cross-repo isolation is designed and tested; cross-repo orchestration is not.",
    steps: [{ n: 1, title: "Cross-repo task graph", exec: "—", state: "—", ev: [], fail: "" }],
    trigger: "A second repo with cross-repo changes.",
  },
  {
    id: "G",
    name: "Factory self-improvement",
    file: "G",
    status: "Phase 5",
    statusKind: "later",
    summary:
      "The outer and meta loops. Log Analyser → Improvement Proposer → Replay Evaluator. The factory proposes changes to itself and never applies them.",
    steps: [
      { n: 1, title: "Log Analyser", exec: "deterministic", state: "—", ev: ["proposal.proposed"], fail: "" },
      { n: 2, title: "Improvement Proposer", exec: "completion", state: "—", ev: ["proposal.proposed"], fail: "" },
      { n: 3, title: "Replay Evaluator", exec: "deterministic", state: "—", ev: ["proposal.evaluated"], fail: "" },
      { n: 4, title: "Human review → definition change", exec: "human", state: "—", ev: ["definition.applied"], fail: "never auto-applied", key: true, note: "Batch evidence, never single-run. Four scopes, four approval bars." },
    ],
    trigger: "≥100 completed runs.",
  },
];

/* ---------- Task state machine (19 states) ---------- */

export const TASK_STATES = [
  { id: "DRAFT", kind: "start", label: "Intent recorded" },
  { id: "TRIAGED", kind: "active" },
  { id: "REFINED", kind: "active", note: "Spec + checkable criteria" },
  { id: "PLANNED", kind: "active", note: "Task graph produced" },
  { id: "QUEUED", kind: "active", note: "Approved; waiting for a worker" },
  { id: "RUNNING", kind: "active", note: "Implementation in T2" },
  { id: "VERIFYING", kind: "active", note: "Gates + oracle running" },
  { id: "AWAITING_REVIEW", kind: "human", note: "Reviewer agent + panel have run" },
  { id: "AWAITING_APPROVAL", kind: "human", note: "Waiting for a human decision" },
  { id: "APPROVED", kind: "human" },
  { id: "MERGING", kind: "human", note: "L2 enforcement point" },
  { id: "MERGED", kind: "terminal", note: "Human merged" },
  { id: "DEPLOYING", kind: "later", note: "v1: guard hard-false" },
  { id: "DEPLOYED", kind: "later" },
  { id: "REJECTED", kind: "terminal" },
  { id: "FAILED", kind: "terminal" },
  { id: "ABANDONED", kind: "terminal" },
  { id: "INCOMPLETE", kind: "terminal", note: "Budget exhausted — partial artefacts preserved" },
  { id: "ESCALATED", kind: "human", note: "Resumable. Not the same as failure." },
];

/* [from, to, guard] — guard null means unconditional */
export const TASK_TRANSITIONS = [
  ["DRAFT", "TRIAGED", null],
  ["DRAFT", "REJECTED", null],
  ["TRIAGED", "REFINED", "specHasCheckableCriterionAndOracleRef"],
  ["TRIAGED", "FAILED", null],
  ["REFINED", "PLANNED", null],
  ["REFINED", "ESCALATED", null],
  ["PLANNED", "QUEUED", "graphAdmissible + oracleAdmitted + planApprovalValid"],
  ["PLANNED", "ESCALATED", null],
  ["QUEUED", "RUNNING", null],
  ["RUNNING", "QUEUED", null],
  ["RUNNING", "VERIFYING", "allNodesTerminal"],
  ["RUNNING", "ESCALATED", null],
  ["RUNNING", "INCOMPLETE", null],
  ["VERIFYING", "AWAITING_REVIEW", "allApplicableGatesPassedIncludingOracle"],
  ["VERIFYING", "RUNNING", "iterationBudgetRemains"],
  ["VERIFYING", "FAILED", "iterationBudgetExhausted"],
  ["AWAITING_REVIEW", "AWAITING_APPROVAL", "requiredApprovalClassIdentified"],
  ["AWAITING_REVIEW", "REJECTED", null],
  ["AWAITING_REVIEW", "ESCALATED", "reviewFatigueThreshold"],
  ["AWAITING_APPROVAL", "APPROVED", "approvalValidUnexpiredBound"],
  ["AWAITING_APPROVAL", "REJECTED", null],
  ["APPROVED", "MERGING", "autonomyPermitsOrHumanInitiated"],
  ["MERGING", "MERGED", null],
  ["MERGING", "FAILED", null],
  ["MERGED", "DEPLOYING", "deploymentTargetInRunbookSet"],
  ["DEPLOYING", "DEPLOYED", null],
  ["DEPLOYING", "FAILED", null],
  ["ESCALATED", "QUEUED", null],
  ["ESCALATED", "REJECTED", null],
  ["INCOMPLETE", "ESCALATED", null],
  ["*nonTerminal*", "ABANDONED", "cancelledByHumanOrSuperseded"],
];

export const NODE_STATES = ["PENDING", "READY", "LEASED", "RUNNING", "SUCCEEDED", "FAILED", "INCOMPLETE", "BLOCKED"];

export const NODE_TRANSITIONS = [
  ["PENDING", "READY"], ["PENDING", "BLOCKED"], ["READY", "LEASED"], ["LEASED", "RUNNING"],
  ["LEASED", "READY"], ["RUNNING", "SUCCEEDED"], ["RUNNING", "FAILED"], ["RUNNING", "INCOMPLETE"],
  ["RUNNING", "BLOCKED"], ["FAILED", "READY"],
];

export const ESCALATION_TRIGGERS = [
  "review-fatigue threshold",
  "unresolvable conflict",
  "policy escalation",
  "repeated classification",
  "resume_failed",
  "not_reproducible",
];

export const FAILURE_CLASSES = [
  { id: "model.reasoning", retry: "≤2", outcome: "FAILED / escalate" },
  { id: "model.capability", retry: "≤2", outcome: "FAILED / escalate" },
  { id: "workflow.composition", retry: "0", outcome: "ESCALATED — never silently retried" },
  { id: "context.insufficient", retry: "0", outcome: "ESCALATED with gap list" },
  { id: "verification.failure", retry: "≤2", outcome: "rework loop" },
  { id: "environment.failure", retry: "new env", outcome: "retry" },
  { id: "policy.denied", retry: "0", outcome: "no retry — security event" },
  { id: "budget.exhausted", retry: "0", outcome: "INCOMPLETE" },
  { id: "tool.unavailable", retry: "3 + backoff", outcome: "degrade / escalate" },
  { id: "unknown", retry: "—", outcome: "—" },
];

/* ---------- Agent roles ---------- */

export const AGENTS = [
  {
    id: "triage", name: "Triage Agent", exec: "completion", cls: "triage", model: "cheap tier", wf: "B, C, D",
    scope: "Classifies the request and routes it to a workflow. Produces a verdict, not a change.",
    autonomy: "L2",
  },
  {
    id: "refinement", name: "Refinement Agent", exec: "completion", cls: "strong", model: "strong tier", wf: "B, C",
    scope: "Turns a raw request into a specification with checkable acceptance criteria and open questions.",
    autonomy: "L2",
  },
  {
    id: "oracle-author", name: "Oracle Author", exec: "completion", cls: "strong", model: "strong tier", wf: "B, C",
    scope: "Proposes acceptance criteria for the R-A oracle route — but only in a SEPARATE run, before the implementer, and stays untrusted until the owner approves it inside plan approval.",
    autonomy: "L2",
    note: "Its provenance records implementationRunId: null. The merge gate rejects a same-run-authored oracle.",
  },
  {
    id: "planner", name: "Planner", exec: "completion", cls: "strong", model: "strong tier", wf: "B, C, D",
    scope: "Produces the task graph: decomposition, topology, per-node context and tool scopes. A component, not a prompt — its output is a reviewable artefact.",
    autonomy: "L2",
  },
  {
    id: "worker", name: "Worker / Implementer", exec: "harness", cls: "worker", model: "worker tier", wf: "B, C, D1, D2",
    scope: "The only role that executes repo code. Runs inside T2. Produces a patch, never a verdict on its own work.",
    autonomy: "L2",
    note: "The only role (with the D/C fixers) permitted the harness executor.",
  },
  {
    id: "reviewer-spec", name: "Reviewer (spec-conformance)", exec: "completion", cls: "strong", model: "strong tier", wf: "B, C",
    scope: "Judges the change against the stated acceptance criteria. Sees no implementer transcript by default.",
    autonomy: "L2",
    note: "Independence is enforced: reviewer run, context and model must differ from the implementer's.",
  },
  {
    id: "reviewer-quality", name: "Reviewer (code-quality)", exec: "completion", cls: "strong", model: "strong tier", wf: "B, C",
    scope: "Judges the change against the repository's standards and conventions.",
    autonomy: "L2",
  },
  {
    id: "security-reviewer", name: "Security Reviewer", exec: "completion", cls: "strong", model: "strong tier (or Mythos)", wf: "B, C, D",
    scope: "Adversarial security pass over the diff. A high-severity finding forces tier R3.",
    autonomy: "L2",
  },
  {
    id: "sweep", name: "Sweep Agent", exec: "harness", cls: "worker", model: "worker tier", wf: "D1",
    scope: "Repository-wide search for non-conformance. Produces findings, not changes.",
    autonomy: "L2",
  },
  {
    id: "ci-repair", name: "CI Repair Agent", exec: "harness", cls: "worker", model: "worker tier", wf: "D2",
    scope: "Fixes CI failures on factory-authored PR branches. Two attempts maximum.",
    autonomy: "L2",
  },
  {
    id: "prioritiser", name: "Prioritiser", exec: "deterministic", cls: "—", model: "not a model", wf: "—",
    scope: "Queue ordering. Implemented as code, not a model — the prioritiser is deterministic.",
    autonomy: "—",
  },
  {
    id: "panel", name: "Panel / Decision Aggregator", exec: "deterministic", cls: "—", model: "not a model", wf: "B, C",
    scope: "Aggregates reviewer verdicts into a decision. Deterministic policy, not a second agent. Unanimity for ready; any blocker ⇒ one rework loop.",
    autonomy: "—",
    note: "No confidence-gated merging in v1. Confidence merging is deferred to A2.11 (P7).",
  },
];

export const EXCLUDED_ROLES = [
  "Docs agent", "Knowledge agent", "Manager agent", "Coordinator agent",
  "Tessl-style loop builder", "Verifier agent",
];

export const G_CHAIN = ["Log Analyser", "Improvement Proposer", "Replay Evaluator"];

/* ---------- Access points ---------- */

export const ACCESS_POINTS = [
  { id: "AP-1", name: "define-intent", verb: "Define intent", body: "POST /v1/intents", auth: "GitHub OAuth session or CLI bearer token" },
  { id: "AP-2", name: "approve", verb: "Approve", body: "POST /v1/approvals/{id}/decision", auth: "Named approver; artefact-hash bound" },
  { id: "AP-3", name: "review", verb: "Review", body: "POST /v1/reviews/{taskId}/decision", auth: "Reviewer; evidence bundle, no implementer transcript" },
  { id: "AP-4", name: "inspect", verb: "Inspect", body: "GET /v1/views/overview", auth: "Read-only. The one view." },
  { id: "AP-5", name: "intervene", verb: "Intervene", body: "POST /v1/tasks/{id}/{action}", auth: "Pause · Cancel · Escalate · Re-run · Redirect · Grant(temporary) · kill switch" },
  { id: "AP-6", name: "amend-factory", verb: "Amend the factory", body: "POST /v1/definition/apply", auth: "Only a merged git SHA + approvalId. Never a dashboard write." },
];

export const CONTROL_VERBS = ["Pause", "Cancel", "Escalate", "Re-run", "Redirect", "Grant (temporary)"];

/* ---------- Levels & tiers ---------- */

export const AUTONOMY = [
  { id: "L0", name: "Research", can: "Read and analyse. Produce nothing that changes anything.", v1: false },
  { id: "L1", name: "Propose", can: "Produce plans, proposals and suggestions for human action.", v1: false },
  { id: "L2", name: "Execute isolated", can: "Work in isolated workspaces, open pull requests, run verification. A human reviews the code and merges.", v1: true },
  { id: "L3", name: "Merge after approval", can: "Merge and deploy after configured approvals. Earned per workflow, never global.", v1: false },
  { id: "L4", name: "Operate production", can: "Operate production autonomously within enumerated runbooks. Narrow by design.", v1: false },
];

export const TIERS = [
  { id: "R0", name: "Trivial", gates: "static + tests + oracle", score: "0–1" },
  { id: "R1", name: "Low", gates: "+ reviewer agent", score: "2–3" },
  { id: "R2", name: "Moderate", gates: "+ security scan + panel + docs check", score: "4–6" },
  { id: "R3", name: "High", gates: "+ security reviewer + owner approval with security-scope box + declared rollback note", score: "7–8" },
  { id: "R4", name: "Critical", gates: "human-only", score: "9+" },
];

export const ISOLATION = [
  { id: "T1", name: "Worktree", what: "A separate working directory sharing one git object store. Cheap, isolated, branch-scoped. No code execution.", v1: true },
  { id: "T2", name: "Container", what: "Rootless Docker. Process and network isolation. Mandatory for any stage that executes repo code, including verification.", v1: true },
  { id: "T3", name: "Hardened sandbox", what: "For untrusted inputs and production-adjacent work. All L4. Deferred in v1.", v1: false },
];

export const EFFECT_CLASSES = [
  { id: "E0", name: "Pure read", rule: "Allow" },
  { id: "E1", name: "Reversible write", rule: "Allow" },
  { id: "E2", name: "External write", rule: "Allow only if resource-scope matches" },
  { id: "E3", name: "Destructive", rule: "REQUIRE_APPROVAL (artefact-bound)" },
  { id: "E4", name: "Production", rule: "REQUIRE_APPROVAL — none exist in v1" },
];

export const TRUST_CLASSES = [
  { id: "trusted", what: "Written by the owner, or by the factory's own reviewed definition." },
  { id: "untrusted-content", what: "Issue text, PR descriptions, code comments, documentation, web pages, dependency files, external tool output. Tagged at ingest, passed as data, never as instruction." },
  { id: "derived", what: "Produced by the factory from trusted or untrusted inputs, with the provenance recorded." },
];

export const THREAT_ACTORS = [
  { id: "T1", name: "Malicious requester", how: "A person submitting an intent they should not be able to submit." },
  { id: "T2", name: "Compromised dependency", how: "A package that executes inside a task environment with credentials." },
  { id: "T3", name: "Compromised integration", how: "An MCP server or third-party service returning hostile results." },
  { id: "T4", name: "Insider or careless operator", how: "A legitimate human using the control surface to widen permissions." },
  { id: "T5", name: "Confused or manipulated agent", how: "An agent that follows an instruction embedded in content it was asked to read." },
  { id: "T6", name: "The system itself", how: "A workflow defect, composition bug, or silent degradation." },
];

export const INJECTION_CONTROLS = [
  { n: 1, name: "Tag at ingest", where: "scm-github ingest + fetch service", what: "Trust classification is a required field of the adapter contract. An adapter without one is a registration error, not a silent omission." },
  { n: 2, name: "Envelope last & fenced", where: "context assembler", what: "Untrusted content is placed LAST in the envelope, inside a fenced block with a nonce: <<<UNTRUSTED id=… source=… nonce=…>>> … <<<END nonce=…>>>" },
  { n: 3, name: "Prompt statement", where: "prompt builder", what: "The envelope declares itself as data, not instruction." },
  { n: 4, name: "Policy checks every proposed action", where: "broker + policy", what: "The agent can only propose. Every consequential action is re-checked by deterministic policy." },
  { n: 5, name: "Effect class + blast radius escalate", where: "policy + review", what: "An action whose consequence exceeds its grant is escalated rather than executed." },
  { n: 6, name: "Human sees raw content", where: "dashboard approval view", what: "The approver sees the raw untrusted blocks, flagged. Reversible effects need a human who has seen the original." },
];
