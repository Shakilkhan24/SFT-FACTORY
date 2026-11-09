# 04 — Integrations and API Catalog

> **Audience:** implementing agents. Every external system the factory touches, every API it calls, every API it exposes, every credential it needs.
> Markers: `[BP]` blueprint · `[PACK]` pack decision · `[VERIFY]` an external fact (endpoint, header, field, flag) that **must be re-checked against current official docs before coding against it** — do this inside the matching spike (`05_…` §1) and record the confirmed value in `docs/spikes/<id>.md`.

---

## 1. Integration inventory

| ID | System | Direction | Used for | Transport / auth | Capabilities (§5) | Ticket | If it fails |
|---|---|---|---|---|---|---|---|
| INT-01 | **GitHub App** (REST + webhooks + git over HTTPS) | both | intake, branches, PRs, checks, CI read | App JWT → per-task **installation tokens**; webhook HMAC | `github.*`, `git.push.branch` | T-1.09, T-2.04, T-2.15 | intake pauses; writes retried with idempotency keys |
| INT-02 | GitHub OAuth | in | owner login to dashboard/CLI | OAuth code flow, owner allow-list | — (AP auth) | T-1.14 | CLI tokens still work |
| INT-03 | Git CLI (host-side only) | local | snapshots, clean worktrees, patch apply, commit | argv arrays; hooks disabled | `git.*` | T-1.12, T-2.12 | task fails `environment.failure` |
| INT-04 | **Anthropic Messages API** | out | all completion stages; harness (via passthrough) | `x-api-key` held by worker/edge only | `model.complete` | T-1.10 | failover per routing policy |
| INT-05 | Second provider (OpenAI-compatible) | out | failover; I-9 proof | API key (worker only) | `model.complete` | T-1.10 | none (gap recorded) |
| INT-06 | Docker Engine (rootless) via CLI | local | T2 sandboxes, edge containers | `docker` CLI via execa, argv arrays | `shell.sandboxed` | T-2.10 | no fallback to unsandboxed execution |
| INT-07 | PostgreSQL 16+ | local | log, state, queue, projections | role-per-component DSNs | — | T-1.02 | system stops claiming work |
| INT-08 | S3-compatible object store | out | run artefacts, oracles, patches | S3 API, versioned bucket | `artefact.write` | T-1.11 | spool locally, then fail stage |
| INT-09 | **Claude Code CLI** (inside T2) | local | the `harness` executor | env + flags `[VERIFY]` | (harness-internal) | T-2.11 | adapter-level retry; other adapter swappable |
| INT-10 | Notification webhook(s) | out | "needs you" pings | HMAC-signed JSON POST | `notify.send` | T-3.05 | dashboard still shows everything |
| INT-11 | OSV / GitHub advisories | out | D-1 candidate + advisory data | via control-plane fetch service | `net.fetch`, `github.advisories.read` | T-3.01, T-5.02 | D-1 skips advisory enrichment |
| INT-12 | Package registries (npm/PyPI/…) | out | install inside T2 | via egress proxy allow-list only | — | T-2.10 | install fails closed |
| INT-13 | MCP servers | both | transport-only adapter; fixture in v1 | official MCP client `[VERIFY]` | `mcp.*` (fixture) | T-1.08 | capability marked degraded |
| INT-14 | Secret store | local | sops+age file or cloud manager | read at process start | — | T-1.09 | process refuses to start |
| INT-15 | Metrics/logs | out | Prometheus scrape, pino JSON logs | `/metrics` (private), stdout | — | T-6.03 | alerts degrade |

**Deferred (with trigger, see `01_…` §3):** Linear/Jira issue adapters · Slack-interactive approvals · Sentry/PostHog signals (Workflow E) · cloud deploy APIs (Workflow A/E) · T3 sandbox provider · replay/eval tooling · external reviewers/marketplaces. Adapter families, alternatives and swap costs: `A1` §7; deploy / IaC / observability adapters: `A2` §3–4.

