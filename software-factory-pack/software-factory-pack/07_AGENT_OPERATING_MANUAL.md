# 07 — Agent Operating Manual

> **Audience:** every AI agent that works on the build, and the owner who supervises them.
> **What is here:** (§1) where files live · (§2) **`AGENTS.md` to copy verbatim to the repo root** · (§3) the ticket execution loop · (§4) copy-paste prompt templates · (§5) the delivery-strategy playbook ("super-dev" — see the note there) · (§6) parallel-agent rules · (§7) owner review protocol · (§8) context hygiene · (§9) escalation · (§10) anti-patterns · (§11) build metrics.

---

## 1. Where things live in the repo

```
factory/                          # your repo
├─ AGENTS.md                      # §2 of this file, verbatim
├─ docs/pack/                     # this pack (00…08, A1, A2)
│  └─ blueprint-reference/        # curated blueprint files (see CONTEXT_MANIFEST.md)
├─ docs/{adr,spikes,evidence,runbooks,readiness}/   # produced during the build
├─ docs/build-metrics.csv         # §11
└─ …                              # code layout: 02 §3
```
Paths in `AGENTS.md` and tickets are relative to `docs/pack/` unless they start with `packages/`, `apps/`, `tools/`, `tests/`, `definition/` or `migrations/`.

---

## 2. `AGENTS.md` (copy everything between the markers to the repo root)

<!-- BEGIN AGENTS.md -->
````markdown
# AGENTS.md — rules for AI agents building the Software Factory

You implement exactly ONE ticket from `docs/pack/05_TICKET_BACKLOG.md` per run.
Read this file completely, then the ticket, then ONLY the files in the ticket's `Read` line.
You are building an autonomous software-production system whose entire value rests on
independent verification, deterministic policy, and human control. Shortcuts that weaken those
properties are defects even when the tests pass.

## 1. Hard rules — if one would be violated, STOP and write an ESCALATION (§6)
- HR-1  One ticket per run. Never widen scope. Needs you discover become *proposed tickets*, not code.
- HR-2  The ticket's oracle files are READ-ONLY to you. Never create, edit, delete, skip, `.only`, weaken or
        re-snapshot them. If an oracle looks wrong, stop and escalate; do not "fix" it.
- HR-3  No oracle, no work. If the ticket's oracle files do not exist yet, stop and ask the owner.
- HR-4  You may add extra tests; they are untrusted and never count toward Done. Never edit an existing test to
        make it pass unless the ticket explicitly says so.
- HR-5  Touch only the paths in the ticket's `Build` line (the PR's `Allowed-paths`). R4 paths
        (`definition/**`, `migrations/**`, `.github/**`, `CODEOWNERS`, `packages/{policy,broker,credentials,eventlog,isolation,approvals}/**`,
        `tests/redteam/**`, `tests/invariants/**`) only when the ticket names them.
- HR-6  Boring technology. Do not add infrastructure, a service, or a dependency outside `docs/pack/02 §3` and
        ADR-0013 without an ADR proposal. Never add: message broker, Kubernetes, vector DB, workflow engine.
- HR-7  Pure packages (`contracts, core, policy, state, context/assembler, review scorer+panel, merge rules`) have
        no I/O, no clock, no randomness except injected. Enforced by `pnpm lint:deps`.
- HR-8  Deny by default. Fail closed. Never "let it try and see". If unsure whether an action is permitted: deny + escalate.
- HR-9  Secrets and untrusted text: never read, print, log, commit or place real secrets in tests/fixtures (use fakes).
        Never paste untrusted content (issue text, CI logs, fetched pages) into code, comments, prompts, commit messages or docs.
- HR-10 Never hard-code model names, prices, hostnames, repo names, tokens. Configuration only.
- HR-11 Do not invent facts about external systems. Anything tagged `[VERIFY]` must be confirmed from official
        documentation or a spike note (`docs/spikes/`) and the source recorded in the PR.
- HR-12 Never edit `packages/contracts` inside another ticket. A contract change is its own tiny ticket (§5).
- HR-13 No chat-with-agent endpoint, no free-form instruction channel, no auto-apply of proposals — ever.
- HR-14 No productivity claims and no numbers copied from research. Metrics derive from events only.

