# ADR-0019 — Use a gapless counter sequence under a row lock, not a bigserial

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The factory's audit trail is the substrate for every replay, every metric and every invariant that
checks "what happened". If events can be lost, reordered or skipped, then a projector reading by
sequence can silently miss events, and the factory will report a confident, wrong history.

The pack identifies the specific trap: a plain `bigserial` leaves gaps on rollback and can commit out
of order, which produces false "lost write" alarms and skipped events in cursor-based projectors. The
failure is not a rare race — it is the normal behaviour of the obvious implementation.

## Decision

Event ordering uses a **gapless `seq`** taken from a counter row updated under a row lock, so the
sequence is commit-ordered.

On top of that:

- Per-aggregate `version`, advanced with a compare-and-set on the aggregate row.
- Projectors read by `seq`, and a gap is a hard error rather than a skipped row.
- Monthly time partitions on the events table.

This ADR **clarifies** blueprint ADR-0008 (event sourcing) — it does not change it.

### Scope limits

This ADR does not decide the partitioning schedule beyond "monthly", nor the projector retention
policy, nor the snapshot cadence. It does not decide the exact SQL, which is T-1.02.

## Consequences

**Positive**
- A gapless sequence makes "an event is missing" a detectable condition instead of an undetectable one. The distinction is the difference between a projector that fails loudly and a projector that quietly produces a wrong history.
- Commit-ordering means the sequence reflects reality, not just allocation order.
- The per-aggregate version CAS gives optimistic concurrency on aggregate state without holding a lock across the whole transaction.

**Negative**
- A counter row under a row lock serialises event appends. At high write rates this is the bottleneck — the pack names p95 append above 50 ms or 200 events/s sustained as the revisit trigger, and that trigger will fire under real load.
- The lock adds contention against other writers to the same counter, including administrative operations that have nothing to do with the factory's event stream.
- Gapless sequencing costs more than `bigserial` on every append; that is the price of detectability.

**Neutral**
- The append pattern is documented in blueprint `09_ORCHESTRATION_STATE_AND_EVENTS.md`, so the ordering contract is readable independently of the implementation.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A plain `bigserial` column | The obvious implementation, and the one the pack names as the trap: gaps on rollback and out-of-order commits produce false alarms and skipped events. |
| A database sequence with `NO CYCLE` and advisory locks | Still allocates out of commit order, so the same class of failure survives. |
| A message broker's ordering guarantees | Adds infrastructure the corpus explicitly forbids (HR-6), and its ordering guarantee is partition-scoped rather than global. |
| Logical timestamps instead of a sequence | Clock skew and equal timestamps make ordering ambiguous; timestamps are good for correlation but not for a gapless cursor. |

## Validation

- The DDL test proves the sequence is gapless under concurrent writers, and the event-log invariant test fails on a missing `seq`.
- If p95 append exceeds 50 ms or 200 events/s is sustained, the pack's own revisit trigger fires and the sequence-plus-snapshot-safe-reader design replaces this one.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0019)
- Related: ADR-0008 (blueprint event sourcing), ADR-0020 (isolation)