---

## 2. GitHub (INT-01) — the central integration

### 2.1 GitHub App configuration
**Repository permissions** `[VERIFY names in the App settings UI]`: Contents **RW** · Pull requests **RW** · Issues **RW** · Checks **RW** · Commit statuses RW (optional) · Actions **R** · Dependabot alerts R (optional, D-1) · Metadata R (mandatory).
**Deliberately NOT granted:** Administration (rulesets are applied by the owner with their own credentials), **Workflows** (without it GitHub rejects pushes that touch `.github/workflows/**` — a free second layer behind the path-deny), Secrets, Environments, Members.
**Webhook events to subscribe:** `issues`, `pull_request`, `pull_request_review`, `workflow_run`, `check_run`, `push`, `installation`, `installation_repositories`. **Not subscribed:** `issue_comment`, `pull_request_review_comment` — there is no chat-with-agent channel, so comments carry no instructions (ADR-0002).
**Install on:** only the repos listed in `definition/repos/*.yaml`; events from any other repo are ignored and logged.

### 2.2 Credential flow (per task)
1. App JWT (RS256, `iss`=App id, `exp` ≤ 10 min) signed with the private key from the secret store.
2. `POST /app/installations/{installation_id}/access_tokens` with body `{"repositories":["<repo-name>"],"permissions":{"contents":"write","pull_requests":"write","checks":"write","issues":"write"}}` — **narrowed to the single task repo and the minimum permissions for the stage** `[VERIFY]`. Token lifetime ≈ 1 h; re-mint for longer tasks.
3. Used only inside broker step 7. `git push` authenticates through `GIT_ASKPASS` reading a one-shot env var (token never in argv, URL, logs, or events); the token string is added to the task redaction set.
4. At terminal state (and by the reaper): `DELETE /installation/token` authenticated with that token `[VERIFY]`; mark lease revoked.
Read-only stages mint `contents:read` only.

### 2.3 REST endpoints used (each reached only through a capability in §5)
| Purpose | Call |
|---|---|
| read issue / comments | `GET /repos/{o}/{r}/issues/{n}`, `GET …/issues/{n}/comments` (paginate) → **untrusted** |
| requester permission | `GET /repos/{o}/{r}/collaborators/{login}/permission` |
| create/update PR | `POST /repos/{o}/{r}/pulls`, `PATCH /repos/{o}/{r}/pulls/{n}`; **before creating, look up an existing PR for the head branch** (idempotency) |
| read PR + files | `GET /repos/{o}/{r}/pulls/{n}`, `…/pulls/{n}/files` |
| comment on issue/PR | `POST /repos/{o}/{r}/issues/{n}/comments` |
| publish gate result | `POST /repos/{o}/{r}/check-runs`, `PATCH …/check-runs/{id}` — name **`factory/merge-gate`**, `head_sha` = PR head |
| read CI | `GET /repos/{o}/{r}/actions/runs?head_sha=…`, `…/actions/runs/{id}/jobs`, `…/actions/runs/{id}/logs` → **untrusted** |
| advisories (D-1) | `GET /repos/{o}/{r}/dependabot/alerts` `[VERIFY perm]` and/or OSV `POST https://api.osv.dev/v1/querybatch` via the fetch service `[VERIFY]` |
| push branch | git smart-HTTP to `refs/heads/factory/<taskId>-<slug>` **only** (ruleset also restricts) |
Rate limits: honour `Retry-After` and `x-ratelimit-*`; secondary-limit backoff; ETag/conditional GETs for polling endpoints.

