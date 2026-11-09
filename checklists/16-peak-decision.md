# 16 — The v1 → peak decision (the promotion machine)

> **Evidence-gated · `A2` · Nothing here is built during v1**
>
> **This checklist builds nothing.** That is the instruction.
>
> `A2` describes the road to *peak automation*: build → deploy → operate, with L3/L4
> **earned** rather than assumed. It is a decision record and a promotion machine, not
> a work order. Writing code against it during v1 is the single most expensive way to
> waste the plan: it adds scope, it adds risk, and it does not make v1 better.
>
> What you *do* in this checklist is **make sure the doors stay open**, and then decide
> whether to walk through them.

---

## PREREQUISITES

* Checklists 01–13 complete. The PRR is signed.
* The factory has run at L2 for at least the soak period, with real data.

---

## STAGE 0 — The oracle

There is no code oracle here. The oracle is a **decision, recorded with evidence**:

| Item | Oracle |
|---|---|
| The promotion decision | A recorded decision: stay at L2, or promote a named workflow to L3 — with the evidence that justifies it, and the evidence that is still missing |

---

## STAGE 1 — The work

### Part 1 — What "peak" means (and what it does not)

Read `A2` §1. The shape of the road:

* **Today:** build. Issue → PR → a human merges. The factory is at L2.
* **Peak:** the factory builds, deploys, and operates — with autonomy earned per
  workflow, evidence by evidence.
* **The journey is not a date.** Every step has a *trigger*, and the triggers are
  measurements, not deadlines.

> Blueprint `18` is explicit that the blueprint's own numbers are hypotheses. `A2`
> inherits that: **no phase boundary has a calendar date.** If someone proposes
> "promote in March", the answer is "on what evidence?"

### Part 2 — Keep the doors open (this part you *do* act on, during v1)

`A2` §11 lists what to do **now** to keep the path open. These are cheap, and they are
inside v1's scope:

| # | Do this now | Why it matters later |
|---|---|---|
| 1 | Keep the **capability registry** honest — every external system behind an interface with a documented swap map (`A1` §7) | a swap later is a code change; without the seam it is a rebuild |
| 2 | Keep **PostgreSQL the only fixed infrastructure dependency** (ADR-0027) | everything else must stay swappable |
| 3 | Keep the deploy path **GitOps-first** in the design (`A2` §3) | direct-apply deploy becomes a separate, harder path later |
| 4 | Keep the **run artefact complete** — 12 elements, every run | the replay evaluator and the improvement loops are *unbuildable* without it (blueprint `17` §1.1) |
| 5 | Keep the **event log complete and hash-chained** | audit, replay and the outer loop all read it |
| 6 | Keep **cost attribution** accurate per task | cost per accepted change is the peak path's unit economics |
| 7 | Keep the **calibration reports current** | promotion to L3 requires calibrated verifiers |
| 8 | Keep the **deferred register** honest | every trigger in Part D is a checklist you will run later |

> Note #4 and #5: these are already done (checklists 03 and 08). That is not a
> coincidence — the peak path is *only* available because the measurement and the event
> log were built in Phase 0. If you had deferred the artefact store, the whole road
> would be closed.

### Part 3 — The promotion machine (the gate, not the work)

`A2` §5 — autonomy is earned. The promotion criteria, in the shape you will need:

**To promote a workflow from L2 to L3**, you need, at minimum:

| # | Evidence required | Where it comes from |
|---|---|---|
| 1 | **≥ 2 verifiers calibrated** for that workflow, with reports inside the currency window | T-4.04, checklist 08 |
| 2 | **≥ 8 weeks of run data** for that workflow | the soak, extended |
| 3 | **Defect-escape data**: the rate at which merged changes were later reverted or flagged as defects | `factory metrics report` — the defect-escape proxy |
| 4 | **The owner explicitly opts in** | an ADR, not a default |
| 5 | A **tested rollback** for whatever the new autonomy level would permit | `A2` §3 — the GitOps-first deploy path |
| 6 | **The merge-gate story changes**, and that change is itself reviewed | ADR-0016 is explicit: the factory holds **no merge capability** in v1; adding `git.merge` is an ADR, not a ticket |

