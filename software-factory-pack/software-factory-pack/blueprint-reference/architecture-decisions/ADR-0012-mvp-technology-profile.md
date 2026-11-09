# ADR-0012 — Fix a minimal technology profile for the initial implementation

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture
- **Evidence class:** [E2] synthesis; [E3] selection within the constraints of the directive
- **Supersedes:** none

---

## Context

The directive requires an investigation of relational databases, document storage, object storage, vector databases, message brokers, event-driven architecture, workflow engines, job queues, containers, Kubernetes, distributed execution, API gateways, model gateways, model routing, caching, and persistent execution state — and then constrains the outcome:

> *"Do not choose technologies merely because they are popular. Prefer modularity, replaceability, and minimal operational complexity. Avoid unnecessary microservices and premature infrastructure complexity. The initial implementation should be achievable by a small engineering team."*

The sources corroborate this: V08's factory works on git, markdown, CI, and an agent harness with no new infrastructure at all. V04's production stack is Neon Postgres + Functions + Realtime plus existing SaaS. V13's stack is GitLab + AWS + a static-analysis tool. All are conventional.

This ADR fixes the **initial** technology profile. It is deliberately a profile of *categories and required properties*, not a vendor lock-in: every selection is behind an interface that can be re-implemented.

## Decision

### The initial profile

| Layer | Selection | Required properties | Deferred / rejected for now |
|---|---|---|---|
| **Authoritative state** | PostgreSQL-compatible managed relational DB (V04's Neon Postgres is the reference instance) | Durable, ACID transactions, JSONB, row-level security, logical replication, PITR, connection pooling | Document DB (ADR-0008) |
| **History / event log** | Append-only event table in the same DB, partitioned by time | Immutable, monotonic sequence, cheap append, efficient range scan | Dedicated event broker (deferred until queue latency is measured as a bottleneck) |
| **Artefacts** | S3-compatible object storage | Immutable, versioned, lifecycle policies, server-side encryption, cheap read/write | Blobs in the DB |
| **Job distribution** | Relational-backed job queue with leases | At-least-once delivery, visibility timeout, idempotent handlers, dead-letter, per-capability concurrency limits | Kafka / SQS-class brokers (deferred trigger: measured queue latency) |
| **Workflow execution** | Own runner over declared definitions | Deterministic replay, versioned definitions, per-step state persistence, resumability | Third-party workflow engine (ADR-0008) |
| **Model access** | Model gateway with routing, budgets, and failover | Provider abstraction, per-task routing, budget enforcement, token accounting, circuit breaker, caching of stable prefixes | Direct provider SDK calls in agents |
| **Tool access** | Tool registry + broker, with MCP as one transport | Per-workflow scopes, per-call policy hooks, health checks, versioning, audit | MCP-only (MCP is a transport, not the registry) |
| **Agent execution (T1)** | Local git worktree | Cheap creation, branch isolation, disposable | — |
| **Agent execution (T2)** | OCI-compatible container on managed container compute (V13's AWS; Modal/E2B-style serverless sandboxes for burst) | Image pinning, no host mounts, resource limits, network policy, per-task credentials | Kubernetes for T2 workloads (premature at this scale) |
| **Agent execution (T3)** | Hardened ephemeral sandbox with per-task credentials and network allow-list | Memory/filesystem isolation, no shared network, credential injection at invocation, full audit, hibernation for idle capacity | — |
| **Kubernetes** | **Not adopted initially** | — | Adopt only if T2 workloads exceed what managed container compute handles, or if scheduling across heterogeneous compute becomes a requirement |
| **Vector database** | **Not adopted as a dependency** | — | Optional retrieval aid over the corpus only; never a correctness path |
| **API gateway** | The control plane's own typed API | AuthN/AuthZ, rate limiting, audit | Separate gateway infrastructure |
| **Caching** | In-process and managed key-value for stable prefixes, tool responses, and read models | Bounded TTL, explicit invalidation, never caching a decision that depends on volatile state | Distributed cache as a core dependency |
| **Persistent execution state** | The control plane's relational state + event log | Survives control-plane restart; a task resumes or fails explicitly | External durable-execution platform (its semantics are adopted; its runtime is not) |
| **CI** | Existing CI provider (GitLab CI in V13's model, GitHub Actions otherwise) | Hermetic, reproducible, per-PR isolation, required checks, artefact retention | Building a CI system |
| **Source control** | Existing Git provider | Branch protection, required reviews, code owners, signed commits where available | — |

### The interface rule

Every selected technology sits behind a factory-defined interface. The blueprint specifies the interface's contract and required properties, not the product. The rule is:

> A component may be replaced without changing the factory definition, the workflows, the agent contracts, or the event schema. Any change that would require such edits is a defect in the interface, not a reason to keep the technology.

### Explicit deferral triggers

Each deferred item has a **measurable trigger** for reconsideration, so deferral is a decision rather than an omission:

| Deferred | Trigger to revisit |
|---|---|
| Message broker | Measured queue latency at p95 exceeding the workflow's deadline, or write contention on the queue tables affecting the control plane's transactional path |
| Kubernetes | T2 workload count or resource diversity exceeding managed container compute's capability, or a hard requirement for scheduling across heterogeneous compute |
| Vector DB | Retrieval precision demonstrably limiting agent task success in a measured way |
| Durable-execution platform | The own runner failing to meet a stated resumability or determinism requirement under load |
| Event streaming platform | Event log volume exceeding what partition-and-archive on the relational store can serve for the required query patterns |

## Consequences

**Positive**
- The component count is small enough for a small team: one database, one object store, one job queue (in the database), one model gateway, one tool broker, one container/sandbox substrate.
- Every selection has a working precedent in the sources, so none is speculative.
- The Kubernetes, broker, and vector-DB decisions are explicitly *deferred with triggers*, which prevents the "premature infrastructure" failure the directive warns about, and prevents them from being forgotten.

**Negative**
- A single relational database is a concentration of risk. Accepted at this scale with managed-service replicas and replay-based recovery.
- Building the workflow runner and the tool broker is real engineering work that a product would otherwise provide. Accepted because V02 shows workflow composition is where failures concentrate, and it must be owned to be understood.
- The container/sandbox substrate choice is provider-sensitive, which is mitigated by the interface rule but not eliminated.

**Neutral**
- Provider selections are implementation choices within the required properties. The reference instances come from the sources (Neon for the database, GitLab/AWS for the platform, Modal/E2B for sandboxes) and are not mandates.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Kubernetes from the start | Directly contrary to the small-team constraint; substantial operational surface before any scale need. |
| Adopting an existing commercial context/skill platform wholesale (V15's Tessl) | Would make the factory dependent on one vendor's definition of a skill and on its product roadmap. The *capabilities* V15 describes are adopted; the dependency is not. |
| Full event-driven microservices | Directly contrary to the directive's minimal-complexity instruction. |
| A general-purpose workflow engine | Failure-mode opacity in the component where failures concentrate (V02). |
| Vector DB as the context store | Makes approximate retrieval authoritative. |

## Validation

- A replaceability test: substituting the database, the object store, the queue implementation, or the model provider must require changes only within that component's adapter.
- The definition of every workflow and agent contract must contain no vendor-specific identifiers or query syntax.
- A dependency-inventory test must confirm that no unmanaged component is running in production outside the declared profile.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-23, D-26, D-30, D-31
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` CP-8, CP-10, D-5, D-8
- Related: ADR-0001, ADR-0006, ADR-0008
