# ADR-0017 — Two executor kinds, and only the Worker uses the harness

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

Some stages of a workflow need to *reason* and some need to *act on a codebase*. An earlier design
implicitly treated both as "call a model". That conflates a small, bounded reasoning step with an
agent that can read and write arbitrary files, and it widens the attack surface of every workflow.

The pack's decision narrows this to two executor kinds and, more importantly, restricts *which stage*
may use the powerful one.

## Decision

There are **two** executor kinds.

| Kind | What it is | Who may use it |
|---|---|---|
| `completion` | a single structured model call through the gateway | Refinement, Planner, Triage, Reviewer, Security-Reviewer |
| `harness` | a coding agent inside the T2 sandbox | the **Worker**, and Workflow-D / C fixers only |

Every model call goes through the gateway. There is no third kind, and no stage may use the `harness`
because it happens to find it convenient — the set of harness-eligible stages is part of the definition,
and the definition is owner-owned (ADR-0014).

### Scope limits

This ADR does not decide whether a read-only tool loop should be permitted for stages that need to
explore a repository beyond the assembled context — the pack records that as a revisit trigger. It does
not decide which model a completion uses (that is ADR-0023, configuration only).

## Consequences

**Positive**
- The attack surface of the dangerous executor is bounded to the one stage that genuinely needs code execution.
- The `completion` kind is cheap, fast and deterministic in shape — a single structured call is far easier to review than an agent loop.
- Provider portability: a completion is a plain API call and moves between providers trivially.

**Negative**
- A stage that outgrows a single structured call has no path forward other than escalation. The Planner and Reviewer will eventually need repo exploration that a single call cannot provide.
- The boundary is a policy that must be enforced at the definition level, not a type — a misconfigured workflow could try to use `harness` for a Reviewer unless the registry checks it.
- Restricting stages keeps the agent-run count low, which is good for the budget but means a workflow that would benefit from parallel exploration cannot have it.

**Neutral**
- The executor kind is a property of the workflow definition, so it is visible in the same place as every other definition change and is reviewed the same way.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One executor kind (harness everywhere) | Maximally uniform, and it makes every stage as dangerous as the most dangerous one — the reviewer's ability to reason about a stage collapses. |
| One executor kind (completion everywhere) | The Worker cannot implement a change at all, so the factory cannot build software. |
| Per-stage executor kinds chosen freely by the workflow author | That is an unreviewed widening of the attack surface expressed as a convenience. |

## Validation

- The capability registry rejects a workflow that requests the `harness` kind for a stage outside the permitted set, and the route-inventory test covers it.
- If more than one stage genuinely needs repository exploration, the revisit trigger fires and a new bounded read-only loop kind is designed rather than widening `harness`.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0017)
- Related: ADR-0020 (isolation), ADR-0023 (routing)
