/* ============================================================
   SOFTWARE FACTORY — Core data
   Part 1: vision, commitments, zones, components
   ============================================================ */

export const META = {
  title: "The Software Factory",
  subtitle: "An interactive map of a blueprint that turns a reviewed issue into a verified pull request",
  source: "Software Factory Blueprint + Implementation Pack v1.0 (48 documents, 12 ADRs)",
  generated: "2026-11-09",
};

export const VISION = {
  definition1968:
    "A computer-controlled programming environment containing standardised development tools along with historical information for management and measurement.",
  definition1968Source: "GE, 1968 (V05, 2:22)",
  working:
    "A software factory is an organisation in which the production cycle is performed by agents, with humans supplying intent and judgement rather than executing the steps — and in which the factory is itself engineered, measured, and improved as a product.",
  theLoadBearingClause:
    "the factory is itself engineered, measured, and improved as a product.",
  threeComponents: [
    {
      legacy: "Controlled programming environment",
      now: "The execution environment, the isolation tiers, the worktree, the sandbox",
    },
    {
      legacy: "Standardised development tools",
      now: "The tool registry, the skill corpus, the standards verifiers",
    },
    {
      legacy: "Historical information for management and measurement",
      now: "The run artefact store, the event log, the metric catalogue",
    },
  ],
  twoProblems: [
    {
      title: "Generated work cannot be trusted without an independent check",
      detail:
        "As models improve, the volume of plausible-looking output rises. The bottleneck moves from generation to judgement. If the same agent writes the fix and the test that judges it, the gate measures the agent agreeing with itself.",
      source: "V12 · most tests an agent writes assert nothing meaningful",
    },
    {
      title: "Agent failures are not reasoning failures",
      detail:
        "V02 audited hundreds of runs: workflow defects, not agent reasoning, caused the failures. The thing to engineer is not the agent, it is the machine the agent runs inside — the workflow, the gates, the isolation, the context selection, the recovery.",
      source: "V02 · the most consequential finding in the corpus",
    },
  ],
  notThis: [
    { it: "A collection of AI tools", why: "Tools do not compose into a factory. Failures concentrate in composition, not in the tools." },
    { it: "An autonomous company", why: "Every workflow ends at L2 by default. Human judgement is retained where it is worth money." },
    { it: "A black-box pipeline", why: "Every action is reconstructable with its authority. A factory you cannot audit is one you cannot improve." },
    { it: "A model with a repository attached", why: "The model is replaceable. The control plane, the gates, and the measurement are not." },
    { it: "A productivity claim", why: "No number is promised. The factory measures itself and reports honestly, including when unflattering." },
  ],
  closingPosition:
    "The factory's value is that a human can trust what it tells them. That is a property maintained by measurement or destroyed by an unmeasured claim.",
};

export const COMMITMENTS = [
  {
    id: "C1",
    title: "The oracle comes first",
    detail:
      "A task's acceptance criteria are expressed as a checkable oracle during specification, before any implementation stage runs, and the oracle is authored against the specification rather than the implementation — by a deterministic generator where possible, by a human otherwise. An agent may propose extra tests; it may never write the tests that decide its own change.",
    weight: "Highest-leverage single decision in the blueprint.",
    tags: ["ADR-0005", "I-4", "I-10"],
  },
  {
    id: "C2",
    title: "The control plane holds the state; the data plane does the work",
    detail:
      "Every consequential action passes through the control plane. The data plane reports outcomes; the control plane writes state. There is no path from an agent to an effect that bypasses a policy decision, because no such path exists.",
    weight: "Makes the safety property topological rather than aspirational.",
    tags: ["ADR-0002", "I-1"],
  },
  {
    id: "C3",
    title: "Context is selected, pinned, and never maximal",
    detail:
      "An agent sees what its stage needs and nothing else — selected deterministically by the context assembler, pinned by identifier and version for the life of the run. Over budget is a failure, not a truncation. Silently dropping context is how a factory produces confidently wrong output.",
    weight: "Budget overflow fails the stage. It never truncates.",
    tags: ["ADR-0009", "I-8"],
  },
  {
    id: "C4",
    title: "Every change to the factory is a change like any other",
    detail:
      "Including changes to the factory itself. The factory proposes; it never applies. A change to a skill, a workflow, the harness, a policy, or an autonomy level goes through review, replay evaluation, approval at a scope-appropriate class, and an observation window with automatic rollback on a guardrail breach.",
    weight: "There is no privileged path.",
    tags: ["ADR-0007", "I-5"],
  },
  {
    id: "C5",
    title: "The factory is a product, and products are engineered",
    detail:
      "It has requirements, an architecture, a test suite, a red-team suite, a roadmap, an incident process, and a cost model. The people who build it are responsible for it in the same way they would be responsible for a product they shipped.",
    weight: "The answer to abandonment risk.",
    tags: ["ADR-0011", "ADR-0012"],
  },
];

