# 05 — Execution and gates: the Workflow-B spine

> **Phase W3–W5 (11 days) · Tickets T-2.09 … T-2.19 · Gate G2 (Phase-1 exit)**
>
> **This is the phase where the factory becomes a factory.** Approval, T2 isolation, the
> egress proxy, the harness adapter, the worker, the verification runtime, the reviewer
> and panel, the PR, the blast-radius scorer, the merge gate, knowledge capture, and
> finally the Workflow B definition itself.
>
> At the end of this phase, **a real issue on the real repository becomes a reviewed pull
> request with a passing, independently-authored oracle** (A1.1). That is the whole
> factory in one sentence.
>
> Eleven tickets over three weeks. The chain T-2.10 → T-2.11 → T-2.12 → T-2.13 is
> **serial** — do not parallelise it.

---

## PREREQUISITES

* Checklist 04 complete. The context assembler, prompt builder, oracle service and
  planner exist and their oracles are green.
* S-3 (rootless Docker networking) done — blocks T-2.10.
* S-4 and S-5 (harness CLI + usage accounting) done — block T-2.11.
* The oracle service exists so that T-2.13 has something to verify against.

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-2.09 | **A2.9** a modified artefact ⇒ the approval is void; **A2.10** an expired approval is unusable; a non-approver is rejected; a consumed approval is not reusable; review minutes are recorded | R-G |
| T-2.10 | **A3.1** no host path outside `/work`, no docker socket; an allowed host works, another host is denied + `net.egress.denied`; private and metadata IPs are denied; **no route when the proxy is down**; cleanup in `finally`; a labelled-container leak detector | R-G |
| T-2.11 | a FakeHarness run yields a patch + events; a real-harness smoke in T2 on the sandbox repo yields a diff; usage reconciles within tolerance; budget exhaustion ⇒ `incomplete`; the turn cap is enforced; **no provider key anywhere in the container env** (scan; test name contains `env-scan`); the golden-stream contract test name contains `harness-contract`; only allow-listed models; wall-clock kill | R-G |
| T-2.12 | a patch touching `.github/**`, an oracle path or an R4 path ⇒ `patch.rejected` (`policy.denied`, **no retry**); a symlink/submodule addition is rejected; oversize is rejected; **a planted `.git/hooks` in the container clone has no host effect**; push only to `factory/*`; injected issue text cannot add paths | R-G |
| T-2.13 | agent-authored tests are flagged untrusted and never satisfy a criterion; **an oracle failure ⇒ gate failure even if the rest passes**; disabling a required check ⇒ tier ≥ R3 + flag; skip-marker/test-deletion fixtures; **holdout checks run but are never mounted in the worker env**; a stable report hash | R-G |
| T-2.14 | the reviewer's run/context differ from the worker's, and the model differs when preferred (**A1.8**); panel policy table tests; **no numeric confidence field exists** in any output schema; a context scan proves the reviewer never saw the transcript | R-G |
| T-2.15 | the body contains no raw untrusted text (links instead; AT-2); the check name/integration is pinned; PR creation is idempotent; size limits | R-G |
| T-2.16 | table-driven scoring; **tier = max(score tier, path floor)**; an R4 path ⇒ the agent patch is rejected; the tier is raised only by humans; deterministic | R-G |
| T-2.17 | the merge-gate is red unless the oracle + approval are valid for the head SHA (`INV-4`); the factory has **no** merge capability; a new push voids the approval; merged-without-gate ⇒ a violation event + alert; ruleset drift fails loudly | R-G |
| T-2.18 | recorded exactly once per merged change; FTS finds by keyword; the docs gate fails when a tagged criterion lacks a docs diff; untrusted text only as quoted-and-tagged excerpts | R-G |
| T-2.19 | **A1.1** an issue → a reviewed PR with an independently-authored passing oracle; A1.2–A1.10 green; A1.11/A1.12 reports attached once T-4.01/T-4.02 land | R-G + owner |

> **T-2.13 and T-2.17 are the merge gate.** Between them they enforce I-4: *no merge
> without a passing acceptance oracle and the applicable approval.* Everything the
> factory builds is only as trustworthy as these two tickets.

---

## STAGE 1 — The work

### T-2.09 · Approval service and plan-first approval · W4 · L · R4

