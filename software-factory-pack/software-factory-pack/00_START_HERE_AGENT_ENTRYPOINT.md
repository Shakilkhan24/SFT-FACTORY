# 00 — START HERE (Software Factory Implementation Pack v1.0)

> **For humans and AI agents.** This pack turns the *Software Factory Blueprint* (a ~1 MB research-and-design corpus) into a **buildable, 8-week, production-ready plan**: architecture, contracts, integrations/APIs, 66 agent-ready tickets, gate checklists, an agent operating manual, and a verification/readiness plan — plus two addenda: **stack neutrality** (`A1`: any factory language, any target language, swappable tools) and the **path to peak automation** (`A2`: deploy, IaC, operate, earned L3/L4).
> The blueprint is a **specification, not an implementation** and says so itself. This pack is the implementation layer on top of it. When the two disagree, the blueprint's ADRs win (see §6).

---

## 1. The goal in one paragraph

Build **Factory v1**: a single-owner, GitHub-native software factory that turns a reviewed issue into a verified pull request — with the acceptance oracle written *before* the implementation, every consequential action policy-checked and logged, every run fully recorded, **a human merging every change**, and honest measurement of its own productivity. Then add bug-fix and maintenance workflows. Autonomy stays at **L2** (agents execute in isolation and open PRs; a human reviews code and merges). Production deployment, incident response, and autonomous merging are **deliberately out of v1** and come back only on evidence (`01_…` §3). **Stack-neutral:** the factory builds software in any language and is itself written in a profile of your choice (`A1`); the evidence-gated road from v1 to **peak automation** — deploy, IaC, operations, earned L3/L4 — is `A2`.

## 2. File map and reading order

| # | File | Read it when | What it gives you |
|---|---|---|---|
| **00** | this file | first | orientation, rules of the road |
| **01** | `01_MISSION_SCOPE_AND_DECISIONS.md` | second | what "production-ready" means (PRD-1…10), scope cut line, 8-week plan, **decision register (ADR-0013…0027)**, owner decision sheet D1–D10, risks |
| **02** | `02_ARCHITECTURE_SPEC.md` | before building any component | topology, zones, repo layout, **component specs & algorithms**, workflow B/C/D flows, security architecture, deployment, degradation |
| **03** | `03_CONTRACTS_AND_DATA_MODEL.md` | **the file you code against** | Postgres DDL, TypeScript interfaces, YAML definition kinds, event vocabulary, state-machine tables |
| **04** | `04_INTEGRATIONS_AND_API_CATALOG.md` | when touching anything external | every integration (GitHub App, providers, Docker, Postgres, S3, harness, MCP…), the factory's REST/SSE/webhook API, CLI, capability registry, secrets inventory |
| **05** | `05_TICKET_BACKLOG.md` | to pick work | 6 spikes + **66 tickets** (oracle-first, with Read bundles, Done criteria), parallelisation map |
| **06** | `06_MASTER_CHECKLIST_AND_COVERAGE.md` | to know what "done" is | gate checklists G0–G4 with verify commands, 99-requirement coverage matrix, deferred register, Friday checkpoint |
| **07** | `07_AGENT_OPERATING_MANUAL.md` | before any agent runs | **`AGENTS.md` (copy to repo root)**, ticket loop, prompt templates, delivery-strategy playbook, review protocol |
| **08** | `08_VERIFICATION_AND_PRODUCTION_READINESS.md` | when writing tests / preparing release | test layers, invariant tests, **AT-1…15 attack specs**, fault injection, drills, ops, PRR |
| **A1** | `A1_STACK_NEUTRALITY_AND_ADAPTERS.md` | when choosing your stack, or if you use something other than TypeScript/GitHub/Docker | **what is fixed vs profile vs adapter**; factory-language profiles (TS, Python, Go, .NET, Java); starter `repo.yml` commands for ~11 target stacks (incl. Terraform, Helm, CI repos); adapter swap map; Kubernetes isolation provider |
| **A2** | `A2_PATH_TO_PEAK_AUTOMATION.md` | when planning beyond v1 | what "peak" means, the full journey map, **GitOps-first deploy**, plan-hash-bound IaC, how autonomy is **earned** (L3/L4), phases P6–P10, **39 ticket stubs** (E7–E12), DORA metrics, peak-path risks |
| — | `reference/validate_ddl.sh` | T-1.02 / G1 | executable seed oracle: applies the DDL from `03` to a throwaway Postgres and checks 25 guarantees (all pass on PostgreSQL 16.15) |
| — | `blueprint-reference/` | by ticket `Read:` line only | curated original blueprint files; `CONTEXT_MANIFEST.md` says what each is for |

## 3. If you are an AI agent

1. Read `AGENTS.md` (repo root; source: `07` §2). Its hard rules override everything below.
2. You implement **one ticket**. Load only: `AGENTS.md`, the ticket, and the files in its `Read:` line (`tools/context-bundle <ticket>`). Never load the whole blueprint.
3. **No oracle, no work.** The ticket's oracle files must already exist and be approved; you may not edit them.
4. Stay inside the ticket's `Build` paths. Anything else → a proposed ticket, not code.
5. Anything tagged `[VERIFY]` is an external fact you must confirm from official docs or a spike note before using.
6. When in doubt: **deny by default, stop, write an ESCALATION** (format in `AGENTS.md` §6).

