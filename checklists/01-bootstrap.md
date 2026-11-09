# 01 — Bootstrap: the factory's own tooling

> **Phase W0 (3 days) · Tickets T-0.01 … T-0.06 · Spikes S-1 … S-6 · Gate G0**
>
> This phase builds **no factory capability**. It builds the *discipline*: the repo, the
> CI, the guards that stop an agent from cheating, the manual factory that runs the
> oracle-first loop by hand, and the two day-one clocks.
>
> **Without this phase, every later ticket is unbounded** — no oracle guard, no scope
> guard, no context bundle, no CI. Skipping it is the single most expensive shortcut
> in the plan.

---

## PREREQUISITES

* None. This is the first phase.
* The owner must be available: **T-0.01 is a human ticket** and it blocks almost
  everything (`D1` — the target repo — must be answered by W4 at the latest).

---

## STAGE 0 — Oracles for this phase

Five of the six tickets here have oracles, and they are unusual: this is the phase
where the oracle *is* the CI infrastructure.

| Ticket | Oracle | Who writes it |
|---|---|---|
| T-0.01 | `06` items CL-G0-01…05 ticked with evidence links | **owner** (R-H) |
| T-0.02 | `pnpm ci` green on the empty scaffold; **a negative test proves a pure package importing `node:fs` fails the deps rule** | R-G / agent (R-A) |
| T-0.03 | oracle-guard rejects a synthetic PR editing an oracle file and accepts a human-authored one; scope-guard rejects a PR touching a path outside `Allowed-paths`; context-bundle fails on an oversize bundle | R-A (agent), separate run |
| T-0.04 | all fields produced on a fixture repo; owner reviews the numbers | R-H (owner) + agent |
| T-0.05 | every command in `repo.yml` runs green on a clean clone; required CI check names listed; criticality map reviewed | R-H + agent |
| T-0.06 | finds the known fixes in a fixture history; git-only, no network | R-G / agent |

> Note the T-0.02 negative test: it is the *first* invariant-shaped test in the
> project, and it proves the dependency rules actually bite before any real code
> exists. Do not skip it — a deps rule that has never failed is not a rule.

---

## STAGE 1 — The work

### T-0.01 · Owner decision sheet and accounts · W0 · S · human

**Open ONLY:** pack `01` §6–§7 (decision register + owner decision sheet),
pack `04` §2.1 (the GitHub App permissions).

**Do:**
1. Answer **D1–D10**. The defaults let work start, but **D1 (target repo) is the one
   that matters** — no default exists. If D1 is unanswered by W4, use the documented
   fallback `factory-sandbox` (a small TS service with real tests) and proceed through
   W3; record the fallback in the ADR.
   * D1 target repo · D2 stack (TS default) · D3 hosting · D4 provider accounts +
     monthly cap (starting caps [PACK]: $5/task, $50/day/workflow) · D5 second provider ·
     D6 approvers (owner only) · D7 notification channel · D8 secrets mechanism ·
     D9 network exposure · D10 daily review time (2–3 h)
2. **Pick the factory-stack profile** (`A1` §4.3) — the language you can review
   fastest. Do this **before W1** so nothing is built twice. Record it in
   `docs/stack-profile.md` and amend ADR-0013. (Checklist 02 assumes the TypeScript
   profile; if you picked another, `A1` §5 gives the re-targeting procedure and only
   the *paths* change.)
3. Create the **GitHub App** with **exactly** the permissions in `04` §2.1 —
   Contents RW, Pull requests RW, Issues RW, Checks RW, Commit statuses RW (optional),
   Actions R, Dependabot alerts R (optional), Metadata R.
   **Deliberately NOT granted:** Administration, **Workflows**, Secrets, Environments,
   Members. (Without Workflows, GitHub rejects pushes that touch
   `.github/workflows/**` — that is a free second layer behind the path-deny.)
   Subscribe to: `issues`, `pull_request`, `pull_request_review`, `workflow_run`,
   `check_run`, `push`, `installation`, `installation_repositories`.
   **Not subscribed:** `issue_comment`, `pull_request_review_comment` — there is no
   chat-with-agent channel, so comments carry no instructions.
   Install **only** on the allow-listed repos.
4. Provider keys, Postgres + bucket (or `docker-compose.dev.yml` for W1–W5), an age key.
5. Commit the decisions as `docs/adr/00NN-*.md` with `Status: Accepted` (or Amended).