### 2.4 Repository protection (applied by the OWNER, not the App) — `tools/protect-repo`
`factory repo protect <o/r>` uses an owner admin token from env `GITHUB_ADMIN_TOKEN` (never stored, never read by the worker) to create this ruleset `[VERIFY schema]`:
```json
{ "name": "factory-default-branch", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" }, { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 1, "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true, "require_last_push_approval": true, "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true,
        "required_status_checks": [ { "context": "factory/merge-gate", "integration_id": <APP_ID> }, { "context": "<repo CI check>" } ] } }
  ],
  "bypass_actors": [] }
```
* `integration_id` pins `factory/merge-gate` to **this App**, so nobody else can satisfy it `[VERIFY]`. **No bypass actors** — including the App and the owner.
* Second ruleset for `refs/heads/factory/**`: block deletion by non-owners; allow pushes only by the App.
* `CODEOWNERS` (committed to the target repo by the owner): `/.github/ @owner`, `/.factory/ @owner`, `/tests/acceptance/ @owner`, `**/migrations/ @owner`, `Dockerfile* @owner`.
* `factory repo protect` finishes by **verifying** the effective rules back through the API and failing loudly on any difference (checklist item CL-G2-xx).

### 2.5 Approval ingestion (merge approval) `[PACK]`
* **Dashboard approval** (AP-2) is always valid for every tier.
* **GitHub approving review** by an approver whose `commit_id == headSha` is accepted as a merge approval for tiers **R0–R2** only (GitHub reviews are natively commit-bound). Webhook `pull_request_review.submitted` → `approval.granted{via:'github-review'}` bound to that SHA; `dismissed`/new push voids it.
* **R3 requires the dashboard approval** (security-scope tick + cool-off). The `factory/merge-gate` check stays red until the factory's own approval record is valid, regardless of GitHub review state.

---

## 3. The factory's own HTTP API (access points) — `apps/api`

**Conventions.** Base path `/v1`; JSON; errors are `application/problem+json` (RFC 9457) with extra `code` (`policy_denied | hash_mismatch | expired | not_approver | conflict | kill_switch | validation`) and `requestId`. Auth: browser = GitHub-OAuth session cookie + CSRF token; CLI = bearer token `fac_…` (stored hashed, scoped, expiring, revocable). `Idempotency-Key` required on creating POSTs. Pagination `?cursor=&limit=`. ETag on GET. Every call emits an event with `actor=human:<login>` and `authority.basis='human-access-point'`. **No endpoint accepts free-form instructions for an agent.** `[BP: ADR-0002, 13 §3]`

| AP | Method & path | Body / query → result |
|---|---|---|
| AP-1 | `POST /v1/intents` | `{repo, source:{kind:'github-issue',ref:'o/r#123'}\|{kind:'manual',title,body}, workflow?, budgetUsdMicros?}` → `202 {taskId}` |
| AP-2 | `GET /v1/approvals?status=requested` | queue |
| AP-2 | `GET /v1/approvals/{id}` | artefact view incl. **raw untrusted content blocks** (flagged) + oracle manifest + diff for merge |
| AP-2 | `POST /v1/approvals/{id}/decision` | `{decision:'grant'\|'refuse', comment?, securityScopeAck?, reviewMinutes?}` → `200` / `409 hash_mismatch` / `410 expired` |
| AP-2 | `POST /v1/approvals/{id}/revoke` | `{reason}` |
| AP-3 | `GET /v1/reviews` | risk-ordered queue with `rationale[]` |
| AP-3 | `GET /v1/reviews/{taskId}` | evidence bundle: spec, oracle result, gate report, panel result, blast radius, diff link — **no implementer transcript** unless `?include=transcript` (audited) |
| AP-3 | `POST /v1/reviews/{taskId}/decision` | `{decision:'approve'\|'reject'\|'defer', rationale}` (approve ⇒ merge approval, tier rules apply) |
| AP-4 | `GET /v1/views/overview` | the **one view**: needs-you, in-flight, recent outcomes, health, cost |
| AP-4 | `GET /v1/tasks`, `/v1/tasks/{id}`, `/v1/tasks/{id}/events`, `/v1/tasks/{id}/runs` | filters `state, repo, workflow` |
| AP-4 | `GET /v1/runs/{id}`, `/v1/runs/{id}/artefacts/{name}` | run record; short-lived signed object URL |
| AP-4 | `GET /v1/metrics/summary`, `GET /v1/audit/explain?eventId=…` | metrics subset; audit walk |
| AP-4 | `GET /v1/stream` | **SSE**: `task.updated`, `approval.requested`, `review.queued`, `health.changed`, `cost.updated`, `killswitch.changed`; `id:` = event `seq` for `Last-Event-ID` resume |
| AP-5 | `POST /v1/tasks/{id}/{pause\|resume\|cancel\|escalate\|rerun}` | `{reason}` |
| AP-5 | `POST /v1/factory/kill-switch` | `{engage:boolean, reason}` — engaged ⇒ intake rejected, scheduler claims nothing, harness containers killed, edge denies new model calls |
| AP-5 | `POST /v1/grants/temporary` | `{taskId, capability, scope, ttlSeconds≤3600, reason}` → creates a `temporary-grant` approval |
| AP-5 | `POST /v1/tasks/{id}/defect-flag` | `{note}` — feeds defect-escape proxy |
| AP-6 | `GET /v1/definition/plan?sha=` · `POST /v1/definition/apply` | plan diff · `{sha, approvalId}` (applies **only** a merged SHA) |
| — | `POST /webhooks/github` | GitHub webhooks (§4) — the only public route |
| — | `GET /healthz`, `/readyz`, `/metrics` | liveness; readiness (DB, object store, active definition, kill-switch state, Docker reachable via worker heartbeat); Prometheus (private) |