## 4. If you are the owner — your first 48 hours

1. Read `01` (30 min). Answer **D1–D10** (`01` §7); the defaults let work start, but **D1 (target repo)** is the one that matters. **Also pick your factory-stack profile** (`A1` §4.3): the language you can review fastest — do this before W1 so nothing is built twice.
2. Create the repo; copy this pack to `docs/pack/` and `07` §2 to `AGENTS.md`.
3. Start the two **day-one clocks** immediately: **T-0.04** (pre-factory baseline — measure *before* any factory output exists) and **T-0.06** (mine calibration candidates).
4. Create the **GitHub App** with exactly the permissions in `04` §2.1 (**no Workflows, no Administration**).
5. Run **T-0.02** and **T-0.03** with an agent using `07`'s templates — from here every ticket follows the oracle-first loop by hand (the "manual factory").
6. Put the **Friday checkpoint** (`06` Part E) in your calendar and hold to the cut order (`01` §5.2).
7. Budget **2–3 focused hours/day** for oracle approval and PR review. This is the real bottleneck of the programme; if it isn't available, slip the date — don't skip review.

## 5. The non-negotiables (details and enforcement: `01` §2)

**Five commitments:** independent verification (oracle first) · policy deterministic / orchestration probabilistic · autonomy earned per workflow (start L2, human code review is the floor) · the factory proposes changes to itself and never applies them · no productivity number without a baseline.
**Twelve invariants I-1…I-12**, each with an automated test (`INV-1…12`, `08` §3).
**Must-not-build:** chat-with-the-agent interface · autonomous self-modifying factory · vector DB as context store · message broker / Kubernetes / event-streaming platform · general workflow engine · one agent per role · LLM grader for every check · multi-tenancy · confidence-score merging without calibration.

## 6. Conventions

* **Authority order when sources disagree:** blueprint ADRs > blueprint requirements (`blueprint-reference/06_…`) > pack `02`/`03`/`04` > ticket text. Raise conflicts; never diverge silently. Three things are never changed without an explicit, argued ADR: the **authority split (ADR-0004)**, **oracle independence (ADR-0005)**, the **human review floor (ADR-0003)**.
* **Markers:** `[BP: …]` mandated by the blueprint (file/section) · `[PACK]` decision made by this pack (reversible via ADR) · `[VERIFY]` external fact to re-check before use.
* **Citations:** `NN §x` with **NN = 09…19** is always a *blueprint document* (the pack has no such numbers); with **NN = 00…08**, or `A1`/`A2`, it is a *pack file* unless written `blueprint NN §x` or `[BP: NN §x]`. Blueprint section numbers refer to the files under `blueprint-reference/`.
* **Commands:** a `pnpm <task>` in any ticket or checklist means *the task `<task>` of your stack profile* (`just <task>` in non-TypeScript profiles); test-name selectors per stack are in `A1` §3.
* **IDs:** tickets `T-<epic>.<nn>` · spikes `S-n` · checklist rows `CL-G<gate>-<nn>` · decisions `ADR-0013…` · production criteria `PRD-n` · roadmap acceptance `A<phase>.<n>` · invariants `I-n` (design) / `INV-n` (test) · attacks `AT-n` · risks `R-nn` (blueprint) / `RP-n` (this plan) · requirements `FR-/NFR-/SEC-/MEAS-nn`.
* **Context tiers:** Tier-0 (always): `AGENTS.md`, ADR-0003/0004/0005/0011/0012, blueprint brief (17), this file, the ticket. Tier-1: the ticket's `Read:` list. Tier-2 (never loaded by build agents): research analyses and provenance docs — they stay in your original zip.

## 7. Provenance and honest coverage

* Derived from `software-factory-blueprint.zip` (README, 19 numbered documents, 12 ADRs, 6 templates, glossary, 15 research analyses of 15 source transcripts).
* **Read in full:** README, START_HERE, the build brief (17), roadmap (16), requirements (06), reference architecture (07), agent catalog (08), orchestration/state/events (09), context/skills (10), tools/MCP (11), workflows (12), security (13), quality (14), all 12 ADRs, and the consistency audit (19).
  **Read in part:** observability (15, first half in full + data-contract sections), executive vision (01, opening), open questions/risks (18, risk register + question list).
  **Consulted by targeted extraction:** all 15 research analyses (their *tools & integrations* and *implementation value* sections) and the templates. **Skimmed by headings only:** source inventory, evidence ledger, synthesis, taxonomy, glossary.
* The blueprint's own audit lists what it did **not** verify (the design has never been built; transcripts not re-checked). This pack inherits those limits. Its additions are marked `[PACK]`; its external-fact claims are marked `[VERIFY]` and are scheduled to be confirmed in spikes S-1…S-6.
* The phrase "super dev#" is not defined anywhere in the corpus; the pack's reading of it is in `07` §5.