## 2. Commands
(Task names. In a non-TypeScript profile run them as `just <task>`; see docs/pack/A1 §3.)
pnpm ci | lint | lint:deps | typecheck | test | test:acceptance -t "A0.1" | test:invariants -t "INV-4"
pnpm test:redteam -t "AT-7" | test:fault | test:concurrency | test:e2e
factory doctor | factory db migrate | factory projections rebuild | factory audit explain <id>
tools/worktree.sh <ticket> | tools/context-bundle <ticket> | tools/oracle-guard | tools/scope-guard

## 3. Protocol for every ticket (details: docs/pack/07 §3)
1. Create a worktree: `tools/worktree.sh T-x.yy` (branch `ticket/T-x.yy`). Never work on `main`.
2. Build your context: `tools/context-bundle T-x.yy` (≤120 KB). Load nothing else. Do not read `research/` files.
3. Restate the ticket in ≤8 lines and list the files you will create/modify (must be ⊆ Build line).
4. Confirm the oracle files exist and note their sha. If they do not: STOP (HR-3).
5. Implement in small commits. Run the oracle and `pnpm ci` after each logical step.
6. Self-review with the checklist in docs/pack/07 §3.2. Fix before opening the PR.
7. Open the PR from the template: Ticket, Allowed-paths, Oracle-Sha, evidence (commands + output), risks, "what I did NOT do".
8. Address review comments by changing code only. If a comment asks to change an oracle, the owner (not you) does it.
9. After merge, delete your worktree. Never leave containers, branches or credentials behind.

## 4. Code conventions
- Follow the language conventions of the ACTIVE STACK PROFILE (`docs/stack-profile.md`, from docs/pack/A1 §4). In every profile: strict static typing; no untyped data across a boundary (parse into a validated type, reject unknown fields); no `any`-style escape hatches or non-null shortcuts in non-test code; exhaustive matching on closed sets. (TypeScript profile: strict `tsc`, `unknown` + Zod instead of `any`, no non-null `!` outside tests, exhaustive `switch` with a `never` check.)
- Expected failures return `Result<T,E>`; exceptions are for programmer errors. Every error maps to a FailureClass.
- Time via injected `Clock`; ids via `core`; money as integer micro-USD; hashes over canonical JSON only.
- Processes: argv arrays only, never shell strings. No ad-hoc printing — use the profile's structured logger with redaction.
- Anything that can be specified exactly is code, not a model call (determinism rule).
- Tests: the profile's runner; put the roadmap/requirement id verbatim in the display name AND in identifier-safe form in the function name (`A0.1` → `A0_1`; docs/pack/A1 §3); property tests
  for pure logic; no network in unit tests; fakes live in `packages/*/fakes` and must pass the same contract tests as the real thing (I-12).
- Commits: `type(scope): message` + trailers `Ticket: T-x.yy` and `Oracle-Sha: <sha>`.

## 5. Contract changes
If your ticket needs a change in `packages/contracts`, STOP. Write a proposal (what, why, blast radius). The owner opens a
tiny `contracts` ticket (size S, R3). Wait for it to merge, rebase, continue.

## 6. Stop-and-escalate triggers (write ESCALATION.md in the worktree root and stop)
Any HR violation would result · the oracle is missing/wrong/contradicts the ticket · the ticket and a blueprint ADR disagree ·
an external fact differs from the ticket/spike · a needed capability is not in the registry · you would need a secret ·
a security doubt of any kind · you hit the turn/cost budget · the change exceeds ~600 lines · tests pass only after weakening a check.
Format: Ticket / Trigger / What I was doing / Evidence (file:line, doc §) / Options with consequences / Recommendation / What I have NOT changed.

## 7. Budgets (starting values)
S ≤ 40 turns · ≤ $3 | M ≤ 80 turns · ≤ $6 | L ≤ 100 turns · ≤ $10 | wall-clock ≤ 2 h | ≤ ~600 changed lines (split if more).

## 8. Source of truth order
Blueprint ADRs > blueprint requirements (06) > docs/pack (02,03,04) > the ticket text. Never quietly diverge: raise it.
Three things are never yours to change: the authority split (ADR-0004), oracle independence (ADR-0005), the human review floor (ADR-0003).
````
<!-- END AGENTS.md -->

---

## 3. The ticket execution loop