**Open ONLY:** blueprint `13` §6, blueprint `11` §5, pack `04` §2.5, pack `02` §4.16.

**Build** `packages/approvals`, the AP-2 endpoints, the dashboard approval view
(**raw untrusted blocks flagged**), the plan artefact, cool-off + security-scope ack, and
GitHub-review ingestion (R0–R2).

**Types in v1:** `plan`, `merge`, `definition`, `temporary-grant`. An approval binds
`(type, artefactKind, artefactRef, artefactSha256)` where the sha is
`sha256(canonicalJson(artefact))`:
* plan ⇒ `{spec, graph, oracleManifestSha, contextPins}`
* merge ⇒ `{headSha, gateReportSha, oracleSha, tier}`

**Properties: bound, time-limited, single-use, revocable, identity-bound,
non-transferable.** Defaults [PACK]: plan 72 h; merge valid while the head SHA is
unchanged (max 7 days); temporary-grant ≤ 1 h. Any artefact change ⇒ hash mismatch ⇒ the
approval is **void** (A2.9); expired ⇒ **unusable** (A2.10).

`decide()` accepts only identities in the approver list for that type; the decision is
recorded with actor `human:<github-login>`. **Chat messages and notification replies are
never decisions.** A verified GitHub approving review bound to the head SHA is accepted
as a merge approval for tiers **R0–R2 only**.

**Solo-owner caveat [PACK]:** separation of duties (R3+) cannot be met by one person.
Compensating controls: reviewer-agent evidence, the mandatory 'security-scope' tick, and
a 10-minute cool-off before an R3 approval can be consumed. Recorded as an accepted risk
until a second approver exists.

**This ticket is R4.**

---

### T-2.10 · T2 isolation and the egress proxy · W4 · L · R4

**Open ONLY:** blueprint ADR-0006, ADR-0020, blueprint `13` §7.3–7.5, pack `04` §7,
pack `02` §4.12.

**Build** `packages/isolation/t2` (the flags), the network bootstrap, `apps/egress-proxy`
(CONNECT, token auth, allow-list, SSRF block, outbox), digest verification, the TTL
reaper, the leak detector, and `factory doctor` checks.

**T2 container flags — exactly these:**

```
--user 10001:10001 --read-only --tmpfs /tmp --cap-drop=ALL
--security-opt no-new-privileges --pids-limit N --memory M --cpus C
```

No `--privileged`, no host network, **no `docker.sock`**. Seccomp default (optionally
`--runtime=runsc` `[VERIFY]`).

**Mounts:** only `/work` (a self-contained clone of the base SHA with `origin` removed)
and read-only toolchain caches; **oracle files mounted read-only at `/oracle`**
(holdout files **not** mounted).

**Acceptance (A3.1, A3.2):** no host path outside `/work`, no docker socket; allowed
host ok / other host denied with `net.egress.denied`; private and metadata IPs denied;
and **no route when the proxy is down** — a dead proxy is a denial, never a fallback to
direct egress. These are the T2 form of the sandbox invariants (INV-1) and they close
rows **CL-G3-09** and **CL-G3-10**.

**Network:** attached **only** to the internal `sandbox` network. Proxy env points at
the egress proxy; model env points at the gateway passthrough. Labels
`factory.task=<id>`; TTL reaper; destroy in `finally`; the leak detector lists labelled
containers of terminal tasks.

**The egress proxy** (Node `CONNECT` proxy on the `factory-egress` edge container, port
3128, on the `sandbox` and `core` networks; denials/summaries go to `edge_outbox`):
auth `Proxy-Authorization` carries `taskId:token`; the allow-list is the task's
`net.egress:<host>` grants (exact host or `*.suffix`, port 443 unless stated);
**resolve DNS in the proxy** and refuse private/loopback/link-local/metadata ranges
after resolution (SSRF); no TLS interception; every denial emits `net.egress.denied`
(a security event). **Proxy down ⇒ no network** (fail closed).

**This ticket is R4.**

---

### T-2.11 · Gateway passthrough and HarnessAdapter · W4 · L · R3

**Open ONLY:** pack `04` §6 + §8, pack `02` §4.7 + §4.13, blueprint ADR-0010.

