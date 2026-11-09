# 05 — Ticket Backlog (agent-ready)

> **Audience:** implementing agents (one ticket per run) and the owner (who writes/approves oracles and reviews PRs).
> 6 spikes + **66 tickets** in 7 epics across W0–W8. Dates/weeks and cut order: `01_…` §5. Gates: `06_…`. How to *execute* a ticket: `07_…` §3.

## 0. How to read a ticket

```
### T-x.yy · Title · Week · Size · Path-tier
Depends · Read (context bundle) · Satisfies (requirements / invariants / roadmap ACs / attacks)
Build (files) · Oracle (written FIRST, read-only to the implementer) · Stop-and-escalate if
```
* **Size:** S ≈ ½ day · M ≈ 1 day · L ≈ 2 days (agent wall-clock incl. review loop). Anything bigger must be split before starting.
* **Path-tier** = review depth the owner applies: **R4** line-by-line + red-team run · **R3** careful review, tests must be read · **R2** diff + tests skim · **R1** skim. (Matches the repo criticality table in `02_…` §3.)
* **Read** paths and citations: a number **09–19** (`13 §2`) is always a *blueprint document* under `blueprint-reference/`; a number **00–08**, or `A1`/`A2` (`02 §4.4`, `A1 §3`), is a *pack file* unless written `blueprint NN §x`. **Commands:** every `pnpm <task>`/script named in a ticket is the TypeScript rendering of a canonical task (`A1` §3); other profiles map the same task names. The peak-path ticket stubs T-7.x…T-12.x live in `A2` §7. **Always-loaded Tier-0 context** for every ticket: `AGENTS.md`, `blueprint-reference/architecture-decisions/{ADR-0003,0004,0005,0011,0012}`, `blueprint-reference/17_DOWNSTREAM_BUILD_AGENT_BRIEF.md`, pack `00` and the ticket's own text. Everything else only if the ticket lists it.
* **Done = all of:** (1) the ticket's oracle tests pass · (2) `pnpm ci` green (lint, typecheck, dependency rules, invariants, red-team stubs) · (3) PR template filled with evidence · (4) owner review at the path-tier depth · (5) the ticket's checklist rows ticked in `06_…`.
* **Oracle-first rule for the build itself (I-10 applied to us):** the oracle files named in a ticket are authored *before* implementation — by the owner, by a deterministic generator, or by a **separate oracle-author agent run** and approved by the owner. The implementing agent **may not edit them** (`tools/oracle-guard` enforces). It may add extra tests, which are marked untrusted and never count toward Done.
* **Never** widen a ticket's scope. A discovered need = a new ticket proposal at the next Friday checkpoint (`07_…` §9).

---

## 1. Spikes (time-boxed ≤ ½ day each; output `docs/spikes/S-n.md` = confirmed facts + a throwaway proof; **no production code**)

| ID | Question to settle | Precedes | Must confirm |
|---|---|---|---|
| **S-1** | Postgres append design: counter-row serialisation, partitioned-table triggers, `REVOKE` effect, `LISTEN/NOTIFY` | T-1.02, T-1.03 | gapless `seq` under 50 concurrent writers; row triggers fire on partitions; app role truly cannot UPDATE/DELETE/TRUNCATE; NOTIFY payload carries only `seq` (size limit) |
| **S-2** | GitHub App mechanics | T-1.09, T-2.04 | installation token narrowed to 1 repo + subset permissions; revoke call; push via `GIT_ASKPASS` with no token in argv; push touching `.github/workflows/**` rejected **without** the Workflows permission; check-run create; ruleset required-check pinned by `integration_id`; webhook signature round-trip |
| **S-3** | Rootless Docker sandbox networking | T-2.10 | `--internal` network + edge containers on two networks; DNS for edge names; CONNECT proxy to an allow-listed host works; direct internet/host/metadata unreachable from T2; resource flags honoured rootless; optional `runsc` |
| **S-4** | Claude Code headless inside T2 through the passthrough | T-2.11 | everything in `04_…` §8 "S-4 must confirm"; golden stream captured |
| **S-5** | Passthrough usage accounting for streamed responses | T-2.11 | gateway-counted vs provider-reported usage within tolerance; cache-token fields; client disconnect; budget-refusal behaviour observed by the CLI |
| **S-6** | Structured output portability | T-1.10 | forced tool call vs native structured output on both providers; invalid-JSON rate; token overhead |

---

## 2. Epic E0 — Bootstrap (Week 0)

### T-0.01 · Owner decision sheet and accounts · W0 · S · human
Depends: — · Read: `01 §6–7` · Satisfies: ADR-0013…0025
Do: answer D1–D10; create the **GitHub App** (`04 §2.1`, no Workflows/Administration), install on target + factory repos; provider keys; Postgres + bucket (or compose for W1–W5); age key; commit decisions as `docs/adr/00NN-*.md` (Accepted/Amended).
Oracle: `06` items CL-G0-01…05 ticked with evidence links. Stop if: D1 unanswered by W4 → use `factory-sandbox` (documented fallback).

### T-0.02 · Monorepo scaffold and CI · W0 · M · R2
Depends: — · Read: `02 §3`; ADR-0012 · Satisfies: I-12, NFR-01
Build: pnpm workspace per `02 §3` *(TypeScript profile — for any other profile follow `A1` §4–5 and size this ticket **L**)* (empty packages, strict tsconfig refs), lint/format, Vitest + fast-check, **dependency-cruiser config encoding the §3 rules**, `tools/coverage-check` (fails CI if any requirement id in `blueprint-reference/06_REQUIREMENTS_AND_NFRS.md` is missing from `06_…` Part C, or its tally is stale), GitHub Actions `ci.yml`, `docker-compose.dev.yml` (Postgres 16, MinIO), `.nvmrc`, CODEOWNERS, and **these exact scripts** (used by every checklist item): `ci`, `lint`, `lint:deps`, `typecheck`, `test`, `test:acceptance` (Vitest, filter with `-t "A0.1"`), `test:invariants` (`-t "INV-4"`), `test:redteam` (`-t "AT-7"`), `test:fault`, `test:concurrency`, `test:e2e`.
Oracle: `pnpm ci` green on the empty scaffold; a *negative* test proves a pure package importing `node:fs` fails the deps rule.