/* ---------- Trust zones (Z0..Z4) ---------- */

export const ZONES = [
  {
    id: "Z0",
    name: "Human",
    subtitle: "Owner · dashboard, CLI, GitHub UI",
    trust: "trusted",
    color: "#7dd3fc",
    summary:
      "The only place intent and judgement originate. Six typed access points; no informal 'chat with the agent' path exists.",
    contains: ["Owner", "Dashboard", "CLI (factory)", "GitHub UI"],
  },
  {
    id: "Z1",
    name: "Control plane",
    subtitle: "Trusted · holds all authoritative state",
    trust: "trusted",
    color: "#a78bfa",
    summary:
      "api + worker processes, Postgres, object store, secret store. Decides intent, policy, state, scheduling and merges. Holds state; never executes work.",
    contains: [
      "apps/api",
      "apps/worker",
      "Postgres (factory schema)",
      "Object store",
      "Secret store",
      "PolicyEngine",
      "EventLog",
      "StateMachine",
      "Scheduler",
      "Orchestrator",
    ],
  },
  {
    id: "Z2",
    name: "Host adapters",
    subtitle: "Inside the worker, with brokered credentials",
    trust: "brokered",
    color: "#f0abfc",
    summary:
      "Adapters executing inside the worker process. Credentials live in memory, per task, and are redacted from every output.",
    contains: ["CredentialBroker", "ModelGateway", "ToolBroker", "Tool Adapters"],
  },
  {
    id: "Z2e",
    name: "Edge containers",
    subtitle: "Sandbox + core networks",
    trust: "brokered",
    color: "#fbbf24",
    summary:
      "factory-egress (token-bound allow-list proxy on :3128) and factory-gateway (model passthrough). The only route out of the sandbox.",
    contains: ["factory-egress", "factory-gateway"],
  },
  {
    id: "Z3",
    name: "Data plane",
    subtitle: "Untrusted code runs here",
    trust: "untrusted",
    color: "#fb7185",
    summary:
      "T2 containers: checkout, harness, gates, repo code. No DB role, no secret, no docker socket, no route except the egress proxy and the gateway.",
    contains: ["T2 task containers", "Claude Code harness", "Verification gates", "Repo code"],
  },
  {
    id: "Z4",
    name: "External",
    subtitle: "Third-party systems",
    trust: "external",
    color: "#94a3b8",
    summary: "GitHub, model providers, package registries, OSV, MCP servers, notification webhook.",
    contains: [
      "GitHub",
      "Anthropic Messages API",
      "Secondary provider",
      "Package registries",
      "OSV advisories",
      "MCP servers",
      "Notification webhook",
    ],
  },
];

/* ---------- The architecture node graph (for the animated map) ---------- */
/* x/y are in a 0..100 viewbox space. zone ids map to ZONES above. */