**Stop if:** D1 is unanswered by W4 → use `factory-sandbox` and document it.

---

### T-0.02 · Monorepo scaffold and CI · W0 · M · R2

**Open ONLY:** pack `02` §3 (repo layout + dependency rules), pack `01` §6 ADR-0012,
pack `A1` §3 (the task-name surface) and `A1` §4–5 (if not the TS profile).

**Build** (TypeScript profile; a different profile changes only paths and task names):

* pnpm workspace per `02` §3 — empty packages, strict tsconfig references.
* Lint + format. **Vitest + fast-check.** Dependency-cruiser config encoding the `02` §3 rules.
* `tools/coverage-check` — fails CI if any requirement id in
  `blueprint-reference/06_REQUIREMENTS_AND_NFRS.md` is missing from `06` Part C, or its
  tally is stale. (Part C tallies **99** requirements: ✅ 75 · 🟡 12 · ⏸ 10 · ◻ 2.)
* GitHub Actions `ci.yml`; `docker-compose.dev.yml` (Postgres 16, MinIO); `.nvmrc`; `CODEOWNERS`.

**These exact scripts** — every checklist item in the whole pack refers to them, so
the names are load-bearing:

| Task | What it does |
|---|---|
| `ci` | lint + typecheck + lint:deps + test + invariants + red-team stubs |
| `lint` · `lint:deps` | lint; dependency rules (pure packages have no I/O) |
| `typecheck` | strict type check |
| `test` | unit + property tests |
| `test:acceptance` | acceptance/oracle tests; select with `-t "A0.1"` |
| `test:invariants` | INV-1…INV-12; select with `-t "INV-4"`; `--mutation` flag |
| `test:redteam` | AT-1…AT-15; select with `-t "AT-7"` |
| `test:fault` · `test:concurrency` · `test:e2e` | fault injection, concurrency, end-to-end |

> `pnpm <task>` is the TypeScript rendering of a canonical task name. In a non-TypeScript
> profile the same task is `just <task>` (ADR-0026). The **test-id selector** that
> replaces `-t "A0.1"` per stack is in `A1` §3 — the identifier rule is: the roadmap id
> appears **verbatim** in the display name and in identifier-safe form in the function
> name (`A0.1` → `A0_1`).

**Oracle:** `pnpm ci` green on the empty scaffold, **plus a negative test** proving a
pure package importing `node:fs` fails the deps rule.

---

### T-0.03 · Manual factory · W0 · M · R3

**Open ONLY:** pack `07` §2–§7.

**Build** — this is the toolchain that makes the rest of the plan safe:

* `AGENTS.md` — copy **verbatim** from `07` §2 (between the markers). Do not paraphrase
  it; it is the contract every agent signs.
* `docs/ticket-template.md`, `.github/pull_request_template.md`.
* `tools/worktree.sh <ticket>` — per-ticket worktree + cleanup.
* `tools/oracle-guard` — **CI check**: a PR from an implementer branch may not modify
  `**/test/oracle/**` or `tests/acceptance/**` unless the commits are human-authored or
  labelled `oracle-approved`.
* `tools/scope-guard` — **CI check**: reads the `Allowed-paths:` globs from the PR body
  and fails if the diff touches anything else.
* `tools/context-bundle <ticket>` — concatenates the ticket's `Read` list into
  `.context/<ticket>.md`, prints byte size + sha256, and **fails above 120 KB**.

**From this point on, every ticket follows `07` §3.** This is the "manual factory"
(ADR-0015) — the build follows the doctrine it implements, so by W5 the factory can
take over part of its own backlog.

---

### T-0.04 · Pre-factory baseline · W0 · M · R2 — **day-one clock #1**

**Open ONLY:** blueprint `14` §9, blueprint `15` §1.

**Build:** `tools/baseline` → `baselines/pre-factory-<date>.{json,md}` for the target
repo, last 90 days:

* PR lead time · issue→merge · review rounds · PR size · revert/hotfix rate within
  14 days · CI failure rate.
* If the repo deploys, also capture the **DORA baseline** (deployment frequency, lead
  time for changes, change failure rate, time to restore) from CI/CD and incident history.

**Measured once, before any factory output exists.** Committed and never regenerated.

