# 00 — START HERE: the build checklists

> **You are an AI agent (Claude, Codex, or equivalent) that will build a Software Factory.**
> This folder is your **work order book**. You do not read the whole Software Factory Pack
> and then start coding — that is the failure mode this folder exists to prevent. You read
> **one checklist**, do **one phase**, stop, and report.

---

## 0. The one-paragraph briefing

You are building the control plane of an autonomous software-production organisation.
A **modular monolith** (TypeScript, pnpm workspaces, Postgres + S3, rootless Docker)
that turns a reviewed GitHub issue into a verified pull request — with the acceptance
oracle written **before** the implementation, every consequential action policy-checked
and logged, every run fully recorded, and **a human merging every change**.

The factory runs at **autonomy L2**: agents execute in isolation and open PRs; a human
reviews the code and merges. Production deployment, incident response and autonomous
merging are **out of scope for v1**.

Your job in this folder: execute checklists `01` → `16` in order, then `17`.

---

## 1. Read this, then start. Do not read more than you need.

| # | File | When to read it | Length |
|---|---|---|---|
| **00** | this file | **now, always** | ~6 min |
| **01**–**16** | the phase checklists | **one at a time**, in order | 15–40 min each |
| **17** | the full index + coverage table | when you need to know "where am I?" | reference |

**The three files you must read before touching any code** (they are Tier-0 context and
they are short):

1. `../00_START_HERE_AGENT_ENTRYPOINT.md` — orientation, the file map, the conventions.
2. `../07_AGENT_OPERATING_MANUAL.md` — **§2 contains `AGENTS.md` verbatim.** That is your
   contract: the hard rules, the commands, the protocol, the escalation format.
3. The current checklist (`checklists/NN-*.md`).

That is it. Do **not** read `01_MISSION_SCOPE_AND_DECISIONS.md` in full — you will get
the parts you need, quoted, in the checklist that needs them. Do **not** read the
blueprint corpus. Do **not** read `software-factory-pack/` top to bottom.

> **Why this matters (read `07` §8, "Context hygiene"):** a context bundle over 120 KB
> means the task is too big or its reading list is sloppy. The pack defines three tiers:
> Tier-0 always, Tier-1 per ticket, Tier-2 **never loaded by build agents** (research
> analyses, provenance docs). Every checklist tells you exactly which tier-1 files to
> open. Opening more is a defect, not thoroughness.

---

## 2. Where things are (paths are relative to the repo root you will create)

```
factory/                          # your repo
├─ AGENTS.md                      # copy from 07 §2 — verbatim, do not paraphrase
├─ docs/pack/                     # the Software Factory Pack, read-only
│  └─ blueprint-reference/        # curated blueprint files — open only what a checklist names
├─ docs/{adr,spikes,evidence,runbooks,readiness}/   # you produce these
├─ docs/build-metrics.csv         # one row per ticket (07 §11)
├─ definition/                    # declarative definition — R4, agent cannot write
├─ migrations/                    # forward-only SQL — R4
├─ packages/{contracts,core,policy,state,eventlog,db,definition,broker,credentials,
│            gateway,artefacts,isolation,harness,context,oracle,verify,review,
│            approvals,merge,scm-github,calibration,orchestrator}/
├─ apps/{api,worker,cli,dashboard}/
├─ tests/{invariants,redteam,e2e,fault,concurrency,fixtures}/
└─ tools/{baseline,mining,protect-repo,worktree.sh,context-bundle,oracle-guard,scope-guard}
```

**In this working copy** the pack lives at `../software-factory-pack/software-factory-pack/`.
You copy it to `docs/pack/` in your repo as part of **Checklist 01**.

---

## 3. The loop you run, every single time

