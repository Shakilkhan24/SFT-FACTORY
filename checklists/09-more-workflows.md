# 09 — More workflows and hooks: bug fix, dependencies, CI repair, proposals

> **Phase W6–W7 (6 days) · Tickets T-5.01 … T-5.05**
>
> Five tickets that extend the factory beyond the issue→PR spine. Each one is small.
> Each one is a trap, because each one is the kind of task where "it worked on the demo"
> is most tempting and most dangerous.
>
> **The theme of this phase: every automation here must know when to stop.** Workflow C
> must escalate when it cannot reproduce; Workflow D-1 must escalate when it finds far
> more than expected; Workflow D-2 must refuse to weaken a gate. A factory that
> speculates is worse than one that asks.

---

## PREREQUISITES

* Checklist 05 complete. The oracle service, the merge gate, the verification runtime,
  the review/panel and the blast-radius scorer all exist.
* Checklist 06 complete for the D-2 gate-weakening auto-rejection to be enforceable.
* T-0.06's calibration candidates exist (D-1 uses the fetch service).

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-5.01 | **A4.2** a regression test that passes on the unfixed code is rejected; **A4.3** not-reproducible ⇒ escalated, no speculative fix; the fix cannot start before oracle admission | R-G |
| T-5.02 | **A4.5** far-more-than-expected ⇒ stop and escalate, no fan-out; chunk bounds; honours the kill switch | R-G |
| T-5.03 | **A4.4** a fix that edits CI/test/lint config or removes tests is rejected; human PRs are never touched | R-G |
| T-5.04 | **A4.10** on a fixture corpus; deterministic output | R-G |
| T-5.05 | a proposal without batch evidence is rejected; a route inventory proves **nothing applies a proposal automatically** | R-G |

---

## STAGE 1 — The work

### T-5.01 · Workflow C — bug fix · W6 · M · R2

**Open ONLY:** blueprint `12` §4.

**Build** `C.bug-fix.yaml`: a reproduction node; the regression test as the oracle with
`expectedBefore: fail`; not-reproducible ⇒ `ESCALATED(not_reproducible)`.

**The delta from Workflow B** (blueprint `12` §4):

* Trigger: the issue is labelled `bug` **and** `factory:ready`.
* A **reproduction node** produces a failing regression test as the oracle.
* If it cannot reproduce within budget ⇒ `ESCALATED(not_reproducible)` and **no
  speculative fix** (A4.3).
* The fix node **cannot start until the oracle is admitted**.
* A regression test that passes on the unfixed code is rejected (A4.2).

> This is the oracle rule at its sharpest: *a regression test that does not fail on the
> unfixed code is rejected.* That one check catches a fix that changes nothing, a test
> that asserts the implementation rather than the behaviour, and a misdiagnosis — all
> at once (blueprint `17` §5.3).

---

### T-5.02 · Workflow D-1 — dependency upgrades · W7 · M · R2

**Open ONLY:** blueprint `12` §5.

**Build:** a cron trigger; a deterministic candidate scan in T2 + advisory data via the
fetch service; chunking (≤ K per run); a per-chunk task (the oracle = the existing suite
+ lockfile integrity, `expectedBefore: pass`); a stop-and-escalate threshold.

**The two rules that make D-1 safe:**

* **Chunking** — ≤ K upgrades per run, one task per chunk. A single mega-upgrade PR is
  unreviewable and unrevertable.
* **A4.5** — if the candidates found ≫ the expected count (a threshold in the
  definition), **stop and escalate instead of fanning out.** A surprise in the
  dependency graph is information, not a backlog.

---

### T-5.03 · Workflow D-2 — CI repair · W7 · M · R2

**Open ONLY:** blueprint `12` §5.4.

**Build:** a trigger on a `workflow_run` failure for a **factory-authored** PR branch;
**2 attempts maximum**; **gate-weakening ⇒ auto-reject**.

**The hard rules:**

* **A4.4** — a fix that edits CI/test/lint config, or removes tests, is **rejected**.
* **Human PRs are never touched.** Only factory-authored PR branches are in scope.
* The attempt cap is 2. A third attempt is a different task, not a continuation.

