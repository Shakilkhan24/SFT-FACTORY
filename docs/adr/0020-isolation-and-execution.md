# ADR-0020 — T1 for reading, T2 rootless Docker for anything that executes code

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The factory's realistic v1 threats are container escape and attacks through the host git daemon —
not a novel kernel exploit. The corpus is explicit that this is the threat model being accepted, and
that a stronger boundary (T3) is deferred behind a trigger rather than built in week one.

The consequence is a rule that is easy to state and easy to get wrong: **any stage that executes
repository code must run inside T2**, and verification counts as executing code.

## Decision

Two isolation tiers, plus a deferred third.

**T1 — host worktree / snapshot, no code execution.** Used for read-only and `completion` stages.

**T2 — rootless Docker.** Mandatory for any stage that executes repository code, **including
verification**. The rules:

- No `docker.sock` in any container.
- **Never run host `git` inside a directory a container could write.** Extract the patch with
  `git diff --binary` and apply it to a clean host worktree.
- Per-task token-bound **egress proxy**; the container reaches the outside world only through it.
- Model access only via the gateway passthrough.

**T3 — deferred**, built on the trigger in pack `01` §3.

### Scope limits

This ADR does not decide the T3 design, nor the exact egress proxy implementation (T-2.10), nor the
resource limits per stage. It does not decide whether `runsc` (gVisor) is used — the pack marks that
`[VERIFY]` and spike S-3 settles it.

## Consequences

**Positive**
- The cheap, realistic attacks are closed: a container cannot reach the host docker daemon, and a malicious repository cannot execute a git hook or a config in the host's working tree.
- The egress proxy makes 'what did this task send out' answerable per task, with a token bound to it.
- T1 stays cheap for the many stages that only read, which keeps the common path fast.

**Negative**
- T2 costs real wall-clock time per task — container start, image pull, filesystem setup — against a budget of ≤2 h per task.
- Rootless Docker has its own performance and compatibility costs, and it is not available on every host (Docker Desktop on macOS and Windows differ).
- The 'never run host git in a container-writable directory' rule is a discipline, not a mechanism: it can be violated by an agent that does not know the rule, and the consequence is host-level code execution.
- The egress proxy must be correct, and a proxy that is too strict breaks tasks while a proxy that is too loose defeats the control.

**Neutral**
- Kernel-level container escape is an **accepted risk** in v1, mitigated by rootless/userns, no capabilities, seccomp and optional gVisor.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Run everything on the host | Removes all isolation. The corpus identifies container escape and git-hook attacks as the realistic v1 threats, and this option declines to address either. |
| Use a full VM per task | Stronger isolation, materially slower, and disproportionately expensive for the many read-only stages that need none of it. |
| Use rootless Docker for every stage including reads | Would satisfy the safety rule but pay the T2 cost on the common path, where the blast radius of a read-only stage is small. |
| Run verification on the host but execution in T2 | Verification executes repository code — the test suite is attacker-controlled — so this split leaves the most reachable hole open. |

## Validation

- The route-inventory test asserts that no host-execution capability exists outside T1 read operations, and the container policy test asserts the no-docker.sock and no-host-git rules.
- If the accepted kernel-escape risk materialises, or if the threat model changes, T3 is built on the pack's trigger rather than the policy being quietly relaxed.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0020)
- Related: ADR-0017 (executor kinds), ADR-0022 (blast radius)
