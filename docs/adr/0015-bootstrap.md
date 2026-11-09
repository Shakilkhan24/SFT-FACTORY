# ADR-0015 — Bootstrap the factory by hand, then let it take over its own non-critical work

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

A factory that is built by a factory that does not yet exist is a bootstrap problem. The pack resolves
it by splitting the timeline: W0–W4 the factory's own tickets are executed by **humans following a
written manual protocol**, and from W5 the factory takes non-critical tickets on its own repository.

The alternative — building the automation first and only then using it — has the property that the
automation is never exercised against real work, so its bugs are found late and expensively. The
manual-first order means the protocol is written down and proven by hand before anything depends on it.

## Decision

The factory is bootstrapped as a **manual factory**.

1. **W0–W4.** Every ticket is executed by a human (or an AI agent run by a human) following `AGENTS.md`
   and the protocol in pack `07` §3: worktree, context bundle, oracle first, implement, self-review,
   PR from the template.
2. **From W5.** The factory takes **non-critical** tickets on its own repository.
3. **Always human-only, at every tier:** `definition/**`, `migrations/**`,
   `packages/{policy,broker,credentials}/**` and `.github/**` remain R4.

The manual factory is not a throwaway. It is the same loop the factory will run, executed by a human,
which is why the manual artefacts (AGENTS.md, the ticket template, the PR template, the worktree helper,
the context bundler and the two guards) are built in W0 and are the same artefacts the automation uses.

### Scope limits

This ADR does not decide the promotion criteria from manual to automated, nor the L1/L2/L3 promotion
mechanics — those are the path to peak automation (`A2`) and are decided ticket by ticket. It does not
decide which target repositories are eligible for factory-run tickets.

## Consequences

**Positive**
- The protocol is exercised against real tickets from day one, so its failure modes surface while the cost of a mistake is still low.
- The manual artefacts double as the automation's inputs: the same context bundler, the same guards and the same PR template serve both the human and the machine path.
- Productivity begins at week one rather than after the automation is built.

**Negative**
- Everything before W5 is slower than an automated run, and the 8-week plan's throughput assumption depends on the automation arriving on time.
- The manual protocol is a document, not code — it can be followed incorrectly, and there is no machine check that the human followed it.
- The W5 hand-over point is a discontinuity: work that ran one way before will run another way after, and the transition is a fault-isolation problem as much as a scheduling one.

**Neutral**
- The R4 paths are the same in both modes, so the human review floor does not move when the automation arrives.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Build the automation first, then use it on real work | The automation would never meet real work until late in the project, and its defects would be found in the most expensive phase of the plan. |
| Outsource the bootstrap to a contractor | The bootstrap decisions are exactly the ones the owner must own, and the corpus's whole argument is about keeping the authority split intact. |
| Skip the manual phase and run everything by hand informally | An informal protocol is not reviewable and produces no artefacts for the automation to inherit. |

## Validation

- The W0 manual artefacts (`AGENTS.md`, the ticket template, the PR template, the worktree helper, the context bundler, both guards) exist and are exercised by real tickets.
- If the manual phase cannot produce the artefacts the automation needs, the automation's design assumption is wrong and must be revisited before W5, not after.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0015)
- Related: ADR-0014 (definition location), ADR-0016 (merge model)
