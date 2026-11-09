# ADR-0005 — Adopt a layered test strategy with an explicit authorship policy

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Engineering, Quality
- **Evidence class:** [E2] synthesis of V01, V06, V12, V13, V15 (conflict resolved in `04_CROSS_SOURCE_SYNTHESIS.md` D-3)
- **Supersedes:** none

---

## Context

Three sources make claims that appear to conflict.

- **V06 (7:40):** QA should use the right testing libraries bottom-up — a full layered pyramid, not E2E-only. Rationale: fault localisation. An E2E-only suite tells you *that* something broke, not *where*.
- **V01 (38:40):** black-box tests are the single most important thing to start with. And **V01 (36:45)**, citing ThoughtWorks research: TDD with agents *hurt* outcomes.
- **V12 (13:09):** over 90% of tests written by agents are "complete slop."

Read as positions on *which layers to have*, these conflict. Read as positions on *who may author the tests that gate a merge*, they compose — and they resolve into a single rule that neither source states.

The underlying pathology is identifiable: an agent writing tests against an agent-written implementation tends to assert the implementation's behaviour rather than the specification's. The suite then passes while the behaviour is wrong. The result is a green build with no protective value, and a false signal that is worse than no signal.

## Decision

The factory uses a **layered test strategy**, and each layer has an explicit **authorship policy** determining whether it may gate a merge.

| Layer | Role | Authorship policy | Gates a merge? |
|---|---|---|---|
| **Acceptance / black-box / E2E** | Defines "done" for the task; the acceptance oracle | Written against the specification, not the implementation. Trusted by default — human-authored, or generated from the spec by a deterministic generator | **Yes — primary gate.** A task is not done until this passes |
| **Integration / contract** | Boundary correctness, interface compatibility, cross-service contracts | Trusted when human-authored or generated from the interface contract definition. Agent-authored versions require review | Yes |
| **Unit** | Component-level behaviour | **Not trusted by default when agent-authored** (V01 36:45; V12 13:09). Agent-written unit tests must be reviewed before they gate anything, and may never alone satisfy the acceptance criterion | Only after review |
| **Static analysis / type check / lint** | Smells, types, complexity, conventions | Deterministic; not agent-authored | **Yes — always** |
| **Formal verification** | Properties that are genuinely provable | Deterministic; proof-driven | Yes, where the property is in scope |
| **Security scanning** | Known vulnerabilities in code and dependencies | Deterministic | Yes |
| **Standards verifiers** | Conformance to a written standard (V15) | Generated deterministically from a skill; narrow and scoped | Yes — subject to ADR-0003's calibration rule |

### Corollaries

1. **An agent-authored test file is an untrusted artefact.** It is reviewed on the same terms as production code until it has earned trust through review history.
2. **The acceptance oracle must be agent-independent.** If the agent that wrote the implementation also wrote the test that decides acceptance, the oracle is not an oracle.
3. **The pyramid's layering is retained** despite V12's finding, because fault localisation is what makes unattended repair possible — and unattended repair is the factory's core value.
4. **A test suite may be pruned of agent-authored unit tests** without loss of gate strength, if the acceptance oracle is strong and the static/verification instruments are in place.
5. **Verifier calibration is mandatory before any verifier substitutes for human review** (ADR-0003). "The verifier exists" is not sufficient; it must be *demonstrated* to fail when its property is violated.

## Consequences

**Positive**
- The green signal becomes trustworthy, which is the precondition for any autonomy above L2.
- Fault localisation is preserved, so a failing run tells the factory where to look.
- The policy gives a clear default (review agent-authored tests) and a clear path to earning trust.

**Negative**
- Agent-authored unit tests are the most common output of an agent, and this policy makes a large fraction of agent output require review. This directly reduces the throughput that V03/V12/V15 report. This is an accepted consequence of V14's finding, and it is why ADR-0003's default is L2 rather than L3.
- Building an agent-independent acceptance oracle is the highest-value early investment, and it is human work. It is Phase 1 in the roadmap for exactly this reason.
- Calibration corpora must be built — known-violation samples for each property. This is ongoing maintenance, not a one-time cost.

**Neutral**
- The calibration procedure and the violation-injection harness are specified in `14_QUALITY_TESTING_AND_EVALUATION.md`.
- The trusted/untrusted boundary for generated tests is enforced by the same content-tagging mechanism as ADR-0004's untrusted-content rule.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| E2E-only (V01's practical recommendation) | Rejected as the total strategy. It discards fault localisation, which is indispensable for automated repair. Adopted only as the *primary gate*, not the whole suite. |
| Full pyramid, agent-authored (V06 read literally) | Rejected: directly contradicted by V01's TDD finding and V12's slop finding. The layering is kept; the authorship policy is the change. |
| Agent-written tests trusted after passing once | Rejected: passing once demonstrates nothing about a test's discriminative power. Calibration is the bar. |
| No tests, only formal verification | Not currently practical for typical application code. Formal verification is adopted as an additional instrument where a property is provable. |

## Validation

- A merge must be blocked when the acceptance oracle fails, regardless of the rest of the suite passing.
- A test authored by the same agent run that produced the implementation must be flagged and excluded from gating until reviewed.
- Every verifier promoted to gate-bearing must have a calibration report on file.
- The suite must be able to answer, for a given failing test, which layer it belongs to — enforced by a naming and placement convention.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-40, D-41, D-42, D-43, D-45, D-46
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` D-3, CO-2, CP-11
- Related: ADR-0003, ADR-0008
