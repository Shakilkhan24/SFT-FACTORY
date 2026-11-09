# ADR-0001 — Adopt a declarative factory definition reconciled by an applier

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture
- **Evidence class:** [E2] cross-source interpretation (V09 primary, V07 topology, V08 practice)
- **Supersedes:** none

---

## Context

The factory's own configuration — which agents exist, which models they use, which tools they may call, which workflows exist, what permissions they hold, how work is scheduled — must itself be definable, reviewable, and changeable without a redeploy.

Two approaches appear in the sources:

- **Declarative definition (V09, 19:41).** The factory is declared as data, in the manner of Terraform. Changes are diffs, reviewed as PRs, applied by a reconciler. This gives reviewability, repeatability, and auditability.
- **Operational control surface (V02 mission control, V04 panels, V06 board, V15 dashboards).** The factory is operated through a live surface where humans observe and adjust.

V08 supplies a third, lighter variant: the factory is a set of markdown files in a repository, changed through ordinary PRs.

The two are not actually in conflict — they answer different questions. But adopting the operational surface *without* the declaration loses reviewability, and adopting the declaration *without* the operational surface leaves humans blind during operation.

## Decision

The factory is defined by a **declarative factory definition** held in a version-controlled repository, and reconciled to reality by an **applier** running in the control plane. The operational dashboard is a **read-and-request surface only**.

**The hard rule:** the control surface may observe, pause, cancel, escalate, and *propose* changes, but it may never write to the definition directly. Any change — including one initiated by a human during an incident — lands in the definition as a reviewed change.

## Consequences

**Positive**
- Every factory change, including permission changes, is visible in a diff and subject to review. Privilege escalation cannot happen silently.
- The definition is the single source of truth for the factory's shape; the dashboard is a projection of it.
- The applier pattern gives idempotence and self-healing: a crashed worker or deleted sandbox is reconverged automatically.
- The factory can be instantiated in a new environment from the definition alone.

**Negative**
- Two representations exist and must be kept consistent; the read-only rule is a discipline, not a mechanism.
- A reconciler, a schema, and drift detection must be built. This is real work.
- The declaration can be wrong, and a reconciler will faithfully and promptly apply a wrong declaration at scale. Mitigation: the declaration is reviewed, and the reconciler applies changes with staged rollout where supported.

**Neutral / to be designed**
- The exact schema is specified in `09_ORCHESTRATION_STATE_AND_EVENTS.md`.
- Drift detection is required; the reconciler must report divergence rather than only correct it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Dashboard as the sole configuration store (V02/V04) | Loses reviewability and auditability. Configuration drifts into UI state and cannot be diffed or reproduced. Unacceptable for a system that holds credentials and permissions. |
| Hand-maintained markdown as the definition (V08) | Excellent for the *content* of the factory (skills, instructions) and adopted as the repository-local context tier, but insufficient as the whole definition: it cannot express reconciliation, drift, or derived state. |
| No declaration; build factory changes directly in code | No review boundary for the most privileged artefacts in the system. |

## Validation

The rule is testable: attempting to mutate factory configuration through the control-surface API without a corresponding reviewed change in the definition must be rejected. This is an explicit acceptance test for the control plane's API.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-26, D-57, D-58
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` D-5, CO-1
- Related: ADR-0002, ADR-0004