**Build** `apps/gateway` (the edge): token auth, model allow-list, `max_tokens` cap,
forward, streaming usage, budget refusal, outbox. And `packages/harness`: the contract,
the `claude-code` adapter, a scripted **FakeHarness**, and the golden-stream contract test.

**The harness contract:**

```
run({prompt, workdir, env, limits{maxTurns, wallClockSeconds, maxUsd},
     allowedTools, model}) → AsyncIterable<HarnessEvent> ⇒
HarnessResult{status, turns, usage, patchRef?}
```

**The claude-code adapter** executes the pinned CLI **inside the T2 container**
non-interactively with structured stream output, a turn cap, a tool allow-list
(**shell/edit/read/grep only — no web tools, no MCP, no sub-agents**), a permission mode
suited to unattended runs, an appended system prompt (the assembled prompt), the model
via env/flag, `ANTHROPIC_BASE_URL` → gateway passthrough, `ANTHROPIC_API_KEY` → the **task
gateway token**, and nonessential traffic/telemetry/auto-update disabled. **All flag and
env names are `[VERIFY]`** against `claude --help` and current docs in Spike S-4, then
frozen behind a contract test with a recorded golden stream.

**Streamed tool uses** become run-record entries and `tool.invoked` events with
`transport: harness-internal` (recorded post-hoc, effect class E1 inside the sandbox).

**Honest limit [PACK]:** harness-internal actions are confined by T2, **not pre-authorised
by the broker**. Defence in depth: (a) a restrictive allow-list, (b) an optional
in-container pre-tool hook denying protected paths, (c) the **authoritative deterministic
check at patch extraction** (T-2.12). (c) is the one that counts.

**Budget:** the CLI turn/budget caps **and** the gateway hard cap; either stopping the run
⇒ `incomplete`.

---

### T-2.12 · Worker stage and patch extraction · W4 · L · R3

**Open ONLY:** pack `02` §4.14, blueprint ADR-0020, blueprint `12` §3.3.

**Build:** the implement executor — provision T2 (a base-SHA clone, the oracle mounted
read-only, the holdout **not** mounted) → assemble the context → run the harness →
**extract + validate the patch** → apply it to a clean host worktree (hooks off) →
commit with trailers → push via the broker → record.

**The patch-extraction path, deterministic, after every harness node:**

1. In the container produce `git diff --binary --no-color --no-ext-diff <baseSha>`
   (including untracked via `git add -N`); copy the patch out as bytes.
2. On the host, **validate before applying**: file count ≤ N, size ≤ S [PACK: 200 files,
   2 MB]; reject symlink (mode 120000) and submodule (160000) changes; reject path
   traversal; reject paths matching **R4/protected** globs or the oracle paths; flag
   executable-bit changes and `.gitattributes` / `.gitmodules` / CODEOWNERS / lockfile /
   `package.json scripts` changes.
3. Apply to a **clean host worktree** from the base SHA with hooks disabled
   (`-c core.hooksPath=/dev/null -c core.fsmonitor=false`), commit as the factory
   identity with trailers (`Factory-Task`, `Factory-Run`, `Factory-Oracle-Sha`), push via
   the broker (`git.push.branch`, `factory/<taskId>-<slug>` only).
4. Violations ⇒ `patch.rejected` (reason list) and node failure class `policy.denied`
   (**no retry**).

> **B-3 (boundary rule):** the worker never executes host `git` inside any directory a
> container could write. This is why the patch is extracted and applied to a clean host
> worktree rather than committed inside the container.

---

### T-2.13 · Verification runtime · W4 · L · R3

**Open ONLY:** blueprint `14` §2 + §6, pack `02` §4.14.

**Build** `packages/verify`: a fresh T2, base + patch + the oracle overlay, the ordered
gates, the `GateReport`, authorship flags, the gate-weakening detector, and scan wrappers.

**The verification runtime runs in a fresh T2 container — never the worker's.** It mounts
the base + the patch + an overlay of the oracle files from the store, then runs the gates
in order:

**static/type/lint → existing tests → the acceptance oracle → the security scan
(dependency audit + secret scan; more per repo) → the gate-weakening detector.**

Produce `GateReport{checks[], authorship flags, tier, reportSha256, headSha}`.

**Authorship flags (I-10):** tests added by the worker are `untrusted`; they run for
information and **never** satisfy a criterion.

