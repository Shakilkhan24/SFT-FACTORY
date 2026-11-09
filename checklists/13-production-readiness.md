# 13 — Production readiness review (PRR)

> **Phase W8 (2 days) · Ticket T-6.06 · Gate G4**
>
> One ticket. Ten criteria. One signature. This is the **go / no-go** for Factory v1.
>
> The PRR is not a status meeting. It is a check that each of PRD-1…PRD-10 is **true**,
> evidenced, and — where it is not — recorded honestly in the deferred register.

---

## PREREQUISITES

* Checklists 01–12 complete. G0, G1, G2, G3 green.
* The soak has run: ≥20 tasks, ≥14 days, ≥10 merged.
* The fault suite passes **against the production topology** (`--prod-like`).

---

## STAGE 0 — The oracle

| Ticket | Oracle | Route |
|---|---|---|
| T-6.06 | a signed `docs/readiness/PRR-<date>.md` | owner |

---

## STAGE 1 — The work

### T-6.06 · Production readiness review · W8 · M · R2

**Do:**

1. Run the **full** checklist (`06` Part A, all gates) against the current state.
2. Update the **deferred register** (`06` Part D) and the **risk register** (`01` §8) —
   every cut and every deferral with its trigger.
3. Produce `docs/readiness/PRR-<date>.md` with the owner's **go/no-go signature**.

**The ten criteria** (pack `01` §1.2) — each needs its evidence, not a claim:

| ID | Criterion | Verified by |
|---|---|---|
| **PRD-1** | Gates G1, G2, G3 fully green (waivers only if recorded, owner-signed, time-boxed) | `06` Part A |
| **PRD-2** | Each of I-1…I-12 has an automated test; breaking the guard in a scratch branch makes the test fail (mutation check) | `08` §3 |
| **PRD-3** | The red-team suite AT-1…AT-15 runs as a **required check** in the factory's own CI | `08` §4 |
| **PRD-4** | ≥20 real tasks over ≥14 days at L2, ≥10 merged; each has a complete 12-element run artefact and a reconstructable audit trail | T-6.05 |
| **PRD-5** | Secret scan over the **entire** event/artefact/log store = 0 findings; no long-lived credential reachable from any T2 container | T-3.06, A3.3, A3.4 |
| **PRD-6** | Restore drill: Postgres + object store restored to a clean host, projections rebuilt, event-hash chain verified, within the owner's RTO (suggested ≤4 h) | T-6.02 |
| **PRD-7** | Fault-injection suite passes: kill api/worker mid-run, Postgres restart, object-store outage, provider outage ⇒ resumed or explicitly failed, never silently lost | T-3.07 |
| **PRD-8** | Dashboard answers "what is the factory doing and what does it need from me" in ≤2 clicks; global kill switch tested; alerts fire in drills | T-1.16, T-6.03, T-6.04 |
| **PRD-9** | Pre-factory baseline report + cost-per-accepted-change report exist; **no productivity claim is made without them** | T-0.04, T-4.01, T-4.05 |
| **PRD-10** | Runbooks exist and **each was exercised once** (credential leak, provider outage, stuck leases, runaway cost, bad factory release rollback) | T-6.04 |

---

## STAGE 2 — Review

The PRR is owner-only. The owner signs it. An agent may assemble the evidence; it may
not sign.

---

## GATE ROWS — G4, production readiness

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G4-01 | **PRD-1** G1, G2, G3 fully green (waivers listed, none on 🔒 rows) | `docs/readiness/PRR-<date>.md` | owner |
| CL-G4-05 🔒 | **PRD-5** zero secret findings; no long-lived credential reachable from any T2 container | CL-G3-26 + CL-G2-18 | agent |
| CL-G4-06 | **PRD-6** restore drill on a clean host within the owner's RTO; the chains verify | the drill record | owner |
| CL-G4-07 | **PRD-7** the fault-injection suite is green on the production topology | `pnpm test:fault --prod-like` | agent |
| CL-G4-08 | The overview answers "doing / needs me" in ≤2 clicks; the kill switch halts intake, the scheduler and the harness ≤10 s; the alerts fire in drills | the drill records | owner |
| CL-G4-10 | **PRD-10** each runbook exercised once (dated) | `docs/runbooks/*` drill log | owner |
| CL-G4-11 🔒 | Only `/webhooks/github` is publicly reachable (external probe); the dashboard/API are private | the probe output | agent |
| CL-G4-12 | The deferred register (Part D) and the risk register are updated; every cut recorded with its trigger | `06` Part D | owner |
| CL-G4-13 | The owner's go/no-go signature | `PRR-<date>.md` | owner |

### Rows confirmed at the PRR but closed elsewhere

These rows are **closed** in the phases that produce their evidence; the PRR confirms
them against that evidence. They are listed here so the PRR checks them, and they are
**not** closed here.

| Row (closed later) | Statement | Closed in |
|---|---|---|
| CL-G4-04 | **PRD-4** ≥20 real tasks over ≥14 days, ≥10 merged, each with a complete run artefact and a reconstructable trail | checklist 12 (the soak) |
| CL-G4-09 | **PRD-9** the pre-factory baseline + the cost-per-accepted-change reports exist; **no productivity claim made without them** | checklist 12 (the soak) |
| CL-G3-27 🔒 | **PRD-2 mutation check:** each invariant's guard is broken and the test goes red | checklist 14 |
| CL-G4-02 🔒 | **PRD-2** invariants proven with the mutation check | checklist 14 (the CL-G3-27 evidence) |
| CL-G4-03 🔒 | **PRD-3** the red-team suite is a required check in CI | checklist 15 (the CL-G3-19 evidence) |

---

## EXIT CRITERIA — before checklist 14

- [ ] `docs/readiness/PRR-<date>.md` exists and is **signed**.
- [ ] All thirteen G4 rows ticked **with evidence**; no waiver on a 🔒 row.
- [ ] Every deferral and every cut is recorded in the deferred register **with its
      trigger** — a cut without a trigger is an undocumented scope change.
- [ ] The risk register is current.

---

## TRAPS

1. **Signing the PRR on a red row.** PRD-1 requires G1–G3 fully green. Waivers exist
   for non-🔒 rows, are owner-signed and time-boxed, and go in `docs/waivers.md`.
   There is no waiver for a 🔒 row.
2. **Counting a row as passed because the code looks right.** Every row has a verify
   command. Run it.
3. **Letting the deferred register drift.** Every cut made during the 8 weeks is
   recorded with its trigger. A cut that is not recorded is a silent scope reduction.
4. **Saying "production-ready" in a way that implies L3.** Factory v1 is production-ready
   for its declared scope: **one owner, one-to-few repos, workflows B/C/D, autonomy L2.**
   Not autonomous merging, not deployment, not incident response.
5. **Letting the PRR be a formality.** If it is signed without the evidence, the whole
   measurement discipline the factory is built on is theatre — and the next claim will
   be unmeasured too.

---

## After the PRR — what happens next

Two paths, and the owner chooses:

* **Path A — run v1.** Keep the factory at L2, keep the backlog coming, keep measuring.
  Most owners should do this for months. The blueprint's own answer to "when does it
  get smarter?" is *evidence, not schedule*.
* **Path B — start the peak path.** Continue to checklist 16 and follow the promotion
  machine in `A2`.

Either way, the factory is now **dogfooding its own doctrine** — the build followed the
process it implements, and from W5 the factory took part of its own backlog (ADR-0015).

**Checklists 14 and 15** are the cross-cutting sweeps. Run them after the PRR if any
G3 row was waived, and run them again whenever the guards change.
