# ADR-0002 — Adopt the control plane / data plane / access point decomposition

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture
- **Evidence class:** [E1] direct (V07), [E2] synthesis with V02, V04, V09
- **Supersedes:** none

---

## Context

The factory needs a top-level architecture that (a) makes human governance concrete, (b) allows the execution fleet to scale and be replaced independently of governance, and (c) does not require a distributed-systems investment beyond what a small team can operate.

V07 supplies a decomposition with three parts:

- **Control plane** — owns intent, policy, authoritative state, and scheduling.
- **Data plane** — the ephemeral execution fleet.
- **Access points** — typed entry points through which humans enter the control plane, each carrying defined authority.

Corroborating elements from other sources: V02's mission control (a supervisory view), V04's dashboard (the operation surface), V06's board (the work surface), V09's declarative definition + applier (the control plane's configuration substrate), V15's automations platform (the scheduler).

## Decision

The factory is decomposed into:

1. **Control plane** — the single authoritative state holder and decision point. Contains the task graph store, the scheduler, the policy engine, the event log, and the orchestrator. It is the only component permitted to instruct the data plane.
2. **Data plane** — a fleet of stateless workers executing tasks in isolated environments. Workers hold no authoritative state; everything they need is provided to them.
3. **Access points** — a small, enumerated set of typed human entry points: *define intent*, *approve*, *review*, *inspect*, *intervene*, *amend the factory*. Each access point declares the authority it carries. There is no other sanctioned channel from human to factory.

Humans may also act **through the factory** — a designer or GTM team member raising a PR that an agent or the factory then processes (V15's fungibility). That is a distinct path from the access points and is explicitly not a governance channel; the factory treats such contributions exactly as it treats any externally-submitted change.

## Consequences

**Positive**
- Governance is implemented as the topology and API of the system, not as a policy document that can be ignored.
- The data plane can be scaled, replaced, or reimplemented without touching governance. The harness and model are behind control-plane interfaces, so provider change is a configuration matter.
- The control plane is a natural single point for audit logging: every consequential action is a recorded event with its authorising authority.
- The data plane's statelessness means a failed worker is simply re-dispatched from the last recorded state.

**Negative**
- The control plane is a single point of failure and a high-value target. Mitigation: state in a durable transactional store; the data plane stateless; recovery replayable from the event log.
- Centrality creates a scaling concern as the fleet grows. Mitigation: the control plane's write path is small — the vast majority of state changes are the data plane reporting artefacts, not mutating control state.
- "Access points" must be genuinely enumerable and enforced, or the abstraction collapses into "humans can do anything."

**Neutral**
- The exact access point set and their contracts are specified in `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md`.
- Whether the orchestrator is itself an agent or deterministic code is decided by ADR-0004.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Peer-to-peer agents with no control plane | No single place to enforce policy, hold state, or record authority. Unmanageable at fleet scale. |
| Control plane that also executes tasks | Couples the authoritative component to the failure-prone one; a slow or wedged task can block the control plane. |
| Humans operating agents directly (bypassing access points) | This is the "chat with the agent" pattern. It makes governance unenforceable and leaves no durable record of authority. Retained only as a *development-time* affordance, never as a production path. |
| Full event-sourced microservice control plane | Exceeds the operational-complexity budget for a small team. The event log is required, but the control plane does not need to be distributed. |

## Validation

- The data plane must contain no component capable of mutating control-plane state except through a control-plane command.
- Every control-plane command must reference an authorising authority (an access-point identity, or a policy-derived grant) and must be recorded in the event log.
- A control-plane restart must reconstruct its state from the durable store without losing in-flight task ownership.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-25, D-58
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` CO-1, D-5
- Related: ADR-0001, ADR-0004