**The gate-weakening detector** (blueprint `14` §6.3) classifies as `gate-weakening`:
touches to CI/test/lint/type configs, coverage thresholds, deleted tests, added skip
markers (`.skip`, `xit`, `xdescribe`, `@pytest.mark.skip`, `t.Skip`), and added
suppression comments above a threshold. `gate-weakening` ⇒ tier ≥ R3, flagged to the
reviewer; in Workflow D-2 ⇒ **automatic rejection** (A4.4).

---

### T-2.14 · Reviewer stage and panel · W5 · M · R2

**Open ONLY:** blueprint `08` §2 roles 6–8, blueprint `14` §2, pack `02` §4.15.

**Build:** a spec-conformance reviewer, a quality reviewer, a security reviewer
(completion stages, **no implementer transcript**), a pure `PanelAggregator` (unanimity
for ready; one blocker ⇒ one rework; security ≥ high ⇒ R3), and independence enforcement.

**Independence (A1.8):** the reviewer's run and context differ from the worker's, and the
model differs when preferred. The panel aggregator is **pure and has no confidence
field** — a numeric confidence field must not exist in any output schema.

---

### T-2.15 · PR creation, summary and check runs · W5 · M · R2

**Open ONLY:** blueprint `12` §3, pack `04` §2.3.

**Build:** a PR body **generated only from artefacts** — spec, the criteria→checks table,
gate results, tier + rationale, cost, run links, and an untrusted-content notice — plus
`change.opened`, the `factory/merge-gate` check lifecycle, and the issue status comment.

**No raw untrusted text in the body.** Links instead (AT-2).

---

### T-2.16 · Blast radius, criticality map, review queue · W5 · M · R3

**Open ONLY:** blueprint `13` §5, pack `02` §4.15, pack `01` §6 ADR-0022.

**Build** `packages/review`: the scorer, the map loader, and the queue projection with
`rationale[]`.

**The scorer is deterministic.** Dimensions and weights:

| Dimension (weight) | 0 | 1 | 2 |
|---|---|---|---|
| reach (High) | ≤1 module | 2–3 modules or a public-interface path | >3 modules / multi-service config |
| reversibility (High) | git revert restores behaviour | coordinated rollback (flags, locks, config) | data/state mutated irreversibly |
| data (High) | none | uses persisted-data paths | schema/migration/PII/retention/crypto code |
| security boundary (High) | none | validation/serialisation/sensitive logging | authn/authz/credentials/trust boundary/exposure |
| blast of error (High) | touched paths R0–R1 | touched paths R2 | touched paths R3–R4 |
| novelty (Medium, 0–1) | ≥5 prior accepted changes of the class, 0 escapes | fewer (**default 1 until history exists**) | — |
| change size (Low, 0–1) | ≤150 lines and ≤8 files | larger | — |

**Score → tier:** `0–1 R0 · 2–3 R1 · 4–6 R2 · 7–8 R3 · 9+ R4`.
**`tier = max(score tier, the criticality-map floor of any touched path)`.** A new
dependency adds +1 to security boundary; `gate-weakening` forces ≥ R3; the tier can be
**raised only by a human** and lowered only by a reviewed policy change.
**R4 ⇒ agents may not change it** (the patch is rejected at extraction).

**The review queue** is ordered by tier desc then age; each item stores `rationale[]`
explaining its position (A2.8).

---

### T-2.17 · Merge gate (L2) and protect-repo · W5 · L · R3

**Open ONLY:** blueprint `14` §6, blueprint ADR-0003, ADR-0016, pack `04` §2.4–2.5.

**Build** `packages/merge` (evaluate / publish, SHA-bound reset, human-merge
observation, the violation path), `factory repo protect` + verify, and the autonomy guard
on `APPROVED→MERGING`.

**`ready =`** the oracle passed for the head SHA **∧** the required gates for the tier
passed **∧** the panel has no blockers **∧** the approval is valid for the head SHA
**∧** autonomy permits (L2: human merge). Publish **check run `factory/merge-gate`** on
the head SHA (success/failure + summary). The ruleset requires it, plus CODEOWNERS review
plus the repo's own CI.

**New commits on the PR branch ⇒ the check resets (SHA-bound) ⇒ the approval is void ⇒
the task returns to `VERIFYING`.**

