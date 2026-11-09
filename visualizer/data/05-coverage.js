/* ============================================================
   SOFTWARE FACTORY — Part 5: coverage matrices & registers
   GENERATED from software-factory-pack/06_MASTER_CHECKLIST_AND_COVERAGE.md
   Parts B (invariant test inventory), C (requirement coverage matrix),
   D (deferred register), E (Friday checkpoint).
   ============================================================ */

/* ---------- Part B — invariant test inventory ---------- */
/* Each invariant needs an automated test. `at` = the gate where it appears. */
export const INV_TESTS = [
  {
    "id": "INV-1",
    "t": "data plane cannot mutate control-plane state",
    "at": "G1"
  },
  {
    "id": "INV-2",
    "t": "no agent widens scope/autonomy/credentials",
    "at": "G1"
  },
  {
    "id": "INV-3",
    "t": "every consequential action attributable + logged",
    "at": "G1"
  },
  {
    "id": "INV-4",
    "t": "no merge without oracle + approval",
    "at": "G2"
  },
  {
    "id": "INV-5",
    "t": "no factory change without reviewed change",
    "at": "G1"
  },
  {
    "id": "INV-6",
    "t": "untrusted content never becomes instruction",
    "at": "G2"
  },
  {
    "id": "INV-7",
    "t": "no production capability exists in v1",
    "at": "G3"
  },
  {
    "id": "INV-8",
    "t": "every run's context pinned and recoverable",
    "at": "G1"
  },
  {
    "id": "INV-9",
    "t": "provider failover works; no single-provider dependency",
    "at": "G1"
  },
  {
    "id": "INV-10",
    "t": "no agent-authored test alone satisfies a criterion",
    "at": "G2"
  },
  {
    "id": "INV-11",
    "t": "surplus capacity not auto-allocated",
    "at": "G2"
  },
  {
    "id": "INV-12",
    "t": "components replaceable behind interfaces (fakes pass the same contract tests)",
    "at": "G1"
  }
];

