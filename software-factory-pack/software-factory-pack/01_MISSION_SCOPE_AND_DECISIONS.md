# 01 — Mission, Scope, Timeline and Decisions

> **Audience:** the human owner and every AI agent working on the build. **Read second** (after `00_START_HERE_AGENT_ENTRYPOINT.md`).
> **What this file settles:** what "production-ready v1" means, what is in and out, how 30 weeks of blueprint roadmap become 8 weeks, the week-by-week plan, and every decision this pack makes on the owner's behalf.
>
> **Markers used across the whole pack**
> `[BP: …]` mandated by the blueprint (cite = file/section in `blueprint-reference/`) · `[PACK]` a decision made by this pack, reversible only through an ADR in §6 · `[VERIFY]` an external fact (API, flag, model name, limit) the implementing agent must re-check against current official docs before relying on it.

---

## 1. Mission

**Build Factory v1:** a single-owner, GitHub-native software factory that turns a reviewed issue into a verified pull request — acceptance oracle written *before* the implementation, every consequential action policy-checked and logged, every run fully recorded, **a human merging every change** — and that measures its own productivity honestly. Extend it to bug-fix (Workflow C) and maintenance (Workflow D) inside the 8 weeks.

**Why this shape.** The blueprint's single most important unanswered question is whether agent throughput becomes *accepted* throughput (Q-05). The v1 factory exists to answer that for the owner with data, while already making the owner faster: several oracle-gated PRs in parallel, with the owner as the merge gate. [BP: 18 §1.1 Q-05]

**Beyond v1.** v1 is the foundation, not the ceiling. `A2` lays out the evidence-gated road to *peak* automation (build → deploy → operate, earned L3/L4, GitOps-first), and `A1` makes the whole plan stack-neutral (any factory language, any target language, swappable tools).

### 1.1 What "production-ready" means here (and what it does not)

| It means | It does **not** mean |
|---|---|
| The factory itself is durable, secure, observable and tested for the scope it supports: **one owner, one-to-few repos, workflows B/C/D, autonomy L2.** | Autonomous merging, deployment to production, or incident response. Those are L3/L4 and need calibration evidence the factory has not yet collected. [BP: ADR-0003] |
| Every invariant I-1…I-12 has an automated test that fails if the invariant is broken. | That every requirement in the blueprint is built (see coverage matrix, `06_…` Part C). |
| It has survived a soak: ≥20 real tasks over ≥14 days on the owner's real repo. [PACK] | That any productivity multiplier is proven. No target is set from the research corpus. [BP: MEAS-06] |

### 1.2 Production-readiness definition (PRD-1 … PRD-10) — the 8-week finish line

| ID | Criterion | Verified by |
|---|---|---|
| PRD-1 | Gates G1, G2, G3 of `06_…` fully green (waivers only if recorded, owner-signed, time-boxed). | `06_…` Part A |
| PRD-2 | Each of I-1…I-12 has an automated test; breaking the guard in a scratch branch makes the test fail (mutation check). | `08_…` §3 |
| PRD-3 | Red-team suite AT-1…AT-15 runs as a **required check** in the factory's own CI. | `08_…` §4 |
| PRD-4 | ≥20 real tasks processed over ≥14 days at L2, ≥10 merged; each has a complete 12-element run artefact and a reconstructable audit trail. | T-6.05 |
| PRD-5 | Secret scan over the *entire* event/artefact/log store = 0 findings; no long-lived credential reachable from any T2 container. | T-3.06, A3.3, A3.4 |
| PRD-6 | Restore drill: Postgres + object store restored to a clean host, projections rebuilt, event-hash chain verified, within the owner's RTO (suggested ≤4 h). | T-6.02 |
| PRD-7 | Fault-injection suite passes: kill api/worker mid-run, Postgres restart, object-store outage, provider outage → resumed or explicitly failed, never silently lost. | T-3.07 |
| PRD-8 | Dashboard answers "what is the factory doing and what does it need from me" in ≤2 clicks; global kill switch tested; alerts fire in drills. | T-1.16, T-6.03, T-6.04 |
| PRD-9 | Pre-factory baseline report + cost-per-accepted-change report exist; no productivity claim is made without them. | T-0.04, T-4.01, T-4.05 |
| PRD-10 | Runbooks exist and each was exercised once (credential leak, provider outage, stuck leases, runaway cost, bad factory release rollback). | T-6.04 |