export const NODES = [
  // ---- Z0 Human
  { id: "owner", label: "Owner", sub: "dashboard · CLI · GitHub UI", zone: "Z0", x: 8, y: 22, w: 13, h: 9, kind: "human" },
  { id: "gh-ui", label: "GitHub UI", sub: "reviews · merges", zone: "Z0", x: 8, y: 36, w: 13, h: 9, kind: "human" },

  // ---- Z1 Control plane
  { id: "api", label: "apps/api", sub: "access points · webhooks · SSE", zone: "Z1", x: 26, y: 8, w: 14, h: 9, kind: "service" },
  { id: "worker", label: "apps/worker", sub: "orchestrator · scheduler · broker", zone: "Z1", x: 26, y: 22, w: 14, h: 12, kind: "service", emphasis: true },
  { id: "policy", label: "PolicyEngine", sub: "pure · fail-closed", zone: "Z1", x: 44, y: 4, w: 13, h: 8, kind: "pure", emphasis: true },
  { id: "eventlog", label: "EventLog", sub: "append-only · hash chain", zone: "Z1", x: 44, y: 14, w: 13, h: 8, kind: "store" },
  { id: "state", label: "StateMachine", sub: "19 task · 8 node states", zone: "Z1", x: 44, y: 24, w: 13, h: 8, kind: "pure" },
  { id: "scheduler", label: "Scheduler", sub: "SKIP LOCKED leases", zone: "Z1", x: 44, y: 34, w: 13, h: 8, kind: "service" },
  { id: "orch", label: "Orchestrator", sub: "stage runner · executors", zone: "Z1", x: 26, y: 38, w: 14, h: 9, kind: "service", emphasis: true },
  { id: "pg", label: "Postgres", sub: "events · state · projections", zone: "Z1", x: 62, y: 8, w: 13, h: 9, kind: "store", emphasis: true },
  { id: "objstore", label: "Object store", sub: "run artefacts · oracles · patches", zone: "Z1", x: 62, y: 19, w: 13, h: 9, kind: "store" },
  { id: "secret", label: "Secret store", sub: "sops+age", zone: "Z1", x: 62, y: 30, w: 13, h: 9, kind: "store" },
  { id: "defn", label: "Definition store", sub: "declarative · applied by SHA", zone: "Z1", x: 62, y: 41, w: 13, h: 9, kind: "store" },
  { id: "context", label: "ContextAssembler", sub: "pure · budget fails", zone: "Z1", x: 80, y: 8, w: 15, h: 9, kind: "pure" },
  { id: "artifact", label: "ArtefactStore", sub: "12-element run record", zone: "Z1", x: 80, y: 19, w: 15, h: 9, kind: "store" },

  // ---- Z2 Host adapters
  { id: "broker", label: "ToolBroker", sub: "10-step choke point", zone: "Z2", x: 26, y: 54, w: 14, h: 9, kind: "service", emphasis: true },
  { id: "cred", label: "CredentialBroker", sub: "ephemeral · per-task", zone: "Z2", x: 44, y: 54, w: 13, h: 9, kind: "service" },
  { id: "gateway", label: "ModelGateway", sub: "routing · budgets · failover", zone: "Z2", x: 62, y: 54, w: 13, h: 9, kind: "service" },

  // ---- Z2e Edge
  { id: "egress", label: "factory-egress", sub: "CONNECT proxy :3128", zone: "Z2e", x: 44, y: 68, w: 14, h: 9, kind: "edge" },
  { id: "gwpassthru", label: "factory-gateway", sub: "model passthrough", zone: "Z2e", x: 62, y: 68, w: 14, h: 9, kind: "edge" },

  // ---- Z3 Data plane
  { id: "t2", label: "T2 container", sub: "rootless · no caps · read-only", zone: "Z3", x: 26, y: 82, w: 16, h: 10, kind: "sandbox", emphasis: true },
  { id: "harness", label: "Harness", sub: "Claude Code CLI", zone: "Z3", x: 46, y: 82, w: 13, h: 10, kind: "sandbox" },
  { id: "gates", label: "Verification gates", sub: "static → tests → oracle → security", zone: "Z3", x: 63, y: 82, w: 16, h: 10, kind: "sandbox" },

  // ---- Z4 External
  { id: "github", label: "GitHub", sub: "App · PRs · checks", zone: "Z4", x: 80, y: 54, w: 15, h: 9, kind: "external" },
  { id: "llm", label: "Model providers", sub: "Anthropic · secondary", zone: "Z4", x: 80, y: 68, w: 15, h: 9, kind: "external" },
  { id: "registry", label: "Registries", sub: "npm · PyPI · crates", zone: "Z4", x: 80, y: 82, w: 15, h: 9, kind: "external" },
];