On `pull_request.closed(merged=true)`: verify `sender ∈ approvers` and that the merged
head SHA equals the approved SHA ⇒ record `change.merged` (authority = that human) ⇒
drive `APPROVED → MERGING → MERGED`. **A merge that bypassed the gate ⇒
`change.merged` with `authority.violation=true` + a `policy.escalated` alert.**

**The factory never merges, force-pushes, or touches protected branches.**

**`factory repo protect`** uses an owner admin token from the env `GITHUB_ADMIN_TOKEN`
(never stored, never read by the worker) to create the ruleset, and then **verifies the
effective rules back through the API and fails loudly on any difference**. The ruleset
pins `factory/merge-gate` to the App via `integration_id`, and has **no bypass actors**
— including the App and the owner.

---

### T-2.18 · Knowledge capture and docs check · W5 · S · R2

**Open ONLY:** blueprint `10` §9, pack `02` §4.20.

**Build:** the `record` stage, `knowledge_records` + a full-text search endpoint (Postgres
FTS — keyword, **not** vector), and the docs check for `public-interface` criteria.

---

### T-2.19 · Workflow B definition and Phase-1 exit · W5 · M · R2

**Open ONLY:** blueprint `12` §3, blueprint `16` Phase 1.

**Build:** `definition/workflows/B.issue-to-pr.yaml`, the roles, the grants, the
environments, the routing; an end-to-end run on the sandbox repo (FakeProvider **plus one
real-provider run**); the A1 suite; the G2 evidence; and **schedule the first real issue**.

---

## STAGE 2 — Review

Standard reviewer pass. T-2.09 and T-2.10 are **R4**. T-2.17 is **R3** and is where the
owner confirms the ruleset on the real target repo.

---

## GATE ROWS — G2, Phase-1 exit

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G2-01 | **A1.1** an issue becomes a reviewed PR with a passing, independently-authored oracle | `pnpm test:e2e -t "A1.1"` + the run id of a real one | agent |
| CL-G2-02 🔒 | **A1.2** the oracle is authored before the implementation runs (provenance check; `implementationRunId == null`) | `… -t "A1.2"` | agent |
| CL-G2-03 | **A1.3** every acceptance criterion has ≥1 oracle check | `… -t "A1.3"` | agent |
| CL-G2-04 | **A1.4** context within budget on every run; no silent truncation | `… -t "A1.4"` | agent |
| CL-G2-05 | **A1.5** a dependent stage gets the upstream artefact and nothing else | `… -t "A1.5"` | agent |
| CL-G2-06 🔒 | **A1.6** agent-authored tests are flagged untrusted and never alone satisfy a criterion | `… -t "A1.6"` | agent |
| CL-G2-07 🔒 | **A1.7** the merge-gate stays red when the oracle fails even if the whole suite passes | `… -t "A1.7"` | agent |
| CL-G2-08 | **A1.8** reviewer identity (run, context, model if preferred) differs from the implementer's | `… -t "A1.8"` | agent |
| CL-G2-09 | **A1.9** budget exhaustion ⇒ labelled `incomplete` with partial artefacts preserved | `… -t "A1.9"` | agent |
| CL-G2-10 | **A1.10** context resolution reproducible (golden file) | `… -t "A1.10"` | agent |
| CL-G2-13 🔒 | Ruleset applied and verified on the target repo: no bypass actors (App excluded); `factory/merge-gate` pinned to the App; CODEOWNERS present | `factory repo protect <o/r> --verify` exit 0 | owner |
| CL-G2-14 🔒 | INV-4, INV-6, INV-10, INV-11 pass (plus the G1 set) | `pnpm test:invariants` | agent |
| CL-G2-15 | The first **real** issue taken through B; a complete run artefact; the owner merge recorded as `change.merged` with the human's authority | task id + `factory audit explain <taskId>` | owner |
| CL-G2-16 | Harness CLI version pinned; the golden-stream contract test green | `pnpm test -t "harness-contract"` | agent |
| CL-G2-17 | Gateway-counted usage reconciles with provider-reported usage within tolerance on ≥5 runs | reconciliation report | agent |
| CL-G2-18 🔒 | No provider key or GitHub token in any T2 container environment | `pnpm test -t "env-scan"`; a `docker inspect` sample | agent |
| CL-G2-19 | The plan-approval screen shows raw untrusted blocks, flagged | e2e UI test | agent |