---

## 2. The non-negotiables (carried verbatim from the blueprint)

**Five commitments** [BP: 00_START_HERE; 17 §1]: (1) verification is independent of the implementer — oracle first; (2) policy is deterministic, orchestration is probabilistic, and they are never the same component; (3) autonomy is earned per workflow — start at L2, human code review is the floor; (4) the factory *proposes* changes to itself and never applies them; (5) no productivity number without a baseline.

**Twelve invariants** [BP: 17 §4.3]. Each row says *how v1 enforces it* and *which test proves it*.

| ID | Invariant | v1 enforcement | Proof |
|---|---|---|---|
| I-1 | Data plane cannot mutate control-plane state except via an authorised command | T2 containers have no DB role, no network except egress proxy + model-gateway passthrough; the worker (host) is the only bridge and calls control-plane modules through `Orchestrator` commands | `INV-1` + A3.1 |
| I-2 | No agent can widen its own scope, autonomy, or credential set | Grants/autonomy live in the *applied definition* (read-only to agents); `factory.write` never granted; credential minting is broker-only | `INV-2`, AT-5, AT-8 |
| I-3 | Every consequential action is attributable and in the event log | Broker step 10 + state-machine transition both append events in the same DB transaction | `INV-3`, A3.12 |
| I-4 | No merge without passing acceptance oracle and applicable approval | Required check `factory/merge-gate` bound to head SHA + branch ruleset + CODEOWNERS | `INV-4`, A1.7 |
| I-5 | No factory change takes effect without a reviewed, evaluated, reversible change | Applier only reads a merged git SHA; control-surface writes rejected | `INV-5`, A0.7, AT-6/7 |
| I-6 | Untrusted content cannot become instruction | Tag-at-ingest, envelope-last, proposed actions re-checked by policy; no tool/grant derives from content | `INV-6`, AT-1/2/3 |
| I-7 | No production write outside an enumerated runbook | v1 has **no** production capability at all (deferred) — test asserts none is registered | `INV-7` |
| I-8 | Every run's context is pinned and recoverable | `context_envelopes` row + object; `resolvedContextSha256` on every run | `INV-8`, A0.4 |
| I-9 | No dependency on one model provider for correctness/governance | Gateway adapters; fake + second provider; failover test | `INV-9` |
| I-10 | No agent-authored test alone satisfies an acceptance criterion | Authorship flags in GateReport; oracle admission rejects `implementationRunId != null` | `INV-10`, A1.6 |
| I-11 | Surplus capacity allocated by policy, not default | Scheduler concurrency + per-workflow caps from definition; no auto-fill | `INV-11` |
| I-12 | Every component replaceable without changing definition/workflows/agent contracts | All components behind `packages/contracts` interfaces; each has an in-memory fake used in tests | `INV-12` |

**Must-not-build list** [BP: 17 §2] — violating any reintroduces a failure mode the design exists to prevent: chat-with-the-agent interface · autonomous self-modifying factory · vector DB as context store · message broker / Kubernetes / event-streaming platform · general-purpose workflow engine · one agent per role · LLM grader for every check · multi-tenancy · confidence-score merging without calibration.

---

## 3. Scope: in, out, and the trigger that brings each deferred item in

