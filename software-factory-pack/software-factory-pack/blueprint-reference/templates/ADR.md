# Template — Architecture Decision Record (`ADR`)

**Use when:** recording an architectural decision that constrains the factory's shape, its dependencies, its trust boundaries, or its operational cost.
**Authority:** ADR-0001 (declarative factory definition) and ADR-0007 (factory changes go through review) are the sources of truth for how decisions are made and changed.
**Submission:** an ADR is a **definition change** and is reviewed at the approval class matching its blast radius — a decision touching policy or autonomy is a **security-scope** decision.

---

## Authoring rules

1. **An ADR records a decision, not a document.** The output is a choice with consequences, not a description of a design. If no choice was made, write a note elsewhere.
2. **The Context section states the forces, not the conclusion.** The reader should be able to reconstruct why the decision was difficult without reading the Decision section.
3. **Every claim is evidence-classed.** `[E1]` direct transcript evidence, `[E2]` cross-source synthesis, `[E3]` engineering judgement, `[E4]` unresolved hypothesis. A decision that rests on no corpus evidence says so plainly.
4. **Alternatives are mandatory and must be genuinely plausible.** An ADR with one alternative is a justification, not a decision record. A rejected alternative that would obviously never have been considered is noise; remove it and say why it was never a candidate.
5. **Consequences include what is being given up.** A consequences section with only positives is a sales document. The negative section is where the next reviewer learns the most.
6. **Validation states how the decision could be shown wrong.** If nothing could falsify the decision, it is a preference, not an engineering decision.
7. **No dead ADRs.** A superseded ADR is edited to point at its successor and its status is changed. It is not deleted, and it is not left claiming to be in force.
8. **An ADR states what it does not decide.** Scope limits belong in the Decision section, so a later reader does not over-read the decision.

---

## The template

```markdown
# ADR-NNNN — <the decision, stated as a choice>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated | Rejected
- **Date:** <YYYY-MM-DD>
- **Decision owners:** <team-or-person>            # accountable for the decision
- **Evidence class:** [E1] … | [E2] … | [E3] … | [E4] …
- **Supersedes:** none | ADR-NNNN@<version>

---

## Context

<The forces that made this a decision rather than a default. What was true
about the system, the constraints, the evidence, and the pressures. Name the
disagreements in the evidence. Where the corpus is silent, say so — silence
is a finding.>

## Decision

<The choice, in the active voice: "The factory uses X." or "The factory
does not do Y.">

### 1. <Sub-decision>
### 2. <Sub-decision>

### Scope limits
<What this decision explicitly does not settle, and where that is decided.>

## Consequences

**Positive**
- …

**Negative**
- …

**Neutral**
- …

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| … | … |

## Validation

- <the check, test, or measurement that demonstrates the decision works>
- <the condition that would show the decision was wrong>

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` <IDs>
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` <IDs / sections>
- Related: ADR-NNNN, ADR-NNNN
```

---

## Worked example — an ADR in the blueprint's own style

> **This is an illustration, not a decision of this blueprint.** The example below is a fictional ADR (ADR-0013) written to demonstrate the format and the depth of argument expected. The real decisions are ADR-0001 … ADR-0012 in `architecture-decisions/`. The *substance* of the example — oracle independence — is real and is actually carried by ADR-0005 and `14_QUALITY_TESTING_AND_EVALUATION.md` §3; only the ADR itself is illustrative.