**Edge services (containers on the sandbox network, not part of `/v1`):**
* `factory-gateway` — `POST /anthropic/v1/messages` (+ token-count endpoint if the harness uses it `[VERIFY]`), header `x-api-key: <task gateway token>`; everything else `404`.
* `factory-egress` — HTTP `CONNECT` proxy on `:3128`, `Proxy-Authorization: Basic base64(taskId:token)`.
Both read token tables with the restricted role `factory_edge` and write usage/denials to **`edge_outbox`**; the worker materialises them into `model_calls` and events (single writer for the log).

---

## 4. Inbound webhook handling (`POST /webhooks/github`)

Pipeline: read **raw body** (limit 5 MB) → verify `X-Hub-Signature-256` HMAC-SHA256 with the webhook secret using constant-time compare → dedupe on `X-GitHub-Delivery` (`webhook_deliveries`) → check repo ∈ definition allow-list → enqueue job → respond `2xx` within the platform timeout. Failures emit `webhook.rejected` (security event). Replay beyond the dedupe window is rejected by delivery id + timestamp sanity.

| GitHub event | Action |
|---|---|
| `issues.labeled` with trigger label | verify sender ∈ allow-list **and** `permission ≥ write`; create intent (AP-1 equivalent, `actor=human:<sender>`); pin issue content by hash at intake |
| `issues.edited` / `issues.opened` | no-op; if a task is active, record `issue edited after intake` (spec stays pinned; re-label to re-intake) |
| `pull_request.synchronize` on `factory/**` | `change.updated`; reset `factory/merge-gate`; void approvals bound to old SHA; if pusher ≠ App → flag |
| `pull_request.closed` (merged) | verify merged head SHA == approved SHA and sender ∈ approvers → `change.merged`; else `change.merged{authority.violation:true}` + `policy.escalated` |
| `pull_request.closed` (not merged) | `REJECTED`/`ABANDONED` per state; cleanup |
| `pull_request_review.submitted/dismissed` | §2.5 approval ingestion / voiding |
| `workflow_run.completed`, `check_run.completed` | feed merge-gate CI status; D-2 trigger on **factory-authored** branches only |
| `push` (default branch) | invalidate snapshot cache; detect `Revert` commits referencing factory changes → defect-escape proxy |
| `installation*` | log; allow-list stays definition-driven |

---

