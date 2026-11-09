# ADR-0014 — Keep the factory definition in the factory monorepo

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The factory's *definition* — the workflows, roles, capabilities, grants, environments, criticality map
and repository allow-list that make the factory a declarative system rather than a codebase (blueprint
ADR-0001) — has to live somewhere. The alternatives are a second repository, or inside the factory
monorepo.

The corpus constrains the choice more than it drives it: the definition is applied by version, and the
applied version is a merged git SHA. A definition living in the monorepo therefore needs no separate
release process, and a change to it is reviewed by the same mechanism as a change to anything else.

## Decision

The factory definition lives at `/definition` in the factory monorepo.

It is protected by CODEOWNERS (owner approval required) and by a path-deny for agent runs. The applied
version is the **merged git SHA** of the definition at the time of application — not a branch name, not
a tag, and not a mutable pointer.

### Scope limits

This ADR does not decide how the definition is *authored* (a future profile may add a DSL and a
compiler), nor how it is *applied* to a target repository (T-1.06, the definition store and applier).
It does not decide the read model used to audit a past run.

## Consequences

**Positive**
- One repository means one review mechanism, one set of branch protections and one commit history for both the definition and the code that applies it.
- Versioning by merged SHA makes every applied definition trivially reproducible: the SHA is the version, and `git show` reconstructs it.
- A solo owner maintains one repository rather than two, which is the constraint the pack's 8-week plan is built around.

**Negative**
- The definition and the runtime change in the same pull request, so a definition change is coupled to a code change. A purely declarative change therefore pulls a runtime change along with it.
- As the definition grows, `definition/**` becomes a large share of the repository and a frequent source of review load.
- Because the definition is in the same repo as the applier, a bug in the applier can corrupt the definition it reads. The applied-SHA discipline limits, but does not remove, this coupling.

**Neutral**
- The path `/definition` is on the R4 human-only list, so an agent run cannot modify it even when a ticket appears to ask for it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A separate definition repository | Cleaner separation, but it introduces a second repository, a second set of protections and a cross-repository versioning scheme — cost the plan does not need while there is one owner. |
| The definition inside each target repository | Moves the trust boundary into repos the factory does not control, and would make the factory's own governance un-auditable from one place. |
| A database-backed definition store | Makes the definition mutable without a commit, which breaks the applied-version-is-a-SHA property that the audit trail depends on. |

## Validation

- Every applied-definition event records the merged SHA, and `git show <sha>` reconstructs the exact definition that was applied.
- If a second human joins, or if the factory begins targeting its own `definition/**`, the separation-of-repository argument becomes stronger than the single-owner argument and this ADR must be revisited.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0014)
- Related: ADR-0013 (stack), ADR-0015 (bootstrap)