```markdown
# ADR-0013 — Treat the acceptance oracle as a separately authored, agent-independent artefact

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture, Engineering leadership
- **Evidence class:** [E2] synthesis of V12 (test authorship), V14 (regression tests as proof), V15 (specificity); [E3] engineering judgement on oracle independence
- **Supersedes:** none

---

## Context

Three sources independently indicate that generated tests are the weakest link
in agentic development.

- **V12 (13:09)** reports that "over 90% of tests the agent writes are complete
  slop" — tests that pass without asserting the behaviour that matters. This
  is an [E1] claim from one source with no published corpus; it is directional
  evidence, not a rate we plan against.
- **V14** treats a regression test as the artefact that proves a bug was fixed,
  and reports a pipeline where repairs are validated by the failure mode
  actually recurring.
- **V15** argues that specificity is the ruler of skill quality, and that
  verifiers can be generated from well-specified properties.

The sources converge on a problem but not on a mechanism. None of them states
that the *authoring* of the acceptance test must be separated from the
*implementation* of the change. V12 identifies a symptom (slop); the corpus
offers no rule about how to prevent it.

The failure mode this creates in a factory is precise: if the same agent
writes the fix and the test that decides the fix is correct, then the gate
passes whenever the agent's mental model is self-consistent. The gate measures
the agent agreeing with itself. V02's finding — that failures concentrate in
workflow composition rather than in reasoning — implies this class of false
signal would be systemic rather than occasional.

## Decision

The factory separates the **acceptance oracle** from the implementation.

### 1. The oracle is constructed before the implementation

A task's acceptance criteria are expressed as a checkable oracle during
specification, before any implementation stage runs. The oracle's construction
is a distinct stage with its own artifact, not a side effect of planning.

### 2. The oracle is agent-independent

The oracle is authored against the specification, not the implementation, by one
of two routes:

- a **deterministic generator** derives tests from a structured specification
  (a contract file, a schema, a behaviour table) — preferred, because it is
  reproducible, reviewable, and free of implementation bias;
- a **human** authors the oracle for properties a generator cannot express.

An agent may not author the oracle for the change it implements. Where an agent
proposes additional tests beyond the oracle, those tests are additions, not
substitutes — they never replace the oracle.

### 3. The oracle is bound to the task, not the implementation

The oracle's artefact is hashed and pinned at construction time, with
`implementationRunId: null` recorded in the oracle's provenance. A later
replacement of the oracle is an approval-class event, not a silent edit.

### 4. The oracle precedes the gate

The acceptance oracle is a merge-gate component at every blast-radius tier.
There is no tier at which an unoracled change merges.

### 5. The independence rule is enforced, not requested

The oracle is authored by a deterministic generator or by a human, and its
provenance is recorded in the verification report. The reviewer's view shows
the oracle's author, so a reviewer can judge the oracle's independence rather
than assume it.

## Scope limits

This decision does not settle which verification layers beyond the acceptance
oracle are mechanisable in a given domain; that is an open question
(`18_OPEN_QUESTIONS_AND_RISKS.md` Q-03). It also does not require that every
task have an agent-authored test suite — only that the tests deciding "done"
are agent-independent.

## Consequences

**Positive**
- The acceptance gate stops being a measure of the implementer's self-consistency.
- A regression test genuinely fails against the pre-fix revision, because it
  was written without knowledge of the fix.
- The oracle becomes the durable artefact of a task: it survives the run,
  supports replay, and is the unit the improvement loop can refine.
- Reproducibility improves — the oracle is reproducible from the specification
  even when the implementation is not.

**Negative**
- The oracle adds a step and consumes budget before any code is written. This
  is a real lead-time cost that must be measured, not assumed away.
- Deterministic oracle generation requires structured specifications. Where the
  specification is prose, a human must write the oracle, which is a scarce
  resource. This is the primary argument against autonomy promotion, and it is
  why the calibration floor is tied to oracle coverage.
- An agent cannot easily repair a broken oracle. Under ADR-0005, a repair that
  weakens the oracle is rejected; the oracle must be repaired by its author
  class.

**Neutral**
- The oracle's schema and the three construction routes are specified in
  `14_QUALITY_TESTING_AND_EVALUATION.md` §3.
- The authorship-policy gate is specified in `12_END_TO_END_WORKFLOWS.md` §2.1,
  step 5.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Let the implementer author its own acceptance tests | This is the status quo that V12's finding describes. The gate would measure self-consistency rather than correctness. |
| Require a human to author every oracle | Correct but unscalable, and it places the whole oracle burden on the scarcest resource at exactly the point where volume is highest. Retained as the fallback route for properties generators cannot express. |
| Generate the oracle from the implementation | Produces a test suite that passes by construction. It cannot detect a misunderstanding of the requirement, which is the failure mode that matters most. |
| Reuse the repository's existing test suite as the oracle | The existing suite predates the change and does not decide whether the change is correct. It is a regression check, not an acceptance oracle. The two are complementary, not substitutes. |
| Allow the implementer to author the oracle where it is "obviously" trivial | "Obviously" is a judgement made by the agent whose independence is in question. The exception cannot be administered and would become the norm. |

## Validation

- The oracle's provenance record must show `implementationRunId: null` at
  construction; a non-null value indicates the oracle was authored after
  implementation and is a submission blocker.
- The regression test for a bug fix must fail against the pre-fix revision
  and pass against the fixed revision, as an automated check.
- Oracle construction must be measurably present in the event log for every
  task that reaches `VERIFYING`; a task with no oracle event is a gate failure.
- If oracle coverage proves low in practice — because structured specifications
  are rare — this decision's scope is wrong and must be revisited rather than
  quietly relaxed.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-38, D-41, D-47, M-06
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` CP-5, CO-3, D-3
- Related: ADR-0003, ADR-0005, ADR-0011
```

---

## Review checklist

Before submitting:

- [ ] The title states a decision, not a topic.
- [ ] Context states the forces and names the evidence; it does not state the conclusion.
- [ ] Every factual claim carries an evidence class, and where the corpus is silent, the silence is stated.
- [ ] At least two genuinely plausible alternatives are recorded with reasons for rejection.
- [ ] Consequences include at least one negative and one neutral.
- [ ] Scope limits are explicit.
- [ ] Validation states both a check that demonstrates success and a condition that would falsify the decision.
- [ ] Every referenced ADR, evidence ID, and document path resolves.
- [ ] The status and supersession fields are correct, and no superseded ADR still claims to be in force.
- [ ] The approval class matches the decision's blast radius — policy or autonomy decisions require the security-scope class.

---

## Related

- `architecture-decisions/` — the twelve decisions this blueprint already carries
- ADR-0001 — the factory is a declarative definition; a decision is a change to it
- ADR-0007 — every definition change goes through review and a replay evaluation
- `14_QUALITY_TESTING_AND_EVALUATION.md` §3 — the acceptance oracle
- `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` §9 — governance of the factory itself