/* ---------- Part C — requirement coverage matrix ---------- */
/* status: "y" covered · "p" partial · "d" deferred · "a" satisfied by absence */
export const COVERAGE = [
  {
    "id": "FR-01",
    "s": "p",
    "tk": "T-2.19, T-5.01",
    "n": "intent → merged PR; deploy/production deferred (Workflow A)"
  },
  {
    "id": "FR-02",
    "s": "y",
    "tk": "T-1.06",
    "n": ""
  },
  {
    "id": "FR-03",
    "s": "y",
    "tk": "T-1.14, T-2.04",
    "n": ""
  },
  {
    "id": "FR-04",
    "s": "y",
    "tk": "T-1.04, T-1.05, T-2.17",
    "n": "all workflows L2"
  },
  {
    "id": "FR-05",
    "s": "p",
    "tk": "T-2.19, T-5.05",
    "n": "change path full; proposal path manual"
  },
  {
    "id": "FR-06",
    "s": "y",
    "tk": "T-1.06, T-2.09",
    "n": "approval class by scope"
  },
  {
    "id": "FR-10",
    "s": "y",
    "tk": "T-2.02",
    "n": ""
  },
  {
    "id": "FR-11",
    "s": "y",
    "tk": "T-2.06",
    "n": ""
  },
  {
    "id": "FR-12",
    "s": "y",
    "tk": "T-2.07",
    "n": ""
  },
  {
    "id": "FR-13",
    "s": "y",
    "tk": "T-2.01",
    "n": ""
  },
  {
    "id": "FR-14",
    "s": "p",
    "tk": "T-5.04",
    "n": "inventory-lite"
  },
  {
    "id": "FR-15",
    "s": "d",
    "tk": "—",
    "n": "promotion/demotion; A4.11"
  },
  {
    "id": "FR-16",
    "s": "y",
    "tk": "T-2.01, T-2.02",
    "n": "`.factory/` = R3"
  },
  {
    "id": "FR-20",
    "s": "y",
    "tk": "T-1.02–1.04",
    "n": ""
  },
  {
    "id": "FR-21",
    "s": "y",
    "tk": "T-1.02, T-1.03",
    "n": ""
  },
  {
    "id": "FR-22",
    "s": "y",
    "tk": "T-1.13, T-3.07",
    "n": ""
  },
  {
    "id": "FR-23",
    "s": "y",
    "tk": "T-2.08",
    "n": ""
  },
  {
    "id": "FR-24",
    "s": "y",
    "tk": "T-2.08",
    "n": ""
  },
  {
    "id": "FR-25",
    "s": "y",
    "tk": "T-2.01, T-2.08",
    "n": ""
  },
  {
    "id": "FR-26",
    "s": "y",
    "tk": "T-1.06",
    "n": "report, never auto-correct"
  },
  {
    "id": "FR-30",
    "s": "y",
    "tk": "T-2.03, T-2.19",
    "n": ""
  },
  {
    "id": "FR-31",
    "s": "y",
    "tk": "T-2.19",
    "n": "by construction (role set reviewed)"
  },
  {
    "id": "FR-32",
    "s": "y",
    "tk": "T-1.13, T-2.11",
    "n": ""
  },
  {
    "id": "FR-33",
    "s": "y",
    "tk": "T-1.10",
    "n": ""
  },
  {
    "id": "FR-34",
    "s": "y",
    "tk": "T-1.10",
    "n": ""
  },
  {
    "id": "FR-35",
    "s": "y",
    "tk": "T-2.14",
    "n": ""
  },
  {
    "id": "FR-40",
    "s": "p",
    "tk": "T-1.12, T-2.10",
    "n": "T1 + T2; T3 deferred"
  },
  {
    "id": "FR-41",
    "s": "y",
    "tk": "T-2.12, T-2.17",
    "n": ""
  },
  {
    "id": "FR-42",
    "s": "y",
    "tk": "T-1.12, T-2.10",
    "n": ""
  },
  {
    "id": "FR-43",
    "s": "y",
    "tk": "T-1.07, T-3.08",
    "n": ""
  },
  {
    "id": "FR-44",
    "s": "y",
    "tk": "T-2.10, T-1.11",
    "n": "digest-pinned image + base SHA + declared commands"
  },
  {
    "id": "FR-50",
    "s": "y",
    "tk": "T-2.13",
    "n": ""
  },
  {
    "id": "FR-51",
    "s": "y",
    "tk": "T-2.13, T-2.17",
    "n": ""
  },
  {
    "id": "FR-52",
    "s": "y",
    "tk": "T-2.07, T-2.13",
    "n": ""
  },
  {
    "id": "FR-53",
    "s": "y",
    "tk": "T-2.13, T-3.03",
    "n": ""
  },
  {
    "id": "FR-54",
    "s": "p",
    "tk": "T-4.03, T-4.04",
    "n": "declared deterministic verifiers; auto-generation from prose standards deferred"
  },
  {
    "id": "FR-55",
    "s": "y",
    "tk": "T-4.04",
    "n": "mechanism; no verifier substitutes for human review at L2"
  },
  {
    "id": "FR-56",
    "s": "y",
    "tk": "T-2.14",
    "n": ""
  },
  {
    "id": "FR-57",
    "s": "y",
    "tk": "T-0.06, T-4.02",
    "n": ""
  },
  {
    "id": "FR-58",
    "s": "y",
    "tk": "T-2.16, T-2.17",
    "n": ""
  },
  {
    "id": "FR-60",
    "s": "y",
    "tk": "T-1.08",
    "n": ""
  },
  {
    "id": "FR-61",
    "s": "y",
    "tk": "T-1.05, T-1.08, T-2.19",
    "n": ""
  },
  {
    "id": "FR-62",
    "s": "y",
    "tk": "T-1.08",
    "n": "fixture MCP"
  },
  {
    "id": "FR-63",
    "s": "y",
    "tk": "T-1.09",
    "n": ""
  },
  {
    "id": "FR-64",
    "s": "y",
    "tk": "T-1.08, T-3.07",
    "n": ""
  },
  {
    "id": "FR-65",
    "s": "y",
    "tk": "T-1.08",
    "n": ""
  },
  {
    "id": "FR-66",
    "s": "y",
    "tk": "T-1.06, T-0.05",
    "n": ""
  },
  {
    "id": "SEC-01",
    "s": "y",
    "tk": "T-1.05, T-1.08",
    "n": ""
  },
  {
    "id": "SEC-02",
    "s": "y",
    "tk": "T-1.05; INV-2",
    "n": ""
  },
  {
    "id": "SEC-03",
    "s": "y",
    "tk": "T-2.01, T-2.04, T-3.01",
    "n": ""
  },
  {
    "id": "SEC-04",
    "s": "y",
    "tk": "T-1.09",
    "n": ""
  },
  {
    "id": "SEC-05",
    "s": "y",
    "tk": "T-2.10",
    "n": ""
  },
  {
    "id": "SEC-06",
    "s": "y",
    "tk": "T-1.05, T-1.08",
    "n": ""
  },
  {
    "id": "SEC-07",
    "s": "y",
    "tk": "T-1.03, T-3.04",
    "n": ""
  },
  {
    "id": "SEC-08",
    "s": "a",
    "tk": "INV-7",
    "n": "no production capability in v1"
  },
  {
    "id": "SEC-09",
    "s": "y",
    "tk": "T-2.01, T-2.02, T-3.03",
    "n": ""
  },
  {
    "id": "SEC-10",
    "s": "d",
    "tk": "—",
    "n": "no deploys; merged changes are reverted by humans via git"
  },
  {
    "id": "SEC-11",
    "s": "y",
    "tk": "T-1.06, T-1.14, T-2.12; AT-6/7",
    "n": ""
  },
  {
    "id": "SEC-12",
    "s": "y",
    "tk": "T-2.10, T-3.08",
    "n": ""
  },
  {
    "id": "FR-70",
    "s": "y",
    "tk": "T-1.16",
    "n": ""
  },
  {
    "id": "FR-72",
    "s": "y",
    "tk": "T-2.16",
    "n": ""
  },
  {
    "id": "FR-73",
    "s": "y",
    "tk": "T-3.05",
    "n": ""
  },
  {
    "id": "FR-74",
    "s": "y",
    "tk": "T-2.09",
    "n": ""
  },
  {
    "id": "FR-75",
    "s": "p",
    "tk": "T-1.08, T-2.09",
    "n": "mechanism built and tested with a fixture E3 capability; no real E3/E4 capability exists"
  },
  {
    "id": "FR-76",
    "s": "d",
    "tk": "—",
    "n": "Workflow E"
  },
  {
    "id": "FR-77",
    "s": "d",
    "tk": "—",
    "n": "human code PRs are not gated by the factory in v1"
  },
  {
    "id": "FR-80",
    "s": "y",
    "tk": "T-2.01, T-2.02",
    "n": ""
  },
  {
    "id": "FR-81",
    "s": "y",
    "tk": "T-2.18",
    "n": ""
  },
  {
    "id": "FR-82",
    "s": "p",
    "tk": "T-2.18",
    "n": "minimal docs check"
  },
  {
    "id": "FR-83",
    "s": "d",
    "tk": "—",
    "n": "Workflow F"
  },
  {
    "id": "FR-84",
    "s": "d",
    "tk": "—",
    "n": "no production signals; CI signals feed D-2"
  },
  {
    "id": "FR-85",
    "s": "p",
    "tk": "T-5.02, T-5.03",
    "n": "D-1, D-2 only"
  },
  {
    "id": "FR-86",
    "s": "a",
    "tk": "INV-7",
    "n": ""
  },
  {
    "id": "FR-90",
    "s": "d",
    "tk": "—",
    "n": "outer loop"
  },
  {
    "id": "FR-91",
    "s": "d",
    "tk": "—",
    "n": "meta loop"
  },
  {
    "id": "FR-92",
    "s": "p",
    "tk": "T-1.06, T-5.05",
    "n": "versioning, approval, git rollback; evaluation deferred"
  },
  {
    "id": "FR-93",
    "s": "y",
    "tk": "T-5.05",
    "n": ""
  },
  {
    "id": "FR-94",
    "s": "d",
    "tk": "—",
    "n": "auto-revert on guardrail breach"
  },
  {
    "id": "FR-95",
    "s": "p",
    "tk": "T-1.07",
    "n": "no auto-fill (I-11); allocation policy deferred"
  }
];