/* edges: [from, to, kind, label] — kind: flow | policy | blocked | data */
export const EDGES = [
  { from: "owner", to: "api", kind: "flow", label: "AP-1…AP-6" },
  { from: "gh-ui", to: "github", kind: "flow", label: "review + merge" },
  { from: "github", to: "api", kind: "flow", label: "webhook" },
  { from: "api", to: "pg", kind: "data", label: "" },
  { from: "api", to: "worker", kind: "flow", label: "enqueue job" },
  { from: "worker", to: "pg", kind: "data", label: "" },
  { from: "worker", to: "objstore", kind: "data", label: "artefacts" },
  { from: "worker", to: "secret", kind: "data", label: "secrets" },
  { from: "worker", to: "defn", kind: "data", label: "applied definition" },
  { from: "orch", to: "state", kind: "policy", label: "transition(cmd)" },
  { from: "orch", to: "scheduler", kind: "flow", label: "claim node" },
  { from: "scheduler", to: "worker", kind: "flow", label: "lease" },
  { from: "worker", to: "context", kind: "flow", label: "resolve" },
  { from: "worker", to: "eventlog", kind: "data", label: "append" },
  { from: "broker", to: "policy", kind: "policy", label: "evaluate" },
  { from: "policy", to: "broker", kind: "policy", label: "decision" },
  { from: "broker", to: "cred", kind: "flow", label: "mint" },
  { from: "broker", to: "gateway", kind: "flow", label: "complete" },
  { from: "gateway", to: "llm", kind: "flow", label: "API" },
  { from: "cred", to: "github", kind: "flow", label: "install token" },
  { from: "worker", to: "t2", kind: "flow", label: "docker exec" },
  { from: "t2", to: "harness", kind: "flow", label: "run" },
  { from: "t2", to: "gates", kind: "flow", label: "verify" },
  { from: "t2", to: "egress", kind: "flow", label: "HTTP proxy" },
  { from: "egress", to: "registry", kind: "flow", label: "allow-list" },
  { from: "t2", to: "gwpassthru", kind: "flow", label: "ANTHROPIC_BASE_URL" },
  { from: "gwpassthru", to: "llm", kind: "flow", label: "forward" },
  { from: "worker", to: "github", kind: "flow", label: "push branch · open PR" },
  { from: "worker", to: "artifact", kind: "data", label: "run record" },
];

/* Explicitly blocked paths — the whole point of the design */
export const BLOCKED_PATHS = [
  { from: "Z3", to: "Z1", what: "T2 → Postgres", why: "The data plane has no database role at all. No path exists." },
  { from: "Z3", to: "Z1", what: "T2 → secret store", why: "No secret is ever mounted into a container." },
  { from: "Z3", to: "host", what: "T2 → docker socket", why: "docker.sock is never mounted. The container cannot spawn a sibling." },
  { from: "Z3", to: "Z4", what: "T2 → internet", why: "Egress is default-deny. Only the token-bound proxy on :3128, with an allow-list, and it fails closed." },
  { from: "Z3", to: "Z4", what: "T2 → model provider", why: "Only via factory-gateway passthrough, with a task-scoped token and a model allow-list." },
  { from: "Z1", to: "Z1", what: "control surface → definition", why: "The dashboard may observe, pause, cancel, escalate and propose — never write. Privilege escalation cannot happen silently." },
];

export const BOUNDARY_RULES = [
  { id: "B-1", text: "Z3 has no DB role, no secret, no docker socket, no route except egress-proxy and gateway." },
  { id: "B-2", text: "Z3 → Z1 data flows only as files copied out by the worker (patch, logs, reports) — untrusted bytes." },
  { id: "B-3", text: "Worker never executes host git inside any container-writable directory; patches apply to a clean host worktree." },
  { id: "B-4", text: "Every Z1/Z2 effect on an external system passes ToolBroker; harness-internal tools are governed by isolation." },
  { id: "B-5", text: "Agents never hold or request credentials. The broker mints and injects them at the invocation boundary." },
  { id: "B-6", text: "Policy is evaluated by pure code from the applied definition. No model is consulted." },
];