> This is commitment 5: *no productivity number without a baseline.* Without this file,
> every later claim is a guess, and `factory metrics report` will refuse to print a delta.
> It also gates **T-4.01** and **T-4.05**, and PRD-9 at G4.

---

### T-0.05 · Target repo onboarding file · W0 · M · R2

**Open ONLY:** pack `03` §4.9, pack `03` §4.8.

**Build:**
* In the **target** repo, via an owner PR: `.factory/repo.yml`, `CODEOWNERS`, and a
  digest-pinnable toolchain `Dockerfile`.
* In the factory repo: `definition/criticality/<repo>.yaml`, `definition/repos/<repo>.yaml`.

**Oracle:** every command in `repo.yml` runs green on a clean clone; the required CI
check names are listed; the criticality map is reviewed by the owner.

> `repo.yml` is the target's build/test/lint/typecheck contract. It is also what tells
> the factory **which commands it may run** — the command set is a capability, not a
> free-text instruction (HR-13, and the route-inventory test in T-1.14).

---

### T-0.06 · Calibration corpus mining · W0 · S · R2 — **day-one clock #2**

**Open ONLY:** blueprint `14` §5.2, §5.6.

**Build:** `tools/mining` → `calibration/candidates.jsonl` with
`{fixSha, preFixSha, testPaths, message}`, mined from commits that fix a bug **and**
touch tests.

**Oracle:** finds the known fixes in a fixture history; git-only, no network.

> The calibration corpus "largely already exists in the git history" (blueprint `17`
> §6.1). This is the raw material for T-4.02 and T-4.03, and for the calibration
> reports that let a verifier gate a merge at all (A2.1). Day two of the project.

---

### Spikes S-1 … S-6 — time-boxed, ≤ ½ day each, **no production code**

**Open ONLY:** the section each spike is named against (pack `05` §1), plus official docs.

**The spike prompt** (pack `07` §4d):

```
You are running SPIKE {{S-n}} (time-box {{minutes}} min). Goal: settle the questions
listed for it in docs/pack/05 §1 using OFFICIAL documentation and a throwaway proof.
Write docs/spikes/{{S-n}}.md: confirmed facts (with source URL and date), exact
commands/flags/fields, surprises, and any change this implies for the pack.
Write no production code. Stop at the time-box.
```

| Spike | Question | Must confirm | Precedes |
|---|---|---|---|
| **S-1** | Postgres append design | gapless `seq` under 50 concurrent writers; row triggers fire on partitions; the app role truly cannot UPDATE/DELETE/TRUNCATE; NOTIFY payload carries only `seq` (size limit) | T-1.02, T-1.03 |
| **S-2** | GitHub App mechanics | installation token narrowed to 1 repo + subset permissions; revoke call; push via `GIT_ASKPASS` with no token in argv; push touching `.github/workflows/**` rejected **without** the Workflows permission; check-run create; ruleset required-check pinned by `integration_id`; webhook signature round-trip | T-1.09, T-2.04 |
| **S-3** | Rootless Docker sandbox networking | `--internal` network + edge containers on two networks; DNS for edge names; CONNECT proxy to an allow-listed host works; direct internet/host/metadata unreachable from T2; resource flags honoured rootless; optional `runsc` | T-2.10 |
| **S-4** | Claude Code headless inside T2 through the passthrough | everything in pack `04` §8 "S-4 must confirm"; golden stream captured | T-2.11 |
| **S-5** | Passthrough usage accounting for streamed responses | gateway-counted vs provider-reported usage within tolerance; cache-token fields; client disconnect; budget-refusal behaviour observed by the CLI | T-2.11 |
| **S-6** | Structured output portability | forced tool call vs native structured output on both providers; invalid-JSON rate; token overhead | T-1.10 |

> **S-1, S-2 and S-3 are on the critical path.** S-1 blocks T-1.02/T-1.03, S-2 blocks
> T-1.09 and T-2.04, S-3 blocks T-2.10. Do them in W0–W1, not "later".
>
> **Every flag, endpoint, header and field name in the pack tagged `[VERIFY]` must be
> confirmed in the matching spike** and the source recorded. Do not code against a
> remembered flag (`HR-11`).

---

## STAGE 2 — Review

