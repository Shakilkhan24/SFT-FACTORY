# 03 — The control plane: definition, broker, credentials, gateway, orchestrator

> **Phase W2 (5 days) · Tickets T-1.06 … T-1.17 · Gate G1 (Phase-0 exit)**
>
> Twelve tickets. This is the longest phase in the plan and the one that most often
> fails on entropy. **Do not run more than three agents at once** (`07` §6), and obey
> the parallelisation map in `05` §9.
>
> At the end of this phase the factory must be able to say: *an unauthorised call is
> denied and logged, and a run produces a complete artefact.* If it cannot say that,
> the phase is not done — no matter how much code exists.

---

## PREREQUISITES

* Checklist 02 complete. `packages/contracts` is stable; the event log, state machines
  and policy engine exist and their property tests are green.
* S-2 done (GitHub App mechanics) — blocks T-1.09. S-3 done (rootless Docker networking)
  — blocks T-2.10, not this phase. S-6 done (structured output portability) — blocks T-1.10.
* **`packages/contracts` is frozen** unless a `contracts` ticket has merged.

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-1.06 | **A0.7**: write via the API role is rejected; an invalid bundle is refused and the prior version stays active; drift is **reported and not auto-corrected**; apply without an approval bound to `bundleSha256` fails; apply of an unmerged SHA fails (SCM fake) | R-G |
| T-1.07 | 1000-iteration race ⇒ no double-claim; an expired lease is re-queued **once**; a duplicate completion is recorded as `node.duplicateExecution` and the first wins; caps are respected; **no auto-fill** of spare capacity | R-G |
| T-1.08 | **A0.1** an outside-grant call ⇒ denied + `tool.denied`; **A0.2** a direct adapter call without the broker fails; step-order spy test; an MCP tool not in the registry **does not exist**; a replayed idempotency key returns the recorded result; E3 without approval ⇒ REQUIRE_APPROVAL; **policy throws ⇒ fail closed** | R-G |
| T-1.09 | a full fake run — a scan of every event, log, artefact and prompt finds **no token** (test name contains `secret-scan`); use-after-revoke fails; secrets absent from logs (redact test); a real-token smoke recorded in S-2 | R-G |
| T-1.10 | **A0.8** cost bounded before start and halts on breach; failover Fake-A→Fake-B on an injected error (`INV-9`); **no failover on budget exhaustion**; invalid structured output twice ⇒ `model.reasoning`; unknown model refused; integer micro-USD golden cost tests | R-G |
| T-1.11 | **A0.3** completeness assertion; seeded secrets redacted in the record **and** in events; object-store outage ⇒ spool then explicit stage failure; the record hash verifies | R-G |
| T-1.12 | **A0.9** reclaimed at every terminal state **including failure**; git invoked with hooks disabled (spy assertion); traversal in a snapshot request rejected | R-G |
| T-1.13 | **A0.5** SIGKILL the worker mid-run ⇒ resumed or explicit ESCALATED/FAILED; an idempotent node handler; cancel reclaims env + credentials; budget exhaustion ⇒ `INCOMPLETE` with partial artefacts labelled; unknown failure ⇒ `workflow.composition` | R-G |
| T-1.14 | every mutating call emits an event with actor + authority; a non-allow-listed login is rejected; a **route-inventory test proves no endpoint accepts free-form agent instructions**; definition write via API rejected; CSRF test | R-G |
| T-1.15 | **A0.6** drop-and-rebuild ⇒ identical rows (hash compare); the projector resumes after a crash without duplicates | R-G |
| T-1.16 | Playwright smoke renders the seeded overview in <2 s; a script proves reaching a review/approval item in **≤2 clicks** (test name contains `NFR-07`); kill-switch round-trip; `factory audit chain` exits 0 on an intact run and ≠0 on a tampered one | R-G |
| T-1.17 | A0.1–A0.10 all green in CI; the owner signs G1 | owner |

---

## STAGE 1 — The work

### T-1.06 · Definition store and applier · W2 · M · R4