export const COVERAGE_STATUS = {
  y: { label: "Covered", cls: "g", mark: "\u2705" },
  p: { label: "Partial", cls: "w", mark: "\ud83d\udfe1" },
  d: { label: "Deferred", cls: "b", mark: "\u23f8" },
  a: { label: "By absence", cls: "v", mark: "\u25fb" },
};

/* ---------- Part D — deferred register ---------- */
/* Every cut/deferral, with the trigger that would reverse it. */
export const DEFERRALS = [
  {
    "item": "T3 hardened sandbox",
    "ref": "ADR-0006; Phase 3.2",
    "why": "cost; T2 + default-deny + patch extraction closes cheap vectors",
    "trig": "content from non-owner authors, tasks needing open network, or first deploy workflow",
    "rev": "monthly"
  },
  {
    "item": "L3 merge / L4 operate",
    "ref": "ADR-0003",
    "why": "needs calibration + defect-escape evidence",
    "trig": "≥2 verifiers calibrated for a workflow, 8+ weeks of data, owner opts in",
    "rev": "monthly"
  },
  {
    "item": "Workflow A (deploy), E (incident)",
    "ref": "`12 §2, §6`",
    "why": "no production capability; rollback not proven",
    "trig": "L3 promotion + tested rollback + runbooks",
    "rev": "quarterly"
  },
  {
    "item": "Workflow F (multi-repo), FR-83",
    "ref": "`12 §7`",
    "why": "one repo in scope",
    "trig": "second repo with cross-repo changes",
    "rev": "quarterly"
  },
  {
    "item": "LLM-judge verifiers, FR-54 auto-generation",
    "ref": "`14 §4.4`",
    "why": "calibration cost; L2 needs none",
    "trig": "convention property that cannot be mechanised and L3 considered",
    "rev": "quarterly"
  },
  {
    "item": "Panel-confidence calibration (A2.11)",
    "ref": "ADR-0011",
    "why": "no confidence-gated merge exists",
    "trig": "before any use of panel output to reduce review",
    "rev": "—"
  },
  {
    "item": "Replay evaluator, outer/meta loops, FR-90/91/94, MEAS-07",
    "ref": "Phase 5",
    "why": "speculative; needs ≥100 runs",
    "trig": "≥100 completed runs with batch evidence",
    "rev": "quarterly"
  },
  {
    "item": "Context promotion/demotion (FR-15, A4.11)",
    "ref": "ADR-0009",
    "why": "one repo",
    "trig": "second repo or ≥10 local context items",
    "rev": "quarterly"
  },
  {
    "item": "Flaky repair, coverage backfill, conformance sweeps (FR-85 rest)",
    "ref": "`12 §5`",
    "why": "need stable gates + baselines",
    "trig": "4 weeks of stable gates",
    "rev": "monthly"
  },
  {
    "item": "Human code PRs through the factory gates (FR-77)",
    "ref": "`blueprint 06` (FR-77)",
    "why": "not needed by owner now",
    "trig": "owner wants factory gates on own PRs",
    "rev": "on request"
  },
  {
    "item": "Real second-provider adapter (if cut)",
    "ref": "NFR-09, I-9",
    "why": "first on the cut list",
    "trig": "immediately after v1",
    "rev": "before v1.1"
  },
  {
    "item": "Separation of duties for R3+",
    "ref": "`13 §6.3`",
    "why": "single owner",
    "trig": "second approver exists",
    "rev": "on change"
  },
  {
    "item": "Multi-tenancy",
    "ref": "Q-01",
    "why": "out of blueprint scope",
    "trig": "explicit requirement",
    "rev": "—"
  },
  {
    "item": "gVisor/`runsc` hardening",
    "ref": "ADR-0020",
    "why": "optional",
    "trig": "any hostile-content workflow",
    "rev": "quarterly"
  }
];