> **The three things that are never yours to change**, restated here because the peak
> path leans on all three: the **authority split** (ADR-0004), **oracle independence**
> (ADR-0005), and the **human review floor** (ADR-0003). If a promotion plan requires
> changing one of them, that is not a promotion — that is a redesign, and it needs its
> own argued ADR and its own conversation with the owner.

### Part 4 — The phased roadmap beyond v1 (`A2` §6–7)

Read it. **Do not implement it.** But read it, because two things in it are decisions
you must make *now*:

| Decision | When | Consequence of getting it wrong |
|---|---|---|
| **E8 — Deploy via GitOps.** Is the target repo's deploy path GitOps-capable *today*? | Now | If the answer is no, and you later need L3 deploy, you will have to change the deploy model under time pressure |
| **E11 — Autonomy machinery.** Does the definition have the shape to express per-workflow autonomy *now*? | Now | If the definition schema cannot express it, adding it later is a contract change — and contract changes are their own ticket, mid-programme, at the worst time |
| **E9 — Infrastructure as code.** Is the *factory's own* infrastructure in code, or on a server someone configured by hand? | Now | Hand-configured infrastructure is unreproducible and unrollbackable |

These three are **v1 work** if the answer is "no", and they are cheap now and expensive
later. This is the only actionable content in this checklist.

### Part 5 — Record the decision

Write `docs/readiness/promotion-<date>.md`:

```
Decision:      stay at L2 | promote <workflow> to L3
Evidence for:  (numbered, each pointing at a file or a report)
Evidence still missing: (numbered)
Next review:   <date, or the trigger that will bring this back>
```

---

## STAGE 2 — Review

The owner decides. The agent may assemble the evidence; it may not decide, and it may
not implement any of `A2`.

---

## GATE ROWS

None. This checklist closes no gate. It records a decision.

---

## EXIT CRITERIA

- [ ] `A2` §1–§5 read and understood.
- [ ] All eight "keep the doors open" items verified as still true (each with a file
      reference or a command output).
- [ ] The three v1-time decisions (GitOps-capable, autonomy expressible, IaC) answered.
- [ ] Any "no" answered with a v1 ticket.
- [ ] `docs/readiness/promotion-<date>.md` written, with the decision and the evidence.
- [ ] **Nothing from `A2` §7 has been implemented.**

---

## TRAPS

1. **Building `A2` during v1.** The peak path is 39 ticket stubs across six phases. Each
   one is a distraction from the 66 tickets that actually produce the factory. Worse,
   building a deploy path before the factory has proven it can build a *verified PR*
   inverts the whole point: the factory must be trusted before it is trusted with more.
2. **Promoting on a schedule.** "It's been three months, so L3." The triggers are
   measurements: calibrated verifiers, weeks of data, defect-escape rate, an explicit
   owner opt-in, a tested rollback. If you cannot produce those four numbers, the answer
   is no, regardless of the calendar.
3. **Adding `git.merge` as a ticket.** It is an **ADR**. The factory holding no merge
   capability in v1 is what makes L2 credible; adding the capability by ticket, under
   schedule pressure, is how a human review floor quietly disappears.
4. **Leaving the artefact store partial "because the peak path is optional".** The
   replay evaluator, the outer loop, the improvement loop and the promotion evidence
   all read the artefact store. A partial store makes all four unbuildable, and it is
   the cheapest thing to get right and the most expensive to retrofit (blueprint
   `17` §5.5).
5. **Skipping Part 2 because it "isn't building anything".** Part 2 is eight cheap
   checks that keep six months of future work possible. It is the highest-leverage
   fifteen minutes in the whole programme.

---

## The closing thought

The blueprint ends with this, and it is the right note to end on:

> *The value of this system is that a human can trust what it tells them. That is a
> property you maintain or you destroy, and it is destroyed by exactly one thing: a
> confident claim that was not measured.*

The factory is done when ten things are true (blueprint `17` §10) — not when the code
exists. If any of them is false, the factory is not done, regardless of how much code
there is.