Every PR in this phase gets the standard reviewer pass (`PROTOCOL.md`, Stage 2).
T-0.03's PR is **R3** (owner reads the guards line by line — they are the trust
boundary). T-0.04's numbers are **owner-reviewed** (R-H oracle).

---

## GATE ROWS — G0 (tick with evidence)

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G0-01 | Owner decisions D1–D10 recorded as ADR files, each Accepted/Amended | `ls docs/adr/00{13..25}*.md`; each has `Status:` | owner |
| CL-G0-02 🔒 | GitHub App has exactly the permissions/events in `04` §2.1; **no Workflows or Administration**; installed only on allow-listed repos | App settings export attached | owner |
| CL-G0-03 🔒 | No provider/App secret in the repo, CI logs or shell history; sops+age file in place | `gitleaks detect --no-banner` = 0 findings | agent |
| CL-G0-04 | Scaffold CI green, including the *negative* deps-rule test | `pnpm ci` | agent |
| CL-G0-05 🔒 | `AGENTS.md` committed; `tools/oracle-guard` is a required check and rejects a synthetic oracle-edit PR | guard test output + ruleset screenshot | agent |
| CL-G0-06 | Pre-factory baseline committed **once** and never regenerated | `git log --oneline -- baselines/pre-factory-*` shows 1 commit | owner |
| CL-G0-07 | Target `.factory/repo.yml` commands run green on a clean clone | transcript in `docs/evidence/G0-07.md` | agent |
| CL-G0-08 | Calibration candidates mined (≥10 fix commits, or shortfall documented) | `wc -l calibration/candidates.jsonl` | agent |
| CL-G0-09 | Spike S-1 done; S-2/S-3 scheduled in W1–W2 | `docs/spikes/S-1.md` | agent |
| CL-G0-10 | Friday checkpoint (Part E) on the calendar | owner confirms | owner |
| CL-G0-11 | Factory-stack profile chosen (`A1` §4.3), recorded in `docs/stack-profile.md`; ADR-0013 amended; the task surface exists and `ci` runs green | file exists + `ci` green | owner |

---

## EXIT CRITERIA — before checklist 02

- [ ] All eleven G0 rows ticked **with evidence** (no waivers on 🔒 rows).
- [ ] `pnpm ci` green, including the negative deps-rule test.
- [ ] `tools/oracle-guard`, `tools/scope-guard`, `tools/context-bundle` all exist and
      have a passing test each.
- [ ] `docs/stack-profile.md` exists; ADR-0013 amended to match it.
- [ ] `baselines/pre-factory-*.json` committed (exactly one commit).
- [ ] `calibration/candidates.jsonl` exists with ≥10 entries or a documented shortfall.
- [ ] `docs/spikes/S-1.md` exists; S-2 and S-3 are scheduled in W1–W2.
- [ ] The target repo exists, `.factory/repo.yml` commands are green, and the criticality
      map is owner-reviewed.
- [ ] `AGENTS.md` is committed and unmodified from `07` §2.

---

## TRAPS — what actually goes wrong here

1. **Copying the pack into the repo and then editing the copy.** The pack is
   read-only. If the copy changes, the checklist IDs and section references in every
   later checklist drift out of alignment. Copy once; change via a reviewed PR with a
   one-line reason in `docs/pack/CHANGELOG.md`.
2. **Granting the GitHub App the Administration permission** "to set up the ruleset".
   No — the **owner** applies rulesets with their own credentials
   (`tools/protect-repo`, `04` §2.4). The App must have **no** bypass actor.
3. **Granting the App the Workflows permission.** It is deliberately excluded; GitHub
   then rejects pushes that touch `.github/workflows/**`, which is the desired
   second layer behind the path-deny.
4. **Regenerating the baseline.** It is measured once. If you regenerate it, you have
   destroyed the only honest comparison point you will ever have.
5. **Deferring the spikes.** S-1/S-2/S-3 each block a chain of tickets. Discovering a
   wrong flag in W4 costs a rewrite; discovering it in a spike costs a paragraph.
6. **Writing the guards but not testing them negatively.** A guard that has never
   rejected anything is not a guard. Each guard needs a test that proves it fails.
7. **Scope-creeping into Phase 0 in W0.** The temptation is to "start the event log
   since it is easy". Resist — the tickets are ordered for a reason, and a
   half-built event log without the hash chain and the CAS is worse than none.