/* ---------- Part E — Friday checkpoint ---------- */
export const FRIDAY = [
  {
    "q": "Gate status",
    "a": "which `CL-G*` rows are ticked with evidence? Anything unticked that should be ticked this week?"
  },
  {
    "q": "Two red weeks in a row? ⇒ apply the next cut from `01 §5.2`; record it in Part D.",
    "a": ""
  },
  {
    "q": "Review load",
    "a": "open PRs ≤3? oldest PR age <24 h? owner review-minutes per PR trend (Q-04)."
  },
  {
    "q": "Security signals since last Friday",
    "a": "`tool.denied`, `policy.denied`, `net.egress.denied`, `patch.rejected`, `webhook.rejected` counts; egress allow-list size and additions (H-12)."
  },
  {
    "q": "Oracle health",
    "a": "same-run-authored oracle rate (must be 0), oracle coverage rate (H-01), share of tasks escalating \"criteria not expressible\"."
  },
  {
    "q": "Cost",
    "a": "spend vs cap; cost per accepted change (after W5); reconciliation drift <2 %."
  },
  {
    "q": "Quality",
    "a": "accepted-PR rate, first-pass success, rework loops, reverts within 14 days."
  },
  {
    "q": "Flake check",
    "a": "any red-team/fault test that flaked? (a flaky security test is a security finding.)"
  },
  {
    "q": "Docs/ADRs updated for any decision made this week; `docs/build-metrics.csv` updated.",
    "a": ""
  },
  {
    "q": "Pick next week's tickets (≤3 concurrent agents); confirm each has its oracle ready *before* it starts.",
    "a": ""
  }
];
