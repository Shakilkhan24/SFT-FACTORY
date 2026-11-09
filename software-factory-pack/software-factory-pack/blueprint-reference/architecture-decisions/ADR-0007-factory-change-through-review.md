# ADR-0007 — All factory changes, including self-improvement, flow through reviewed definition changes

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture, Engineering leadership
- **Evidence class:** [E2] synthesis of V08, V09, V11, V15
- **Supersedes:** none

---

## Context

The directive requires the factory to be capable of continuous improvement while explicitly forbidding autonomous rewriting of critical infrastructure or security policy without validation and approval.

The corpus converges on a mechanism, from four independent directions:

- **V08:** the factory is markdown files; changes to it go through ordinary PRs.
- **V09:** the factory is declared as code; changes are diffs, reviewed, applied.
- **V11:** the harness is the engineered artefact and is privilege-bearing; the meta loop *proposes* changes and a human approves.
- **V15:** loops read logs and improve the skills that define them.

What none of the sources says explicitly is how to make this safe when the improver is an autonomous component. This ADR supplies the missing constraint.

## Decision

### 1. No self-modification outside the definition

No agent, loop, or automation may modify the factory definition, the policy set, the skill corpus, the verifier set, or any other configuration outside the reviewed-change process. This includes the meta-factory loop itself.

### 2. The improvement loop proposes; it does not apply

The meta loop's output is a **change proposal** — a structured diff with the evidence that motivated it, the expected effect, the measurement plan, and a rollback plan. A human reviews and merges it, exactly as any other change.

### 3. Four scopes, four approval bars

| Scope | Changes | Evidence required | Approval |
|---|---|---|---|
| **Run** | One execution | — | Automatic; bounded by the turn budget |
| **Skill** | One skill's content | Log evidence from ≥N runs; no regression against the skill's benchmark | Automatic if the change is additive and below a risk threshold; otherwise reviewed |
| **Workflow** | The composition of skills into a workflow | Batch pattern analysis across many runs | **Human review required** |
| **Harness** | Agent configuration, tool surface, model routing, context assembly, policy | Systemic analysis over a long window; an explicit experiment design | **Human review required, always** |

A change at the *workflow* or *harness* scope that would alter the *policy* set or the *autonomy levels* is additionally constrained by ADR-0003's promotion bar: it requires the calibration evidence described there.

### 4. Batch evidence, never single-run

An improvement proposal must be grounded in **batch evidence** across many runs. A proposal derived from a single failure is rejected as noise-fitting — and, deliberately, as a defence against a single poisoned run manipulating the factory.

### 5. Every change is evaluated, versioned, and rollbackable

Before promotion, a candidate change is evaluated against the historical run set (replay) and, where the change is behavioural, against a shadow or flag configuration. Every change carries a version, an author, an evidence link, and a rollback procedure. A change that degrades a guardrail metric is reverted automatically.

### 6. The definition is the only writable surface

Consistent with ADR-0001, the runtime control surface is read-and-request only. This closes the loop: the improvement proposal is submitted *through* the same mechanism as a human's change, so there is no privileged path.

## Consequences

**Positive**
- The factory improves through the same disciplined process that improves the product — a single governance model, not two.
- The most dangerous capability in the system (changing what agents are permitted to do) is the most tightly controlled.
- Every improvement is attributable, reversible, and measurable.
- The mechanism is uniform across product code and factory code, so engineers already know it.

**Negative**
- Improvement is slower than autonomous self-modification would be. Accepted deliberately: the failure mode of autonomous self-modification (V14's slop, applied to the rules themselves) is not recoverable.
- Requires the historical run set to exist and to be replayable. This makes the run-artefact store a hard prerequisite, not an optional analytics feature.
- The "automatic if additive and below a risk threshold" case at *skill* scope requires a defensible threshold, which must be set per organisation and will need revision.

**Neutral**
- The change-proposal schema is specified in `09_ORCHESTRATION_STATE_AND_EVENTS.md`.
- The evaluation and replay procedure is specified in `14_QUALITY_TESTING_AND_EVALUATION.md`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Agents modify skills and harness directly at runtime | Rejected: the failure modes compound (a degraded skill produces degraded runs, which produce more degraded skill proposals). Also bypasses every control the blueprint relies on. |
| Fully autonomous meta-factory with periodic human review of outcomes only | Rejected: outcome review cannot detect a subtly corrupted rule that still produces passing results — the exact pathology of V01's and V12's findings. |
| No self-improvement at all | Rejected: a factory that cannot improve is a static automation, which the corpus unanimously rejects (V11's outer loop, V15's compounding gains, V01's kaizen). |
| Separate "improvement repository" | Rejected: splitting the artefacts means splitting the review, and the harness is more privilege-bearing than the product code. One definition, one review path. |

## Validation

- An automated test must demonstrate that an agent cannot write to the definition, policy, skill, or verifier stores — by attempting it through every available tool path.
- A change proposal lacking batch evidence must be rejected by the review interface.
- Replay evaluation must run automatically for every harness-scope proposal, and a proposal that fails the replay must not be mergeable.
- An automatic revert path must exist for any promoted change, and a guardrail breach must trigger it.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-20, D-26, D-57, D-50, D-24
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` D-6, CO-5, CP-5
- Related: ADR-0001, ADR-0003, ADR-0008
