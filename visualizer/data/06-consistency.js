/* ============================================================
   SOFTWARE FACTORY — Part 6: consistency ledger
   Places where the source documents disagree with each other,
   and which reading the visualizer treats as authoritative.
   ============================================================ */

/* kind: "count" | "collision" | "gap" | "scope" */
export const CONFLICTS = [
  {
    id: "X-1",
    kind: "count",
    topic: "Task state machine size",
    claim: "The roadmap (blueprint 16, deliverable 0.3) says “the 20 states”.",
    counter: "The state machine itself (09 §2.1) lists 19, and the glossary repeats 19.",
    verdict: "19",
    why: "The authoritative list wins over the prose that summarises it. The pack’s own context manifest flags this and names 09 §2.1 as authoritative. Every transition in the table references a state that exists in the 19 — so 20 is a counting slip, not a missing state.",
    impact: "None on behaviour. It matters only if you are reading the roadmap and wondering which state you missed.",
  },
  {
    id: "X-2",
    kind: "count",
    topic: "How many workflows exist",
    claim: "The roadmap phase 4 says “Workflows A–F in production” and its exit criterion reads “Six workflows run continuously with measured baselines”.",
    counter: "The end-to-end workflow document (12) specifies seven — A, B, C, D, E, F and G — and says “All seven workflows use the taxonomy…”.",
    verdict: "Seven (A–G)",
    why: "Workflow G is the improvement loop — the meta-workflow that proposes changes to the factory itself. It is deliberately excluded from the phase-4 count because a workflow that changes the factory cannot be counted among the workflows it measures.",
    impact: "The excluded workflow is the one that makes the factory a product rather than a pipeline. Reading “six” and stopping there hides C4.",
  },
  {
    id: "X-3",
    kind: "count",
    topic: "Number of agent roles",
    claim: "The agent catalogue is often described as holding ten roles.",
    counter: "The catalogue in the visualizer carries twelve executable roles, and Workflow G additionally names three roles of its own — Log Analyser, Improvement Proposer, Replay Evaluator.",
    verdict: "Twelve catalogue roles + three G-specific roles",
    why: "The catalogue is the set of roles a task may dispatch. Workflow G’s three are specialised for the improvement loop and are described where they are used rather than in the shared catalogue.",
    impact: "Roles are specifications, not deployments (ADR-0010). A count that mixes catalogue roles with workflow-local roles will mislead you when you write the agent contracts.",
  },
  {
    id: "X-4",
    kind: "collision",
    topic: "The I-1 … I-3 prefix is used twice",
    claim: "Top-level invariants are numbered I-1 through I-12.",
    counter: "The idempotency-key categories in the data model also use I-1, I-2, I-3.",
    verdict: "Read the section, not the prefix",
    why: "Both are legitimate. The invariants are safety properties of the factory; the idempotency categories classify keys in the control-plane API. They never appear in the same list — but a search across the whole corpus will collide.",
    impact: "This is why the cross-reference layer in this visualizer resolves IDs in context: a bare “I-2” is ambiguous across the corpus, so it is only linked from within the invariants view.",
  },
  {
    id: "X-5",
    kind: "collision",
    topic: "The R- prefix is used for two different scales",
    claim: "Blast-radius tiers are R0 through R4 (trivial → critical).",
    counter: "The blueprint risk register numbers risks R-01 through R-22.",
    verdict: "R0–R4 is a tier; R-NN is a risk",
    why: "The tier is a dial you set per task; the risk is an item in a register you maintain. They are never compared, but “R2” in prose can mean either a moderate blast radius or the second risk on the list.",
    impact: "Read R0–R4 in the levels view and R-NN in the risks view. The dash is the tell.",
  },
  {
    id: "X-6",
    kind: "count",
    topic: "How many requirements the coverage matrix tracks",
    claim: "Part C of the master checklist is headed “all 99 blueprint requirements”.",
    counter: "The matrix itself contains 79 rows — 67 functional requirements and 12 security requirements.",
    verdict: "79 rows",
    why: "The requirement IDs are not contiguous. FR-07–FR-09, FR-17–FR-19, FR-27–FR-29, FR-36–FR-39, FR-45–FR-49, FR-59, FR-67–FR-69, FR-71, FR-78–FR-79, FR-87–FR-89 are absent from the matrix — and FR-77, FR-83, FR-86, FR-92 and FR-93 are absent too. The source requirements use sparse numbering by design, so “99” counts ID space, not rows.",
    impact: "Two of the absent ones are named in the deferral register — FR-77 (human PRs through the factory gates) and FR-83 (multi-repo). Absence from the matrix does not mean absence from the blueprint.",
  },
  {
    id: "X-7",
    kind: "scope",
    topic: "What “v1” excludes",
    claim: "The blueprint describes a factory that merges, deploys and operates.",
    counter: "In v1 there is no production capability at all — `factory.write` is never granted, and a test asserts that no production capability is registered.",
    verdict: "v1 ends at MERGED",
    why: "I-7 and the absent-capability set make the boundary mechanical rather than aspirational. Deploy and operate exist in the design as workflows A and E, but they are deferred with named triggers.",
    impact: "Reading the deferred register is the fastest way to tell which parts of the blueprint you are not building yet, and what would have to be true to build them.",
  },
];

/* The conflicts that a reader is most likely to trip over, ranked. */
export const CONFLICT_ORDER = ["X-1", "X-2", "X-4", "X-5", "X-3", "X-6", "X-7"];

export const CONFLICT_KINDS = {
  count: { label: "Count", cls: "w" },
  collision: { label: "ID collision", cls: "b" },
  gap: { label: "Gap", cls: "v" },
  scope: { label: "Scope", cls: "a" },
};