**Open ONLY:** blueprint ADR-0001, ADR-0007, blueprint `09` §9, pack `02` §4.1.

**Build** `packages/definition` + `factory definition validate | plan | apply`, plus a
drift job.

* Load `/definition` at a git SHA; validate every document against `contracts`; compute
  `bundleSha256`.
* `plan(sha)` = a structured diff vs the latest applied version.
* `apply(sha)` requires **all three**: the SHA is on the protected default branch with
  required checks green (checked through the SCM adapter); an owner `definition`
  approval bound to `bundleSha256`; and the applier DB role.
* Drift job (nightly): compare the applied bundle to the git SHA it claims; emit
  `definition.driftDetected`; **never auto-correct** (FR-26).
* **Reject control-surface writes:** only role `factory_applier` can insert
  `definition_versions`; the API role cannot (A0.7, AT-6/7).

**Failure:** an invalid bundle ⇒ apply refused, the previous version stays active.

**This ticket is R4.**

---

### T-1.07 · Scheduler and leases · W2 · M · R3

**Open ONLY:** pack `02` §4.8, blueprint ADR-0012.

**Build** `packages/orchestrator/scheduler`: enqueue / claim (`SKIP LOCKED`) / heartbeat /
reap / idempotency, concurrency caps, kill-switch awareness.