### 3.1 Steps (owner and agent)
| # | Step | Who | Output |
|---|---|---|---|
| 0 | **Oracle ready?** Author the ticket's oracle files first (owner, deterministic generator, or a *separate* oracle-author run, §4b) and approve them; record `Oracle-Sha` | owner | oracle files + sha |
| 1 | Create worktree, build context bundle | agent | `.context/T-x.yy.md` (+ size/sha) |
| 2 | Restate ticket + planned file list | agent | ≤8 lines in the PR draft |
| 3 | Implement in small commits, running oracle + `pnpm ci` | agent | commits |
| 4 | Self-review (§3.2) | agent | checklist in PR |
| 5 | Open PR (template) | agent | PR with evidence |
| 6 | Reviewer-agent pre-pass (fresh context, §4c) | agent B | findings table |
| 7 | Owner review at the ticket's path-tier depth (§7) | owner | approve / request changes |
| 8 | Merge, tick `06` rows with evidence, log build metrics (§11) | owner + agent | green rows |

### 3.2 Self-review checklist (agent fills in the PR)
- [ ] Diff ⊆ Allowed-paths; no oracle/protected path touched
- [ ] Oracle tests pass; `pnpm ci` green; `lint:deps` green
- [ ] Every new failure path is **fail-closed**, emits an event or error class, and cleans up in `finally`
- [ ] No secret/untrusted text in code, logs, fixtures, commit messages
- [ ] No hard-coded model/host/price/repo; no new dependency/infrastructure
- [ ] Idempotency considered for every external effect; resumable after crash
- [ ] Pure packages have no I/O; Zod `.strict()` on every external input
- [ ] Tests assert **behaviour** (would a wrong implementation fail them?); no mocks of the unit under test
- [ ] I wrote down what I did NOT do and any `[VERIFY]` facts I relied on (with sources)

### 3.3 Definition of Ready (a ticket may start only if)
Oracle files exist and are approved · dependencies merged · spike notes it needs exist · Build line and Allowed-paths agreed · budget set · `Read` bundle ≤120 KB.

---

## 4. Prompt templates (copy, fill `{{…}}`)

### 4a. Implementer
```
You are the IMPLEMENTER for ticket {{T-x.yy}} of the Software Factory build.
Load, in this order and nothing else: (1) AGENTS.md (2) the ticket text below (3) the bundle from `tools/context-bundle {{T-x.yy}}`.
Oracle files (READ-ONLY to you; already approved; sha {{oracleSha}}): {{oraclePaths}}
Do: restate the ticket in ≤8 lines; list the files you will touch (must be ⊆ Build); implement in small commits;
run the oracle and `pnpm ci` after each step; self-review with AGENTS-checklist; open the PR from the template.
If any AGENTS.md §6 trigger fires, write ESCALATION.md and stop.
Budget: {{turns}} turns, {{usd}} USD, {{minutes}} minutes.
TICKET:
{{paste the ticket block}}
```

### 4b. Oracle author (separate run, before the implementer; never sees an implementation)
```
You are the ORACLE AUTHOR for ticket {{T-x.yy}}. You have not seen, and must not look for, any implementation of it.
Inputs: the ticket's Satisfies and Oracle lines; the cited blueprint sections; packages/contracts.
Write ONLY test files at {{oraclePaths}} that assert BEHAVIOUR through the public interface (black-box), each test name
containing its requirement/roadmap id. Tests must fail against the current repo (or pass, if the ticket says expectedBefore: pass).
Rules: no implementation code; no mocks of the unit under test; no snapshot-only assertions; ≥1 negative case per rule;
property tests where the ticket says so; deterministic (no network, no wall-clock).
Output: the files + a table: criterion → test name → what wrong implementation this test would catch.
The owner reviews before any implementer starts.
```

### 4c. Reviewer (fresh context; must not receive the implementer's transcript)
```
You are an independent REVIEWER. Inputs: the ticket text, the oracle files, the diff, the `pnpm ci` output. Nothing else.
Check: (1) does the diff satisfy the ticket's Satisfies list? (2) any scope creep or path outside Allowed-paths?
(3) any change to oracle/protected paths? (4) AGENTS.md hard-rule violations (I/O in pure packages, secrets, hard-coded models,
untrusted text in code, new dependencies) (5) fail-open paths, swallowed errors, missing events, missing idempotency,
missing cleanup in `finally` (6) do the tests assert behaviour — would a wrong implementation pass?
Output: a findings table (severity blocker/major/minor · file:line · evidence · suggested fix), a verdict, and "what I could not verify".
```

