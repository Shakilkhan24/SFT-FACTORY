# 11 — Runbooks and the kill switch

> **Phase W8 (2 days) · Ticket T-6.04**
>
> One ticket. Seven runbooks. Each one **exercised once with a dated record**. A runbook
> that has never been followed is a document, not a capability.
>
> **This is where the factory stops being software and becomes an operation.**

---

## PREREQUISITES

* Checklist 10 complete. The production deployment exists, the alerts fire, and the
  restore drill has run.
* The kill switch is wired from checklist 03 (T-1.16) — this ticket proves it works
  under load.

---

## STAGE 0 — The oracle

| Ticket | Oracle | Route |
|---|---|---|
| T-6.04 | **each runbook exercised once with a dated record**; the kill switch halts intake, the scheduler and the harness **within 10 s** | R-G + owner |

---

## STAGE 1 — The work

### T-6.04 · Runbooks and kill switch · W8 · M · R2

**Open ONLY:** pack `01` §1.2 (PRD-8, PRD-10), pack `04` §3 (the kill-switch endpoint),
pack `02` §8 (the degradation matrix).

**Build** `docs/runbooks/` — seven runbooks:

| Runbook | What it covers |
|---|---|
| **Credential leak** | A credential is suspected to have leaked: where to look, how to revoke all leases, how to re-mint, how to scan the store, what to tell the owner |
| **Provider outage** | The primary provider is down or slow: failover state, how to route to the fallback, how to pause intake, how to resume the queue |
| **Stuck leases / zombie containers** | Tasks are not progressing: how to find expired leases, how to re-queue, how to reap labelled containers, how to clear the orphan reaper's backlog |
| **Runaway cost** | Spend spikes: the circuit breaker, how to engage the kill switch, how to identify the runaway task |
| **Bad factory release rollback** | A release made things worse: how to roll back the factory, which DB migrations are reversible (none — they are forward-only), how to restore instead |
| **Webhook-secret rotation** | The webhook secret must change: how to re-encrypt it, how to rotate without downtime, how to verify the round-trip |
| **Restore** | A full restore from backup: the RTO steps, the chain verification, the smoke task |

**The kill switch** — `POST /v1/factory/kill-switch` with `{engage, reason}`:

**Engaged ⇒** intake is rejected, the scheduler claims nothing, harness containers are
killed, and the edge denies new model calls.

**The drill:** engage it under load (a real task in flight) and measure. **Intake, the
scheduler and the harness must all halt within 10 seconds.** Record the measured time.
A kill switch that takes 30 s to stop a harness run is a kill switch that lets the next
three tasks start.

---

## STAGE 2 — Review

Standard reviewer pass. The owner personally signs each drill record — a runbook is
only exercised if a human ran it.

---

## GATE ROWS — evidence produced here, closed at the PRR

This phase produces the **drill records** for two G4 rows. The rows themselves are
**closed** at the production readiness review in checklist 13, against that evidence.

| Row (closed later) | Statement | Closed in |
|---|---|---|
| CL-G4-10 | **PRD-10** each runbook exercised once (dated) | checklist 13 |
| CL-G4-08 | The overview answers "doing / needs me" in ≤2 clicks; the kill switch halts intake, the scheduler and the harness ≤10 s; the alerts fire in drills | checklist 13 |

---

## EXIT CRITERIA — before checklist 12

- [ ] Seven runbooks exist in `docs/runbooks/`.
- [ ] **Each one has a dated drill record** — seven records, seven dates.
- [ ] The kill-switch drill engaged the switch under load; intake, the scheduler and the
      harness all halted within **10 seconds**, measured and recorded.
- [ ] Every drill record says what happened, not just that it was run.
- [ ] The restore runbook's steps match the actual restore drill from checklist 10.

---

## TRAPS

1. **Writing runbooks from the code rather than from an incident.** A runbook written
   from the code describes how the system was meant to work. Written during a drill, it
   describes what actually happens — which is the only version worth having.
2. **Exercising the kill switch on an idle factory.** An idle factory halts trivially.
   The drill needs a task in flight, a container running and a queue non-empty.
3. **Forgetting that migrations are forward-only.** "Roll back the release" for a release
   that included a migration means *restore*, not revert. Say so in the runbook.
4. **A runbook that assumes the dashboard is up.** During an outage of the dashboard, the
   CLI is the access point (`02` §8: *dashboard down ⇒ api + CLI remain the access
   points*).
5. **Leaving the kill switch engaged.** The drill must end with it disengaged and the
   queue resumed — and that resumption must itself be recorded.
6. **Writing a credential-leak runbook that says "rotate the secret".** The leak is in
   the store, the artefacts and the logs. The runbook must include the scan, the
   `revokeAll`, the re-mint, and the evidence that the old value is gone.