| Blueprint capability | v1 | Notes / deferral trigger |
|---|---|---|
| **Phase 0** — definition, event log, state machine, policy, broker, gateway, artefact store, scheduler, access points, T1, orchestrator | **IN, full** | |
| **Phase 1** — context assembler, skills, prompts, refine/plan/work, oracle, verification, reviewer, panel, merge gate, PR, knowledge | **IN, full** | "Panel" = deterministic aggregator over reviewer outputs; **no confidence-gated merging** |
| **Phase 2** — gate set, authorship policy, calibration + injection harness, blast radius, review queue, approvals | **IN, core** | OUT: LLM-judge verifiers, panel-confidence calibration (A2.11). Trigger: owner wants L3 for a workflow |
| **Phase 3** — T2, credential broker, default-deny egress, fetch service, tagging, red-team, supply chain, audit tool | **IN** (T2, broker, egress proxy, tagging, 15 attacks, supply chain basics, audit tool, minimal fetch service) | **T3 OUT.** Trigger: any workflow that accepts content from non-owner authors, or tasks needing open network, or first deploy workflow |
| Workflow **B** issue→PR | **IN** | the spine |
| Workflow **C** bug fix (reproduction gate) | **IN** | W6 |
| Workflow **D** | **IN: D-1** dependency upgrades, **D-2** CI repair of factory-authored PRs | OUT: flaky repair, coverage backfill, conformance sweeps. Trigger: 4 weeks of stable gates + baselines |
| Workflow **A** (deploy), **E** (incident), **F** (multi-repo) | OUT | Trigger A/E: calibrated verifiers + tested rollback + owner opts into L3/L4. Trigger F: second repo with cross-repo changes. **Path and phases: `A2` §6** |
| Autonomy **L3/L4** | OUT | Needs calibration reports + defect-escape data [BP: ADR-0003 §3] |
| Replay evaluator, outer/meta loops, auto-rollback of factory changes | OUT | v1 keeps only the **proposal schema** + manual review path (T-5.05). Trigger: ≥100 completed runs |
| Context inventory | **IN-lite** (duplicate/stale/orphan report) | T-5.04 |
| Multi-tenant, vector DB, k8s, broker, workflow engine | **OUT, by decision** | Q-01 / must-not-build |

---

## 4. Compression: how ~30 weeks (team of 2–4) becomes 8 weeks (owner + AI agents)

The blueprint's roadmap puts the first Workflow-B slice at ≈ week 30. These six levers close the gap. **If any lever fails, use the cut order in §5.2 — never the "never cut" list.**

1. **One owner, one repo, one workflow first.** The blueprint's own advice; everything after is configuration. [BP: 16, 17 §5.7]
2. **Thin component, real interface.** Every Phase 0–3 component is built in its smallest correct form *behind the real interface*; the in-memory fake used by tests doubles as the I-12 proof.
3. **Boring off-the-shelf where the blueprint is silent.** Postgres, S3 API, Docker, GitHub App, Fastify, Vitest, Claude Code as a *HarnessAdapter*. Build bespoke only what encodes an invariant: policy, broker, event log, assembler, gate, scorer, approvals. [BP: ADR-0012]
4. **AI agents implement; the owner writes/approves oracles and reviews every PR.** From Week 0 the build itself runs the factory's own discipline by hand (the "manual factory", ADR-0015), so by Week 5 the factory can take over part of its own backlog.
5. **Contract-first, parallel by disjoint file ownership.** `packages/contracts` lands first; tickets then run in parallel worktrees (`07_…` §6).
6. **A pre-agreed cut line** (§5.2) so slippage removes breadth, never safety.

**Reality check [PACK].** 8 weeks is feasible only if the owner gives ~2–3 focused hours a day to oracle approval and PR review. Human review is the bottleneck of the whole programme (CP-7, R-03) and it applies to the build too. If that time is not available, slip the date, don't skip review.

---

## 5. The plan

### 5.1 Week-by-week (ticket details in `05_TICKET_BACKLOG.md`)

| Week | Theme | Tickets | Exit gate (see `06_…`) |
|---|---|---|---|
| **W0** (3 days) | Decide, scaffold, bootstrap the manual factory, start the two day-one clocks | T-0.01 – T-0.06 | **G0** pre-flight |
| **W1** | Contracts, DB, event log, state machine, policy engine | T-1.01 – T-1.05 (+ T-1.06 begins) | contract + unit gates green |
| **W2** | Definition applier, scheduler, broker, credentials, gateway, artefacts, T1, orchestrator, access points, projections, dashboard v0 | T-1.06 – T-1.17 | **G1** = Phase-0 exit (A0.1–A0.10) |
| **W3** | Context assembler, skills, prompts, GitHub intake + tagging, triage, refinement, oracle, planner; start baseline + calibration | T-2.01 – T-2.08, T-4.01, T-4.02 | specs + oracles produced for a sandbox issue |
| **W4** | Approvals, T2 Docker + egress proxy, gateway passthrough + Claude Code harness, worker, verification runtime | T-2.09 – T-2.13, T-4.03 | worker produces a verified patch in T2 |
| **W5** | Reviewer + panel, PR creation + check runs, blast radius, merge gate, knowledge, Workflow B wiring | T-2.14 – T-2.19 (+ T-3.01 starts) | **G2** = Phase-1 exit (A1.1–A1.12). **First real issue on the real repo.** |
| **W6** | Safety hardening, Workflow C, first calibration reports; soak starts on real issues | T-3.01 – T-3.06, T-5.01, T-4.04 | red-team core green |
| **W7** | Fault injection, concurrency, Workflow D-1/D-2, inventory-lite, proposals, cost reports, production deploy, backups, self-observability | T-3.07, T-3.08, T-5.02 – T-5.05, T-4.05, T-6.01 – T-6.03 | **G3** = safety + breadth exit |
| **W8** | Soak completion, drills, runbooks, readiness review, buffer | T-6.04 – T-6.06 | **G4** = production readiness (PRD-1…10) |