### Rows whose machinery is built here but which close in checklist 08

Measurement and calibration are built in checklist 08 (T-4.01, T-4.02, T-4.03). The
*machinery* this phase produces — the metrics pipeline, the calibration corpus, the
oracle-provenance accounting — is what those rows verify.

| Row (closed later) | Statement | Closed in |
|---|---|---|
| CL-G2-11 | **A1.11** baseline and cost-per-accepted-change computed; no delta printed without a baseline | checklist 08 |
| CL-G2-12 | **A1.12** the first calibration corpus has violation **and** conforming samples + a measured detection rate | checklist 08 |
| CL-G2-20 🔒 | **Same-run-authored oracle rate = 0**; oracle coverage rate reported (H-01, H-11) | checklist 08 |

### G3 rows closed by this phase

These three rows are **G3** rows, but the machinery they verify is built here — the
scorer, the approval service and the review queue (T-2.12, T-2.13, T-2.16). They are
*confirmed* at the PRR in checklist 13.

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G3-06 🔒 | **A2.7** a change that disables a required check is classified ≥R3 and needs security-scope approval | `… -t "A2.7"` | agent |
| CL-G3-07 | **A2.8** the review queue order is explained by the recorded score for every item | `… -t "A2.8"` | agent |
| CL-G3-08 🔒 | **A2.9** an approval for a modified artefact is void; **A2.10** an expired approval cannot authorise | `… -t "A2.(9\|10)"` | agent |
| CL-G3-09 🔒 | **A3.1** a T2 task cannot reach a host path outside its checkout; no docker socket | `… -t "A3.1"` | agent |
| CL-G3-10 🔒 | **A3.2 (T2 form)** a T2 task cannot reach the network beyond its allow-list; private/metadata ranges denied; no route if the proxy is down | `… -t "A3.2"` | agent |

---

## EXIT CRITERIA — before checklist 06

- [ ] A1.1–A1.10 green. A real issue became a reviewed PR with an independent oracle.
- [ ] The merge gate is red when the oracle fails, even if the whole suite passes (A1.7).
- [ ] A new push to the PR branch voids the approval (SHA-bound).
- [ ] The factory has **no** merge capability — the registry does not contain it (INV-7).
- [ ] The ruleset is applied and verified on the target repo, with no bypass actors.
- [ ] No provider key or GitHub token in any T2 container environment (`env-scan`).
- [ ] The reviewer never saw the implementer's transcript (A1.8, context scan).
- [ ] No numeric confidence field exists in any output schema.
- [ ] `factory repo protect <o/r> --verify` exits 0.
- [ ] The first real issue is scheduled (this starts the soak — see checklist 12).

---

## TRAPS

1. **Composing the harness's patch inside the container** and pushing from there. It
   breaks B-3 and re-opens the git-hook attack (AT-6/AT-7). Extract the patch as bytes;
   apply it on the host to a clean worktree with hooks disabled.
2. **Mounting the holdout oracle files into the worker container.** The holdout exists so
   the agent cannot read the checks it must satisfy. Mounting it in the worker env
   destroys the entire value of a holdout.
3. **Putting the provider key in the T2 environment** so the harness can call the
   provider directly. The harness talks to the **gateway passthrough** with a **task
   gateway token**. The real key stays in the edge container.
4. **Letting the panel aggregate a confidence score.** "One reviewer was 0.9 confident"
   is not a decision. The panel is a deterministic aggregator over verdicts.
5. **Letting the reviewer read the implementer's transcript.** Independence (A1.8) is
   what makes the review a second opinion rather than an echo.
6. **Making the merge gate green when the gates are green but the approval is stale.**
   The gate has four independent conjuncts: oracle ∧ tier gates ∧ no blockers ∧ valid
   approval. Any one missing ⇒ red.
7. **Granting the App or the owner a bypass actor in the ruleset.** "Bypass actors: []"
   is the whole point. A bypass actor is a permanent hole in I-4.
8. **Allowing the merge gate to be re-run against a stale SHA.** It is SHA-bound by
   design. A re-run against an old report is a forged green.
9. **Skipping the real-provider run in T-2.19.** "FakeProvider works, so production works"
   is precisely the assumption the golden-stream contract test and S-4/S-5 exist to
   challenge.
