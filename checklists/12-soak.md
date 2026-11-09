# 12 — The soak: 20 real tasks over 14 days

> **Phase W5 → W8 (wall-clock bound) · Ticket T-6.05**
>
> This is not a build phase. It is a **measurement phase** that runs in the background
> while other checklists are executed. It starts the moment the first real issue goes
> through Workflow B (checklist 05) and finishes in W8.
>
> **It cannot be compressed.** There is no way to fake 14 days of soak. The factory's
> central open question is whether agent throughput becomes *accepted* throughput
> (Q-05), and only wall-clock time answers it.

---

## PREREQUISITES

* Checklist 05 complete — the first real issue has been through Workflow B (CL-G2-15).
* Checklist 08 complete — `factory metrics report` works and the baseline exists.
* The owner has committed **2–3 focused hours a day** to oracle approval and PR review.
  This is the real bottleneck of the programme (CP-7, R-03). If it is not available,
  **slip the date — do not skip review.**

---

## STAGE 0 — The oracle

| Ticket | Oracle | Route |
|---|---|---|
| T-6.05 | **≥10 merged**; **100 % complete run artefacts**; all trails reconstructable; secret scan = 0; a metrics report produced | R-G + owner |

---

## STAGE 1 — The work

### T-6.05 · Soak run · W5–W8 · L · R2

**Do:**

1. Process **≥ 20 real tasks** over **≥ 14 days** on the owner's real repository, at
   **L2**. Real tasks: the work you would otherwise do yourself.
2. Every task follows the full loop: intent → triage → refine → oracle → plan → plan
   approval → implement in T2 → verify → review → **owner merge** → record.
3. **Weekly "what did the factory merge" review** — a real conversation about what the
   factory produced, not just a metrics dump.
4. Log every task in `docs/build-metrics.csv`.

**The acceptance:**

| Criterion | Threshold |
|---|---|
| Real tasks processed | ≥ 20 |
| Duration | ≥ 14 days |
| Merged | ≥ 10 |
| Run artefacts complete | **100 %** (all 12 elements, every run) |
| Audit trail reconstructable | **100 %** — `factory audit explain <taskId>` works for every merged change |
| Secret scan over the whole store | **0 findings** |
| Metrics report | produced, with the baseline, the delta, the cost and the guardrail |

### The weekly review — what to actually ask

This is the point of the soak. Ask these, out loud, every week:

1. **Which tasks did the factory handle that you would not have wanted it to handle?**
   (Scope discipline.)
2. **Which tasks did it refuse or escalate, and were those escalations correct?**
   (A correct escalation is a *success*, not a failure.)
3. **Where did you spend your review minutes, and were they spent on the right PRs?**
   (Q-04 — the review-capacity question.)
4. **What did the factory produce that you then had to substantially rewrite?**
   (This is the accepted-throughput question, Q-05.)
5. **Did any oracle prove non-discriminating in practice?**
   (The oracle quality question — and the input to calibration.)

### What the soak is designed to reveal

Blueprint `01` §10 says this plainly: *the first two weeks after Phase-1 exit will
mostly reveal problems: unexpressible criteria, flaky repo tests, context gaps. That is
the point of the soak.*

Expect the factory to shine on **well-specified, test-backed work** (bug fixes with
reproductions, small features, dependency upgrades) and to escalate on **vague work**.
**Escalation is a correct outcome, not a failure.**

---

## STAGE 2 — Review

This phase produces no PRs. The review is the owner's weekly conversation, recorded.

---

## GATE ROWS

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G4-04 | **PRD-4** ≥20 real tasks over ≥14 days, ≥10 merged, each with a complete run artefact and a reconstructable trail | `factory metrics report --soak` | owner |
| CL-G4-09 | **PRD-9** the pre-factory baseline + the cost-per-accepted-change reports exist; **no productivity claim made without them** | the reports | owner |
| CL-G3-28 | Owner reviewed every R3/R4 PR merged in W3–W7 (list) | `docs/evidence/G3-28.md` | owner |

> **CL-G3-28** is a G3 row that only closes at the *end* of the window it measures, so
> it lives here rather than in the phase that produced the PRs. The human review floor
> (ADR-0003 §3) is not a phase — it is a continuous obligation, and this row is the
> receipt.

---

## EXIT CRITERIA — before checklist 13

- [ ] **≥ 20** real tasks processed over **≥ 14 days**.
- [ ] **≥ 10** merged.
- [ ] **100 %** of run artefacts have all 12 elements.
- [ ] **100 %** of merged changes reconstruct via `factory audit explain`.
- [ ] The secret scan over the whole store = **0 findings**.
- [ ] `factory metrics report --soak` produces baseline, delta, cost and guardrail.
- [ ] Four (or more) weekly reviews recorded, each with the five questions answered.
- [ ] `docs/build-metrics.csv` has a row per task.
- [ ] The escalations the factory made are recorded, and each was judged correct.

---

## TRAPS

1. **Compressing the soak.** Twenty tasks in three days is not a soak; it is a
   stress test with no time dimension. The 14 days exist because most failure modes
   (flaky tests, stale leases, drifting calibration, review fatigue) are time-dependent.
2. **Counting tasks the factory did not complete.** The threshold is *processed*, and
   the merge count is separate. If 20 tasks were started and 6 merged, that is a fact
   to report honestly, not 20 successes.
3. **Running the soak on toy tasks.** Real tasks, the real repo, real review pressure.
   The measurement is of the system in use, not in a demo.
4. **Skipping the weekly review.** That is where the qualitative signal comes from.
   The metrics tell you the throughput; the conversation tells you whether the output is
   worth accepting.
5. **Treating an escalation as a defect to be engineered away.** A factory that never
   escalates on vague work is a factory that guesses. Count the escalations; judge
   whether they were correct.
6. **Quoting a speed-up number at the end of the soak.** You may report the baseline,
   the delta, the cost and the guardrail. You may not report a multiplier (MEAS-06).