### 5.2 Slip policy

**Cut order** (cut the first item that gets you back on schedule; record each cut in `06_…` Part D "Deferred register" with its trigger):
1. T-5.05 proposals, T-5.04 inventory-lite 2. T-5.03 (D-2) then T-5.02 (D-1) 3. real second-provider adapter (keep interface + FakeProvider + failover test; NFR-09 gap recorded) 4. T-5.01 Workflow C 5. dashboard polish → CLI + three server-rendered pages 6. calibration beyond one property

**Never cut:** event log (T-1.02/1.03) · state machine (1.04) · policy engine (1.05) · broker + credential broker (1.08/1.09) · run artefacts (1.11) · gateway budgets (1.10) · T2 + egress (2.10) · oracle admission (2.07) · approval binding (2.09) · verification + authorship flags (2.13) · merge gate (2.17) · untrusted tagging (2.04/3.01) · red-team AT-1…AT-9, AT-13, AT-14 (3.02) · audit tool (3.04) · restore drill (6.02) · kill switch (6.04).

**Weekly checkpoint (Friday, 30 min):** run `06_…` Part E. Two consecutive red weeks → apply the next cut.

---

## 6. Decision register (pack ADRs, numbered after the blueprint's ADR-0001…0012)

All are **Proposed**; the owner confirms or amends them in T-0.01. Changing one later = new ADR (template: `blueprint-reference/templates/ADR.md`).