### T-0.03 · Manual factory · W0 · M · R3
Depends: T-0.02 · Read: `07 §2–7` · Satisfies: ADR-0015, I-10 (build)
Build: `AGENTS.md` (from `07 §2`), `docs/ticket-template.md`, `.github/pull_request_template.md`, `tools/worktree.sh` (per-ticket worktree + cleanup), **`tools/oracle-guard`** (CI check: a PR from an implementer branch may not modify `**/test/oracle/**` or `tests/acceptance/**` unless commits are human-authored or labelled `oracle-approved`), **`tools/scope-guard`** (CI check: reads the `Allowed-paths:` globs from the PR body and fails if the diff touches anything else), **`tools/context-bundle <ticket>`** (concatenates the ticket's `Read` list into `.context/<ticket>.md`, prints byte size + sha256, fails above 120 KB).
Oracle: oracle-guard rejects a synthetic PR editing an oracle file and accepts a human-authored one; scope-guard rejects a PR touching a path outside `Allowed-paths`; context-bundle fails on an oversize bundle. From here on, every ticket follows `07 §3`.

### T-0.04 · Pre-factory baseline · W0 · M · R2 (**day-one clock #1**)
Depends: T-0.01 · Read: `blueprint-reference/14 §9`, `15 §1` · Satisfies: MEAS-03, MEAS-06, PRD-9
Build: `tools/baseline` → `baselines/pre-factory-<date>.{json,md}` for the target repo, last 90 days: PR lead time, issue→merge, review rounds, PR size, revert/hotfix rate within 14 days, CI failure rate. **If the repo deploys, also capture the DORA baseline** (deployment frequency, lead time for changes, change failure rate, time to restore) from CI/CD and incident history (`A2` §9). Measured **once, before factory output exists**.
Oracle: all fields produced on a fixture repo; owner reviews numbers; file committed and never regenerated.

### T-0.05 · Target repo onboarding file · W0 · M · R2
Depends: T-0.01 · Read: `03 §4.9`, `03 §4.8` · Satisfies: FR-66
Build (in the **target** repo, via owner PR): `.factory/repo.yml`, `CODEOWNERS`, a digest-pinnable toolchain `Dockerfile`; in the factory repo: `definition/criticality/<repo>.yaml`, `definition/repos/<repo>.yaml`.
Oracle: every command in `repo.yml` runs green on a clean clone; required CI check names listed; criticality map reviewed by the owner.

### T-0.06 · Calibration corpus mining · W0 · S · R2 (**day-one clock #2**)
Depends: T-0.01 · Read: `14 §5.2, §5.6` · Satisfies: FR-57, A1.12 (data)
Build: `tools/mining` → `calibration/candidates.jsonl` `{fixSha, preFixSha, testPaths, message}` from commits that fix a bug *and* touch tests.
Oracle: finds the known fixes in a fixture history; git-only, no network.

---

## 3. Epic E1 — Spine (Weeks 1–2) → Gate G1

### T-1.01 · Contracts and core · W1 · L · R3
Depends: T-0.02 · Read: `03` (all), blueprint `09 §4` · Satisfies: I-12, FR-02, NFR-01
Build: `packages/contracts`, `packages/core`: Zod schemas for every item in `03 §3–§7`; `canonicalJson`, `sha256`, ULID/UUIDv7, `Result`; JSON-Schema export → `/schemas`; `events.md` registry.
Oracle: canonical-JSON test vectors (key order, unicode, numbers; rejects NaN/Infinity); every YAML example in `03 §4` parses and a variant with an unknown field is rejected; unregistered event type rejected.
Stop if: a blueprint field and `03` disagree → raise.

### T-1.02 · Database schema and migrations · W1 · M · R4
Depends: T-1.01, S-1 · Read: `03 §2`; ADR-0008, ADR-0019 · Satisfies: SEC-07, I-3, NFR-04
Build: `migrations/0001_core.sql` (DDL from `03 §2` verbatim), roles/grants, `ensure_event_partitions` job, `factory db migrate|status|partitions`, Kysely types.
Oracle: **start from `reference/validate_ddl.sh` (already passes against the shipped DDL; extend it, never weaken it)**; applies on empty DB; **as `factory_app`, UPDATE/DELETE/TRUNCATE on `events` fail**; as `factory_edge`, only `edge_outbox` INSERT succeeds among writes; partition job idempotent; default partition catches out-of-range rows.

### T-1.03 · Event log · W1 · M · R4
Depends: T-1.02 · Read: `02 §4.2`; blueprint `09 §4–6` · Satisfies: FR-21, SEC-07, I-3, A0.6 (base)
Build: `packages/eventlog`: append (counter lock → gapless `seq`, CAS on aggregate row, hash chain, `NOTIFY`), `read`, `verifyChain`, redaction hook, atomic multi-append.
Oracle: 50 concurrent appends ⇒ gapless strictly-increasing `seq` in commit order; CAS conflict ⇒ `ConcurrencyError` and **no event**; rollback leaves no `seq` gap; tampering via owner role is detected by `verifyChain`.

### T-1.04 · State machines · W1 · M · R3
Depends: T-1.03 · Read: `03 §6`; blueprint `09 §2–3` · Satisfies: FR-22, FR-04, I-4 (guard), A0.5 (part)
Build: `packages/state`: tables + guards (pure) + `transition()` over the event log.
Oracle (property tests): only table transitions succeed; every accepted transition appends ≥1 event; replaying events reproduces state; `APPROVED→MERGING` refused at L2 unless trigger is human-initiated with matching SHA; ABANDONED reachable from any non-terminal; node machine incl. lease-expiry.

### T-1.05 · Policy engine · W1 · M · R4
Depends: T-1.01 · Read: ADR-0004; `13 §2`; `11 §4`; `02 §4.4`; `03 §3, §4.7` · Satisfies: SEC-01, SEC-02, FR-04; I-2, I-3; AT-4, AT-5, AT-14
Build: `packages/policy/**`, `definition/policy-bundle.yaml` v1.
Oracle: unknown action ⇒ DENY; **deny dominates allow** (generated cases); engine exception ⇒ DENY; autonomy above level ⇒ DENY; E3/E4 ⇒ REQUIRE_APPROVAL; identical input+bundle ⇒ identical decision (property); package has no I/O imports.
Stop if: a rule seems to need model output.

### T-1.06 · Definition store and applier · W2 · M · R4
Depends: T-1.01, T-1.02, T-1.03, T-1.05 · Read: ADR-0001, ADR-0007; `09 §9`; `02 §4.1` · Satisfies: FR-02, FR-06, FR-26, I-5; A0.7; AT-6, AT-7
Build: `packages/definition` + `factory definition validate|plan|apply`; drift job.
Oracle: **A0.7** write via API role rejected; invalid bundle refused, prior version stays active; drift reported and **not auto-corrected**; apply without an approval bound to `bundleSha256` fails; apply of an unmerged SHA fails (SCM fake).

### T-1.07 · Scheduler and leases · W2 · M · R3
Depends: T-1.02, T-1.03 · Read: `02 §4.8`; ADR-0012 · Satisfies: FR-43, NFR-05, I-11; A0.5 (part)
Build: `packages/orchestrator/scheduler`: enqueue/claim (`SKIP LOCKED`)/heartbeat/reap/idempotency, concurrency caps, kill-switch awareness.
Oracle: 1000-iteration race ⇒ no double-claim; expired lease re-queued once; duplicate completion recorded as `node.duplicateExecution`, first wins; caps respected; no auto-fill of spare capacity.

### T-1.08 · Capability registry and ToolBroker · W2 · L · R4
Depends: T-1.01, T-1.03, T-1.05 · Read: `11 §2–6`; `02 §4.5`; `04 §5` · Satisfies: FR-60/61/62/64/65, SEC-01, SEC-06; I-12; A0.1, A0.2; AT-4, AT-14
Build: `packages/broker`: registry loader + reconciliation, the **10-step pipeline in order**, adapters (inproc/http/cli/mcp + fixture server), invocation records, idempotency, the v1 capability YAMLs from `04 §5`; adapters constructible only inside the broker module (lint rule + runtime guard).
Oracle: **A0.1** outside-grant call ⇒ denied + `tool.denied`; **A0.2** direct adapter call without the broker fails; step-order spy test; MCP tool not in registry does not exist; replayed idempotency key returns the recorded result; E3 without approval ⇒ REQUIRE_APPROVAL; policy throws ⇒ fail closed.

### T-1.09 · Credential broker and secret store · W2 · M · R4
Depends: T-1.08, S-2 · Read: `11 §7`; `04 §2.2, §10`; `02 §4.6` · Satisfies: SEC-04, FR-63, I-2; A3.3, A3.4 (early); AT-11
Build: `packages/credentials`: `SecretStore` (sops/age + env), GitHub installation-token minting (narrowed), redaction-set registry, `revokeAll` in `finally` + orphan reaper, `credential_leases`, FakeCredentialProvider.
Oracle: a full fake run — scan of every event, log, artefact and prompt finds **no token** (test name contains `secret-scan`); use-after-revoke fails; secrets absent from logs (redact test); real-token smoke recorded in S-2.

### T-1.10 · Model gateway (complete path) · W2 · L · R3
Depends: T-1.01, T-1.03, S-6 · Read: `11 §9`; `02 §4.7`; `04 §6` · Satisfies: FR-33, FR-34, NFR-09, NFR-11; I-9; A0.8
Build: `packages/gateway`: anthropic, openai-compatible and fake adapters; routing/budgets (checked **before** the call); ledger; failover; portable structured output + Zod revalidation; cache breakpoints; startup models check; `pricing.yaml`.
Oracle: **A0.8** cost bounded before start and halts on breach; failover Fake-A→Fake-B on injected error (`INV-9`); **no failover on budget exhaustion**; invalid structured output twice ⇒ `model.reasoning`; unknown model refused; integer micro-USD golden cost tests.

### T-1.11 · Run-artefact store and redaction · W2 · M · R3
Depends: T-1.03, T-1.09 · Read: `15 §2`; ADR-0011; `02 §4.11` · Satisfies: MEAS-01, MEAS-02, NFR-08; A0.3
Build: `packages/artefacts`: 12-element record writer (incremental, atomic with outcome), S3 adapter, local spool, redaction pipeline, completeness assertion, retention + purge.
Oracle: **A0.3** completeness assertion; seeded secrets are redacted in record *and* events; object-store outage ⇒ spool then explicit stage failure; record hash verifies.

### T-1.12 · T1 isolation (snapshot / clean worktree) · W2 · S · R3
Depends: T-1.01 · Read: ADR-0006; `02 §4.12`; ADR-0020 · Satisfies: FR-40, FR-42; A0.9
Build: `packages/isolation/t1`: `git archive` snapshots keyed by base SHA, clean worktree creator (hooks disabled, fsmonitor off), reclamation + leak detector.
Oracle: **A0.9** reclaimed at every terminal state incl. failure; git invoked with hooks disabled (spy assertion); traversal in a snapshot request rejected.

### T-1.13 · Orchestrator · W2 · L · R3
Depends: T-1.04, T-1.07, T-1.08, T-1.10, T-1.11, T-1.12 · Read: `09 §8`; `02 §4.9` · Satisfies: FR-22, FR-32, FR-23; A0.5
Build: `packages/orchestrator`: stage runner, executor registry (deterministic/completion/harness-stub/human), execution loop, resume, pause/cancel, budgets, failure classes, escalation.
Oracle: **A0.5** SIGKILL worker mid-run ⇒ resumed or explicit ESCALATED/FAILED; idempotent node handler; cancel reclaims env + credentials; budget exhaustion ⇒ `INCOMPLETE` with partial artefacts labelled; unknown failure ⇒ `workflow.composition`.

### T-1.14 · Access-point API and auth · W2 · L · R3
Depends: T-1.03, T-1.04, T-1.05, T-1.13 · Read: `04 §3`; `13 §3`; ADR-0002 · Satisfies: FR-03, FR-70; SEC-11; AT-6, AT-7
Build: `apps/api` (Fastify): OAuth session + CSRF, CLI tokens, AP-1…AP-6 per `04 §3` (stubs for later-ticket behaviours), problem+json, idempotency keys, rate limit, SSE.
Oracle: every mutating call emits an event with actor + authority; non-allow-listed login rejected; **route-inventory test proves no endpoint accepts free-form agent instructions**; definition write via API rejected; CSRF test.

### T-1.15 · Projections and rebuild · W2 · M · R2
Depends: T-1.03 · Read: `15 §3`; `02 §4.18` · Satisfies: NFR-03; A0.6
Build: projector with durable cursors; `task_current`, shells for `approval_queue`, `cost_attribution`; `factory projections rebuild`; staleness metrics.
Oracle: **A0.6** drop-and-rebuild ⇒ identical rows (hash compare); projector resumes after crash without duplicates.

### T-1.16 · Operational surface v0 and CLI · W2 · M · R1
Depends: T-1.14, T-1.15 · Read: `13 §8`; `15 §6` · Satisfies: NFR-07, FR-70; PRD-8 (part)
Build: dashboard v0 (Needs you / In flight / Health / Cost, SSE, kill switch, task timeline); CLI skeleton incl. `login`, `tasks`, `kill-switch`, `projections rebuild`, **`audit chain <taskId>`** (runs `EventLog.verifyChain`).
Oracle: Playwright smoke renders seeded overview < 2 s; script proves reaching a review/approval item in ≤2 clicks (test name contains `NFR-07`); kill-switch round-trip; `factory audit chain` exits 0 on an intact run and ≠0 on a tampered one.

### T-1.17 · Phase-0 exit · W2 · M · R2
Depends: all E1 · Read: `blueprint-reference/16` Phase 0; pack `08 §2` · Satisfies: A0.1–A0.10
Build: `H.hello` workflow (FakeProvider → artefact → record) e2e; red-team subset **AT-4, AT-5, AT-7, AT-8** in `tests/redteam`; G1 evidence pack.
Oracle: A0.1–A0.10 all green in CI; owner signs G1.

---

## 4. Epic E2 — Workflow B spine (Weeks 3–5) → Gate G2

### T-2.01 · Context assembler · W3 · L · R3
Depends: T-1.01 · Read: `10 §2–5`; `02 §4.10` · Satisfies: FR-13, I-8, CX-1; A0.4, A1.4, A1.5, A1.10
Build: `packages/context/assembler` (pure), content-addressed item store, precedence, ordering, byte budget (**fail, never truncate**), untrusted envelope with nonce, gaps, `context_envelopes` persistence.
Oracle: golden-file determinism; over-budget ⇒ `context.budget_exceeded`; untrusted content last and delimiter/nonce spoofing neutralised; dependent stage gets upstream artefact only; tampered item rejected on load.

### T-2.02 · Skill registry · W3 · M · R2
Depends: T-2.01 · Read: `10 §4` · Satisfies: FR-10, SEC-09
Build: loader for `definition/skills`, schema, procedure vs standard, lifecycle (only ACTIVE resolvable), integrity.
Oracle: non-ACTIVE not resolvable; tamper rejected; lint: a skill cannot declare tools/authority.

### T-2.03 · Prompt builder · W3 · M · R2
Depends: T-2.01, T-2.02 · Read: `10 §8`; `blueprint 08 §2` · Satisfies: CX-6, MEAS-01
Build: ten-part builder, versioned templates (`definition/prompts`), `promptSha256`, per-role output contracts from Zod.
Oracle: snapshot tests per role; authority lists denies first; untrusted envelope last; numeric budgets; identical inputs ⇒ identical hash.

### T-2.04 · GitHub intake (webhooks, ingest, tagging) · W3 · L · R3
Depends: T-1.08, T-1.09, T-1.14, S-2 · Read: `04 §2, §4`; `13 §1.4`; `12 §3.2` · Satisfies: SEC-03, FR-03; AT-1, AT-2
Build: `packages/scm-github`: webhook verify + dedupe, `github.*` capabilities via broker, requester allow-list + permission check, repo allow-list, ingest with **tagging**, polling fallback flag.
Oracle: bad signature ⇒ `webhook.rejected`; replayed delivery ignored; non-allow-listed author ⇒ `intent.rejected`; issue body stored as an untrusted object ref (never inlined into instruction-bearing fields); edits after intake ignored; fake GitHub server in tests + one real smoke on the sandbox repo.

### T-2.05 · Triage stage · W3 · S · R2
Depends: T-2.03, T-1.10, T-1.13 · Read: `blueprint 08 §2` role 1 · Satisfies: FR-30
Build: completion executor (cheap route), schema `{workflow, inScope, rationale}`.
Oracle: schema-valid; out-of-scope ⇒ REJECTED; no tools in the prompt; untrusted envelope used.

### T-2.06 · Refinement stage and spec schema · W3 · M · R2
Depends: T-2.05 · Read: `12 §3`; `blueprint 08 §2` role 2 · Satisfies: FR-11
Build: `specify` stage; spec schema (goal, non-goals, acceptance criteria with ids + checkable-kind hints, constraints, `public-interface` tags, open questions); guard TRIAGED→REFINED.
Oracle: no checkable criterion ⇒ ESCALATED; every criterion has an id; vagueness heuristics flag; spec hash stable.

### T-2.07 · Oracle construction and admission · W3–W4 · L · R3
Depends: T-2.06, T-2.10, T-1.11 · Read: `14 §3`; ADR-0005; `02 §4.14` · Satisfies: FR-12, FR-52, I-10; A1.2, A1.3, A1.6
Build: `packages/oracle`: manifest, routes R-H/R-G/R-A, generators (`command-check`, `cli-golden`, `behavior-table`, `file-assertion`), protected-path writer, admission (before-state run in T2), provenance.
Oracle: **oracle authored before implementation** (provenance check); every criterion ≥1 check; `expectedBefore` mismatch ⇒ `oracle.admissionFailed`; agent-route oracle `untrusted` until approved; **`implementationRunId != null` ⇒ rejected**; generator determinism.

### T-2.08 · Planner stage and graph admission · W3–W4 · M · R3
Depends: T-2.06 · Read: `09 §7`; `blueprint 08 §2` role 4; `03 §4.11` · Satisfies: FR-23, FR-24, FR-25
Build: `plan` stage; `TaskGraph` schema; admission (acyclic, `oracleRef` per node, 4 chunkability conditions for fan-out, grants ⊆ workflow).
Oracle: cyclic graph rejected; fan-out without justification rejected; node without oracle rejected; capability outside grant rejected.

### T-2.09 · Approval service and plan-first approval · W4 · L · R4
Depends: T-1.03, T-1.14 · Read: `13 §6`; `11 §5`; `04 §2.5`; `02 §4.16` · Satisfies: FR-73, FR-74, FR-75; I-4; A2.9, A2.10; AT-13
Build: `packages/approvals`, AP-2 endpoints, dashboard approval view (**raw untrusted blocks flagged**), plan artefact = canonical `{spec, graph, oracleManifestSha, contextPins}`, cool-off + security-scope ack, GitHub-review ingestion (R0–R2).
Oracle: **A2.9** modified artefact ⇒ void; **A2.10** expired unusable; non-approver rejected; consumed approval not reusable; review minutes recorded.

### T-2.10 · T2 isolation and the egress proxy · W4 · L · R4
Depends: T-1.12, T-1.09, S-3 · Read: ADR-0006, ADR-0020; `13 §7.3–7.5`; `04 §7`; `02 §4.12` · Satisfies: FR-40, FR-42, SEC-05, SEC-12; A3.1; AT-9, AT-10
Build: `packages/isolation/t2` (flags per `04 §7`), network bootstrap, `apps/egress-proxy` (CONNECT, token auth, allow-list, SSRF block, outbox), digest verification, TTL reaper, leak detector, `factory doctor` checks.
Oracle: **A3.1** no host path outside `/work`, no docker socket; allowed host ok / other host denied + `net.egress.denied` / private & metadata IPs denied; **no route when proxy is down**; cleanup in `finally`; labelled-container leak detector.

### T-2.11 · Gateway passthrough and HarnessAdapter · W4 · L · R3
Depends: T-2.10, T-1.10, S-4, S-5 · Read: `04 §6, §8`; `02 §4.7, §4.13`; ADR-0010 · Satisfies: FR-32, SEC-04, NFR-09, NFR-11
Build: `apps/gateway` edge (token auth, model allow-list, `max_tokens` cap, forward, streaming usage, budget refusal, outbox), `packages/harness` contract + `claude-code` adapter + scripted **FakeHarness** + golden-stream contract test.
Oracle: FakeHarness run yields patch + events; real-harness smoke in T2 on the sandbox repo yields a diff; usage reconciles within tolerance; budget exhaustion ⇒ `incomplete`; turn cap enforced; **no provider key anywhere in the container env** (scan; test name contains `env-scan`); golden-stream contract test name contains `harness-contract`; only allow-listed models; wall-clock kill.

### T-2.12 · Worker stage and patch extraction · W4 · L · R3
Depends: T-2.11, T-2.07, T-2.01, T-1.08 · Read: `02 §4.14`; ADR-0020; `12 §3.3` · Satisfies: FR-41, FR-40, I-2, I-6; AT-1, AT-2, AT-10
Build: implement executor: provision T2 (base-SHA clone, oracle mounted read-only, holdout not mounted) → assemble context → run harness → **extract + validate patch** → apply to clean host worktree (hooks off) → commit with trailers → push via broker → record.
Oracle: patch touching `.github/**`, oracle paths or an R4 path ⇒ `patch.rejected` (`policy.denied`, no retry); symlink/submodule add rejected; oversize rejected; **planted `.git/hooks` in the container clone has no host effect**; push only to `factory/*`; injected issue text cannot add paths.

### T-2.13 · Verification runtime · W4 · L · R3
Depends: T-2.12, T-2.07 · Read: `14 §2, §6`; `02 §4.14` · Satisfies: FR-51, FR-52, FR-53, FR-58, I-4, I-10; A1.6, A1.7, A2.7
Build: `packages/verify`: fresh T2, base + patch + oracle overlay, ordered gates, `GateReport`, authorship flags, gate-weakening detector, scan wrappers.
Oracle: agent-authored tests flagged untrusted and never satisfy a criterion; **oracle fail ⇒ gate fail even if the rest passes**; disabling a required check ⇒ tier ≥ R3 + flag; skip-marker/test-deletion fixtures; holdout checks run but never mounted in the worker env; stable report hash.

### T-2.14 · Reviewer stage and panel · W5 · M · R2
Depends: T-2.13, T-2.03 · Read: `blueprint 08 §2` roles 6–8; `14 §2`; `02 §4.15` · Satisfies: FR-35, FR-56; A1.8
Build: spec-conformance reviewer, quality reviewer, security reviewer (completion stages, **no implementer transcript**), pure `PanelAggregator` (unanimity for ready; blocker ⇒ one rework; security ≥ high ⇒ R3), independence enforcement.
Oracle: reviewer run/context differ from worker's and model differs when preferred (**A1.8**); panel policy table tests; **no numeric confidence field exists** in any output schema; context scan proves reviewer never saw the transcript.

### T-2.15 · PR creation, summary and check runs · W5 · M · R2
Depends: T-2.14, T-2.04 · Read: `12 §3`; `04 §2.3` · Satisfies: FR-41, FR-70
Build: PR body **generated only from artefacts** (spec, criteria→checks table, gate results, tier + rationale, cost, run links, untrusted-content notice), `change.opened`, `factory/merge-gate` lifecycle, issue status comment.
Oracle: body contains no raw untrusted text (links instead; AT-2); check name/integration pinned; idempotent PR creation; size limits.

### T-2.16 · Blast radius, criticality map, review queue · W5 · M · R3
Depends: T-2.13 · Read: `13 §5`; `02 §4.15`; ADR-0022 · Satisfies: FR-72, FR-58; A2.8
Build: `packages/review` scorer + map loader + queue projection with `rationale[]`.
Oracle: table-driven scoring; **tier = max(score tier, path floor)**; R4 path ⇒ agent patch rejected; tier raised only by humans; deterministic.

### T-2.17 · Merge gate (L2) and protect-repo · W5 · L · R3
Depends: T-2.15, T-2.16, T-2.09 · Read: `14 §6`; ADR-0003, ADR-0016; `04 §2.4–2.5` · Satisfies: FR-51, FR-58, FR-41, I-4; A1.7; AT-7, AT-13
Build: `packages/merge` (evaluate/publish, SHA-bound reset, human-merge observation, violation path), `factory repo protect` + verify, the autonomy guard on `APPROVED→MERGING`.
Oracle: merge-gate red unless oracle + approval valid for the head SHA (`INV-4`); factory has **no** merge capability; new push voids approval; merged-without-gate ⇒ violation event + alert; ruleset drift fails loudly.

### T-2.18 · Knowledge capture and docs check · W5 · S · R2
Depends: T-2.17 · Read: `10 §9`; `02 §4.20` · Satisfies: FR-81, FR-82
Build: `record` stage, `knowledge_records` + FTS search endpoint, docs check for `public-interface` criteria.
Oracle: record exactly once per merged change; FTS finds by keyword; docs gate fails when a tagged criterion lacks a docs diff; untrusted text only as quoted-and-tagged excerpts.

### T-2.19 · Workflow B definition and Phase-1 exit · W5 · M · R2
Depends: all E2 · Read: `12 §3`; blueprint `16` Phase 1 · Satisfies: A1.1–A1.12
Build: `definition/workflows/B.issue-to-pr.yaml`, roles, grants, environments, routing; e2e on the sandbox repo (FakeProvider + one real-provider run); A1 suite; G2 evidence; schedule the **first real issue**.
Oracle: **A1.1** issue → reviewed PR with an independently-authored passing oracle; A1.2–A1.10 green; A1.11/A1.12 reports attached once T-4.01/T-4.02 land.

---

## 5. Epic E3 — Safety hardening (Weeks 5–7) → Gate G3

### T-3.01 · Tagging audit and fetch service · W5–W6 · M · R3
Depends: T-2.04, T-1.08 · Read: `13 §7.7`; `11 §11` · Satisfies: SEC-03, FR-62; A3.5; AT-1, AT-3
Build: enumerate every ingest path (issues, CI logs, PR bodies, fetched URLs, dependency metadata); central `tagUntrusted()`; control-plane fetch service (`net.fetch`: allow-list, size/time caps, SSRF block).
Oracle: static scan + runtime test: no ingest path bypasses tagging; fetched content arrives tagged; non-allow-listed host refused.

### T-3.02 · Red-team suite AT-1…AT-15 · W6 · L · R4
Depends: T-2.17 · Read: `14 §10`; `08 §4` · Satisfies: PRD-3; A3.5–A3.11
Build: all 15 attacks with fixtures (`08 §4`); **required check in the factory's CI**; the **mutation runner** `pnpm test:invariants --mutation` (applies each entry of `tests/invariants/mutations.md` in a scratch worktree and expects the matching INV test to fail).
Oracle: all pass; removing any of 5 representative controls makes its test fail (mutation check).

### T-3.03 · Supply-chain controls · W6 · M · R3
Depends: T-2.10, T-2.13 · Read: `13 §7.6` · Satisfies: SEC-09; AT-9
Build: reject tag-only image refs, lockfile enforcement gate, new-dependency flag/score, audit gate, install-script flag, commit provenance trailers.
Oracle: tag-only image ⇒ definition invalid; dependency added without lockfile change ⇒ gate fail; install scripts flagged.

### T-3.04 · Audit reconstruction tool · W6 · M · R2
Depends: T-1.03, T-1.11, T-2.09 · Read: `13 §7.8`; `15 §2` · Satisfies: SEC-07, NFR-06; A3.12
Build: `factory audit explain` (event/task → authority → policy decision → approval → envelope → run → tool calls; human + JSON).
Oracle: property test over a recorded fake run: **100 % of consequential events resolve to an authority**.

### T-3.05 · Approval-fatigue indicators and notifications · W6 · S · R1
Depends: T-2.09, T-1.15 · Read: `13 §6.4` · Satisfies: FR-73; H-12
Build: volume/latency/rubber-stamp/post-hoc-defect indicators; allow-list-size metric; signed webhook notifier (ids + links only).
Oracle: indicators from seeded events; notifier payload carries no untrusted text.

### T-3.06 · Secret scanning and redaction hardening · W6 · M · R3
Depends: T-1.11, T-1.09 · Read: `13 §7.2` · Satisfies: NFR-08, SEC-04; PRD-5
Build: scanner over events/artefacts/logs/DB dumps; extended patterns; CI fails on any finding in a full fake run.
Oracle: seeded secrets of 10 formats caught; scan of the whole store = 0 (test name contains `store-secret-scan`).

### T-3.07 · Fault-injection suite · W7 · L · R2
Depends: T-2.19 · Read: `09 §6`; `14 §10` · Satisfies: NFR-04, NFR-10; PRD-7
Build: kill api/worker at each stage; Postgres restart; object-store outage; provider outage/slow; Docker daemon restart; egress/gateway down; clock skew (scenarios FI-1…FI-14 in `08 §5`); runner flag `--prod-like` to run against the production compose topology.
Oracle: zero silent losses; every scenario ends resumed or explicitly failed/escalated; leases heal.

### T-3.08 · Concurrency suite · W7 · M · R2
Depends: T-2.19 · Read: `blueprint 07 §10` (scaling model) · Satisfies: NFR-05, SEC-12; A3.8
Build: N parallel tasks, same and different repos; checks on worktrees, containers, credentials, edge tokens, caps.
Oracle: zero contamination events; cross-repo access refused and recorded.

---

## 6. Epic E4 — Measurement and calibration (Weeks 3–7)

### T-4.01 · Metrics projections and baseline report · W3 (start) → W6 · M · R2
Depends: T-1.15, T-0.04 · Read: `14 §8–9`; `15 §3` · Satisfies: MEAS-03/05/06/08; A1.11
Build: metrics subset (`02 §4.22`), `factory metrics report` (baseline, delta, cost, guardrail), oracle coverage, **same-run-authored-oracle rate**.
Oracle: derived **only** from events; refuses to print a delta without a baseline; failure taxonomy split computed.

### T-4.02 · Calibration corpus format and harness · W3 · M · R3
Depends: T-0.06, T-1.01 · Read: `14 §5.2–5.4` · Satisfies: FR-57; A2.3, A1.12
Build: `packages/calibration`: corpus schema + validation, runner, thresholds by property kind, report + currency window.
Oracle: **A2.3** violation-only corpus rejected; threshold table tests; report hash stable.

### T-4.03 · Violation-injection harness · W4 · M · R3
Depends: T-4.02 · Read: `14 §5.6` · Satisfies: FR-55; A2.4, A2.5
Build: historical mining → samples, seed injection, ≥5 mutation operators for the target language, mandatory negative control.
Oracle: **A2.4** seeded violation caught through the *whole pipeline* (verifier → gate → merge block); **A2.5** realistic non-violation not flagged.

### T-4.04 · First calibration reports and gating consult · W6 · M · R3
Depends: T-4.03, T-2.13 · Read: `14 §5.3–5.8` · Satisfies: FR-55; A1.12, A2.1, A2.2
Build: calibrate 2 properties on the target repo (one security-flavoured, one correctness-flavoured); merge gate consults the calibration store.
Oracle: **A2.1** verifier without report cannot gate; **A2.2** expired report drops the verifier automatically.

### T-4.05 · Cost reports and budget circuit breakers · W7 · M · R2
Depends: T-1.10, T-4.01 · Read: `15 §4` · Satisfies: MEAS-04, NFR-11; PRD-9
Build: `cost_attribution`, cost per accepted change, circuit breaker (spend rate > 2× trailing mean or day cap ⇒ pause intake + notify).
Oracle: breaker trips in a simulated spike; breach is `incomplete`, not failure.

---

## 7. Epic E5 — More workflows and hooks (Weeks 6–7)

### T-5.01 · Workflow C — bug fix · W6 · M · R2
Depends: T-2.19, T-2.07 · Read: `12 §4` · Satisfies: FR-01 (part); A4.2, A4.3
Build: `C.bug-fix.yaml`; reproduction node; regression test = oracle (`expectedBefore: fail`); not-reproducible ⇒ ESCALATED.
Oracle: **A4.2** regression test that passes on unfixed code is rejected; **A4.3** no speculative fix; fix cannot start before oracle admission.

### T-5.02 · Workflow D-1 — dependency upgrades · W7 · M · R2
Depends: T-2.19, T-3.01 · Read: `12 §5` · Satisfies: FR-85; A4.5
Build: cron trigger; deterministic candidate scan in T2 + advisory data via fetch service; chunking (≤K/run); per-chunk task (oracle = existing suite + lockfile integrity, `expectedBefore: pass`); stop-and-escalate threshold.
Oracle: **A4.5** far-more-than-expected ⇒ stop and escalate, no fan-out; chunk bounds; honours kill switch.

### T-5.03 · Workflow D-2 — CI repair · W7 · M · R2
Depends: T-5.02 · Read: `12 §5.4` · Satisfies: FR-85; A4.4; AT-15
Build: trigger on factory-authored PR CI failure; 2 attempts max; gate-weakening ⇒ auto-reject.
Oracle: **A4.4** fix that edits CI/test/lint config or removes tests rejected; human PRs never touched.

### T-5.04 · Context inventory-lite · W7 · S · R1
Depends: T-2.01 · Read: `10 §6` · Satisfies: FR-14; A4.10
Build: `factory inventory` (duplicate, stale, orphaned reference, unclassified, privileged-unreviewed); duplicate+stale count tracked.
Oracle: **A4.10** on a fixture corpus; deterministic output.

### T-5.05 · Proposal schema and manual review path · W7 · S · R2
Depends: T-1.14 · Read: `12 §8`; ADR-0007 · Satisfies: FR-93, SEC-11; I-5
Build: `proposals` table + AP read/approve/reject; schema {evidence (≥N runs), expected effect, measurement plan, rollback plan}.
Oracle: proposal without batch evidence rejected; route inventory proves **nothing applies a proposal automatically** (applying = ordinary reviewed definition change).

---

## 8. Epic E6 — Production (Weeks 7–8) → Gate G4

### T-6.01 · Production deployment · W7 · L · R3
Depends: T-2.19, T-3.06 · Read: `04 §7, §10`; ADR-0025 · Satisfies: NFR-10; PRD-5, PRD-8
Build: VM provisioning notes, prod compose, Caddy, worker systemd unit, rootless Docker, networks, sops secrets, DB roles, bucket versioning, private access, `factory doctor --prod`.
Oracle: doctor green; **only `/webhooks/github` reachable publicly** (external probe); no docker socket in any container; secrets absent from `docker inspect` of T2 containers.

### T-6.02 · Backups and restore drill · W7 · M · R2
Depends: T-6.01 · Satisfies: PRD-6
Build: Postgres PITR/dump schedule, bucket versioning + lifecycle, restore script; drill on a clean host: restore → rebuild projections → verify hash chains → smoke task.
Oracle: RTO measured and recorded; chains verify.

### T-6.03 · Self-observability and alerts · W7 · M · R2
Depends: T-6.01 · Read: `15 §3` · Satisfies: NFR-03; PRD-8
Build: structured logs, Prometheus metrics, alerts: `tool.denied` / `net.egress.denied` / `policy.denied` spikes, event gap / chain break, stuck leases, projection staleness, spend rate, budget breach, webhook rejects, orphan credential leases.
Oracle: each alert fires in a drill.

### T-6.04 · Runbooks and kill switch · W8 · M · R2
Depends: T-6.03 · Satisfies: PRD-8, PRD-10
Build: `docs/runbooks/`: credential leak, provider outage, stuck leases/zombie containers, runaway cost, bad factory release rollback, webhook-secret rotation, restore; kill-switch drill.
Oracle: each runbook exercised once with a dated record; kill switch halts intake, scheduler and harness within 10 s.

### T-6.05 · Soak run · W5–W8 · L · R2
Depends: T-2.19 (start), runs through W8 · Satisfies: PRD-4, PRD-9
Do: ≥20 real tasks over ≥14 days on the real repo at L2; weekly "what did the factory merge" review.
Oracle: ≥10 merged; 100 % complete run artefacts; all reconstructable; secret scan 0; metrics report produced.

### T-6.06 · Production readiness review · W8 · M · R2
Depends: all · Read: pack `06` all; `08 §6, §8` · Satisfies: PRD-1…10
Do: run the full checklist, update deferred and risk registers, owner go/no-go.
Oracle: signed `docs/readiness/PRR-<date>.md`.

---

## 9. Parallelisation map (max 3 concurrent build agents, each in its own worktree)

| Week | May run in parallel (disjoint packages) | Must be serial |
|---|---|---|
| W1 | after T-1.01: {T-1.02→T-1.03→T-1.04} ∥ {T-1.05} | T-1.01 first (contracts bump needed for anything else) |
| W2 | {T-1.06} ∥ {T-1.07} ∥ {T-1.08→T-1.09} ∥ {T-1.10} ∥ {T-1.11} ∥ {T-1.12}; then {T-1.14 ∥ T-1.15}; then T-1.16 | T-1.13 after 1.07/1.08/1.10/1.11/1.12; T-1.17 last |
| W3 | {T-2.01→T-2.02→T-2.03} ∥ {T-2.04} ∥ {T-4.01, T-4.02}; then {T-2.05→T-2.06→T-2.08} | T-2.07 after T-2.10 (W4) for admission |
| W4 | {T-2.10→T-2.11→T-2.12→T-2.13} (serial chain) ∥ {T-2.09} ∥ {T-2.07} ∥ {T-4.03} | chain order |
| W5 | {T-2.14} ∥ {T-2.16} → {T-2.15} → {T-2.17} → {T-2.18} → T-2.19 | |
| W6 | {T-3.01 ∥ T-3.03 ∥ T-3.04 ∥ T-3.05 ∥ T-3.06}, T-3.02, T-5.01, T-4.04 | |
| W7 | {T-3.07 ∥ T-3.08 ∥ T-5.02→T-5.03 ∥ T-5.04 ∥ T-5.05 ∥ T-4.05 ∥ T-6.01→T-6.02→T-6.03} | |
| W8 | T-6.04, T-6.05 (finishing), T-6.06 | |

**Interface rule:** a ticket needing a contract change first opens a tiny `contracts` ticket (S, R3) and waits for it to merge — never edit `packages/contracts` inside another ticket.