* Claim: `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
* Lease `lease_expires_at`; heartbeat every `lease/3`; the reaper re-queues expired
  leases (`node.leased → ready`) and records `node.duplicateExecution` if a stale worker
  later reports — **the first committed result wins**.
* Concurrency caps come from the definition, per workflow and globally.
* **No auto-fill of spare capacity** (I-11).

---

### T-1.08 · Capability registry and ToolBroker · W2 · L · R4

**Open ONLY:** blueprint `11` §2–6, pack `02` §4.5, pack `04` §5.

**Build** `packages/broker`: the registry loader + reconciliation, the **10-step pipeline
in order**, the adapters (`inproc` / `http` / `cli` / `mcp` + a fixture server),
invocation records, idempotency, and the v1 capability YAMLs from `04` §5.

**The registry rule:** a tool the registry does not list **does not exist**, even if an
MCP server advertises it (reconciliation rule, `11` §3.2).

**The 10 steps, exactly, each emitting its event and failing closed:**

1. validate args against `inputSchema`
2. deny-list
3. grant
4. resource-scope
5. `PolicyEngine.evaluate`
6. approval check (if required; bound to `argsSha256` / artefact)
7. **credential acquire + inject** (never into returned data)
8. execute with a timeout through the adapter
9. validate result against `outputSchema`, **tag trust**
10. write the invocation record (`tool_invocations`) including the idempotency key

* Idempotency keys: tool `(taskId, nodeId, attempt, toolId, argsSha256)`; external side
  effects `(…, externalOperation)`. A duplicate key ⇒ return the recorded result.
* Adapters: `in-process`, `http`, `cli` (**argv arrays only, no shell strings**), `mcp`
  (official MCP client; a test fixture server), `library`. Adapter contract:
  `describe / invoke / health / close`. Health ⇒ `healthy | degraded | unavailable |
  unknown`; **the broker and the policy fail closed**, optional adapters degrade.
* Results from `trust: untrusted` capabilities are tagged and can only reach agents
  through the assembler's untrusted envelope.
* **Adapters are constructible only inside the broker module** — enforced by a lint rule
  *and* a runtime guard. This is what makes **A0.2** (a direct adapter call fails) true.

**This ticket is R4.**

---

### T-1.09 · Credential broker and secret store · W2 · M · R4

**Open ONLY:** blueprint `11` §7, pack `04` §2.2 + §10, pack `02` §4.6.

**Build** `packages/credentials`: `SecretStore` (sops/age + env), GitHub
installation-token minting (narrowed), the redaction-set registry, `revokeAll` in
`finally` + an orphan reaper, `credential_leases`, and a `FakeCredentialProvider`.

* `SecretStore` reads control-plane secrets (GitHub App private key, provider keys,
  webhook secret, DB URL) at process start; **never writes them to logs, DB or events**.
* `CredentialBroker.mint(task, scopeSpec)` ⇒ a GitHub installation token narrowed to the
  task's `repositories` and `permissions` (TTL ≤ 1 h; re-mint for long tasks). It records a
  `credential_leases` row (id, task, scope, expiry — **no secret material**) and adds
  the token string to the task's **redaction set** (exact-match scrubbing in artefacts,
  events, logs).
* `revoke(task)` runs in a `finally` at every terminal state, and a reaper handles orphans:
  revoke at the provider where supported, mark the lease revoked.
* Credentials are injected **only inside broker step 7**, into the adapter call — **never**
  into prompts, context, container env, argv or results.

**Acceptance (A3.3, A3.4):** a context scan finds **no** credential in any prompt or
assembled context, and a credential **cannot be used after its task terminates** —
use-after-revoke fails. These close rows **CL-G3-11** and **CL-G3-12**, and they are the
credential half of the injection surface that AT-8 and AT-11 exercise.

**This ticket is R4.**

---

### T-1.10 · Model gateway (complete path) · W2 · L · R3

**Open ONLY:** blueprint `11` §9, pack `02` §4.7, pack `04` §6.

**Build** `packages/gateway`: anthropic, openai-compatible and fake adapters; routing and
budgets (**checked before the call**); the ledger; failover; portable structured output
with Zod revalidation; cache breakpoints; a startup models check; `pricing.yaml`.

**`complete(request)`:** resolve the route from `routing-policy.yaml` (role → model,
fallbacks) → **budget check before the call** (request / task / workflow / day) →
idempotency lookup `(taskId, nodeId, attempt, promptSha256, modelVersion)` → provider call
with a timeout and bounded retry → usage + cost into `model_calls` and the
`model.requested | failed | failedOver` events → return `{content, toolCalls, usage,
model, routingDecision, cached}`.

* **Structured output:** `responseFormat: json-schema` implemented portably (a forced
  single tool call whose input schema is the JSON schema) or with the provider's native
  structured outputs when available `[VERIFY]`; the result is **always** re-validated with
  Zod; one repair attempt counts as a retry.
* **Failover triggers:** provider error, rate-limited, repeated schema failure when a
  stronger route is configured. **Budget exhaustion never fails over** — it halts with
  `budget.exhausted` and outcome `incomplete`.
* **Prompt caching:** cache breakpoints at the end of the stable prefix only (policy,
  role, standards, procedures); the untrusted envelope and the task come after.
  Re-check the semantics (minimum length, TTL) in the provider docs `[VERIFY]`.
* **Startup check:** call the provider's models list and refuse routes naming unknown
  models `[VERIFY]`.

**The passthrough** (for the harness) is the edge container described in checklist 05,
but the **budget logic** lives here now: it refuses with a provider-shaped error when
`spent + pending edge_outbox usage + a conservative estimate for this request` would
exceed the task budget.

---

### T-1.11 · Run-artefact store and redaction · W2 · M · R3

**Open ONLY:** blueprint `15` §2, blueprint ADR-0011, pack `02` §4.11.

**Build** `packages/artefacts`: the 12-element record writer (incremental, atomic with
the outcome), the S3 adapter, a local spool, the redaction pipeline, the completeness
assertion, retention + purge.

**The 12 elements** (blueprint `15` §2.3) — identity/workflow/spec version · context
manifest · model/harness/config versions · every tool call · prompts + generated text ·
verification per layer **with authorship** · artefacts with hashes · outcome + failure
class · approval + authority · token + compute cost · budget consumption · policy decisions.

* Written by the **framework**, never by agents, **incrementally** and atomically with
  the outcome. Objects go to `runs/<runId>/…`; Postgres `runs` indexes sha256 and cost.
* **Redaction at capture:** (1) exact-match scrub of the task's minted secrets,
  (2) pattern scrub (token formats, private keys, JWTs, high-entropy strings near
  `key|token|secret|password`), (3) deny-listed env names. Everything redacted is listed
  in `redaction.applied[]`.
* Retention classes per `15` §2.5; implement `retain_until` and a purge job that
  **never touches `events`**.

> Measurement is a prerequisite, not a deliverable (blueprint `17` §5.5). You cannot
> retrofit instrumentation later, because by then you will not know where the
> information went.

---

### T-1.12 · T1 isolation (snapshot / clean worktree) · W2 · S · R3

**Open ONLY:** blueprint ADR-0006, pack `02` §4.12, pack `01` §6 ADR-0020.

**Build** `packages/isolation/t1`: `git archive` snapshots keyed by base SHA, a clean
worktree creator (**hooks disabled, fsmonitor off**), reclamation + a leak detector.

**Proof:** **A0.9** — reclaimed at every terminal state **including failure**; git is
invoked with hooks disabled (spy assertion); traversal in a snapshot request is rejected.

---

### T-1.13 · Orchestrator · W2 · L · R3

**Open ONLY:** blueprint `09` §8, pack `02` §4.9.

**Build** `packages/orchestrator`: the stage runner, the executor registry, the execution
loop, resume, pause/cancel, budgets, failure classes, escalation.

**Executors** (ADR-0017): `deterministic` (code) · `completion` (gateway call) ·
`harness` (T2 + HarnessAdapter) · `human` (approval wait).

**Stage kinds:** 14 exist in the blueprint; **v1 implements 12** — `specify, plan,
implement, verify, review, aggregate, approve, merge(observe), record, sweep` (D-1), a
stub `evaluate` (calibration) and a minimal `propose` (T-5.05). **`deploy` and
`investigate` are not implemented.**

* Loop per ready node: build the `StageInput` (spec, assembled context, tools/grants,
  budget, isolation, model policy, **upstream artefact only**) → run the stage executor →
  persist the result → apply the resulting state transition(s).
* **Resume:** on start, rebuild in-flight state from the DB; nodes with expired leases
  are re-queued; tasks in `RUNNING` with no live node become `ESCALATED(resume_failed)`.
* **Cancellation / pause:** a cooperative flag checked between steps, and `docker kill`
  for harness nodes; always followed by cleanup.
* **Failure classes (10)** per blueprint `08` §4.3; unknown ⇒ `workflow.composition`.
  Retries per policy (default max 2 for model-reasoning/verification failures, **0** for
  `policy.denied`, 3 with backoff for `tool.unavailable`).
* **Budget exhaustion ⇒ stage outcome `incomplete`** with partial artefacts preserved
  and labelled (FR-32).

---

### T-1.14 · Access-point API and auth · W2 · L · R3

**Open ONLY:** pack `04` §3, blueprint `13` §3, blueprint ADR-0002.

**Build** `apps/api` (Fastify): OAuth session + CSRF, CLI tokens, AP-1…AP-6 per
`04` §3 (stubs for later-ticket behaviours), problem+json, idempotency keys, rate limit, SSE.

**Conventions:** base path `/v1`; JSON; errors are `application/problem+json` (RFC 9457)
with an extra `code` (`policy_denied | hash_mismatch | expired | not_approver | conflict |
kill_switch | validation`) and a `requestId`. Browser auth = GitHub-OAuth session cookie +
CSRF; CLI = bearer token `fac_…` (stored hashed, scoped, expiring, revocable).
`Idempotency-Key` required on creating POSTs. Pagination `?cursor=&limit=`. ETag on GET.

**Every call emits an event** with `actor=human:<login>` and
`authority.basis='human-access-point'`.

**There is no endpoint that accepts free-form instructions for an agent.** The
route-inventory test proves it.

---

### T-1.15 · Projections and rebuild · W2 · M · R2

**Open ONLY:** blueprint `15` §3, pack `02` §4.18.

**Build:** a projector with durable cursors; `task_current`; shells for `approval_queue`
and `cost_attribution`; `factory projections rebuild`; staleness metrics.

**Every projection can be dropped and rebuilt from the log** (A0.6). The rebuild is a CLI
command *and* a test.

---

### T-1.16 · Operational surface v0 and CLI · W2 · M · R1

**Open ONLY:** blueprint `13` §8, blueprint `15` §6.

**Build:** dashboard v0 (Needs you / In flight / Health / Cost, SSE, kill switch, task
timeline) and the CLI skeleton: `login`, `tasks`, `kill-switch`, `projections rebuild`,
and **`audit chain <taskId>`** (which runs `EventLog.verifyChain`).

**The dashboard is one view.** It must answer *"what is the factory doing and what does
it need from me"* in **≤2 clicks** (NFR-07).

---

### T-1.17 · Phase-0 exit · W2 · M · R2

**Open ONLY:** blueprint `16` Phase 0, pack `08` §2.

**Build:** the `H.hello` workflow (FakeProvider → artefact → record) end-to-end; the
red-team subset **AT-4, AT-5, AT-7, AT-8** in `tests/redteam`; the G1 evidence pack.

---

## STAGE 2 — Review

Standard reviewer pass. T-1.06, T-1.08 and T-1.09 are **R4** — every line, and the
owner may mutate the guard to watch a test fail.

---

## GATE ROWS — G1, Phase-0 exit

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
| CL-G1-18 🔒 | The DDL oracle passes on the migrated database: append-only for every role, edge least-privilege, gapless `seq` under concurrency | `bash reference/validate_ddl.sh` exit 0 | agent |

### G3 rows closed by this phase

These two rows are **G3** rows whose machinery is the credential broker built here
(T-1.09). They are *confirmed* at the PRR in checklist 13.

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G3-11 🔒 | **A3.3** credentials are absent from prompts and context (context scan) | `… -t "A3.3"` | agent |
| CL-G3-12 🔒 | **A3.4** a credential cannot be used after its task terminates | `… -t "A3.4"` | agent |

---

## EXIT CRITERIA — before checklist 04

- [ ] All eighteen G1 rows ticked **with evidence**.
- [ ] **A0.1–A0.10 all green in CI.**
- [ ] The `H.hello` workflow runs end to end: FakeProvider → artefact → record.
- [ ] `factory audit chain <taskId>` exits 0 on an intact run and ≠0 on a tampered one.
- [ ] Secret scan of the whole hello-task store = 0 findings.
- [ ] `factory projections rebuild` reproduces identical rows (hash compare).
- [ ] Every R4 PR in this phase has an owner line-by-line review recorded in
      `docs/evidence/G1-16.md`.
- [ ] `docs/build-metrics.csv` has a row per ticket (12 rows added this phase).

---

## TRAPS

1. **Building the broker's adapters before the registry.** The registry is the source of
   truth; an adapter not in the registry does not exist. Registry first.
2. **Putting credentials in the adapter's environment** "for convenience". Credentials
   are injected **only at step 7**, into the call, and never into env, argv, prompts,
   context or results. The `env-scan` test in G2 will catch it, but the secret will
   already have been in a log.
3. **Letting the policy engine "decide to allow" when the bundle is empty.** An empty
   bundle must yield DENY, not ALLOW. Test it.
4. **Auto-filling spare scheduler capacity.** I-11: surplus capacity is allocated by
   policy, not by default. "The queue is empty, why aren't we running three more?"
   — because nothing authorised it.
5. **Making the event log append and the state change separate.** One transaction.
6. **Writing a 12-element artefact record after the run instead of during it.**
   Blueprint `17` §5.5: *"Do not add instrumentation later; you cannot retrofit it."*
7. **Adding a dashboard page per feature.** NFR-07 wants **one** view that answers
   "doing / needs me" in ≤2 clicks. More pages make it worse.
8. **Letting `querySelector`-style convenience creep into the orchestrator.** The
   orchestrator holds state in the DB and the event log, not in process memory.
9. **Running five agents at once.** Three is the limit. Two agents editing the same
   package is a merge conflict and a scope-guard failure, not a speed-up.