| ADR | Decision | Why | Alternative / revisit trigger |
|---|---|---|---|
| **0013** Stack *(amended by `A1`)* | **Reference profile — TypeScript** (strict) on the current Node LTS; pnpm workspaces; Vitest + fast-check; **Zod as contract source of truth** → JSON Schema export; SQL-first migrations + Kysely; Fastify (+ zod type-provider, OpenAPI); React + Vite dashboard; `execa` for CLIs; pino + prom-client | One language across API, worker, CLI, UI; strong runtime+static typing for contract-heavy code; first-class SDK/CLI support for the harness | Python (FastAPI/Pydantic) is equally valid — only file paths in tickets change. Revisit only if the target repos are Python-centric *and* the owner prefers it — **the stack is a profile: see `A1` §4; choose the language you review fastest** |
| **0014** Definition location | `/definition` in the factory monorepo, protected by CODEOWNERS + path-deny for agents; applied version = merged git SHA | Solo owner; avoids a second repo to maintain | Move to its own repo when a 2nd human joins or when the factory targets its own `definition/**` |
| **0015** Bootstrap | Manual factory in W0 (`AGENTS.md`, worktree helper, oracle-first ticket template, protected oracle paths); progressive dogfooding — from W5 the factory takes non-critical tickets on its own repo (`definition/**`, `migrations/**`, `packages/{policy,broker,credentials}/**`, `.github/**` stay R4/human-only) | Productivity from day 1; the build follows the doctrine it implements | — |
| **0016** L2 merge model | Humans merge in the GitHub UI; the factory holds **no merge capability** in v1. Approval = commit status/check bound to the head SHA; factory observes `pull_request.closed(merged)` and records `change.merged` with the human as authority | Smallest possible authority; matches L2 exactly | Add `git.merge` capability only at L3 promotion |
| **0017** Executor kinds | Two kinds: `completion` (single structured model call through the gateway) and `harness` (coding agent inside T2). **Only the Worker (and Workflow-D/C fixers) use `harness`.** Refinement, Planner, Triage, Reviewer, Security-Reviewer are `completion` | Smaller attack surface, provider-portable, deterministic context | If a stage needs repo exploration beyond the assembled context, allow a bounded read-only tool loop through the broker |
| **0018** Credentials | GitHub **App** with per-task installation tokens (narrowed `repositories` + `permissions`), revoked at task end; no PATs; human login via GitHub OAuth with an owner allow-list | Matches SEC-04 (ephemeral, per-task, least-privilege) natively | GitLab/other SCM → new CredentialBroker adapter |
| **0019** Event sequencing (clarifies ADR-0008) | Gapless `seq` from a counter row updated under row lock (commit-ordered); **per-aggregate `version` CAS** on the aggregate row; projectors read by `seq`; monthly time partitions | A plain `bigserial` leaves gaps on rollback and can commit out of order → false "lost write" alarms and skipped events in cursor projectors | If p95 append >50 ms or >200 events/s sustained → switch to sequence + snapshot-safe reader |
| **0020** Isolation & execution | T1 (host worktree/snapshot, no code execution) for read-only/completion stages. **T2 (rootless Docker) is mandatory for any stage that executes repo code**, including verification. Rules: no `docker.sock` in any container; **never run host `git` inside a directory a container could write** (extract a patch via `git diff --binary`, apply it to a clean host worktree); per-task token-bound **egress proxy**; model access only via gateway passthrough. **T3 deferred** | Container-escape and git-hook/config attacks are the realistic v1 threats; this closes the cheap ones | Accepted risk: kernel-level container escape. Mitigations: rootless/userns, no caps, seccomp, optional gVisor `runsc` [VERIFY]. Build T3 on the §3 trigger |
| **0021** Oracle routes in v1 | Three routes: **R-H** human-authored (protected path); **R-G** deterministic generator for a small set of criterion kinds; **R-A** agent-authored by a **separate run before the implementer**, `untrusted` until the owner approves it **inside the plan approval**. Each criterion declares `expectedBefore: fail\|pass` (fail for new behaviour/bugs, pass for refactors); admission runs the oracle on the base commit and refuses on mismatch. Criteria may be `visible` or `holdout` | Lowest-cost way to keep oracle independence for a solo owner | — |
| **0022** Blast-radius v1 | Deterministic scorer, dimension points per `02_…` §4.14; **tier = max(score tier, criticality-map path floor)**; tier raised only by humans | Blueprint gives dimensions and tiers but not point values | H-08: compare predicted vs observed tier monthly and retune through reviewed policy change |
| **0023** Model routing | Routing is **config only** (`routing-policy.yaml`); names are examples and `[VERIFY]` against the provider's current model list at startup; gateway refuses unknown models; second provider = OpenAI-compatible adapter; FakeProvider for CI; failover test is a required check | I-9, NFR-09, FR-33 | Per-class thresholds tuned from data (Q-16) |
| **0024** Notifications & approvals | Approval *decisions* only via authenticated access points (dashboard/CLI) — never by replying in chat. Notifications (needs-you pings) via a generic webhook adapter (Slack/Telegram/Discord/email) chosen later | Keeps authority provenance clean | Slack-interactive approvals if volume demands, still routed through AP-2 |
| **0025** Hosting | Runner host = Linux VM with rootless Docker (≥4 vCPU/8 GB); Postgres 16+ with PITR (managed or pgBackRest/WAL-G); S3-compatible bucket with versioning; Caddy TLS; dashboard on a **private network** (VPN/tunnel) — only `/webhooks/github` is public; secrets via sops+age or a cloud secret manager | Smallest footprint that keeps the sandbox off the control-plane trust path | Split runner and control-plane hosts on the first untrusted-content workflow |
| **0026** Command surface | Commands are **task names** run by a language-neutral task runner (`just` recommended); test ids follow the identifier rule in `A1` §3 | The checklist never changes when the language does | — |
| **0027** Adapters over products | Every external system sits behind an interface with a documented swap map (`A1` §7); **PostgreSQL is the one fixed infrastructure dependency**; on the peak path deploy is **GitOps-first** (`A2` §3) | Keeps the plan valid for any SCM / CI / runtime / language and keeps production credentials out of the factory | Direct-apply deploy only for organisations without GitOps (`A2` T-8.07) |

---

## 7. Owner decision sheet (T-0.01) — answer before W1; defaults let agents proceed

