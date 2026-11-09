# ADR-0009 — Adopt a two-tier context model: repository-local by default, central for organisation-wide policy

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture, Engineering leadership
- **Evidence class:** [E2] synthesis of V08, V09, V13, V15 (conflict resolved in `04_CROSS_SOURCE_SYNTHESIS.md` D-4)
- **Supersedes:** none

---

## Context

Sources disagree about where an agent's context lives.

- **V08:** a software factory is a bunch of markdown files in the repository; `agents.md` carries the context.
- **V13:** repository-local `CLAUDE.md` files.
- **V15:** a central context platform with a skills registry, organisation-wide policies, and estate-wide inventory of stale/duplicate context.
- **V09:** a central data plane holding project knowledge.

The tension is real: local context stays close to the code it describes, but duplicates and diverges; central context enables organisation-wide standards but drifts from individual codebases silently.

## Decision

### 1. The partition rule

**Context whose truth is a property of the repository lives in the repository. Context whose truth is a property of the organisation lives centrally.**

| Repository-local tier | Central tier |
|---|---|
| Build and test commands | Security and compliance policy *(non-overridable)* |
| Code conventions and style | Organisation-wide standards (e.g. brand, accessibility) |
| Architecture notes and ADRs | Shared integration contracts and API conventions |
| Domain vocabulary and DDD terms | Approved skill and playbook library |
| Local runbooks | Engineering knowledge and decision records |
| Repository-specific verification expectations | Mandatory context requirements per repository (policy) |

### 2. Precedence

1. **Central security and compliance policy always wins.** A repository cannot opt out. This is a deliberate, explicit exception to locality, and it is the mechanism by which V15's governance policies bind every repository.
2. Otherwise, **repository-local context overrides central context** for repository-scoped concerns.
3. Where neither covers a concern, the agent proceeds under the general agent policy and flags the gap.

### 3. Precedence is resolved in one place, deterministically

The **context assembler** (ADR-0004's deterministic layer) computes the effective context for a task by applying the precedence rules. It is a deterministic function of (central policy, central context at the applicable scope, repository-local context, task type). The assembly result is recorded in the run artefact, so the exact context used for any run is recoverable — a prerequisite for diagnosing a bad run and for replaying it.

### 4. Promotion and demotion are explicit operations

- **Promotion:** a repository-local context artefact that is found to be repository-independent may be proposed for centralisation. Promotion is a reviewed change (ADR-0007). The local copy becomes a pointer to the central artefact.
- **Demotion:** the reverse, when a central artefact proves to be repo-specific.
- Both operations are surfaced by the **context inventory**, which continuously detects outdated, duplicate, and stale context across the estate.

### 5. Context is a privilege-bearing artefact

Any context artefact that changes what an agent is permitted or instructed to do is treated as a security-relevant change: it requires the same review as a policy change, it is versioned, and its provenance is recorded.

## Consequences

**Positive**
- Repository context cannot drift from the code without a visible diff — the property V08 provides and that central-only approaches lose.
- Organisation-wide standards are enforceable and centrally improved once, rather than copied N times.
- The precedence rules give a single deterministic answer, so context selection is auditable.
- The promotion/demotion cycle turns V15's duplicate detection from a report into a mechanism.

**Negative**
- Two places to look for context, and a precedence rule to understand. Mitigated by the context assembler producing one effective context per task.
- The context inventory requires scanning the estate, which is a background job with a cost.
- Promotion and demotion are process, not automation, and require someone to decide.

**Neutral**
- The context item schema and the assembler's algorithm are specified in `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Central only (V15's platform model, V09) | Context drifts from code silently; the "stale" problem V15 itself inventories. Rejected as the sole model. |
| Local only (V08, V13) | Duplication across repositories; no organisation-wide standard; no central improvement. Rejected as the sole model. |
| Symmetric merging with no precedence | Non-deterministic or ambiguous resolution; the agent may load both and the wrong one wins. Rejected. |
| Runtime-fetched context with no version pinning | Non-reproducible runs; a context change silently alters behaviour of an in-flight task. Rejected: context is pinned per run. |

## Validation

- The context assembler must be a pure, deterministic function, unit-tested against a precedence matrix.
- Every run must record the resolved context (identifiers and versions), enabling exact replay.
- A test must demonstrate that a repository cannot override a central security policy.
- The inventory must report stale and duplicate context, and the count must be non-increasing over time as a tracked metric.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-19, D-20, D-21, D-22, D-56
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` D-4, CO-4, CO-6
- Related: ADR-0001, ADR-0004, ADR-0007
