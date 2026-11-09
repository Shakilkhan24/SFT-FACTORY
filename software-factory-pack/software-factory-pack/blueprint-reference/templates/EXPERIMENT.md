# Template — Experiment Report (`Experiment`)

**Use when:** reporting the evidence for a change to the factory — a new skill version, a workflow change, a model or routing change, a policy change, an autonomy promotion.
**Authority:** ADR-0011 §3 (the four required elements) and `14_QUALITY_TESTING_AND_EVALUATION.md` §7 (the evaluation framework) are the sources of truth.
**Submission:** an experiment report is an **evidence artefact**, not a decision. It accompanies a proposal; it does not authorise anything. A proposal that references a report with a missing element is rejected at validation.

---

## Authoring rules

1. **Four elements, always: baseline, delta, cost, guardrail.** A change with no baseline is not evidence. A change with no guardrail is not safe. This is ADR-0011 §3 and is non-negotiable.
2. **The baseline is measured, not remembered.** It is the same metric, on the same workload, over a stated window, before the change — not a figure quoted from a slide.
3. **The comparison is controlled.** Both sides use the same run set, the same window, and the same evaluation criteria. A comparison across different workloads is not a comparison.
4. **Model outputs are regenerated, not replayed.** A replay that reused recorded outputs would measure nothing; see `15_...` §7.2.
5. **The run set's limits are stated.** Every report names what the run set cannot represent. A report that claims generality from a historical set is overclaiming.
6. **Cost includes the evaluation's own cost.** An experiment that consumed more than it returned is a negative result and must be reported as one.
7. **The guardrail set is drawn from the standing list**, and any guardrail the change was expected to affect is stated even when it did not.
8. **A null result is a result.** "No measurable difference" is a finding worth recording; it prevents the same proposal being re-proposed with a different name.
9. **The report is an artefact.** It is retained, joinable to the proposal and to the definition revision, and it is itself subject to the retention policy.

---

## The template

```markdown
# Experiment EXP-NNNN — <what is being evaluated>

- **Experiment id:** EXP-NNNN
- **Date:** <YYYY-MM-DD>
- **Author:** <team-or-person>
- **Proposal under test:** <proposal-id> — <one line>
- **Scope of the change:** skill | workflow | harness | policy | autonomy | routing | environment
- **Status:** Complete | Incomplete | Inconclusive | Abandoned
- **Decision:** Proceed | Proceed with changes | Reject | Defer pending <what>

---

## 1. Hypothesis

<What you expect to happen, stated so that it can be wrong. Include the
direction of the expected effect and the metric it should show up in.>

## 2. Method

### 2.1 Change under test
<Exactly what differs between baseline and candidate. A single change; if
several changed, the experiment is a bundle and that is stated here.>

### 2.2 Run set

| Property | Value |
|---|---|
| Class (what kind of task) | <the affected class> |
| Window | <start> to <end> |
| Size (N runs) | <n> |
| Held-out portion | <n> or none |
| Selection rule | <how the runs were selected — must be reproducible> |
| Known composition | <the mix of task types in the set> |

### 2.3 Procedure
1. Evaluate the **baseline** configuration on the run set.
2. Evaluate the **candidate** configuration on the same run set.
3. Compare on the stated metric set and the stated guardrail set.
4. Report the four elements.

### 2.4 Repetitions
<How many times each side was run. Model behaviour is non-deterministic;
a single pass on each side is a comparison of two samples, not of two
configurations.>

### 2.5 Evaluation criteria
<The metrics compared, with their definitions and collection points.>

## 3. Baseline

| Metric | Value | Window | Workload | Notes |
|---|---|---|---|---|
| <metric> | <value> | <window> | <same run set> | <collection point> |

## 4. Delta

| Metric | Baseline | Candidate | Delta | Confidence | Interpretation |
|---|---|---|---|---|---|
| <metric> | <value> | <value> | <±value> | <interval or "sample too small"> | <one line> |

**What this does and does not support.** <The claim the evidence supports,
and the stronger claim it does not.>

## 5. Cost

| Component | Baseline | Candidate | Delta |
|---|---|---|---|
| Inference (tokens / USD) | | | |
| Tool execution | | | |
| Infrastructure | | | |
| Human time (if material) | | | |
| **Evaluation cost (this experiment)** | | | |

**Cost per accepted change:** <baseline> → <candidate>
**Does the improvement pay for itself?** <yes/no/insufficient data, with the
break-even stated if computable>

## 6. Guardrails

| Guardrail | Baseline | Candidate | Breach? | Threshold |
|---|---|---|---|---|
| Defect escape rate | | | | |
| Revert rate | | | | |
| Human intervention rate | | | | |
| Cost per accepted change | | | | |
| Context budget compliance | | | | |
| Approval rubber-stamp rate | | | | |
| Gate failure rate | | | | |
| Total system cost | | | | |

<Any guardrail the change was expected to affect is discussed even if it did
not move.>

## 7. Observations and anomalies

<What happened that was not predicted. Failures, flakiness, side effects,
segments where the effect reversed. A report that lists only what was
expected is a summary, not an experiment.>

## 8. Limits of this evidence

- <what the run set cannot represent>
- <what the sample size does not support>
- <what a field trial would capture that this did not>
- <what would change the conclusion>

## 9. Conclusion and next step

<Proceed / Proceed with changes / Reject / Defer. What was learned that
generalises beyond this proposal? What is the next experiment this suggests?>

## 10. Artefact references

- Run set: <run-set-id>
- Baseline run: <run-id>
- Candidate run: <run-id>
- Proposal: <proposal-id>
- Definition revision: <revision-id>
- Event log window: <event-log-query-ref>
```