## 5. Initial capability registry (v1) — one `ToolCapability` YAML per row (`03_…` §4.4)

| id | kind | effect | transport | required scope | credential (permissions) | result trust | used by |
|---|---|---|---|---|---|---|---|
| `repo.snapshot.read` | read | E0 | inproc | `repo:read` | — | trusted | assembler, completion stages |
| `repo.search` | read | E0 | inproc | `repo:read` | — | trusted | assembler (deterministic) |
| `git.worktree.create` | compute | E1 | inproc | `git.write.branch` | — | trusted | patch path |
| `git.patch.apply` | mutation | E1 | inproc | `repo:write:path:<glob>` | — | trusted | patch path (path-scope enforced) |
| `git.commit` | mutation | E1 | inproc | `git.write.commit` | — | trusted | patch path |
| `git.push.branch` | mutation | E2 | cli (git) | `git.write.branch` (`refs/heads/factory/*`) | github `contents:write` | trusted | patch path |
| `github.pr.create` / `.update` | mutation | E2 | http | `git.write.pr` | github `pull_requests:write` | trusted | PR stage |
| `github.pr.read` | read | E0 | http | `repo:read` | github `pull_requests:read` | **untrusted** | review, D-2 |
| `github.issue.read` | read | E0 | http | `repo:read` | github `issues:read` | **untrusted** | intake |
| `github.issue.comment` | communicate | E2 | http | `git.write.pr` | github `issues:write` | trusted (own text) | status/escalation notes |
| `github.permission.read` | read | E0 | http | — | github `metadata:read` | trusted | intake auth |
| `github.checks.publish` | mutation | E2 | http | `git.write.pr` | github `checks:write` | trusted | merge gate |
| `github.ci.read` | read | E0 | http | `repo:read` | github `actions:read` | **untrusted** | D-2, merge-gate |
| `github.advisories.read` | read | E0 | http | `net.fetch` | github `dependabot_alerts:read` | **untrusted** | D-1 |
| `net.fetch` | read | E0 | inproc (fetch service) | `net.fetch` + host allow-list | — | **untrusted** | D-1 (OSV, registry metadata) |
| `shell.sandboxed` | compute | E1 | inproc → T2 exec | `shell.sandboxed` | — | trusted (but content-checked) | verify, harness (recorded) |
| `artefact.write` | mutation | E1 | inproc | framework-only | — | trusted | run store |
| `knowledge.write` | mutation | E1 | inproc | framework-only | — | trusted | record stage |
| `notify.send` | communicate | E2 | http | `notify.send` | — | trusted | ops |
| `mcp.fixture.echo` | read | E0 | mcp | test env only | — | untrusted | contract test (FR-62) |
| *(no `prod.*`, `deploy.*`, `git.push.protected`, `git.merge`, `secret.read`, `factory.write` capabilities exist in v1; `INV-7` asserts it)* | | | | | | | |

---

## 6. Model providers and the gateway

* **Anthropic adapter** `[VERIFY all]`: `POST /v1/messages` (streaming and non-streaming), `GET /v1/models`, token counting endpoint; headers `x-api-key`, `anthropic-version` (pin the documented value), optional `anthropic-beta`; prompt caching via `cache_control` on content blocks; forced tool use (`tool_choice`) for structured output; usage fields for input/output/cache read/cache write tokens.
* **Secondary adapter:** OpenAI-compatible `POST /v1/chat/completions` with a forced function call for structured output; `GET /v1/models` `[VERIFY]`.
* **Pricing** lives in `definition/pricing.yaml` (per-model USD per million tokens, per token class) — **never hard-coded**; checked against the provider's published prices at T-1.10 and monthly (reminder in the Friday checklist). Costs are integer micro-USD.
* **Models as examples:** `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` (and the Mythos-tier `claude-fable-5-1`, optional for planner/security review) appear in `routing-policy.yaml` as **configuration values only**, verified by the models-list call at startup. Never reference a model id in code.
* **Reconciliation:** gateway-counted usage vs provider-reported usage on every run; alert on drift > 2 %.

