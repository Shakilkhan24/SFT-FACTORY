# ADR-0008 — Use a relational store for authoritative state and an append-only event log for history

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture
- **Evidence class:** [E2] synthesis of V04, V07, V09, V11, V15
- **Supersedes:** none

---

## Context

The factory must hold authoritative state (tasks, workflows, approvals, configurations) and must also hold a durable history (every run, every decision, every tool call) from which improvement loops, evaluations, and audits are derived.

Sources point in slightly different directions:

- **V04:** Neon Postgres + Functions + Realtime — a managed relational store with serverless functions for orchestration and realtime state push to the UI.
- **V07:** the control plane is the single authoritative state holder.
- **V09:** a declarative definition plus a reconciler; the definition is the source of truth for configuration.
- **V11:** the outer and meta loops require a run-artefact store — every run's inputs, outputs, and costs — as the substrate for improvement.
- **V15:** loops capture logs, and logs are reviewed to improve skills; the automations platform integrates back into the context platform.
- **V05 (1968):** a factory contains "historical information for management and measurement."

The directive requires investigation of relational databases, document storage, object storage, vector databases, message brokers, event-driven architecture, workflow engines, and job queues, and warns: *"Do not choose technologies merely because they are popular... Prefer modularity, replaceability, and minimal operational complexity... The initial implementation should be achievable by a small engineering team."*

## Decision

### 1. Authoritative state: a relational database

Workflow and task state lives in a **relational database** (PostgreSQL-compatible). Rationale:

- The state is highly relational and requires transactional integrity: a task's state, its approval state, its lease, and its artefact references must change atomically.
- Concurrent access is common (the control plane and many workers touch the same rows), and relational transactions make correctness straightforward.
- The directive's "durable workflows over fragile conversational execution" principle requires exactly-once state transitions, which relational transactions express directly.
- A managed offering (V04's choice) keeps the operational burden off a small team.

### 2. History: an append-only event log

Every consequential action is appended to an **immutable event log**, in the same database (or a companion store if volume requires), with a monotonic sequence, a correlation id, the actor, the authority under which it acted, and the outcome. The log is the substrate for:

- The improvement loops (V11's outer/meta loops, V15's log-driven skill improvement).
- Evaluation and replay (ADR-0007).
- Audit (V07's "audit as a by-product").
- Cost attribution (per task, per agent, per model).

### 3. Artefacts: object storage

Large binaries — build outputs, logs, traces, test reports, generated artefacts — go to **object storage**, referenced from the database by URI. The database holds metadata and pointers; it does not hold blobs.

### 4. No vector database at the core

Vector search is used, if at all, as an **optional retrieval aid** over the context/skills corpus and the knowledge store. It is not a source of truth and no correctness property depends on it. Semantic retrieval is a quality enhancement, and treating it as a dependency would make the factory's behaviour depend on an approximate component.

### 5. No general-purpose message broker or event-driven architecture at the core

Work distribution uses a **relational-backed job queue** with leases, in the same database. Rationale: the control plane is a single authoritative component (ADR-0002); the vast majority of coordination is request/response or lease-based work claiming. Introducing a broker would add an operational component and a second source of truth for the smallest team.

A broker becomes justified only if the factory reaches a scale where the queue is a measured bottleneck — and that is an explicit future condition, not a current requirement.

### 6. No general-purpose workflow engine

Workflows are **defined in the factory definition and executed by the control plane's own runner**, with state persisted in the relational store after every step. Rationale: V02's finding is that workflow composition is where failures concentrate. A bespoke workflow engine we own and can test is preferable to an opaque engine whose failure modes we cannot inspect. The engine is a single, well-defined internal component with a versioned definition format.

### 7. Realtime is a UI concern

Live UI updates are served from the control plane (SSE or WebSocket), derived from the event log or a relational change stream. This is a read-model concern and does not affect the persistence model.

## Component-to-technology mapping

| Concern | Chosen approach | Explicitly not chosen | Rationale |
|---|---|---|---|
| Authoritative workflow/task state | Relational DB | Document DB | Strong relational invariants and transactions are required |
| History / audit / improvement substrate | Append-only event log in the same DB | Event broker as primary | History is write-once and read for analysis; a broker is for live distribution |
| Large artefacts | Object storage | DB blobs | Size, cost, lifecycle |
| Work distribution | Relational-backed job queue with leases | General message broker | Simplest correct mechanism at this scale; a broker is added only on measured need |
| Workflow execution | Own runner over declared definitions | Third-party workflow engine | Failure-mode transparency (V02) |
| Context retrieval | Optional vector index over the corpus | Vector DB as core dependency | Approximate component must not carry correctness |
| Live UI | Read model over event log / change stream | — | UI concern only |

## Consequences

**Positive**
- Few components; a small team can operate it.
- Exactly-once state transitions and audit are properties of the store, not of careful coding.
- The improvement loops have a single, coherent data substrate.
- Every dependency is replaceable at the interface level because nothing relies on a vendor-specific query language or delivery semantics.

**Negative**
- A single relational database is a scaling ceiling and an availability dependency. Mitigation: it is a managed service with replicas; the data plane is stateless and can be re-dispatched; recovery replays from the event log.
- A relational-backed job queue has lower peak throughput than a dedicated broker. Accepted at this scale, with an explicit trigger to revisit (measured queue latency as a bottleneck).
- Owning the workflow runner means owning its correctness. Mitigated by ADR-0007's replay evaluation and by versioning workflow definitions.

**Neutral**
- The specific managed provider is an implementation choice; the blueprint specifies the properties required (durability, transactions, JSON support, lease semantics, CDC/Realtime) and lists them in `07_REFERENCE_ARCHITECTURE.md`.
- Object storage, queue, and embedding providers are likewise specified by required properties.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Event-driven architecture with a broker at the core | Adds a second source of truth and an operational component for coordination that leases handle correctly. Retained as a documented future trigger. |
| Document database for workflow state | Weaker fit for the transactional invariants the state model needs; the state model is documented in `09_ORCHESTRATION_STATE_AND_EVENTS.md`. |
| Vector database as the context store | Makes approximate retrieval authoritative. |
| Third-party workflow engine | Opacity of failure modes in the component where V02 shows failures concentrate. |
| Kafka/Durable Functions / Temporal | Higher operational complexity than the directive's small-team constraint permits. Temporal's *semantics* are adopted (durable execution, deterministic replay) even though its runtime is not. |

## Validation

- Every state transition must be transactional and must produce exactly one event-log entry with the same correlation id.
- Replaying the event log for a completed task must reconstruct its state exactly.
- A crash of the control plane must leave no task in a state that cannot be resumed or explicitly failed.
- The queue must demonstrate no task loss and no double execution under lease expiry (at-least-once with idempotent handlers, verified by test).

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-25, D-49, D-59, M-03
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` CP-9, §3 CO-7
- Related: ADR-0001, ADR-0002, ADR-0007
