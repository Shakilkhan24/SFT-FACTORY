# ADR-0006 — Adopt tiered execution isolation with per-task credential scoping

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decision owners:** Platform architecture, Security
- **Evidence class:** [E2] synthesis of V03, V08, V12, V13, V14, plus [E3] additions for credentials and injection
- **Supersedes:** none

---

## Context

Every source that describes concurrent agent work describes isolation as mandatory. But the sources describe isolation at different strengths, and almost none of them address credentials or hostile input.

- **V08 (5:12):** a fresh git worktree from `origin/main` per feature; never build on main. Cheap, git-native, but host-local and file-level only.
- **V03 (18:47–19:24), V12:** disposable remote sandboxes and containers — the "laptop problem" requires that the unit of production be remote, ephemeral infrastructure.
- **V13:** containers, plus a hard turn limit (11:17).
- **V14:** 12-factor discipline — declared, disposable, portable, dev/prod parity.

None of the sources describes **credential scoping** (per-task, short-lived, least-privilege credentials) or **prompt injection through untrusted content**. Both are [E3] additions.

## Decision

### 1. Three isolation tiers, applied by task risk

| Tier | Mechanism | Protects against | Cost | Applies when |
|---|---|---|---|---|
| **T1 — Worktree** | Fresh git worktree from the base branch | File-level interference between concurrent tasks; accidental commits to the protected branch | Very low — no infrastructure | Development, documentation, low-blast-radius changes; the default |
| **T2 — Container** | Containerised workspace with a declared image, no host mounts beyond the checkout, restricted network, scoped credentials | Process escape, cross-task contamination, credential over-reach, runaway resource consumption | Moderate | Any change that executes code, touches dependencies, or runs tests |
| **T3 — Hardened sandbox** | Ephemeral, network-restricted sandbox with per-task ephemeral credentials, resource quotas, full audit | Hostile input, network exfiltration, supply-chain compromise in dependencies | Higher | Any task whose inputs are untrusted; any workflow that touches production-adjacent systems; all L4 operations |

**Every task runs at T1 or above. T2 is the default for anything that runs code. T3 is mandatory when the task reads untrusted content or touches production-adjacent systems.**

### 2. Credential scoping

- Every task receives **ephemeral, per-task credentials** with only the capabilities the workflow needs.
- Credentials are **never** available in an agent's context or prompt; they are injected at the tool-invocation boundary by the tool broker.
- Credentials are short-lived and revoked when the task ends.
- A credential may not be broadened by an agent; broadening requires a policy decision (ADR-0004).
- Long-lived credentials exist only in the control plane, are never exposed to the data plane, and are brokered.

### 3. Network policy

- Default-deny egress from the execution environment.
- Allow-list per workflow, declared in the factory definition, reviewed as a change.
- Untrusted content fetched by an agent is fetched by a **fetching service in the control plane**, not by the agent's environment, and is returned as tagged untrusted content (ADR-0004). This removes the agent's ability to browse freely and exfiltrate.

### 4. Cleanup

Environments, worktrees, containers, and credentials are destroyed when the task reaches a terminal state, including failure. Cleanup is a reconciler responsibility (ADR-0001), so a crashed task's resources are reclaimed rather than leaked.

### 5. Turn and time budgets

Every run has a **turn budget** (default 100, per V13) and a wall-clock budget. Exhausting either returns control to a human with the partial artefacts preserved and labelled as incomplete.

## Consequences

**Positive**
- Blast radius is bounded structurally, not by detection.
- A task that fetches hostile content cannot reach the network to exfiltrate anything.
- A compromised or confused task cannot hold a credential that outlives it.
- Failed runs are reproducible, because the environment is declared (12-factor).

**Negative**
- T2/T3 costs money per task and adds wall-clock latency (cold starts). Mitigation: warm image pools for T2; hibernation for T3.
- The default-deny network policy means every new integration requires a definition change and review. This is deliberate friction — it is the control.
- Network-fetched content must be routed through the fetching service, which adds a hop and a size limit. Some workflows legitimately need direct egress and must declare it.

**Neutral**
- The exact T2 image composition and T3 provider selection are open questions; the blueprint specifies the *properties* required, not a vendor.
- The isolation tier for each workflow is declared in the factory definition, so changing it is a reviewed change.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Worktrees only (V08 literally) | Adequate for a trusted single-developer context, but it offers no credential isolation, no network restriction, and no resource containment. The blueprint adopts worktrees as T1 within a larger stack, not as the whole answer. |
| Vagrant-style full-VM isolation for everything | Exceeds the cost and operational budget for a small team. Container tier covers the realistic threat surface; hardened sandbox is reserved for hostile-input and production-adjacent work. |
| Long-lived credentials in the agent environment | Rejected: it makes the approval mechanism (ADR-0003, ADR-0004) decorative, because a compromised task holds standing authority. |
| Allow-by-default egress with filtering | Rejected: filters are evadable; default-deny is not. |
| No isolation, rely on review | Rejected: review is a detection control and is probabilistic; the factory's whole premise is unattended execution between review points. |

## Validation

- A test must demonstrate that a T2 task cannot reach a host path outside its checkout, and a T3 task cannot reach the network beyond its allow-list.
- A test must demonstrate that credentials are absent from the agent's prompt and context, and that they are invalidated at task end.
- An injected instruction in fetched content must be verifiably unable to alter the agent's action (verified by the red-team suite in `14_QUALITY_TESTING_AND_EVALUATION.md`).
- Leaked-resource detection must run as a reconciler check.

## References

- Evidence: `../03_EVIDENCE_LEDGER.md` D-30, D-31, D-37, D-55, D-58, plus §4 gaps (secret management, prompt injection)
- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` CO-8, D-8
- Related: ADR-0002, ADR-0004, ADR-0007