---

## 7. Docker / T2 integration details

* One-time: `docker network create --internal --subnet 172.28.0.0/24 factory-sandbox` and a bridge `factory-core`. **Edge containers** `factory-egress` and `factory-gateway` (same app image, different entrypoints) attach to **both**; T2 containers attach to `factory-sandbox` only. (Works for rootful and rootless Docker; avoids relying on host-gateway reachability.)
* Per task (argv arrays through `execa`, **never a shell string**): create container with `--user 10001:10001 --read-only --tmpfs /tmp:rw,size=1g --cap-drop=ALL --security-opt no-new-privileges --pids-limit <n> --memory <m> --cpus <c> --network factory-sandbox --label factory.task=<id> --label factory.env=<id>`, env `HTTPS_PROXY/HTTP_PROXY=http://<taskId>:<token>@factory-egress:3128`, `NO_PROXY=factory-gateway`, `ANTHROPIC_BASE_URL=http://factory-gateway:<port>/anthropic` (harness only), mounts `-v <workdir>:/work:rw` and `-v <oracleDir>:/oracle:ro`, image `…@sha256:<digest>`, command `sleep infinity`; then `exec` per step; copy out via `docker cp`/bind-mounted output dir; `rm -f` in `finally`.
* **Never** `--privileged`, `--network host`, `-v /var/run/docker.sock`, `--pid host`, device mounts, or writable host paths outside the task workdir. `factory doctor` and test A3.1 verify.
* Image: built from a Dockerfile in the repo, **pinned by digest in the definition**, containing the language toolchain, `git`, `ripgrep`, the harness CLI at a pinned version, and scanners (e.g., `gitleaks`, an audit tool) `[VERIFY availability]`. Rebuild = reviewed definition change (digest bump).

---

## 8. Harness (INT-09) — contract and Spike S-4 checklist

The adapter is the **only** code that knows harness flags. It must:
1. start the pinned CLI **inside** the T2 container non-interactively with a structured streaming output mode;
2. pass: the assembled prompt, a model, a **turn cap**, a **tool allow-list** (shell, edit, read, search — no web, no MCP, no sub-agents), an unattended-safe permission mode, optional settings file denying protected paths;
3. set `ANTHROPIC_BASE_URL` → `factory-gateway`, `ANTHROPIC_API_KEY` → the **task gateway token** (format-compatible with what the CLI accepts), and disable nonessential traffic, telemetry, error reporting and auto-update;
4. translate the stream into `HarnessEvent`s (assistant text, tool use, tool result, usage, final result) and enforce the wall-clock cap with `docker kill`;
5. return `HarnessResult{status, turns, usage, patchRef}`.
**S-4 must confirm and freeze (record in `docs/spikes/S-4.md`):** package/install name and pinned version · exact flags/env for each item above · stream-json event shapes (and whether a verbose flag is required) · how background/small-model calls are configured so the passthrough allow-list covers every model used · whether key format is validated client-side · behaviour when the gateway returns a budget-exhausted error · golden stream fixture for the contract test.

---

## 9. CLI reference — `apps/cli` (binary `factory`)