```
 ┌─ STAGE 0 ─ ORACLE ──────────────────────────────────────────┐
 │  A SEPARATE session. Writes the acceptance tests FIRST.     │
 │  Never sees an implementation. Never sees one later.        │
 │  (prompt: 07 §4b)                                            │
 │  If oracle is missing → STOP. No oracle, no work. (HR-3)    │
 └──────────────────────────────────────────────────────────────┘
                            ↓  (owner approves the oracle)
 ┌─ STAGE 1 ─ IMPLEMENT ────────────────────────────────────────┐
 │  Worktree → context bundle → restate → implement → self-review│
 │  → PR with evidence.                                          │
 │  (prompt: 07 §4a)                                            │
 └──────────────────────────────────────────────────────────────┘
                            ↓
 ┌─ STAGE 2 ─ REVIEW (a different agent, fresh context) ───────┐
 │  Findings table + verdict. (prompt: 07 §4c)                  │
 └──────────────────────────────────────────────────────────────┘
                            ↓
 ┌─ STAGE 3 ─ OWNER ────────────────────────────────────────────┐
 │  Human review at the path-tier depth. (07 §7)                │
 │  Merge. Tick the gate rows with evidence. Log build metrics. │
 └──────────────────────────────────────────────────────────────┘
```

**Stage 0 is not optional and it is not the same session as Stage 1.**
That separation is invariant **I-10**: *no agent-authored test alone satisfies an
acceptance criterion.* If you write the test and the code in one run, the oracle is a
restatement of the implementation, not a check on it, and the entire factory becomes
untrustworthy. Every checklist spells out the two prompts.

**Per ticket, you also do** (from `AGENTS.md` §3):

1. `tools/worktree.sh T-x.yy` — never work on `main`.
2. `tools/context-bundle T-x.yy` — ≤120 KB; load nothing else.
3. Restate the ticket in ≤8 lines; list the files you will touch (must be ⊆ Build).
4. Confirm the oracle files exist; note their sha. If not → **STOP**.
5. Implement in small commits; run the oracle + `pnpm ci` after each logical step.
6. Self-review against `07` §3.2 checklist.
7. Open the PR from the template, with evidence.
8. Address review comments by changing code only.
9. After merge, delete the worktree.

**Budgets** (`AGENTS.md` §7): S ≤ 40 turns / ≤ $3 · M ≤ 80 / ≤ $6 · L ≤ 100 / ≤ $10 ·
wall-clock ≤ 2 h · ≤ ~600 changed lines. Exceed → split the ticket or escalate.

---

## 4. The five commitments (from blueprint `00`/`17` §1) — the things you may never trade

1. **Independent verification** — the oracle is written before, and by someone other than, the implementer.
2. **Policy is deterministic; orchestration is probabilistic** — and they are never the same component.
3. **Autonomy is earned per workflow** — start at L2. Human code review is the floor.
4. **The factory proposes changes to itself and never applies them.**
5. **No productivity number without a baseline.**

Three things are never yours to change, without an explicit argued ADR:
the **authority split** (ADR-0004), **oracle independence** (ADR-0005), the
**human review floor** (ADR-0003).

**Must-not-build** (blueprint `17` §2) — a checklist that seems to need one of these is
mis-specified; escalate instead:
chat-with-the-agent interface · autonomous self-modifying factory · vector DB as context
store · message broker / Kubernetes / event-streaming platform · general-purpose workflow
engine · one agent per role · LLM grader for every check · multi-tenancy ·
confidence-score merging without calibration.

---

## 5. When you are stuck: escalate, do not improvise

Write `ESCALATION.md` in the worktree root and stop. Format (`AGENTS.md` §6):
**Ticket / Trigger / What I was doing / Evidence (file:line, doc §) / Options with
consequences / Recommendation / What I have NOT changed.**

Triggers: any hard rule would be violated · the oracle is missing, wrong, or contradicts
the ticket · the ticket and a blueprint ADR disagree · an external fact differs from the
ticket or a spike note · a needed capability is not in the registry · you would need a
secret · **any security doubt of any kind** · you hit the turn/cost budget · the change
exceeds ~600 lines · tests pass only after weakening a check.

**Deny by default.** When unsure whether an action is permitted: deny and escalate.
Never "let it try and see."

---

## 6. The checklist anatomy (so you know what you are reading)

Every `NN-*.md` has the same shape:

```
Header            what phase this is, which tickets, which gate
PREREQUISITES    what must already be merged (ticket IDs, gate rows)
STAGE 0          the oracle-author prompt, per ticket
STAGE 1          the implementer prompt, per ticket, with:
                   Open ONLY:   the tier-1 files to read
                   Goal:        what "done" means for this ticket
                   How:         the ordered steps, the algorithms, the traps
                   Do NOT open: the files that would blow your context budget
STAGE 2          the reviewer prompt
GATE ROWS        the CL-G* rows this phase ticks, with the exact verify command
EXIT CRITERIA    what must be true before the next checklist
TRAPS            the mistakes that actually happen in this phase
```

---

## 7. The order, and why it is this order

| Checklist | Phase | Tickets | Gate | Blocking reason |
|---|---|---|---|---|
| **01** | Bootstrap | T-0.01…0.06, S-1…S-6 | **G0** | Without the scaffold, CI and the manual factory there is no oracle guard and no scope guard — every later ticket is unbounded. |
| **02** | Contracts + database | T-1.01…1.05 | — | Every other package imports `contracts`. A contract change inside another ticket is forbidden (HR-12). |
| **03** | Control plane | T-1.06…1.17 | **G1** | Phase-0 exit. The event log, policy engine, broker, gateway, orchestrator — the pieces everything else stands on. |
| **04** | Context + intake | T-2.01…2.08 | — | Nothing can be specified without a context assembler and a prompt builder. |
| **05** | Execution + gates | T-2.09…2.19 | **G2** | The Workflow-B spine: approval, T2, harness, worker, verification, reviewer, merge gate. First real issue lands here. |
| **06** | Safety hardening | T-3.01…3.06 | — | Tagging audit, red-team suite, supply chain, audit tool, secret scanning. |
| **07** | Resilience | T-3.07, T-3.08 | — | Fault injection and concurrency. Cannot be trusted until proven under failure. |
| **08** | Measurement + calibration | T-4.01…4.05 | — | Metrics and the calibration harness. Starts in W3, finishes in W7. |
| **09** | More workflows | T-5.01…5.05 | — | Workflow C, D-1, D-2, inventory-lite, proposals. |
| **10** | Production deploy | T-6.01…6.03 | — | VM, backups, observability. |
| **11** | Runbooks + drill | T-6.04 | — | Each runbook is exercised once, with a dated record. |
| **12** | Soak | T-6.05 | — | ≥20 real tasks over ≥14 days. Wall-clock bound; start it early (it starts in W5). |
| **13** | Production readiness | T-6.06 | **G4** | PRD-1…PRD-10 and the go/no-go. |
| **14** | The invariants sweep | cross-cutting | — | PRD-2 mutation check: every INV-1…INV-12 must have a test that fails when its guard is broken. |
| **15** | The red-team sweep | cross-cutting | — | PRD-3: AT-1…AT-15 as a **required CI check**. |
| **16** | The v1 → peak decision | A2 | — | **Build nothing.** The promotion machine and the evidence you must collect before L3. |
| **17** | Full index | — | — | Coverage table. Where am I? |

**Read `17` once now** if you want the whole map, then work `01`→`16` in order.

---

## 8. The rules for this folder

* **The pack is read-only.** Never edit `software-factory-pack/**` or the three READMEs at
  the top of this directory. If the pack is wrong, raise it (checklist → escalation →
  owner). The owner fixes it via a reviewed change with a one-line reason in
  `docs/pack/CHANGELOG.md`.
* **These checklists are also read-only to you.** They tell you *where to look* and *what
  to do*. The spec lives in the pack; the checklist is the execution order.
* **One checklist at a time.** Not two. Not "just the DB part".
* **Finish the exit criteria before moving on.** A green checklist you skipped is worse
  than a red one, because it hides the gap.
* **Evidence or it did not happen.** Every ticked gate row needs a command output, a run
  id, a PR link, or a dated record in `docs/evidence/`. A row without evidence is unticked.
* **Ask, don't assume.** If a checklist's "Open ONLY" list is not enough to implement
  something, that is a **pack defect**: escalate with the exact question, do not go
  hunting through the blueprint for an answer.
