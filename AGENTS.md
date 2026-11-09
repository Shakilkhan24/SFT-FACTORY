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