| Command | Purpose |
|---|---|
| `factory login` / `whoami` | OAuth device flow → stored token |
| `factory intent create --repo o/r (--issue N \| --title … --body …) [--workflow B]` | AP-1 |
| `factory tasks ls\|show <id>\|events <id>\|pause\|resume\|cancel\|escalate\|rerun` | AP-4/5 |
| `factory approvals ls\|show <id>\|grant <id>\|refuse <id>` | AP-2 |
| `factory reviews ls\|show <taskId>\|approve\|reject\|defer` | AP-3 |
| `factory kill-switch on\|off --reason …` | AP-5 |
| `factory definition validate\|plan\|apply --sha …` | AP-6 |
| `factory db migrate\|status\|partitions` | ops |
| `factory projections rebuild [--name …]` | ops (A0.6) |
| `factory audit explain <eventId\|taskId>` | audit tool (A3.12) |
| `factory repo onboard <o/r>` | validate `.factory/repo.yml`, dry-run commands in T2, print gaps |
| `factory repo protect <o/r> [--verify]` | apply + verify ruleset (owner admin token via env); `--verify` only re-reads and diffs the effective rules, exit ≠ 0 on drift |
| `factory baseline run --repo … --since 90d` | pre-factory baseline (T-0.04) |
| `factory calibrate run\|report --verifier … --corpus …` | calibration run / report (T-4.02–4.04) |
| `factory metrics report [--soak]` | baseline · delta · cost · guardrail report (T-4.01); `--soak` summarises the soak window |
| `factory audit chain <taskId>` | verify the event hash chain (T-1.16, T-6.02) |
| `factory inventory` | context inventory-lite report (T-5.04) |
| `factory doctor` | rootless Docker, networks, DB, object store, GitHub App, models list, clock skew, secrets present, **no docker.sock mounted anywhere** |

---

## 10. Configuration and secrets inventory

| Name | Secret? | Holder | Rotation / note |
|---|---|---|---|
| `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_IDS` | no | worker, api | — |
| `GITHUB_APP_PRIVATE_KEY` | **yes** | **worker only** | rotate on suspicion + yearly |
| `GITHUB_WEBHOOK_SECRET` | **yes** | api only | rotate quarterly |
| `GITHUB_OAUTH_CLIENT_ID/SECRET` | secret | api | rotate yearly |
| `GITHUB_ADMIN_TOKEN` | **yes** | **owner's shell only, never on the host** | used for `repo protect`, then discarded |
| `ANTHROPIC_API_KEY`, `SECONDARY_PROVIDER_API_KEY` | **yes** | worker + `factory-gateway` | rotate quarterly / on leak (runbook) |
| `DATABASE_URL_{APP,PROJECTOR,APPLIER,EDGE,READONLY,OWNER}` | **yes** | per component | distinct roles; owner only for migrations |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | secret | worker, api (read-signing) | scoped to the bucket |
| `SESSION_SECRET`, `EDGE_TOKEN_HMAC_KEY` | **yes** | api / worker+edge | rotate on suspicion |
| `NOTIFY_WEBHOOK_URL`, `NOTIFY_HMAC_KEY` | secret | worker | — |
Secrets are loaded once via `SecretStore`, never logged, never stored in DB/events/artefacts, and **never present in any T2 container environment** (checked by the leak scanner and `factory doctor`).

---

## 11. Notifications `[PACK]`
Generic HMAC-signed JSON webhook: `{kind:'needs-you'|'health'|'cost', taskId?, title, link, tier?}` — **ids and links only, never untrusted raw content**. Slack/Telegram/Discord/email bridges are the owner's choice behind that webhook. Decisions are never taken from notification replies (ADR-0024).

## 12. MCP (INT-13) `[BP: 11 §3]`
Transport and discovery only; the **registry is authoritative**. v1 ships the adapter and one fixture server. Contract tests: (a) a registered MCP tool is callable exactly like any other capability (FR-62); (b) a tool advertised by a server but absent from the registry **does not exist** (reconciliation); (c) MCP results are tagged by the capability's declared trust. MCP server entries carry a trust level `internal|external|untrusted` and are definition-controlled.

## 13. API security checklist (apply to every endpoint, tested in T-3.02)
HMAC verification before parsing · constant-time comparisons · request size limits · schema validation (`.strict()`) · authentication on every route except `/webhooks/github` and `/healthz` · CSRF on cookie-authenticated mutations · CORS closed by default · per-token rate limits · idempotency keys · no secrets or untrusted text in logs · problem+json without stack traces · every mutation → event with actor + authority · SSE streams authenticated and authorised per event class.
