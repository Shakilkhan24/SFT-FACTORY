# ADR-0011 — Treat run artefacts, telemetry, and cost accounting as a prerequisite, not a deliverable

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture, Engineering leadership
- **Evidence class:** [E2] synthesis of V02, V05, V09, V11, V12, V15
- **Supersedes:** none

---

## Context

The 1968 Beamer/GE definition of a software factory includes, as one of its three components, "historical information for management and measurement" (V05, 2:22). Measurement is not a modern addition to the concept; it was intrinsic to it from the beginning.

Corroborating evidence across the corpus:

- **V02 (8:04):** a retrospective failure audit across hundreds of runs revealed that workflow defects — not agent reasoning — caused 21 failures. That finding was only possible because runs were auditable.
- **V09 (24:13):** the one credible before/after in the corpus reports a baseline, a delta, a cost, and a **guardrail metric** (revert rate unchanged).
- **V11:** the outer and meta loops are impossible without a store of run artefacts; improvement must be grounded in batch evidence across many runs.
- **V15:** loops capture logs, and logs are reviewed to improve skills — "you're creating loops to monitor loops."
- **V12:** throughput, review latency, and quality are the metrics that expose where the factory is actually failing.

The corpus's own weakness is that most metrics are vendor-reported without baselines (M-01, M-04, M-08 in the evidence ledger), which the directive explicitly forbids laundering into targets.

## Decision

### 1. Run artefacts are a hard prerequisite

The factory cannot enter Phase 2 without a run-artefact store that captures, for every run:

- task identity, workflow, and the effective context (identifiers and versions, per ADR-0009)
- the model, agent harness, and configuration versions used
- every tool call: tool, arguments summary, result summary, duration, cost
- all prompts and generated text (subject to a retention policy)
- verification results, with per-layer outcomes
- the artefacts produced, with hashes
- the outcome, the approval, and the authority under which it acted
- token counts and compute cost

Without this, the improvement loops, the evaluations, the calibration, and the audits are all unbuildable. It is the first thing to build after the control plane.

### 2. Telemetry is emitted by the framework, not by agents

Agents do not report their own metrics. The **runtime and control plane emit telemetry** as a by-product of executing work. Agent-reported metrics are untrustworthy — an agent under pressure to succeed is the least reliable narrator of its own performance.

### 3. Every experiment reports four things

Any change to the factory — a new workflow, a model change, a prompt change, an autonomy promotion — must be reported with:

| Element | Requirement |
|---|---|
| **Baseline** | The measurement of the same metric before the change, over a stated window and on the same workload |
| **Delta** | The change in the metric, with confidence information where the sample permits |
| **Cost** | Total cost of the change: inference, tool execution, and infrastructure |
| **Guardrail** | At least one metric that must not degrade — e.g. revert rate, defect escape rate, intervention frequency |

A change with no baseline is not evidence. A change with no guardrail is not safe. This is V09's method, generalised into a policy.

### 4. Cost is attributed to the unit of work

Cost must be attributable to the accepted change — not merely to the run — because the meaningful business unit is the change that lands, not the token spent. Per-accepted-change cost is therefore a first-class metric, and it is the metric that governs model routing decisions.

### 5. Metrics have owners and thresholds

Each metric in the evaluation framework has a named owner, a definition, a collection point, and a threshold at which it triggers action. A metric without an owner is decoration.

### 6. No target is set from the corpus

No figure from the source corpus (M-01 … M-10 in the evidence ledger) is used as a target, SLA, or planning input. Targets are set only after the factory has established its own baseline. Where a source figure is cited, it is cited as directional evidence about a different organisation's deployment.

## Consequences

**Positive**
- Every architectural claim the factory makes about itself becomes falsifiable.
- The improvement loops (ADR-0007) have a substrate by construction.
- Cost is visible before it becomes a surprise, and attributable to the thing that creates value.
- The blueprint avoids the corpus's central methodological failure — unsourced productivity claims.

**Negative**
- Storing prompts and tool-call arguments has storage, privacy, and potentially-licensing implications. Mitigation: a retention policy, redaction of secrets at capture time, and a documented decision about what is retained per retention class.
- Instrumentation has a real cost in latency and storage. Mitigated by sampling for high-volume non-critical signals while retaining full fidelity for the metrics that gate decisions.
- Establishing a baseline takes time, and during that period the factory cannot prove improvement. This is a deliberate delay and it is correct: the alternative is guessing.

**Neutral**
- The metric catalogue, collection points, and thresholds are specified in `14_QUALITY_TESTING_AND_EVALUATION.md` and `15_OBSERVABILITY_COST_AND_FEEDBACK.md`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Instrumentation as a later phase | Rejected: without the run artefact store, the improvement loops, calibration, and audits cannot be built at all. The store is a prerequisite, not a feature. |
| Agent-reported metrics | Rejected: the narrator is incentivised and unreliable. |
| Sampling only, to save cost | Rejected for decision-gating metrics. Sampling is acceptable for high-volume telemetry but not for the metrics that determine promotion or rollback. |
| Adopting the corpus's headline figures as targets | Rejected by the directive and by evidence quality. V09's own figure came with a guardrail; the others did not. |

## Validation

- Every run must produce a complete artefact record within an agreed latency of completion.
- Every factory change in the definition history must be joinable to a measurement report containing all four elements.
- Cost attribution must reconcile with billing to within an agreed tolerance.
- A deliberately injected agent failure must be visible in the telemetry — the instrumentation must detect what the factory is designed to detect.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-59, M-02, M-03, §2 register, §4 gaps (cost models)
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` CP-9, CO-7
- Related: ADR-0007, ADR-0008