### 4d. Spike
```
You are running SPIKE {{S-n}} (time-box {{minutes}} min). Goal: settle the questions listed for it in docs/pack/05 §1 and 04 §{{x}} using
OFFICIAL documentation and a throwaway proof. Write docs/spikes/{{S-n}}.md: confirmed facts (with source URL and date), exact
commands/flags/fields, surprises, and any change this implies for the pack. Write no production code. Stop at the time-box.
```

---

## 5. The delivery-strategy playbook ("super-dev")

> **Note on the name.** The phrase "super dev#" does not appear anywhere in the blueprint corpus, so it is not defined for me. I read it as **"the strategies a very senior, very disciplined developer would use to ship this fast and safely."** The 14 strategies below distil the blueprint's own rules plus standard high-leverage delivery practice. If "super dev" refers to a specific methodology or source, tell me and I will re-align this section; nothing else in the pack depends on its name.

| # | Strategy | Rule | How it shows up here | Anti-pattern |
|---|---|---|---|---|
| SD-1 | **Contract first** | Schemas/interfaces land before code; all packages depend inward on `contracts` | T-1.01 first; contract changes are their own tickets | agents inventing shapes per ticket |
| SD-2 | **Oracle first** (boundary-level TDD) | The person/run that writes the check is never the one that writes the code; implementer can't edit it | every ticket has oracle files before it starts; `oracle-guard` | tests edited to pass; implementer-authored acceptance tests |
| SD-3 | **Vertical slice, always green** | Keep one end-to-end path working and thicken it | hello-task by W2 → Workflow B by W5 → real issue end of W5 | a week with no e2e path; "integration at the end" |
| SD-4 | **Determinism before intelligence** | If code can decide, code decides; models only for judgement | policy, assembler, aggregator, scorer, projections are pure; of Workflow B's 11 stages only 6 involve a model (5 completion + 1 harness), 3 are deterministic code, 2 are human approvals | calling a model for what a function does |
| SD-5 | **Narrow, pinned context** | ≤120 KB bundle per run; fresh context per ticket; never load research files | `tools/context-bundle`; Tier-0 + the ticket's `Read` | "read the whole blueprint" runs; stale context |
| SD-6 | **Small tickets, short leashes** | ≤1 day, ≤~600 lines, turn/cost caps, split before starting | size labels S/M/L; budgets in AGENTS.md | multi-day mega-tickets; open-ended agent sessions |
| SD-7 | **Parallel by disjoint ownership** | ≤3 agents, each in its own worktree, disjoint Allowed-paths | `05 §9` map; `scope-guard` | two agents editing the same package |
| SD-8 | **Boring technology, trigger-based additions** | New infra only on a measured trigger | ADR-0012/0013; HR-6 | adding a queue/broker "for scale" |
| SD-9 | **Fail closed, log everything** | Deny by default; every consequential action is an event with an authority | policy/broker/proxy fail closed; audit tool | silent fallbacks; swallowed errors |
| SD-10 | **Measure from day one** | Baseline before output; build metrics per ticket; no claims without a baseline | T-0.04, `docs/build-metrics.csv` | retro-fitting metrics; quoting corpus numbers |
| SD-11 | **Budget review capacity** | WIP limit, risk-tiered depth, reviewer-agent pre-pass, R4 cooling-off | §7 | a review queue that grows silently |
| SD-12 | **Pre-agreed cut line** | Cut breadth, never safety; decide weekly | `01 §5.2`, Friday checkpoint | cutting a test to hit a date |
| SD-13 | **Spikes before commitments** | Time-boxed facts from official docs, no production code | S-1…S-6 | building on a remembered flag or endpoint |
| SD-14 | **Evidence over assertion** | A row is ticked only with evidence; `[VERIFY]` facts carry sources | `06` rules | "it works on my machine" |
| SD-15 | **Dogfood early** | The build follows the doctrine it implements, then the factory takes over its own non-critical backlog | ADR-0015 | building the process after the product |

---

## 6. Parallel-agent rules
* **At most 3 concurrent build agents**, each in `../wt/T-x.yy` on branch `ticket/T-x.yy`.
* **File ownership = the ticket's Build line.** `tools/scope-guard` fails a PR that strays. Two tickets with overlapping paths never run together.
* **Contracts first.** A ticket needing a contract change waits for the `contracts` ticket (S, R3) to merge.
* **Merge order follows the dependency graph** (`05 §9`); rebase, don't merge `main` into ticket branches.
* **R4 tickets run alone** with the owner present (no other R4 in flight).
* **One owner reviews at a time**; the queue is FIFO within a tier, R4 first.

