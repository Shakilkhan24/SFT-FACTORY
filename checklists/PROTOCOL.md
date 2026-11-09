# PROTOCOL — the four-stage execution protocol

> **Referenced by every phase checklist.** Read this once, in full, before checklist 01.
> It contains the exact prompts you paste into your agent sessions, the escalation
> format, the self-review checklist, and the rules for evidence.
>
> Sources: pack `07` §2–§11, pack `06` Part A/E, blueprint `17` §5.
> Authority order when sources disagree: **blueprint ADRs > blueprint requirements >
> pack `02`/`03`/`04` > ticket text.** Raise conflicts; never diverge silently.

---

## STAGE 0 — The oracle (a separate session, before any implementation)

The oracle is the acceptance check for a ticket, written **against the specification,
not the implementation**. It must exist, be approved, and have a recorded sha **before**
the implementer starts. If it does not exist → **STOP** (`HR-3`, "No oracle, no work").

> Why: invariant **I-10** — *no agent-authored test alone satisfies an acceptance
> criterion*. A test written by the same run that wrote the code is a restatement, not
> a check. This is the single biggest source of entropy if you collapse the stages.
> Blueprint `17` §5.3: *"a regression test that does not fail on the unfixed code is
> rejected."*

### 0a. Pick the route first (`01` §6, ADR-0021)

| Route | Who writes it | When to use | Trust |
|---|---|---|---|
| **R-H** | the **owner** (human) | the criterion is important and cheap for you to write by hand | trusted |
| **R-G** | a **deterministic generator** (`packages/oracle`) | criterion kind ∈ `command-check`, `cli-golden`, `behavior-table`, `file-assertion` (+`http-contract` if the repo declares a runnable service in `repo.yml`) | trusted |
| **R-A** | an **agent run separate from and before the implementer** | you cannot author it and it is not generatable | `untrusted` until the **owner approves it inside the plan approval** |

Every criterion declares `expectedBefore: fail | pass`:
* `fail` — new behaviour or a bug fix. The oracle must **fail** on the base commit.
* `pass` — a refactor. The oracle must **pass** on the base commit.

Admission (run in T2 at the base SHA) compares each check to `expectedBefore`. A
mismatch ⇒ `oracle.admissionFailed`. R-A regenerates once; R-G escalates as a
generator bug; R-H goes back to the owner.

### 0b. The oracle-author prompt (paste into a **fresh** session)

```
You are the ORACLE AUTHOR for ticket {{T-x.yy}} of the Software Factory build.
You have not seen, and must not look for, any implementation of it.

Inputs (read ONLY these):
  - the ticket's Satisfies and Oracle lines        (docs/pack/05_TICKET_BACKLOG.md)
  - the cited blueprint sections
  - packages/contracts                             (the schemas you assert against)

Write ONLY test files at: {{oraclePaths}}
{{oraclePaths}} must be under the protected oracle path (default
tests/acceptance/<slug>/** or packages/*/test/oracle/**) and must be
human-approved — flag it as R-A (agent-authored) in the manifest.

Rules:
  - Assert BEHAVIOUR through the public interface (black-box). Never assert on
    implementation internals.
  - No implementation code. No mocks of the unit under test.
  - No snapshot-only assertions. At least ONE negative case per rule (the thing
    that must NOT happen).
  - Property tests where the ticket says so.
  - Deterministic: no network, no wall-clock, no randomness that is not seeded.
  - Test names must carry the requirement id verbatim in the display name AND in
    identifier-safe form in the function name (A0.1 -> A0_1; see A1 §3).
  - expectedBefore per criterion: fail for new behaviour/bugs, pass for refactors.
  - Set implementationRunId = null in the provenance record. It must be null.

Output:
  1. the test files
  2. a table: criterion -> test name -> what wrong implementation this test
     would catch
  3. the list of criteria with NO expressible check, if any (these escalate to
     the owner; do not fake them)

Stop and report if any criterion cannot be expressed as a check.
The owner reviews this before any implementer starts.
```

### 0c. The owner's oracle approval (10–15 min, `07` §7)

The owner asks, per criterion:
* Does each criterion **discriminate**? What wrong implementation would pass?
* Is anything checked **only via mocks**?
* Does the test fail on the base commit where `expectedBefore: fail`?

Record `Oracle-Sha` (the sha256 of the oracle files) — it goes in the implementer's
prompt and in the commit trailers.

---

## STAGE 1 — The implementer (a different session, after the oracle is approved)

### 1a. The implementer prompt (paste into a fresh session)

