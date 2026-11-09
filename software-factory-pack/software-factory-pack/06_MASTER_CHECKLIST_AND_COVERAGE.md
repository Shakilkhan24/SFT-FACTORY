# 06 — Master Checklist, Gates and Coverage

> **Audience:** implementing agents (to know what "done" means) and the owner (to decide go/no-go).
> **Rule:** a gate is green only when *every* row is ticked **with evidence** (command output, run id, PR link, or a dated record in `docs/evidence/`). A row without evidence is unticked. Waivers: owner-signed, time-boxed, recorded in `docs/waivers.md`; never for rows marked 🔒.
> **ID scheme:** `CL-G<gate>-<nn>` checklist rows · `A<phase>.<n>` blueprint acceptance criteria (`blueprint-reference/16`) · `INV-n` invariant tests · `AT-n` attacks · `PRD-n` production-readiness criteria (`01 §1.2`) · `T-x.yy` tickets (`05`).
> **Verify column:** commands assume the scripts created in T-0.02. Acceptance tests are named with their roadmap id so `pnpm test:acceptance -t "A0.1"` selects them. 🔒 = security-critical, no waiver. **`pnpm <task>` means the task `<task>` of your stack profile; the selector that replaces `-t "A0.1"` for each stack is in `A1` §3.**

---

## Part A — Gate checklists