---

## 7. Owner review protocol (by path-tier)

| Tier | Typical time | What you do |
|---|---|---|
| **R4** | ≈45 min | Read **every line**; confirm oracle sha unchanged since approval; run `test:redteam` locally; ask "what input makes this fail open?"; apply a mutation to the main guard and watch a test fail; read the reviewer-agent findings **last**; **12-hour cooling-off before merging** `[PACK]` unless it is blocking |
| **R3** | ≈25 min | Read code and tests; check tests assert behaviour, not implementation; confirm deps rules and fail-closed paths; skim reviewer-agent findings first |
| **R2** | ≈12 min | Diff + tests skim; run `pnpm ci`; exercise the feature once |
| **R1** | ≈5 min | Skim; CI green |
| **Oracle approval** | ≈10–15 min | Does each criterion discriminate? What wrong implementation would pass? Is anything checked only via mocks? |

**Load estimate [PACK]:** 66 tickets ≈ 35 h of first-pass review ≈ **50 h with rework ≈ 6–7 h/week**, leaving headroom for soak-phase real-issue review. If actual review minutes (tracked in §11) exceed this by >30 %, slow the WIP limit — do not shorten review.

**Reviewer-agent pre-pass:** run template 4c on every PR; read its blockers first; it supplements, never replaces, your review.

---

## 8. Context hygiene
* **Tier-0 (always):** `AGENTS.md`, ADR-0003/0004/0005/0011/0012, the blueprint brief (17), pack `00`, the ticket.
* **Tier-1 (per ticket):** exactly the ticket's `Read` list; build with `tools/context-bundle`.
* **Tier-2 (never loaded by build agents):** research analyses, source inventory, evidence ledger, synthesis — provenance only (they live only in your original zip).
* A bundle over 120 KB means the ticket is too big or its `Read` list is sloppy — fix the ticket.
* **Fresh context per ticket.** Never reuse a long-running session across tickets; carry knowledge via the repo (ADRs, spikes, code), not via transcripts.

---

## 9. Escalation and change control
* **Agent → owner:** `ESCALATION.md` (format in `AGENTS.md` §6). The owner answers in the ticket thread; the answer is recorded in the ticket or an ADR.
* **Pack/blueprint defects:** fix them by a reviewed change to the pack (`docs/pack/…`) with a one-line reason in `docs/pack/CHANGELOG.md`; never diverge silently. Do not change the authority split, oracle independence or the human review floor without an explicit argued ADR.
* **New tickets** are accepted only at the Friday checkpoint; mid-week additions are only for blockers.
* **Waivers** (`docs/waivers.md`): owner-signed, time-boxed, never for 🔒 rows.

---

## 10. Anti-patterns to reject on sight

| Anti-pattern | Why it hurts | Catch |
|---|---|---|
| Oracle authored by (or in the same run as) the implementer | destroys independence (I-10) | oracle-guard; provenance |
| Editing/skipping tests to get green | hides regressions | gate-weakening review; HR-4 |
| Mocking the unit under test | tests nothing | reviewer 4c(6) |
| Silent truncation / swallowing errors / `catch {}` | confident wrong results | fail-closed rule; reviewer |
| New infra or dependency "for convenience" | scope and attack surface | HR-6 |
| Real or realistic secrets in fixtures | leak risk, scanner noise | HR-9; secret-scan |
| Hard-coded model/host/price | provider lock-in, wrong costs | HR-10 |
| Untrusted text copied into prompts/docs/commits | injection path | HR-9, AT-1/2/3 |
| Agent-authored "acceptance" tests counted as Done | I-10 violation | HR-4 |
| Unbounded retries hiding failures | cost, masked defects | failure-class policy |
| A model call where a function would do | cost, non-determinism | SD-4 |
| Productivity claims | MEAS-06 | HR-14 |
| "Let me just try it in prod/main" | bypasses every gate | worktree rule, rulesets |

---

## 11. Build metrics (our own baseline — dogfooding)
Append one row per ticket to `docs/build-metrics.csv`:
`ticket, path_tier, size, agent, model, start, end, wall_minutes, turns, usd, oracle_author (owner|generator|agent), oracle_change_requests, review_minutes, review_rounds, rework_loops, escalations, defects_found_later`
Use it at each Friday checkpoint (`06` Part E) and in the PRR. These numbers describe *this build*; they are not targets for the factory.