```
You are the IMPLEMENTER for ticket {{T-x.yy}} of the Software Factory build.

Load, in this order and NOTHING ELSE:
  1. AGENTS.md                      (repo root — your contract, hard rules HR-1..HR-14)
  2. the ticket text below
  3. the bundle from: tools/context-bundle {{T-x.yy}}
     (if the bundle exceeds 120 KB, STOP and report — the ticket is too big)

Do NOT read the blueprint corpus, the research analyses, or any file not in the
bundle. Tier-2 documents are never loaded by build agents.

Oracle files (READ-ONLY to you; already approved; sha {{oracleSha}}):
  {{oraclePaths}}

Do:
  - restate the ticket in <= 8 lines
  - list the files you will touch (must be a subset of the ticket's Build line)
  - implement in small commits; run the oracle and `pnpm ci` after each logical step
  - self-review with the AGENTS.md checklist (07 §3.2)
  - open the PR from the template with real evidence (commands + output)

Hard rules you may not break (full list in AGENTS.md §1):
  - one ticket per run; never widen scope
  - never create/edit/delete/skip/weaken/re-snapshot an oracle file
  - touch only the paths in the ticket's Build line
  - boring technology; no new infrastructure or dependency outside 02 §3
  - pure packages have no I/O, no clock, no randomness except injected
  - deny by default; fail closed
  - no secrets or untrusted text in code, logs, fixtures, commit messages
  - no hard-coded model names, prices, hostnames, repo names, tokens
  - no productivity claims; metrics derive from events only

If any AGENTS.md §6 trigger fires: write ESCALATION.md in the worktree root and STOP.

Budget: {{turns}} turns, {{usd}} USD, {{minutes}} minutes.

TICKET:
{{paste the ticket block from docs/pack/05_TICKET_BACKLOG.md}}
```

### 1b. The protocol inside that session

1. `tools/worktree.sh T-x.yy` → branch `ticket/T-x.yy`. Never work on `main`.
2. `tools/context-bundle T-x.yy` → `.context/T-x.yy.md` (+ size/sha). Load nothing else.
3. Restate the ticket in ≤8 lines; list the planned files.
4. Confirm the oracle files exist; note their sha. **If not: STOP (HR-3).**
5. Implement in small commits. After each logical step run the oracle and `pnpm ci`.
6. Self-review (checklist below). Fix before opening the PR.
7. Open the PR from the template: Ticket · Allowed-paths · Oracle-Sha · evidence ·
   risks · **what you did NOT do**.
8. Address review comments by changing code only. If a comment asks to change an
   oracle, **the owner does that, not you**.
9. After merge: delete the worktree. Never leave containers, branches or credentials.

**Commits:** `type(scope): message` + trailers `Ticket: T-x.yy` and `Oracle-Sha: <sha>`.

**Expected failures** return `Result<T,E>`; exceptions are for programmer errors.
Every error maps to a **FailureClass** (`AGENTS.md` §4).

### 1c. The self-review checklist (the implementer fills this in the PR)

- [ ] Diff ⊆ Allowed-paths; no oracle/protected path touched
- [ ] Oracle tests pass; `pnpm ci` green; `lint:deps` green
- [ ] Every new failure path is **fail-closed**, emits an event or error class, and cleans up in `finally`
- [ ] No secret / untrusted text in code, logs, fixtures, commit messages
- [ ] No hard-coded model/host/price/repo; no new dependency or infrastructure
- [ ] Idempotency considered for every external effect; resumable after a crash
- [ ] Pure packages have no I/O; strict schema validation on every external input
- [ ] Tests assert **behaviour** (would a wrong implementation fail them?); no mocks of the unit under test
- [ ] You wrote down what you did **NOT** do, and any `[VERIFY]` facts you relied on (with sources)

---

## STAGE 2 — The reviewer (a third session, fresh context, no implementer transcript)

```
You are an independent REVIEWER. Inputs: the ticket text, the oracle files, the diff,
the `pnpm ci` output. NOTHING ELSE. You do not have the implementer's transcript and
must not ask for it.

Check:
  1. Does the diff satisfy the ticket's Satisfies list?
  2. Any scope creep, or any path outside Allowed-paths?
  3. Any change to oracle / protected paths?
  4. AGENTS.md hard-rule violations — I/O in pure packages, secrets, hard-coded
     models, untrusted text in code, new dependencies
  5. Fail-open paths, swallowed errors, missing events, missing idempotency,
     missing cleanup in finally
  6. Do the tests assert behaviour — would a wrong implementation pass?

Output:
  - a findings table: severity (blocker | major | minor) · file:line · evidence ·
    suggested fix
  - a verdict
  - "what I could NOT verify"

The reviewer SUPPLEMENTS the owner's review. It never replaces it.
```

---

## STAGE 3 — The owner (human)