| # | Decision | Default if unanswered | Blocks |
|---|---|---|---|
| D1 | **Target repo for the first slice** (host, language, build/test/lint/typecheck commands, CI) | **No default.** Fallback: create `factory-sandbox` (small TS service with real tests) and proceed through W3; D1 must be answered by W4 | T-0.05, T-2.x |
| D2 | Confirm TypeScript stack (ADR-0013) or choose Python | TypeScript | all paths |
| D3 | Hosting (ADR-0025) | One Linux VM + managed Postgres + S3-compatible bucket | T-6.01 |
| D4 | Model provider accounts + monthly cap | Anthropic primary; **starting caps [PACK]: $5/task, $50/day/workflow, owner-set monthly cap** | T-1.10 |
| D5 | Second provider | OpenAI-compatible endpoint; if none, FakeProvider only (gap recorded) | T-1.10 |
| D6 | Approvers | the owner's GitHub login only | T-1.14, T-2.09 |
| D7 | Notification channel | none (dashboard only) | T-3.05 |
| D8 | Secrets mechanism | sops + age file on the host | T-1.09 |
| D9 | Network exposure | private dashboard (VPN/tunnel); public `/webhooks/github` only; if no public endpoint possible → polling intake | T-2.04, T-6.01 |
| D10 | Daily review time | 2–3 h | the whole plan |

---

## 8. Risks specific to this 8-week plan

| ID | Risk | Likelihood / impact | Mitigation | Early signal |
|---|---|---|---|---|
| RP-1 | Owner review capacity saturates (R-03) | High / High | ≤3 open build PRs at once; risk-tiered review (`07_…` §7); reviewer-agent pre-pass; cut order | PRs waiting >24 h |
| RP-2 | Oracle authoring cost makes tasks not worth running (R-01, H-01) | Med / Critical | R-G generators for common criteria; R-A + owner review at plan approval; track oracle coverage and cost per oracle | share of tasks escalating "criteria not expressible" >40% |
| RP-3 | Harness CLI/SDK flags or stream format drift | Med / Med | Spike S-4 pins the CLI version; adapter has a golden-stream contract test; adapter is the only code that knows flags | contract test red after an upgrade |
| RP-4 | Gateway passthrough accounting wrong for streaming | Med / High | Reconcile gateway-counted usage against provider usage fields on every run; alert on >2 % drift | reconciliation alert |
| RP-5 | Security regressions introduced by AI-written code in the trust-bearing packages | Med / Critical | R4 paths are human-only; red-team suite required in CI from W3; mutation check for invariants | any AT test flakes |
| RP-6 | Scope creep ("one more workflow") | High / High | Cut order is pre-agreed; backlog changes only at the Friday checkpoint | tickets added mid-week |
| RP-7 | Provider outage/cost spike mid-soak | Med / Med | Fallback route; per-task/day caps; circuit breaker (T-4.05) | spend rate >2× trailing mean |
| RP-8 | Built but not used (R-08) | Med / High | First real issue by end of W5; weekly "what did the factory merge" review | zero merged factory PRs in a week after W5 |

Programme-level risks R-01…R-22 remain in force [BP: 18 §3].

---

## 9. Hypotheses the v1 soak must produce evidence on [BP: 18 §2]

| Hypothesis | v1 metric (from `14_…` §8) | Where reported |
|---|---|---|
| H-01 oracles can be built for a substantial fraction of tasks at acceptable cost | oracle coverage rate; cost per oracle | T-4.01 report |
| H-09 two providers give real failover diversity | failover test + record of what the fallback actually is | T-1.10, `INV-9` |
| H-11 oracle-first discipline holds under schedule pressure | **same-run-authored oracle rate** (must be 0) | T-4.01 |
| H-12 default-deny egress is sustainable | allow-list size and additions/month | T-3.05 / dashboard Health |
| Q-04 per-item review cost | owner review minutes per PR (self-reported in the approval form, optional field) | T-4.01 |
| Q-05 agent vs accepted throughput | accepted PRs/week and **cost per accepted change**, against the pre-factory baseline | T-4.05 |

---

## 10. Honest expectations

* The first two weeks after Phase-1 exit will mostly *reveal* problems: unexpressible criteria, flaky repo tests, context gaps. That is the point of the soak.
* Expect the factory to shine on well-specified, test-backed work (bug fixes with reproductions, small features, dependency upgrades) and to escalate on vague work. Escalation is a correct outcome, not a failure.
* Do not quote any speed-up figure from the research corpus. Report the baseline, the delta, the cost and a guardrail — or say nothing. [BP: MEAS-03, MEAS-06]