---

## Worked example — evaluating a skill revision

```markdown
# Experiment EXP-0011 — Does a revised context-selection trigger reduce `context.insufficient` failures?

- **Experiment id:** EXP-0011
- **Date:** 2026-11-12
- **Author:** Engineering productivity
- **Proposal under test:** PROP-0042 — widen the billing-adapter trigger in `skill.backend-conventions@7` to include the settlement and reconciliation paths
- **Scope of the change:** skill
- **Status:** Complete
- **Decision:** Proceed

---

## 1. Hypothesis

`context.insufficient` failures on billing-adapter tasks will fall, because the
applicable context item is not being selected by the trigger evaluator. The
failure taxonomy counts (27 of 41 failures in the 30-day window) put
`context.insufficient` third but show it clustering on one task class, which
is what the proposed trigger targets.

## 2. Method

### 2.1 Change under test
One change: the trigger expression in `skill.backend-conventions` version 8
adds `services/settlement/**` and `services/reconciliation/**` to the
path set that selects the skill. Nothing else in the configuration differs.

### 2.2 Run set

| Property | Value |
|---|---|
| Class | Tasks whose specification touches `services/billing/**` |
| Window | 2026-09-15 to 2026-10-15 (31 days) |
| Size (N runs) | 214 |
| Held-out portion | 43 (20%) |
| Selection rule | All runs in the window whose specification referenced the billing service path, ordered by task id |
| Known composition | 68% single-service changes, 24% multi-service, 8% schema migrations |

### 2.3 Procedure
1. Evaluate the baseline configuration (`skill.backend-conventions@7`) on the run set.
2. Evaluate the candidate configuration (`@8`) on the same run set.
3. Compare on the metric set and the guardrail set below.
4. Report the four elements.

### 2.4 Repetitions
Each side was run three times over the run set, to bound the effect of model
non-determinism. The reported values are the medians of the three passes.

### 2.5 Evaluation criteria
- **Primary:** `context.insufficient` rate on the run set.
- **Secondary:** acceptance-oracle pass rate; context budget compliance;
  skill invocation outcome rate; cost per accepted change.
- **Guardrails:** the eight standing guardrails, evaluated on the same set.

## 3. Baseline

| Metric | Value | Window | Workload | Notes |
|---|---|---|---|---|
| `context.insufficient` rate | 0.126 | 31 days | run set | run artefact, failure classification |
| Acceptance-oracle pass rate | 0.812 | 31 days | run set | verification runtime |
| Context budget compliance | 0.994 | 31 days | run set | context assembler |
| Cost per accepted change | $4.18 | 31 days | run set | cost attribution |

## 4. Delta

| Metric | Baseline | Candidate | Delta | Confidence | Interpretation |
|---|---|---|---|---|---|
| `context.insufficient` rate | 0.126 | 0.071 | **−0.055** | 95% CI [−0.081, −0.029] | The targeted failure class falls by roughly half |
| Acceptance-oracle pass rate | 0.812 | 0.847 | +0.035 | 95% CI [−0.004, +0.074] | Directionally positive; the interval includes zero |
| Context budget compliance | 0.994 | 0.991 | −0.003 | CI includes zero | Slight increase in over-budget events; monitored |
| Skill invocation outcome rate | 0.881 | 0.903 | +0.022 | 95% CI [+0.004, +0.041] | Improved |

**What this does and does not support.** It supports the claim that the
revised trigger reduces `context.insufficient` failures on billing-adapter
tasks, and that the change did not degrade any guardrail. It does **not**
support a general claim about context-selection quality: the run set covers
one service, one task class, and a 31-day window.

## 5. Cost

| Component | Baseline | Candidate | Delta |
|---|---|---|---|
| Inference | $1,842 | $1,910 | +$68 |
| Tool execution | $311 | $318 | +$7 |
| Infrastructure | $142 | $143 | +$1 |
| **Evaluation cost (this experiment)** | — | $214 | +$214 |
| **Total** | $2,295 | $2,385 | **+$90** |

**Cost per accepted change:** $4.18 → $4.31 (+3.1%)
**Does the improvement pay for itself?** The primary metric improvement is
measurable at this scale. At the observed volume (214 runs/month for this
class), the evaluation cost is recovered after roughly seven months of
application. The improvement's value is therefore primarily in the failure
reduction, not in a short payback.

## 6. Guardrails

| Guardrail | Baseline | Candidate | Breach? | Threshold |
|---|---|---|---|---|
| Defect escape rate | 0.031 | 0.034 | No | > 0.041 |
| Revert rate | 0.019 | 0.017 | No | > 0.028 |
| Human intervention rate | 0.241 | 0.238 | No | > 0.290 |
| Cost per accepted change | $4.18 | $4.31 | No | > $4.60 |
| Context budget compliance | 0.994 | 0.991 | No | > 0.985 |
| Approval rubber-stamp rate | 0.042 | 0.043 | No | > 0.070 |
| Gate failure rate | 0.077 | 0.074 | No | > 0.096 |
| Total system cost | $2,295 | $2,385 | No | > $2,525 |

Context budget compliance moved in the wrong direction by 0.003. The widened
trigger selects the skill more often, which adds context in cases where the
skill is now selected but not needed. The value remains above the threshold,
but this is the metric to watch if the trigger is widened again.

## 7. Observations and anomalies

- The three repetitions diverged more than expected on the primary metric
  (0.071, 0.068, 0.079). The interval reflects that spread.
- The held-out 20% showed a smaller effect than the full set (0.082 versus
  0.071), consistent with mild overfitting to the evaluation set. The held-out
  figure is the more conservative estimate.
- Two runs in the settlement path failed for a different reason entirely —
  a missing local dependency — and were classified `infrastructure`. They
  are excluded from the failure-taxonomy denominator but retained in the
  cost figures.
- One task selected the skill twice in the candidate configuration. This
  appears to be a duplicate-selection defect in the assembler rather than an
  effect of the trigger, and it is logged as a separate finding.

## 8. Limits of this evidence

- The run set is historical and reflects February-to-April billing work. It
  cannot represent settlement work that has not yet been done.
- The sample supports a conclusion about one service, not about context
  selection in general.
- The candidate's higher context usage may be a first-order effect that
  compounds as the trigger widens; this experiment cannot see that.
- A field trial over the following month would capture the effect on work
  that had not previously been selected — the historical set structurally
  cannot.

## 9. Conclusion and next step

**Proceed.** The skill revision reduces the targeted failure class by
approximately half, no guardrail breaches, and the cost increase is within
threshold. The approval class is skill-scope.

Next: a field observation over 30 days of live traffic, watching the context
budget compliance metric specifically, since it is the one that moved the
wrong way.

## 10. Artefact references

- Run set: `runset.billing-adapter.2026-09-15_2026-10-15`
- Baseline runs: `eval.baseline.2026-11-08`, `eval.baseline.2026-11-09`, `eval.baseline.2026-11-10`
- Candidate runs: `eval.candidate.2026-11-08`, `eval.candidate.2026-11-09`, `eval.candidate.2026-11-10`
- Proposal: `PROP-0042`
- Definition revision: `rev.2026-11-11T16:20:00Z`
- Event log window: `eventlog://task?class=billing-adapter&from=2026-09-15&to=2026-10-15`
```

---

## Review checklist

Before submitting:

- [ ] All four elements are present: baseline, delta, cost, guardrail.
- [ ] The baseline was measured on the same workload and window as the candidate.
- [ ] The run set is class-matched, sized, time-windowed, reproducible, and — where the sample permits — held out.
- [ ] Both sides were evaluated with the same criteria, and the repetition count is stated.
- [ ] The guardrail table covers all eight standing guardrails, including those the change was not expected to affect.
- [ ] Cost includes the evaluation's own cost.
- [ ] The limits section states what the run set cannot represent.
- [ ] Observations include what was not predicted; the section is not empty.
- [ ] Every artefact reference resolves to a retained run, proposal, or revision.
- [ ] The decision is one of the four permitted values, and the approval class is named.
- [ ] No metric in this report uses a corpus figure as a target or a threshold.

---

## Related

- ADR-0011 §3 — the four required elements
- `14_QUALITY_TESTING_AND_EVALUATION.md` §7 — the four evaluation levels and the guardrail set
- `14_QUALITY_TESTING_AND_EVALUATION.md` §8 — the metric catalogue and the action thresholds
- `14_QUALITY_TESTING_AND_EVALUATION.md` §9 — baseline establishment
- `15_OBSERVABILITY_COST_AND_FEEDBACK.md` §7 — replay: what is and is not replayed, and the run-set properties
- `09_ORCHESTRATION_STATE_AND_EVENTS.md` §9 — the definition change lifecycle and the approval class by scope
- `18_OPEN_QUESTIONS_AND_RISKS.md` — the hypotheses an experiment may be designed to test