### G0 — Pre-flight (end of Week 0)

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G0-01 | Owner decisions D1–D10 recorded as ADR files, each Accepted/Amended | `ls docs/adr/00{13..25}*.md`; each has `Status:` | owner |
| CL-G0-02 🔒 | GitHub App has exactly the permissions/events in `04 §2.1`; **no Workflows or Administration**; installed only on allow-listed repos | App settings export attached; `factory doctor --preflight github` (after T-2.04) | owner |
| CL-G0-03 🔒 | No provider/App secret in the repo, CI logs or shell history; sops+age file in place | `gitleaks detect --no-banner` = 0 findings | agent |
| CL-G0-04 | Scaffold CI green, including the *negative* deps-rule test | `pnpm ci` | agent |
| CL-G0-05 🔒 | `AGENTS.md` committed; `tools/oracle-guard` is a required check and rejects a synthetic oracle-edit PR | guard test output + ruleset screenshot | agent |
| CL-G0-06 | Pre-factory baseline committed **once** and never regenerated | `git log --oneline -- baselines/pre-factory-*` shows 1 commit | owner |
| CL-G0-07 | Target `.factory/repo.yml` commands run green on a clean clone | transcript in `docs/evidence/G0-07.md` | agent |
| CL-G0-08 | Calibration candidates mined (≥10 fix commits, or shortfall documented) | `wc -l calibration/candidates.jsonl` | agent |
| CL-G0-09 | Spike S-1 done; S-2/S-3 scheduled in W1–W2 | `docs/spikes/S-1.md` | agent |
| CL-G0-10 | Friday checkpoint (Part E) on the calendar | owner confirms | owner |
| CL-G0-11 | Factory-stack profile chosen (`A1` §4.3), recorded in `docs/stack-profile.md`; ADR-0013 amended; the task surface exists (`just ci` or the profile's equivalent runs green) | file exists + `ci` task green | owner |

### G1 — Phase-0 exit (end of Week 2) — blueprint A0.1–A0.10

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G1-01 🔒 | **A0.1** a tool call outside the grant is denied and logged as a security event | `pnpm test:acceptance -t "A0.1"` | agent |
| CL-G1-02 🔒 | **A0.2** a direct capability call bypassing the policy engine fails | `… -t "A0.2"` | agent |
| CL-G1-03 | **A0.3** a run produces all 12 artefact elements | `… -t "A0.3"` | agent |
| CL-G1-04 | **A0.4** two runs of the same trivial task resolve an identical context | `… -t "A0.4"` | agent |
| CL-G1-05 🔒 | **A0.5** killing the worker mid-run yields resumed or explicitly failed — never silent loss | `pnpm test:fault -t "A0.5"` | agent |
| CL-G1-06 | **A0.6** every projection can be dropped and rebuilt identically | `… -t "A0.6"`; `factory projections rebuild` | agent |
| CL-G1-07 🔒 | **A0.7** a control-surface write to the definition without a reviewed change is rejected | `… -t "A0.7"` | agent |
| CL-G1-08 | **A0.8** task cost is bounded before start and observable while running | `… -t "A0.8"` | agent |
| CL-G1-09 | **A0.9** worktrees/snapshots reclaimed at terminal state including failure | `… -t "A0.9"` | agent |
| CL-G1-10 🔒 | **A0.10** red-team subset AT-4, AT-5, AT-7, AT-8 pass | `pnpm test:redteam -t "AT-(4\|5\|7\|8)"` | agent |
| CL-G1-11 | Invariant tests INV-1, 2, 3, 5, 8, 9, 12 exist and pass | `pnpm test:invariants` | agent |
| CL-G1-12 | Event hash chain verifies on the hello-task run | `factory audit chain <taskId>` exit 0 | agent |
| CL-G1-13 🔒 | Secret scan of the hello-task store = 0 findings | `pnpm test -t "secret-scan"` | agent |
| CL-G1-14 | `factory doctor` passes locally | output attached | agent |
| CL-G1-15 | From the dashboard overview, a needs-you item is reachable in ≤2 clicks | `pnpm test:e2e -t "NFR-07"` | agent |
| CL-G1-16 🔒 | Owner reviewed every **R4** PR line-by-line (list PR numbers) | `docs/evidence/G1-16.md` | owner |
| CL-G1-17 | Build metrics recorded per ticket (wall-clock, tokens/$, review minutes) | `docs/build-metrics.csv` | agent |
| CL-G1-18 🔒 | The DDL oracle (`reference/validate_ddl.sh`, as extended by T-1.02) passes on the migrated database: append-only for every role, edge least-privilege, gapless `seq` under concurrency | `bash reference/validate_ddl.sh` exit 0 | agent |

### G2 — Phase-1 exit: Workflow B slice (end of Week 5) — blueprint A1.1–A1.12

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G2-01 | **A1.1** an issue becomes a reviewed PR with a passing, independently-authored oracle | `pnpm test:e2e -t "A1.1"` + run id of a real one | agent |
| CL-G2-02 🔒 | **A1.2** the oracle is authored before the implementation runs (provenance check; `implementationRunId == null`) | `… -t "A1.2"` | agent |
| CL-G2-03 | **A1.3** every acceptance criterion has ≥1 oracle check | `… -t "A1.3"` | agent |
| CL-G2-04 | **A1.4** context within budget on every run; no silent truncation | `… -t "A1.4"` | agent |
| CL-G2-05 | **A1.5** a dependent stage gets the upstream artefact and nothing else | `… -t "A1.5"` | agent |
| CL-G2-06 🔒 | **A1.6** agent-authored tests are flagged untrusted and never alone satisfy a criterion | `… -t "A1.6"` | agent |
| CL-G2-07 🔒 | **A1.7** merge-gate stays red when the oracle fails even if the whole suite passes | `… -t "A1.7"` | agent |
| CL-G2-08 | **A1.8** reviewer identity (run, context, model if preferred) differs from the implementer's | `… -t "A1.8"` | agent |
| CL-G2-09 | **A1.9** budget exhaustion ⇒ labelled `incomplete` with partial artefacts preserved | `… -t "A1.9"` | agent |
| CL-G2-10 | **A1.10** context resolution reproducible (golden file) | `… -t "A1.10"` | agent |
| CL-G2-11 | **A1.11** baseline and cost-per-accepted-change computed; no delta printed without a baseline | `factory metrics report` | agent |
| CL-G2-12 | **A1.12** first calibration corpus has violation **and** conforming samples + a measured detection rate | `factory calibrate report` | agent |
| CL-G2-13 🔒 | Ruleset applied and verified on the target repo: no bypass actors (App excluded); `factory/merge-gate` pinned to the App; CODEOWNERS present | `factory repo protect <o/r> --verify` exit 0 | owner |
| CL-G2-14 🔒 | INV-4, INV-6, INV-10, INV-11 pass (plus G1 set) | `pnpm test:invariants` | agent |
| CL-G2-15 | First **real** issue taken through B; run artefact complete; owner merge recorded as `change.merged` with the human's authority | task id + `factory audit explain <taskId>` | owner |
| CL-G2-16 | Harness CLI version pinned; golden-stream contract test green | `pnpm test -t "harness-contract"` | agent |
| CL-G2-17 | Gateway-counted usage reconciles with provider-reported usage within tolerance on ≥5 runs | reconciliation report | agent |
| CL-G2-18 🔒 | No provider key or GitHub token in any T2 container environment | `pnpm test -t "env-scan"`; `docker inspect` sample | agent |
| CL-G2-19 | Plan-approval screen shows raw untrusted blocks, flagged | e2e UI test | agent |
| CL-G2-20 🔒 | **Same-run-authored oracle rate = 0**; oracle coverage rate reported (H-01, H-11) | `factory metrics report` | agent |

### G3 — Safety and breadth exit (end of Week 7) — A2.x / A3.x / A4.x subset + attacks

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G3-01 🔒 | **A2.1** a verifier with no calibration report cannot gate a merge | `… -t "A2.1"` | agent |
| CL-G3-02 🔒 | **A2.2** an expired calibration removes the verifier from the gating set automatically | `… -t "A2.2"` | agent |
| CL-G3-03 | **A2.3** a violation-only corpus is rejected | `… -t "A2.3"` | agent |
| CL-G3-04 🔒 | **A2.4** a seeded violation is detected through verifier → gate → merge block | `… -t "A2.4"` | agent |
| CL-G3-05 | **A2.5** the negative control (realistic non-violation) is not flagged | `… -t "A2.5"` | agent |
| CL-G3-06 🔒 | **A2.7** a change that disables a required check is classified ≥R3 and needs security-scope approval | `… -t "A2.7"` | agent |
| CL-G3-07 | **A2.8** the review queue order is explained by the recorded score for every item | `… -t "A2.8"` | agent |
| CL-G3-08 🔒 | **A2.9** an approval for a modified artefact is void; **A2.10** an expired approval cannot authorise | `… -t "A2.(9\|10)"` | agent |
| CL-G3-09 🔒 | **A3.1** a T2 task cannot reach a host path outside its checkout; no docker socket | `… -t "A3.1"` | agent |
| CL-G3-10 🔒 | **A3.2 (T2 form)** a T2 task cannot reach the network beyond its allow-list; private/metadata ranges denied; no route if the proxy is down | `… -t "A3.2"` | agent |
| CL-G3-11 🔒 | **A3.3** credentials are absent from prompts and context (context scan) | `… -t "A3.3"` | agent |
| CL-G3-12 🔒 | **A3.4** a credential cannot be used after its task terminates | `… -t "A3.4"` | agent |
| CL-G3-13 🔒 | **A3.5** an injected instruction in fetched content cannot alter an action (AT-1, AT-2, AT-3) | `pnpm test:redteam -t "AT-(1\|2\|3)"` | agent |
| CL-G3-14 🔒 | **A3.6** scope-escalation attempts denied and logged (AT-4, AT-5) | `… -t "AT-(4\|5)"` | agent |
| CL-G3-15 🔒 | **A3.7** writing to the definition is rejected through every tool path (AT-6, AT-7) | `… -t "AT-(6\|7)"` | agent |
| CL-G3-16 🔒 | **A3.8** a cross-repository access attempt is refused and recorded (SEC-12) | `… -t "A3.8"` | agent |
| CL-G3-17 🔒 | **A3.9** a tampered context/skill artefact is rejected on load | `… -t "A3.9"` | agent |
| CL-G3-18 🔒 | **A3.10** a rejected/modified-artefact approval attempt is void and recorded (AT-13) | `… -t "A3.10"` | agent |
| CL-G3-19 🔒 | **A3.11** the red-team suite AT-1…AT-15 runs as a **required check** in the factory's CI | ruleset export + CI run | agent |
| CL-G3-20 🔒 | **A3.12** any consequential action reconstructs with its authority (100 % on the recorded run) | `… -t "A3.12"` | agent |
| CL-G3-21 | **A4.2** bug-fix regression test that passes on unfixed code is rejected; **A4.3** not-reproducible ⇒ escalated, no speculative fix | `… -t "A4.(2\|3)"` | agent |
| CL-G3-22 | **A4.4** a sweep/CI-repair fix that weakens a gate is rejected; **A4.5** a sweep that finds far more than expected stops and escalates | `… -t "A4.(4\|5)"` | agent |
| CL-G3-23 | **A4.10** inventory reports stale/duplicate/orphaned; the duplicate+stale count is tracked | `… -t "A4.10"` | agent |
| CL-G3-24 | Fault-injection suite green (NFR-04, NFR-10) | `pnpm test:fault` | agent |
| CL-G3-25 | Concurrency suite green (NFR-05) | `pnpm test:concurrency` | agent |
| CL-G3-26 🔒 | Secret scan over the whole store = 0 (PRD-5) | `pnpm test -t "store-secret-scan"` | agent |
| CL-G3-27 🔒 | **PRD-2 mutation check:** for each INV test, temporarily break its guard ⇒ the test fails (record the mutations tried) | `pnpm test:invariants --mutation` | agent |
| CL-G3-28 | Owner reviewed every R3/R4 PR merged in W3–W7 (list) | `docs/evidence/G3-28.md` | owner |

### G4 — Production readiness (end of Week 8) = PRD-1…PRD-10

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G4-01 | **PRD-1** G1, G2, G3 fully green (waivers listed, none on 🔒 rows) | `docs/readiness/PRR-<date>.md` | owner |
| CL-G4-02 🔒 | **PRD-2** invariants proven with mutation check | CL-G3-27 evidence | agent |
| CL-G4-03 🔒 | **PRD-3** red-team suite required in CI | CL-G3-19 evidence | agent |
| CL-G4-04 | **PRD-4** ≥20 real tasks over ≥14 days, ≥10 merged, each with a complete run artefact and reconstructable trail | `factory metrics report --soak` | owner |
| CL-G4-05 🔒 | **PRD-5** zero secret findings; no long-lived credential reachable from any T2 container | CL-G3-26 + CL-G2-18 | agent |
| CL-G4-06 | **PRD-6** restore drill on a clean host within the owner's RTO; chains verify | drill record | owner |
| CL-G4-07 | **PRD-7** fault-injection suite green on the production topology | `pnpm test:fault --prod-like` | agent |
| CL-G4-08 | **PRD-8** overview answers "doing / needs me" in ≤2 clicks; kill switch halts intake, scheduler and harness ≤10 s; alerts fire in drills | drill records | owner |
| CL-G4-09 | **PRD-9** pre-factory baseline + cost-per-accepted-change reports exist; **no productivity claim made without them** | reports | owner |
| CL-G4-10 | **PRD-10** each runbook exercised once (dated) | `docs/runbooks/*` drill log | owner |
| CL-G4-11 🔒 | Only `/webhooks/github` is publicly reachable (external probe); dashboard/API private | probe output | agent |
| CL-G4-12 | Deferred register (Part D) and risk register updated; every cut recorded with its trigger | this file Part D | owner |
| CL-G4-13 | Owner go/no-go signature | `PRR-<date>.md` | owner |

---

## Part B — Invariant test inventory (each must exist; proof detail in `08 §3`)

| Test | Invariant | Appears at |
|---|---|---|
| INV-1 | data plane cannot mutate control-plane state | G1 |
| INV-2 | no agent widens scope/autonomy/credentials | G1 |
| INV-3 | every consequential action attributable + logged | G1 |
| INV-4 | no merge without oracle + approval | G2 |
| INV-5 | no factory change without reviewed change | G1 |
| INV-6 | untrusted content never becomes instruction | G2 |
| INV-7 | no production capability exists in v1 | G3 |
| INV-8 | every run's context pinned and recoverable | G1 |
| INV-9 | provider failover works; no single-provider dependency | G1 |
| INV-10 | no agent-authored test alone satisfies a criterion | G2 |
| INV-11 | surplus capacity not auto-allocated | G2 |
| INV-12 | components replaceable behind interfaces (fakes pass the same contract tests) | G1 |

---

## Part C — Requirement coverage matrix (all 99 blueprint requirements)

Legend: ✅ covered in v1 · 🟡 partially covered (note says what is missing) · ⏸ deferred (trigger in Part D) · ◻ satisfied by absence in v1 (nothing to violate; a test asserts it).

| ID | Status | Tickets / tests | Note |
|---|---|---|---|
| FR-01 | 🟡 | T-2.19, T-5.01 | intent → **merged PR**; deploy/production deferred (Workflow A) |
| FR-02 | ✅ | T-1.06 | |
| FR-03 | ✅ | T-1.14, T-2.04 | |
| FR-04 | ✅ | T-1.04, T-1.05, T-2.17 | all workflows L2 |
| FR-05 | 🟡 | T-2.19, T-5.05 | change path full; proposal path manual |
| FR-06 | ✅ | T-1.06, T-2.09 | approval class by scope |
| FR-10 | ✅ | T-2.02 | |
| FR-11 | ✅ | T-2.06 | |
| FR-12 | ✅ | T-2.07 | |
| FR-13 | ✅ | T-2.01 | |
| FR-14 | 🟡 | T-5.04 | inventory-lite |
| FR-15 | ⏸ | — | promotion/demotion; A4.11 |
| FR-16 | ✅ | T-2.01, T-2.02 | `.factory/**` = R3 |
| FR-20 | ✅ | T-1.02–1.04 | |
| FR-21 | ✅ | T-1.02, T-1.03 | |
| FR-22 | ✅ | T-1.13, T-3.07 | |
| FR-23 | ✅ | T-2.08 | |
| FR-24 | ✅ | T-2.08 | |
| FR-25 | ✅ | T-2.01, T-2.08 | |
| FR-26 | ✅ | T-1.06 | report, never auto-correct |
| FR-30 | ✅ | T-2.03, T-2.19 | |
| FR-31 | ✅ | T-2.19 | by construction (role set reviewed) |
| FR-32 | ✅ | T-1.13, T-2.11 | |
| FR-33 | ✅ | T-1.10 | |
| FR-34 | ✅ | T-1.10 | |
| FR-35 | ✅ | T-2.14 | |
| FR-40 | 🟡 | T-1.12, T-2.10 | T1 + T2; **T3 deferred** |
| FR-41 | ✅ | T-2.12, T-2.17 | |
| FR-42 | ✅ | T-1.12, T-2.10 | |
| FR-43 | ✅ | T-1.07, T-3.08 | |
| FR-44 | ✅ | T-2.10, T-1.11 | digest-pinned image + base SHA + declared commands |
| FR-50 | ✅ | T-2.13 | |
| FR-51 | ✅ | T-2.13, T-2.17 | |
| FR-52 | ✅ | T-2.07, T-2.13 | |
| FR-53 | ✅ | T-2.13, T-3.03 | |
| FR-54 | 🟡 | T-4.03, T-4.04 | declared deterministic verifiers; auto-generation from prose standards deferred |
| FR-55 | ✅ | T-4.04 | mechanism; no verifier substitutes for human review at L2 |
| FR-56 | ✅ | T-2.14 | |
| FR-57 | ✅ | T-0.06, T-4.02 | |
| FR-58 | ✅ | T-2.16, T-2.17 | |
| FR-60 | ✅ | T-1.08 | |
| FR-61 | ✅ | T-1.05, T-1.08, T-2.19 | |
| FR-62 | ✅ | T-1.08 | fixture MCP |
| FR-63 | ✅ | T-1.09 | |
| FR-64 | ✅ | T-1.08, T-3.07 | |
| FR-65 | ✅ | T-1.08 | |
| FR-66 | ✅ | T-1.06, T-0.05 | |
| SEC-01 | ✅ | T-1.05, T-1.08 | |
| SEC-02 | ✅ | T-1.05; INV-2 | |
| SEC-03 | ✅ | T-2.01, T-2.04, T-3.01 | |
| SEC-04 | ✅ | T-1.09 | |
| SEC-05 | ✅ | T-2.10 | |
| SEC-06 | ✅ | T-1.05, T-1.08 | |
| SEC-07 | ✅ | T-1.03, T-3.04 | |
| SEC-08 | ◻ | INV-7 | no production capability in v1 |
| SEC-09 | ✅ | T-2.01, T-2.02, T-3.03 | |
| SEC-10 | ⏸ | — | no deploys; merged changes are reverted by humans via git |
| SEC-11 | ✅ | T-1.06, T-1.14, T-2.12; AT-6/7 | |
| SEC-12 | ✅ | T-2.10, T-3.08 | |
| FR-70 | ✅ | T-1.16 | |
| FR-72 | ✅ | T-2.16 | |
| FR-73 | ✅ | T-3.05 | |
| FR-74 | ✅ | T-2.09 | |
| FR-75 | 🟡 | T-1.08, T-2.09 | mechanism built and tested with a fixture E3 capability; no real E3/E4 capability exists |
| FR-76 | ⏸ | — | Workflow E |
| FR-77 | ⏸ | — | human code PRs are not gated by the factory in v1 |
| FR-80 | ✅ | T-2.01, T-2.02 | |
| FR-81 | ✅ | T-2.18 | |
| FR-82 | 🟡 | T-2.18 | minimal docs check |
| FR-83 | ⏸ | — | Workflow F |
| FR-84 | ⏸ | — | no production signals; CI signals feed D-2 |
| FR-85 | 🟡 | T-5.02, T-5.03 | D-1, D-2 only |
| FR-86 | ◻ | INV-7 | |
| MEAS-01 | ✅ | T-1.11 | |
| MEAS-02 | ✅ | T-1.03, T-1.11 | |
| MEAS-03 | ✅ | T-4.01 | |
| MEAS-04 | ✅ | T-4.05 | |
| MEAS-05 | 🟡 | T-4.01 | ~18 of 23 metrics |
| MEAS-06 | ✅ | T-4.01 | report refuses a delta without baseline |
| MEAS-07 | ⏸ | — | replay evaluator |
| MEAS-08 | ✅ | T-4.01 | |
| FR-90 | ⏸ | — | outer loop |
| FR-91 | ⏸ | — | meta loop |
| FR-92 | 🟡 | T-1.06, T-5.05 | versioning, approval, git rollback; evaluation deferred |
| FR-93 | ✅ | T-5.05 | |
| FR-94 | ⏸ | — | auto-revert on guardrail breach |
| FR-95 | 🟡 | T-1.07 | no auto-fill (I-11); allocation policy deferred |
| NFR-01 | ✅ | T-0.02; INV-12 | |
| NFR-02 | 🟡 | T-1.11, T-2.01, T-2.10 | manifest + pins recorded; re-execution/replay deferred |
| NFR-03 | ✅ | T-1.15, T-1.16, T-6.03 | |
| NFR-04 | ✅ | T-1.13, T-3.07 | |
| NFR-05 | ✅ | T-3.08 | |
| NFR-06 | ✅ | T-3.04 | |
| NFR-07 | ✅ | T-1.16 | |
| NFR-08 | ✅ | T-1.11, T-3.06 | |
| NFR-09 | ✅ | T-1.10 | second provider real adapter is first on the cut list |
| NFR-10 | ✅ | T-3.07; `02 §8` | |
| NFR-11 | ✅ | T-1.10, T-4.05 | |
| NFR-12 | ✅ | T-1.06, T-6.04 | |

**Tally:** ✅ 75 · 🟡 12 · ⏸ 10 · ◻ 2 = 99 (verified by script against `blueprint-reference/06_REQUIREMENTS_AND_NFRS.md`). `tools/coverage-check` (T-0.02) fails CI if any requirement id is missing from this table or the tally is stale.

---

## Part D — Deferred register (every cut/deferral, with its trigger)

> Promotion path and phase triggers beyond v1: `A2` §5–6.

| Item | Blueprint ref | Why deferred | Trigger to build | Review |
|---|---|---|---|---|
| T3 hardened sandbox | ADR-0006; Phase 3.2 | cost; T2 + default-deny + patch extraction closes cheap vectors | content from non-owner authors, tasks needing open network, or first deploy workflow | monthly |
| L3 merge / L4 operate | ADR-0003 | needs calibration + defect-escape evidence | ≥2 verifiers calibrated for a workflow, 8+ weeks of data, owner opts in | monthly |
| Workflow A (deploy), E (incident) | `12 §2, §6` | no production capability; rollback not proven | L3 promotion + tested rollback + runbooks | quarterly |
| Workflow F (multi-repo), FR-83 | `12 §7` | one repo in scope | second repo with cross-repo changes | quarterly |
| LLM-judge verifiers, FR-54 auto-generation | `14 §4.4` | calibration cost; L2 needs none | convention property that cannot be mechanised and L3 considered | quarterly |
| Panel-confidence calibration (A2.11) | ADR-0011 | no confidence-gated merge exists | before any use of panel output to reduce review | — |
| Replay evaluator, outer/meta loops, FR-90/91/94, MEAS-07 | Phase 5 | speculative; needs ≥100 runs | ≥100 completed runs with batch evidence | quarterly |
| Context promotion/demotion (FR-15, A4.11) | ADR-0009 | one repo | second repo or ≥10 local context items | quarterly |
| Flaky repair, coverage backfill, conformance sweeps (FR-85 rest) | `12 §5` | need stable gates + baselines | 4 weeks of stable gates | monthly |
| Human code PRs through the factory gates (FR-77) | `blueprint 06` (FR-77) | not needed by owner now | owner wants factory gates on own PRs | on request |
| Real second-provider adapter (if cut) | NFR-09, I-9 | first on the cut list | immediately after v1 | before v1.1 |
| Separation of duties for R3+ | `13 §6.3` | single owner | second approver exists | on change |
| Multi-tenancy | Q-01 | out of blueprint scope | explicit requirement | — |
| gVisor/`runsc` hardening | ADR-0020 | optional | any hostile-content workflow | quarterly |

---

## Part E — Friday checkpoint (30 minutes, every week)

1. Gate status: which `CL-G*` rows are ticked with evidence? Anything unticked that should be ticked this week?
2. Two red weeks in a row? ⇒ apply the next cut from `01 §5.2`; record it in Part D.
3. Review load: open PRs ≤3? oldest PR age <24 h? owner review-minutes per PR trend (Q-04).
4. Security signals since last Friday: `tool.denied`, `policy.denied`, `net.egress.denied`, `patch.rejected`, `webhook.rejected` counts; **egress allow-list size and additions** (H-12).
5. Oracle health: **same-run-authored oracle rate (must be 0)**, oracle coverage rate (H-01), share of tasks escalating "criteria not expressible".
6. Cost: spend vs cap; cost per accepted change (after W5); reconciliation drift <2 %.
7. Quality: accepted-PR rate, first-pass success, rework loops, reverts within 14 days.
8. Flake check: any red-team/fault test that flaked? (a flaky security test is a security finding.)
9. Docs/ADRs updated for any decision made this week; `docs/build-metrics.csv` updated.
10. Pick next week's tickets (≤3 concurrent agents); confirm each has its oracle ready *before* it starts.
