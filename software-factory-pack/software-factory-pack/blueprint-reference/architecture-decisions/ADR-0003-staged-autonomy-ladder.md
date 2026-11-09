# ADR-0003 — Adopt a staged, per-workflow autonomy ladder with mandatory human review of code

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture, Engineering leadership
- **Evidence class:** [E2] cross-source interpretation (V11 + V14 + V12 + V13 + V15)
- **Supersedes:** none

---

## Context

The corpus splits sharply on how much of the development loop may run unattended.

**Pro high autonomy.** V03, V12, V15 describe factories where agents produce the large majority of code, with human review reduced to a residue. V15 reports 85–90% of PRs agent-handled at ~850 PRs/week.

**Pro supervised autonomy.** V14 states that unattended models will not improve or maintain codebase quality over time (5:31), and cites SlopCodeBench where GPT-5.5 scored 14.8% (6:52). V12 reports that over 90% of agent-written tests are slop (13:09). V02 reports that a fully dark factory was attempted and abandoned (2:23–2:49).

These cannot both be actioned as stated. The resolution is in `04_CROSS_SOURCE_SYNTHESIS.md` D-1: the sources are describing different parts of the system, and the right answer is neither a global level nor a single choice but **autonomy assigned per workflow, earned by evidence, and bounded by blast radius**.

## Decision

### 1. Autonomy is per-workflow, not global.

Each workflow in the factory definition carries an **autonomy level**. The level is a function of two things: the **demonstrated reliability** of that workflow under its own verification, and the **blast radius** of its outputs.

### 2. The five levels.

| Level | Name | The factory may | Human involvement |
|---|---|---|---|
| **L0** | Research | Read, search, analyse, produce reports | None required |
| **L1** | Propose | Produce plans, designs, patches, specs — no repository mutation | Human selects and applies |
| **L2** | Execute isolated | Create branches, run in isolated workspaces, open PRs | Human reviews the PR; always required for code |
| **L3** | Merge after approval | Merge and deploy after a configured, risk-tiered approval is satisfied | Approval per the merge policy |
| **L4** | Operate production | Execute an enumerated set of authorised production operations | Pre-approved runbook, no per-action approval; post-hoc review |

### 3. The floor.

**Human reading of code is mandatory for any workflow whose output enters the main branch, until that workflow has a discriminator-calibrated verifier set covering its acceptance criteria.** This is the reconciled lesson of V14 and V15: a verifier may substitute for human review only if it has been *demonstrated on this repository, for this class of change, to fail when the property is violated*.

### 4. The default is L2.

A new workflow starts at L2. Promotion requires evidence: a calibration run showing the workflow's verifiers detect known violations, plus an observed defect-escape rate below the agreed threshold over a defined sample.

### 5. Promotion and revocation are recorded.

Autonomy level changes are changes to the factory definition and therefore reviewed changes (ADR-0001). Autonomy may be revoked by evidence — a defect escape, a verifier regression, a cost anomaly — and revocation is not an exceptional path.

### 6. L4 is narrow and enumerated.

L4 applies only to operations with a written, reviewed runbook: a defined alert class, a prepared remediation, an abort condition, and a post-hoc review. It is not a general "deploy to production" permission.

## Consequences

**Positive**
- The design is honest about the uncertainty in the corpus: it does not bet the factory on either V15's scale claims or V14's blanket objection.
- It makes the review-capacity constraint (CP-7) explicit and forces it into the design rather than discovering it at scale.
- It gives an unambiguous next action at every point: *earn the next level*, with a defined evidence bar.
- It matches the directive's §9 requirement for L0–L4 plus a practical risk model.

**Negative**
- The strongest throughput claims in the corpus are therefore *not* the blueprint's expected steady state. The blueprint expects a lower agent-authored share with an explicit path upward. This is a deliberate acceptance of lower headline throughput in exchange for a defensible quality position.
- The evidence bar for promotion is real work: it requires a verifier suite, a calibration corpus of known violations, and an observation window. This is the largest single cost in the roadmap.
- Risk-tiered autonomy requires a blast-radius computation, which is itself an estimation problem with no perfect answer.

**Neutral**
- The blast-radius estimation method is specified in `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md`.
- The calibration procedure is specified in `14_QUALITY_TESTING_AND_EVALUATION.md`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Global L3 (agents merge on confidence, as V04's merge policy) | Rejected as the *default*: V04's confidence function is undocumented in the source, and a global level cannot distinguish a documentation sweep from a schema migration. Retained as a per-workflow *option* at L3. |
| Global L2 forever (V14's strict reading) | Rejected as a permanent position: it makes the review queue grow linearly with throughput, which CP-7 identifies as unsustainable. Adopted as the *floor*, not the ceiling. |
| L4 production autonomy from the start | Rejected: V02's abandoned dark factory is direct evidence against, and V14's failure mode is unbounded in scope. |
| "Dark factory" (no human anywhere) | Rejected outright — V02 attempted and abandoned it. |

## Validation

- The control plane must refuse to execute a workflow above its declared autonomy level.
- The merge path must record, for each merge, which approval satisfied it and under which level.
- A calibration report must exist for every workflow promoted above L2, listing known violations introduced and the detection rate observed.
- Autonomy revocation must be possible without a code deployment.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-07, D-35, D-47, D-48, D-52, D-54, M-05, M-06, M-08
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` D-1, D-7
- Related: ADR-0005, ADR-0006
