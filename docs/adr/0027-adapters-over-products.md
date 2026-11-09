# ADR-0027 — Every external system sits behind an interface; Postgres is the one fixed dependency

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The plan's value is that it survives contact with a different target repo, a different SCM and a
different cloud. That survival depends on one property: nothing outside the factory's contracts is
named directly in business logic. Where it is not, the plan becomes a plan for one deployment.

The corpus also names the exception, and it is important — an absolute "everything is an adapter" rule
would be expensive and is not what the evidence supports.

## Decision

1. Every external system sits behind an **interface** with a documented swap map (`A1` §7).
2. **PostgreSQL is the one fixed infrastructure dependency.** It is not abstracted away.
3. On the peak path, deploy is **GitOps-first** (`A2` §3).

The PostgreSQL exception is deliberate. The event log's gapless-sequence requirement (ADR-0019),
row-lock semantics and time partitioning are properties the factory's correctness depends on; a
portable SQL abstraction cannot preserve them, and a shim that pretended to would be a source of
subtle divergence. Postgres is therefore a constraint, and the cost of that constraint is paid
knowingly.

### Scope limits

This ADR does not decide which products the adapters wrap — that is the swap map in `A1` §7. It does
not decide the deploy mechanics beyond GitOps-first on the peak path.

## Consequences

**Positive**
- The plan stays valid when the target uses GitLab, a different cloud or a different runtime, because the seams are the interfaces rather than the products.
- PostgreSQL's special status means the one place where correctness really depends on engine semantics is the one place that is not abstracted into a leaky shim.
- GitOps-first means the factory's own deployment has the same audit trail as its outputs.

**Negative**
- Postgres is a real constraint: the factory cannot be pointed at a different database, and the swap map has a hole in it by design.
- Each adapter is another surface to maintain, and the interface has to be designed well enough to cover two products it will not actually be used with.
- The one fixed dependency concentrates the operational risk: Postgres becomes the single thing whose failure stops the factory.

**Neutral**
- The swap map in `A1` §7 records which product each interface currently wraps.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Abstract the database too | A portable SQL layer cannot preserve gapless sequencing under a row lock, and a shim that pretended to would diverge subtly — the worst possible failure for an audit trail. |
| Name products directly everywhere | The plan becomes a plan for one deployment; every change of supplier becomes a change of the factory's business logic. |
| Abstract everything except databases, with no interface at all | Gives up the property that the plan survives a supplier change, for no gain. |

## Validation

- Every external system the factory calls is reached through a named interface, and the dependency rules reject a direct import of a vendor SDK outside the adapter package.
- If a new product category appears that the interfaces do not cover, a new interface is added rather than the boundary dissolved.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0027)
- Related: ADR-0025 (hosting), ADR-0026 (command surface)