| Tier | Typical time | What the owner does |
|---|---|---|
| **R4** | ≈45 min | Read **every line**. Confirm the oracle sha is unchanged since approval. Run `test:redteam`. Ask "what input makes this fail open?" **Apply a mutation to the main guard and watch a test fail.** Read the reviewer-agent findings **last**. 12-hour cooling-off before merging a `[PACK]` change unless blocking. |
| **R3** | ≈25 min | Read code and tests. Check the tests assert behaviour, not implementation. Confirm dep rules and fail-closed paths. Skim reviewer findings first. |
| **R2** | ≈12 min | Diff + tests skim. Run `pnpm ci`. Exercise the feature once. |
| **R1** | ≈5 min | Skim. CI green. |
| **Oracle approval** | ≈10–15 min | Does each criterion discriminate? What wrong implementation would pass? Anything checked only via mocks? |

**Load estimate [PACK]:** 66 tickets ≈ 35 h of first-pass review ≈ **50 h with
rework ≈ 6–7 h/week**. If actual review minutes exceed this by >30 %, **slow the WIP
limit — do not shorten the review.**

---

## ESCALATION format (`AGENTS.md` §6)

Write `ESCALATION.md` in the worktree root, then stop. Headings, in order:

```
Ticket:        T-x.yy
Trigger:       which §6 trigger fired
What I was doing:
Evidence:      file:line, doc §, command output
Options:       each option and its consequence
Recommendation:
What I have NOT changed:
```

**§6 triggers:** any hard rule would be violated · the oracle is missing/wrong/contradicts
the ticket · the ticket and a blueprint ADR disagree · an external fact differs from the
ticket or spike · a needed capability is not in the registry · you would need a secret ·
**a security doubt of any kind** · you hit the turn/cost budget · the change exceeds
~600 lines · tests pass only after weakening a check.

**A note on `[VERIFY]`:** anything tagged `[VERIFY]` in the pack is an external fact
(endpoint, header, field, flag, model name, limit) that must be confirmed against
**current official documentation** or a spike note in `docs/spikes/`, and the source
recorded in the PR. Do not code against a remembered flag.

---

## Evidence rules (`06` header, Part E)

A gate row is green only when it is ticked **with evidence**: command output, run id, PR
link, or a dated record in `docs/evidence/`. **A row without evidence is unticked.**

Waivers (`docs/waivers.md`): owner-signed, time-boxed, recorded — **never for 🔒 rows**.

🔒 rows are security-critical. There is no waiver.

---

## The Friday checkpoint (30 min, every week, `06` Part E)

1. Gate status: which `CL-G*` rows are ticked with evidence? Anything unticked that should be?
2. Two red weeks in a row? ⇒ apply the next cut from `01` §5.2; record it in Part D.
3. Review load: open PRs ≤3? oldest PR age <24 h? review-minutes-per-PR trend.
4. Security signals since last Friday: `tool.denied`, `policy.denied`, `net.egress.denied`,
   `patch.rejected`, `webhook.rejected` counts; **egress allow-list size and additions**.
5. Oracle health: **same-run-authored oracle rate (must be 0)**, oracle coverage rate,
   share of tasks escalating "criteria not expressible".
6. Cost: spend vs cap; cost per accepted change; reconciliation drift <2 %.
7. Quality: accepted-PR rate, first-pass success, rework loops, reverts within 14 days.
8. Flake check: any red-team/fault test that flaked? **A flaky security test is a security finding.**
9. Docs/ADRs updated for any decision made this week; `docs/build-metrics.csv` updated.
10. Pick next week's tickets (≤3 concurrent agents); confirm each has its oracle ready
    **before** it starts.

---

## Build metrics (`07` §11)

Append one row per ticket to `docs/build-metrics.csv`:

```
ticket, path_tier, size, agent, model, start, end, wall_minutes, turns, usd,
oracle_author (owner|generator|agent), oracle_change_requests, review_minutes,
review_rounds, rework_loops, escalations, defects_found_later
```

These numbers describe **this build**. They are not targets for the factory, and
they are never quoted as a productivity claim (`HR-14`, `MEAS-06`).

---

## Parallel agents (`07` §6)

* **At most 3 concurrent build agents**, each in `../wt/T-x.yy` on branch `ticket/T-x.yy`.
* **File ownership = the ticket's Build line.** `tools/scope-guard` fails a PR that
  strays. Two tickets with overlapping paths never run together.
* **Contracts first.** A ticket needing a contract change waits for the tiny
  `contracts` ticket (S, R3) to merge.
* **Merge order follows the dependency graph** (`05` §9). Rebase; never merge `main`
  into ticket branches.
* **R4 tickets run alone** with the owner present.
* **One owner reviews at a time**; the queue is FIFO within a tier, R4 first.
