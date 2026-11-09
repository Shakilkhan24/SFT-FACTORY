# ADR-0022 — A deterministic blast-radius scorer sets the tier; humans raise it only

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

Every change in the factory's target repositories needs a review tier, and the tier decides how much
owner attention it costs. A tier chosen by the agent that wrote the change is not a control; a tier
chosen by a human for every change is not automatable.

The blueprint supplies the dimensions and the tiers but not the point values that turn a dimension
reading into a tier. Those point values are a policy decision, and this ADR records them as one.

## Decision

The blast radius is scored by a **deterministic scorer**.

- Seven dimensions, each contributing points per pack `02` §4.14.
- **Tier = max(score tier, criticality-map path floor).** A file the criticality map marks as
  critical cannot be scored below that floor by a low-scoring change.
- The tier is raised **only by humans**. The scorer can only ever lower a human's decision, never
  raise it — a change that looks small but touches a critical path still gets the critical path's tier.

### Scope limits

This ADR does not decide the point values themselves — those live in the policy package and are
changed through reviewed policy change, not here. It does not decide the criticality map's contents,
which are the owner's per-repository judgement (T-0.05).

## Consequences

**Positive**
- The tier is reproducible: the same change scores the same tier every time, on any machine, with no model call.
- The `max` with the criticality floor means a well-behaved scorer cannot be talked into approving a critical path.
- Humans raise tiers, never lower them, so the failure mode of the control is over-review rather than under-review.

**Negative**
- Point values are guesses until they are calibrated against observed outcomes, and the pack's H-08 hypothesis (compare predicted tier to observed tier monthly) is exactly the work that fixes them.
- A deterministic scorer cannot see intent. A malicious or careless change that is small by every dimension still scores small.
- The criticality floor only helps for paths the owner has classified. An unclassified critical path has no floor.

**Neutral**
- The tier and its score components are recorded on the change, so a reviewer can see why a change was routed to them.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Let the agent choose the tier | The tier is the mechanism that decides how much human attention a change receives; letting the author set it removes the control. |
| Have a human set the tier for every change | Accurate, and it makes the factory no faster than the owner's review queue — which is the thing the factory exists to change. |
| Score the blast radius with a model call | Non-deterministic and promptable, so the same change could score differently on two runs. A tier that can change between runs cannot be a required check. |

## Validation

- The same change produces the same tier on repeated runs, and a change touching a critical path scores at least the critical path's floor tier.
- If H-08's monthly comparison shows the predicted and observed tiers diverge systematically, the point values are retuned through reviewed policy change.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0022)
- Related: ADR-0021 (oracle routes), ADR-0003 (blueprint review floor)
