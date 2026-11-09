# ADR-0010 — Adopt dependency-driven task topology with a chunkability rule for fan-out

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture
- **Evidence class:** [E2] synthesis of V03, V10, V12, V13 (conflict resolved in `04_CROSS_SOURCE_SYNTHESIS.md` D-2)
- **Supersedes:** none

---

## Context

The corpus contains both a strong pro-parallelism position and a strong anti-parallelism position.

- **V03, V12:** agent fleets scale throughput; work is decomposed and fanned out; model tiers manage cost.
- **V10:** workers should run **in sequence with fresh context**, not as a swarm — "more fresh context and kind of fresh head" (13:03). A shared context across dependent stages is a liability.
- **V12:** "sub agent orchestration is basically astrology for vibe coders" (22:43) — spawning agents without justification is unjustified. And yet V12 runs a fleet.
- **V13:** role-specialised agents, each single-responsibility.

The positions are not actually contradictory; they are answers to different questions. V10 is about **context sharing between dependent stages**; V12 is about **unjustified spawning**. The synthesis needs one rule covering both.

## Decision

### 1. Topology is chosen per dependency edge, not per task

A task is represented as a **task graph**: nodes are work items, edges are dependencies. Each edge is classified as **independent** or **dependent**.

- **Independent edge → fan-out permitted.** The work items may execute concurrently, in separate isolated environments.
- **Dependent edge → sequential, with a fresh context.** The downstream item receives the upstream output as a typed artefact at a context boundary; it does not inherit the upstream agent's context, reasoning, or tool history.

### 2. The chunkability rule

Fan-out is permitted **only** where all four conditions hold. If any fails, the work stays inline.

| # | Condition | Test |
|---|---|---|
| 1 | **Independently specifiable** | The work item can be described completely without the sibling's output |
| 2 | **Verifiable in isolation** | A named check can determine whether the work item succeeded, without the siblings |
| 3 | **No cross-cutting coordination** | The work item does not require coordinating with siblings mid-execution (no shared schema change, no coupled API edit, no shared file) |
| 4 | **Cheaper separately than inline** | The coordination overhead (context assembly, artefact passing, merge risk, review overhead) is less than the benefit of parallelism |

Condition 4 is the one most often skipped, and it is why V12's objection lands. A rule with three conditions would permit fan-out whenever work is "parallelisable" in the trivial sense, which is where coordination cost exceeds benefit.

### 3. The planner is a component, not a prompt

The decomposition that produces the task graph is performed by a **planner** whose output is a reviewable artefact — the graph, with each edge's topology classification and the justification for each fan-out decision recorded. The planner is itself subject to the quality gate: a task graph is an artefact that can be reviewed, and the classification is auditable.

This directly addresses V12's correlated-failure risk: if the decomposer is wrong, N workers produce N consistently wrong implementations. Making the decomposition a reviewable artefact is the mitigation.

### 4. Model tiering follows context scope, not prestige

Where a workflow needs multiple model tiers (V03, V12), the tier is selected by the **scope of context and judgement required**, not by status:

| Tier | Assigned to | Context scope | Judgement scope |
|---|---|---|---|
| **Manager** | Planning, decomposition, escalation | Whole task graph, all requirements, all constraints | Cross-cutting; affects many workers |
| **Coordinator** | Sequencing, dependency handling, re-planning on failure | Sub-graph it manages | Bounded to the sub-graph |
| **Worker** | Executing one bounded work item | Exactly the work item's specification and its inputs | Narrow; checkable by a verifier |
| **Reviewer** | Judging a work item's output | The output, the specification, the relevant standards | Scoped to the properties being judged |

The rule is that **a worker never receives more context than its work item requires** — which is V10's fresh-context principle combined with V12's tiering, and it is also what makes cost predictable.

### 5. Roles are specifications, not deployments

The agent catalogue (V13's roles, V04's runner/reporter/panel) defines **role specifications**. A role may be realised as:
- a dedicated agent with its own prompt, tools, and model; or
- a stage in a general-purpose agent's workflow, given a scoped context and a narrowed tool set.

Roles that are performed identically, with identical tools and context, are **merged** rather than deployed separately. New roles are created only when a role's responsibilities genuinely differ in tools, authority, context, or evaluation — never to increase the agent count.

## Consequences

**Positive**
- One rule covers both V10's context-hygiene concern and V12's proliferation concern.
- The chunkability rule is testable, and the classification is recorded, so fan-out decisions can be audited after the fact.
- Fresh-context workers give bounded, predictable token cost and simple retry semantics.
- Reviewing the task graph catches decomposition errors before N workers amplify them.

**Negative**
- The planner becomes a critical component and a single point of failure for a whole task graph. Mitigation: the graph is reviewable, and a failed planner run is a failed task, not a bad fleet of workers.
- The chunkability test requires judgement and cannot be fully mechanised. It is enforced by the planner's own review and by the recorded justification.
- Sequential dependencies reduce wall-clock throughput relative to a fully parallel fleet, deliberately.

**Neutral**
- The task graph schema and topology classification fields are specified in `09_ORCHESTRATION_STATE_AND_EVENTS.md`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Always-parallel fleet (V03, V12 literally) | Rejected: coordination cost and correlated decomposition failure. Retained for the genuinely embarrassingly-parallel case (e.g. a conformance sweep over 500 files), which the chunkability rule admits. |
| Always-sequential (V10 literally) | Rejected as a total rule: it discards real parallelism on independent work and increases wall-clock time without improving quality for independent items. |
| Swarm without a recorded topology (sub-agents spawned ad hoc) | Rejected: unauditable, unbounded, and exactly V12's objection. |
| Fixed role-to-agent one-to-one mapping (V13 literally) | Rejected as a deployment constraint: it multiplies agents without necessity. Roles become specifications; deployments are decided per workflow. |

## Validation

- The planner output must record a topology classification and a chunkability justification for every fan-out edge.
- A test must demonstrate that a dependent edge never shares context between stages — the downstream context contains the upstream artefact and nothing else from the upstream run.
- A test must demonstrate that role merging is applied where role specifications are identical.
- Fan-out decisions must be reviewable after the fact: the recorded justification must state which of the four conditions failed for any edge that stayed inline.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-16, D-29, D-32, D-28, D-27
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` D-2, CO-5
- Related: ADR-0002, ADR-0008
