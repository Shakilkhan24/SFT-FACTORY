# ADR-0016 — Humans merge in the GitHub UI; the factory holds no merge capability in v1

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The blueprint's autonomy ladder (L0–L3) says the merge decision is the owner's until promotion is
earned, and the pack's L2 model is the first level where the factory proposes changes to itself but
never applies them. The question this ADR answers is the mechanism, and the mechanism is what makes the
authority split checkable rather than aspirational.

If the factory can merge, then every guarantee about human control is enforced by the factory's own
code — the same code that makes the proposal. Keeping the merge outside the factory makes the
guarantee structural.

## Decision

In v1 the factory **never merges**.

1. Humans merge in the GitHub UI.
2. The factory holds **no merge capability**: there is no capability that merges a branch, and no
   credential that would permit it.
3. Approval is a commit status / check bound to the **head SHA**, not to the branch name.
4. The factory observes `pull_request.closed` with `merged: true` and records a `change.merged` event
   naming the human as the authority.

### Scope limits

This ADR does not decide the L3 promotion criteria, and it does not forbid the factory from *opening* a
pull request — it decides who merges. It does not decide how the approval check is bound in GitHub's
ruleset, which is `tools/protect-repo` and an owner-applied configuration.

## Consequences

**Positive**
- The human review floor (blueprint ADR-0003) is enforced by the absence of a capability rather than by a policy check that could be disabled or misconfigured.
- The check binds to the head SHA, so a force-push after approval invalidates the approval rather than silently carrying it forward.
- The factory still learns from merges — the `change.merged` event is what the measurement layer consumes — without holding the authority.

**Negative**
- Every merge waits on a human sitting at a browser, which bounds throughput by the owner's review capacity (D10, 2–3 h per day) regardless of how fast the factory proposes.
- The factory cannot self-merge even when it is right, so a perfectly-correct proposal still consumes owner attention.
- Observing `pull_request.closed` means the merge is a *fact learned after the fact*, not a step the factory controls — which is the point, but it means the factory cannot correct a mistaken merge.

**Neutral**
- The factory's own proposals to change itself are subject to exactly the same rule as everyone else's — which is what 'the factory proposes changes to itself and never applies them' means in practice.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Give the factory a merge capability, gated by an L2 promotion | The corpus does not forbid it — it forbids it *in v1*. Adopting it now would put the human-control guarantee behind the factory's own implementation. |
| Let the factory open a pull request with a pre-filled merge checkbox | GitHub does not offer this safely, and any approximation would amount to a merge capability with extra steps. |
| The factory merges via the GitHub App's merge permission | That is a merge capability, and it is also the permission that would make a credential leak immediately destructive. |

## Validation

- No capability in the registry performs a merge, and the GitHub App permissions in ADR-0018 do not include anything that would permit one.
- If the owner promotes to L3, this ADR is superseded by a new one that names the capability, the gate and the rollback path — it is not amended in place.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0016)
- Related: ADR-0018 (credentials), ADR-0024 (notifications and approvals)
