# ADR-0021 — Three oracle routes; an agent may not author the oracle it implements

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The single most valuable property of the factory is that its verification is *independent* of the
thing it verifies. If the same agent writes the fix and the test that decides the fix is correct, the
gate measures the agent agreeing with itself — which is exactly the failure the whole blueprint is
built to avoid.

Independence has a cost: the oracle must be authored by someone (or something) that has not seen the
implementation. With a solo owner, that "someone" is expensive. The routes below buy independence at
the lowest sustainable cost.

## Decision

There are **three oracle routes** in v1.

| Route | Who authors | Where it is trusted |
|---|---|---|
| **R-H** | a human | protected path |
| **R-G** | a deterministic generator, for a small set of criterion kinds | reproducible and reviewable |
| **R-A** | an agent, in a **separate run before the implementer** | `untrusted` until the owner approves it **inside the plan approval** |

Every criterion declares `expectedBefore: fail | pass` — `fail` for new behaviour and bug fixes,
`pass` for refactors. Admission runs the oracle on the base commit and **refuses on mismatch**, which
is what makes a criterion meaningful rather than decorative.

Criteria may be `visible` or `holdout`.

### Scope limits

This ADR does not decide the criterion kinds that R-G can generate (T-0.01 and the later oracle
tickets do), nor which criteria are holdout, nor the metrics that later decide whether R-A agents may
be trusted more broadly.

## Consequences

**Positive**
- R-G is reproducible and reviewable — the same specification always produces the same oracle, so a reviewer can re-run it and get the same answer.
- R-A is the only route that scales with agent throughput, and the separate-run rule preserves its independence while making it cheap.
- The `expectedBefore` declaration makes a criterion self-checking: a criterion that passes before the change was written was never testing the change.

**Negative**
- R-H does not scale. Every criterion the owner must write personally is a criterion that does not get written.
- R-A consumes a run and a review for every criterion, so it is the most expensive route per criterion even though it is the cheapest per owner-minute.
- The base-commit admission run doubles the oracle's execution cost: it runs once before the change and once after.
- The `untrusted` status of an R-A oracle means it cannot gate a merge on its own, which will feel slow to an owner under time pressure.

**Neutral**
- The oracle's provenance records its route, so a reviewer can judge the independence rather than assume it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One route for all oracles | Any single route has a cost the plan cannot afford at one end or the other: human authoring does not scale, and agent authoring without a separate run destroys independence. |
| Let the implementer author its own tests, plus a human review | This is the status quo the blueprint exists to replace; the gate would measure self-consistency. |
| Derive the oracle from the implementation | Produces a test suite that passes by construction and cannot detect a misread requirement. |

## Validation

- The oracle-independence guard rejects a PR from an implementer branch that modifies an oracle path, and the oracle's provenance record shows `implementationRunId: null` at construction.
- If R-H turns out to be the dominant route in practice, the cost of independence is too high for the plan and this ADR is revisited — the property is not quietly dropped.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0021)
- Related: ADR-0005 (blueprint oracle independence), ADR-0014 (definition location)