> A CI-repair agent that "fixes" the test by deleting it is the most direct path from
> an automated factory to an untrustworthy one. The gate-weakening detector from
> checklist 05 (T-2.13) is what makes this safe, and A4.4 is what makes it automatic.

---

### T-5.04 · Context inventory-lite · W7 · S · R1

**Open ONLY:** blueprint `10` §6.

**Build** `factory inventory`: duplicate, stale, orphaned reference, unclassified, and
privileged-unreviewed findings. Track the **duplicate + stale** count.

**Inventory-lite** is the v1 scope: the full inventory (promotion/demotion, FR-15) is
deferred until there is a second repo or ≥10 local context items.

---

### T-5.05 · Proposal schema and manual review path · W7 · S · R2

**Open ONLY:** blueprint `12` §8, blueprint ADR-0007.

**Build:** the `proposals` table + the AP read/approve/reject endpoints; the schema
`{evidence (≥N runs), expected effect, measurement plan, rollback plan}`.

**The route inventory must prove that nothing applies a proposal automatically.**
Applying a proposal = an ordinary reviewed definition change. That is the whole
mechanism: *the factory proposes changes to itself and never applies them* (commitment
4, I-5, SEC-11).

---

## STAGE 2 — Review

Standard reviewer pass. T-5.03 is **R2** but the owner reads the auto-reject rule
personally — an agent that can edit the CI config is an agent that can switch off its
own tests.

---

## GATE ROWS

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G3-21 | **A4.2** a bug-fix regression test that passes on unfixed code is rejected; **A4.3** not-reproducible ⇒ escalated, no speculative fix | `… -t "A4.(2\|3)"` | agent |
| CL-G3-22 | **A4.4** a sweep/CI-repair fix that weakens a gate is rejected; **A4.5** a sweep that finds far more than expected stops and escalates | `… -t "A4.(4\|5)"` | agent |
| CL-G3-23 | **A4.10** inventory reports stale/duplicate/orphaned; the duplicate+stale count is tracked | `… -t "A4.10"` | agent |

---

## EXIT CRITERIA — before checklist 10

- [ ] A bug-fix regression test that passes on the unfixed code is **rejected**.
- [ ] A not-reproducible bug ⇒ `ESCALATED`, and **no speculative fix is produced**.
- [ ] The fix node cannot start before oracle admission.
- [ ] D-1 chunks to ≤ K per run and honours the kill switch.
- [ ] D-1 stops and escalates when the candidate count ≫ expected — no fan-out.
- [ ] D-2 auto-rejects any fix that edits CI/test/lint config or removes tests.
- [ ] D-2 never touches a human-authored PR.
- [ ] The inventory output is deterministic and reports stale/duplicate/orphaned.
- [ ] A proposal without batch evidence is rejected, and the route inventory proves
      **nothing applies a proposal automatically**.

---

## TRAPS

1. **Letting Workflow C fix a bug it could not reproduce.** "It looked like the cause"
   is a guess. A guess in an automated factory becomes a merged regression.
2. **Accepting a regression test that passes on the unfixed code.** That test asserts
   nothing. A4.2 catches it — but only if the check is actually run at admission.
3. **Letting D-1 fan out across 40 upgrades in one run.** It is faster and it is
   unreviewable. The threshold exists so that a surprise becomes an escalation.
4. **Letting D-2 "fix" CI by relaxing the linter.** The gate-weakening detector
   classifies it and auto-rejects. If your D-2 can weaken a gate, the whole red-team
   result from checklist 06 is void.
5. **Building the full context inventory** (promotion, demotion, auto-reclassification)
   when v1 only promised inventory-lite. It is deferred for a reason: one repo, fewer
   than ten local context items.
6. **Adding a "apply proposal" endpoint** because it would be convenient. That is
   commitment 4 broken, and I-5 with it. Applying a proposal is a normal reviewed
   definition change through the definition applier — with its own approval, its own
   hash binding and its own human.
7. **Letting D-1 use `expectedBefore: fail`.** Its oracle is the *existing* suite plus
   lockfile integrity, so it must **pass** on the base commit. An upgrade that fails
   the pre-existing suite is not an upgrade.
