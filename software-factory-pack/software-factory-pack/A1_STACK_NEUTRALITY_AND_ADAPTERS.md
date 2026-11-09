# A1 — Stack Neutrality: Profiles and Adapters

> **Audience:** the owner (to choose a stack) and implementing agents (to re-target the pack mechanically).
> **Why this file exists:** files 00–08 use TypeScript, `pnpm`, GitHub and Docker as *reference choices*. None of them is required by the blueprint. This file separates what is **fixed** from what is a **profile** or an **adapter**, and shows how to swap each.
> Markers: `[BP]` blueprint · `[PACK]` pack decision · `[VERIFY]` confirm against current official docs before relying on it.

---

## 1. The answer in five lines

1. There are **two different stacks**: the *factory stack* (what the factory itself is written in) and the *target stacks* (what the factory builds). They are independent.
2. **Target stacks are open-ended.** The factory builds anything you can install, build and test from a command line inside a container image you choose (§6).
3. The **factory stack is a profile** (§4). TypeScript is only the *reference rendering*; Python, Go, .NET and Java profiles are provided. Choose by **review speed**, not fashion (§4.3).
4. **Tools are adapters** (§7): GitHub, GitLab, Docker, Kubernetes Jobs, Claude Code, other harnesses, any model provider, any CI, any secret store.
5. What is **not** negotiable is the architecture's guarantees (`01` §2) — and PostgreSQL, because those guarantees (role privileges, append-only enforcement, `SKIP LOCKED` leases) were verified on it (`reference/validate_ddl.sh`).

---

## 2. What is fixed, what is a profile, what is an adapter

| Layer | Status | Where it lives | Notes |
|---|---|---|---|
| Architecture, trust zones, invariants, flows, security model | **Fixed** | `02` §1–2, §4 (rules), §5, §6 | tool-neutral |
| Data model (SQL) and its validation script | **Fixed** (PostgreSQL 16+) | `03` §2, `reference/validate_ddl.sh` | other SQL engines would have to re-prove A0.x and the privilege model |
| Definition kinds (YAML), event vocabulary, state-machine tables | **Fixed** | `03` §4–7 | JSON Schema is the neutral interchange form |
| Interface contracts | **Fixed semantics, parametric notation** | `03` §3 | TypeScript is used as an IDL; render per language (§5) |
| Repo layout, build/test/lint commands, code conventions | **Profile** | `02` §3, `05` T-0.02, `06` verify commands, `07` AGENTS.md §4 | §3–§5 |
| SCM, CI, isolation, harness, model provider, secrets, object store, notifier, identity | **Adapter** | `04`, §7 here | each behind an interface (I-12) |
| Deploy, IaC, observability signals | **Adapter (peak path)** | `A2` | GitOps-first |
| What the factory builds | **Target profile** | `<repo>/.factory/repo.yml` | §6 |

---

## 3. The command surface: task names, not `pnpm`

The pack's checklist and tickets call commands such as `pnpm test:acceptance -t "A0.1"`. Read every `pnpm <task>` as **"the task `<task>` of your stack profile"**.

**Canonical tasks** (colon in the pack ⇄ hyphen in a task runner): `ci`, `lint`, `lint-deps`, `typecheck`, `test`, `test-acceptance`, `test-invariants`, `test-redteam`, `test-fault`, `test-concurrency`, `test-e2e`, `mutation`.
**Recommended runner `[PACK]`:** [`just`](https://github.com/casey/just) (or `make`) — language-neutral, so the checklist never changes when the language does. In the TypeScript profile the tasks are `pnpm` scripts.

**Test-ID rule (all languages):** the roadmap/invariant/attack id appears **verbatim in the test's display name** *and* in an identifier-safe form with dots → underscores in the function/class name (`A0.1` → `A0_1`, `INV-4` → `INV_4`, `AT-7` → `AT_7`).

| Stack | Selector that replaces `-t "A0.1"` |
|---|---|
| TypeScript / Vitest | `-t "A0.1"` |
| Python / pytest | `-k "A0_1"` |
| Go | `-run 'A0_1'` |
| .NET / xUnit | `--filter "FullyQualifiedName~A0_1"` |
| Java / JUnit 5 (Gradle · Maven) | `--tests '*A0_1*'` · `-Dtest='*A0_1*'` `[VERIFY]` |
| Rust | `cargo test A0_1` |

---

## 4. Factory-stack profiles

### 4.1 The variables (a profile fills every row)

| Variable | **TypeScript** (reference) | **Python** | **Go** | **.NET** | **Java/Kotlin** |
|---|---|---|---|---|---|
| Runtime / build | current Node LTS · pnpm workspaces · tsc | CPython 3.12+ · uv workspace | Go modules (one module) | current .NET LTS · solution of class libs | JDK 21 LTS · Gradle multi-project |
| Layout (one unit per `02` §3 package) | `packages/<pkg>` · `apps/<app>` | `src/factory/<pkg>` (namespace pkgs) · `apps/<app>` | `internal/<pkg>` · `cmd/<app>` | `src/Factory.<Pkg>` · `apps/<App>` | Gradle subprojects `:<pkg>` · `:apps:<app>` |
| Contract source of truth | Zod → JSON Schema | Pydantic v2 (`extra="forbid"`) → JSON Schema | structs + JSON-Schema generator; `DisallowUnknownFields` | records + System.Text.Json (disallow unmapped members) + JSON-Schema validator | records + Jackson (fail on unknown) + JSON-Schema validator |
| Errors (`Result`) | tagged union `Result` | exceptions at boundaries + `Result` dataclass in pure code | `(T, error)` with typed errors | `Result<T,E>` / `ErrorOr` | sealed interface / `Either` |
| HTTP / API (OpenAPI-first) | Fastify (+ zod provider) | FastAPI | chi / echo + oapi-codegen | ASP.NET Core Minimal APIs | Spring Boot / Quarkus |
| DB access (SQL-first, **no ORM-driven DDL**) | Kysely + `pg` | psycopg 3 / SQLAlchemy Core | pgx + sqlc | Npgsql + Dapper | JDBI / jOOQ |
| Migration runner (forward-only plain SQL) | dbmate / node-pg-migrate | dbmate | golang-migrate / dbmate | DbUp / dbmate | Flyway |
| Test runner | Vitest | pytest | `go test` | xUnit | JUnit 5 |
| Property tests | fast-check | Hypothesis | rapid / gopter | FsCheck | jqwik |
| Dependency-rule enforcement (`lint-deps`) | dependency-cruiser | import-linter | `depguard` (golangci-lint) / go-arch-lint | NetArchTest / ArchUnitNET | ArchUnit |
| Static analysis (`lint` + `typecheck`) | ESLint + `tsc --strict` | ruff + mypy `--strict` (or pyright strict) | golangci-lint + `go vet` | analyzers + nullable enabled + `dotnet format` | Error Prone + Checkstyle/SpotBugs |
| Process exec (**argv arrays only**) | execa | `subprocess.run([...], shell=False)` | `os/exec` | `ProcessStartInfo.ArgumentList` | `ProcessBuilder(List)` |
| Logging with redaction | pino `redact` | structlog processors | `log/slog` `ReplaceAttr` | Serilog destructuring policy | Logback masking |
| Metrics | prom-client | prometheus_client | client_golang | prometheus-net | Micrometer |
| Worker concurrency | event loop + child processes | asyncio + process pool | goroutines | `Task`/async | virtual threads |
| Container control | `docker` CLI via argv wrapper (**all profiles** — SDKs optional) | same | same | same | same |
| Dashboard | React + Vite, **or** server-rendered | HTMX + Jinja2 | `templ` + HTMX | Razor + HTMX | Thymeleaf + HTMX |
| Packaging (one image per entrypoint: api, worker, egress, gateway, cli) | node slim | uv + slim | static binary, distroless | chiseled / slim | jlink / Jib |

### 4.2 Fit notes (for *this* system: a long-running supervised worker, many HTTP integrations, strict schemas, subprocess/Docker control)

| Stack | Strengths here | Costs here |
|---|---|---|
| **Go** | static single binary per entrypoint (easy for a DevOps operator); excellent process/network/Docker control; cheap concurrency; very readable for review | more verbose for schema/YAML handling and pure "algebraic" code; fewer ready-made schema/property-test tools |
| **Python** | fastest to write and change; richest AI/SDK ecosystem; concise pure functions | needs strict typing discipline (mypy/pyright **strict** + Pydantic `forbid`) to keep the trust-bearing packages trustworthy; concurrency design needs care |
| **TypeScript** | one language across API, worker and UI; strong schema tooling | Node process supervision is fine but not its strength; dependency surface is large |
| **.NET** | excellent typing and tooling; strong fit for enterprise shops | heavier ecosystem fit for container/agent tooling |
| **Java/Kotlin** | mature, robust, strong static analysis | heaviest footprint; slowest iteration for an 8-week build |

### 4.3 How to choose `[PACK]`
1. **The language you can review fastest.** You will read every line of the R4 packages (policy, broker, credentials, event log, isolation, approvals); review speed is the programme's bottleneck (`01` §4).
2. **The language you can operate and deploy most simply** (as a DevOps engineer: a static binary or a small image often wins).
3. **Ecosystem fit** (agent SDKs, schema tooling).
If two tie, prefer the one with a **strict static type system for the pure packages** — that is where independent verification matters most.

---

## 5. Re-targeting the pack to a profile (agent-executable procedure)

Run **inside T-0.02** (the scaffold ticket) *before any other build ticket* — if the chosen profile is not TypeScript, T-0.02 is sized **L** instead of M and includes steps 1–8. Output: `docs/stack-profile.md` (the filled §4.1 column) and an ADR amending ADR-0013.

1. **Fill the profile** — copy the chosen column of §4.1 into `docs/stack-profile.md`; add exact tool versions after a spike (`[VERIFY]`).
2. **Render the notation** of `03` §3 into the language (table below). Keep names, operations, error cases and invariants **identical**; only the syntax changes.
3. **Create the task surface** (§3): one `justfile` (or Makefile) exposing every canonical task; map them to the profile's tools; add the selector mapping.
4. **Re-scaffold** per T-0.02 with the profile's layout, runner, dependency-rule tool and a *negative* test proving a pure package cannot import I/O.
5. **Translate `AGENTS.md` §4** (code conventions) into the language: strict typing, no untyped data across boundaries, no shell strings, exhaustive matching, injected clock/ids.
6. **Do not change:** the SQL in `03` §2 and `reference/validate_ddl.sh`; YAML kinds; event/state tables; oracle *assertions* in tickets; checklist ids and gates; invariants.
7. **Ticket paths:** read `packages/<name>` as the profile's layout entry for that unit; read file extensions accordingly.
8. **Prove equivalence:** the contract tests (L2 in `08` §1) must pass against the real implementation *and* its fake in the new language — that is I-12 doing its job.

**Notation → language rendering**

| `03` §3 notation | Render as |
|---|---|
| `type X = 'a'\|'b'` (string union) | enum / `Literal` / string-typed enum with exhaustive matching |
| branded `UsdMicros` | newtype / wrapper struct (never a bare float) |
| `Result<T,E>` | the profile's idiom (§4.1) — but one consistent choice repo-wide |
| `unknown` + schema validation | untyped payload parsed into a validated DTO at the boundary only |
| `AsyncIterable<T>` | generator / channel / `IAsyncEnumerable<T>` / `Flow` |
| `Promise<T>` | async function / goroutine+channel / `Task<T>` / `CompletableFuture<T>` |
| `.strict()` | forbid-unknown-fields setting of the profile |
| pure package rule (HR-7) | enforced by the dependency-rule tool of the profile |

---

## 6. Target-stack profiles — what the factory builds

### 6.1 The contract (every target repo, any language)
The factory needs exactly three things from a target repo: **(1)** `.factory/repo.yml` declaring *argv-array* commands (`install`, `static`, `typecheck`/build, `test`, `oracle`, `securityScan`) — **`03` §4.9**; **(2)** a **toolchain image** (digest-pinned in the definition) containing the language toolchain, `git`, `ripgrep`, the harness CLI and scanners; **(3)** CODEOWNERS and a criticality map. Commands run **only in T2**; **no real credentials** are ever present (tests use fakes, service containers or emulators).
`{oraclePaths}` expands to the oracle files; stacks that select tests by class or filter provide an optional `.factory/oracle-select` script (runs in T2, prints the selector for the given paths).

### 6.2 Starter `repo.yml` commands by stack (illustrative defaults — `[VERIFY]` tool flags per project/version)

| Stack | install | static | build / typecheck | test | oracle | security scan |
|---|---|---|---|---|---|---|
| Node / TypeScript | `pnpm install --frozen-lockfile` | `pnpm run lint` | `pnpm run typecheck` | `pnpm run test` | `pnpm vitest run {oraclePaths}` | `pnpm audit`, gitleaks |
| Python | `uv sync --frozen` | `ruff check .` | `mypy .` | `pytest -q` | `pytest -q {oraclePaths}` | `pip-audit`, gitleaks, optionally `bandit` |
| Go | `go mod download` | `golangci-lint run` | `go vet ./... && go build ./...` | `go test ./...` | `go test {oraclePaths}` (packages) | `govulncheck ./...`, gitleaks |
| Java (Maven) | `mvn -B -q dependency:resolve` | `mvn -B -q checkstyle:check` | `mvn -B -q -DskipTests package` | `mvn -B test` | `mvn -B test -Dtest=<selector>` | OWASP dependency-check, gitleaks |
| .NET | `dotnet restore --locked-mode` | `dotnet format --verify-no-changes` | `dotnet build -warnaserror` | `dotnet test` | `dotnet test --filter <selector>` | `dotnet list package --vulnerable --include-transitive` |
| Rust | `cargo fetch --locked` | `cargo fmt --check && cargo clippy -- -D warnings` | `cargo build --locked` | `cargo test` | `cargo test <selector>` | `cargo audit` / `cargo deny check` |
| PHP / Laravel | `composer install --no-interaction` | `vendor/bin/phpstan analyse` | — | `vendor/bin/phpunit` | `vendor/bin/phpunit {oraclePaths}` | `composer audit` |
| Ruby / Rails | `bundle install --frozen` | `bundle exec rubocop` | — | `bundle exec rspec` | `bundle exec rspec {oraclePaths}` | `bundle audit`, `brakeman` |
| Terraform / OpenTofu | `terraform init -backend=false` | `terraform fmt -check -recursive && tflint` | `terraform validate` | `terraform test` (if used) | `terraform test` / policy tests | `trivy config .` or `checkov -d .`; **`plan` is a broker capability, not a sandbox command (`A2` §3–4)** |
| Helm / Kubernetes manifests | — | `helm lint` / `kube-linter lint` | `helm template . \| kubeconform -strict` | `conftest test` (policy) | `conftest test {oraclePaths}` | `trivy config .` |
| CI pipeline repos | — | `actionlint` (GitHub Actions) | — | dry-run in a canary repo | — | — |

### 6.3 What does not fit T2 (declare it; the factory then escalates instead of guessing)
iOS/macOS builds (need macOS runners) · Windows-only builds · GPU or hardware-in-the-loop tests · tests that require real cloud accounts · browser E2E without a headless browser in the image. Declare in `repo.yml` `unsupported: [macos, gpu, real-cloud, …]`; criteria depending on them are routed to **R-H** (human-authored oracle, human-run verification) or served by a self-hosted **IsolationProvider** adapter (§7). Mutation operators and the `behavior-table` oracle generator need one small template per language/test framework; all other generators are language-neutral.

---

## 7. Adapter families and swap costs

| Family | Interface (`03` §3) | v1 adapter | Alternatives | What changes when you swap | Tickets touched | Size |
|---|---|---|---|---|---|---|
| **SCM + review** | `ScmAdapter` | GitHub App | GitLab, Bitbucket, Azure DevOps, Gitea/Forgejo | credential minting; webhook verification; PR ⇄ MR objects; required-check/ruleset equivalent (branch protection, approvals, external status checks `[VERIFY per host]`); `repo protect` | T-1.09, T-2.04, T-2.15, T-2.17, `04` §2 | M–L (~5 tickets) |
| **CI visibility/trigger** | `github.ci.read` capability | GitHub Actions | GitLab CI, Jenkins, Buildkite, Tekton, Argo Workflows, CircleCI | read results; D-2 triggers; merge-gate CI status | T-2.17, T-5.03 | S–M |
| **Isolation** | `IsolationProvider` | rootless Docker | Podman rootless · **Kubernetes Pod/Job** (§8) · Firecracker/microVMs · cloud sandboxes · self-hosted runner pools (macOS/Windows/GPU) | provision/exec/copy/destroy + egress plumbing | T-1.12, T-2.10 | M (1 ticket + spike) |
| **Harness** | `HarnessAdapter` | Claude Code CLI | Codex CLI, Cursor agent, OpenCode, Aider, others | flags + stream parser; **must allow a base-URL override** or the gateway passthrough cannot meter it | T-2.11 | S–M |
| **Model provider** | `ProviderAdapter` | Anthropic + OpenAI-compatible | Bedrock, Vertex, Azure OpenAI, local OpenAI-compatible servers | adapter + pricing file | T-1.10 | S |
| **Secrets** | `SecretStore` | sops + age | Vault, cloud secret managers, Kubernetes secrets (+ External Secrets) | store implementation | T-1.09 | S |
| **Object store** | artefact store | S3-compatible | GCS/Azure Blob (SDK or S3 gateway), MinIO, local FS (dev) | adapter | T-1.11 | S |
| **Identity** | AP auth | GitHub OAuth | any OIDC provider (Keycloak, Okta, Entra, Google) | auth module | T-1.14 | S |
| **Notifier** | `notify.send` | signed webhook | Slack, Telegram, Teams, email | adapter | T-3.05 | S |
| **Database** | — | PostgreSQL | **none recommended** | guarantees were proven on Postgres | — | — |
| **Deploy / IaC / signals** | see `A2` | GitOps, Terraform, Prometheus (peak path) | direct apply, Pulumi/OpenTofu/CDK, Datadog/CloudWatch/Sentry | per `A2` | E8–E10 | per tool |

---

## 8. Kubernetes as the isolation provider (for operators who prefer clusters)

Map the Docker flags of `04` §7 to a Pod. Everything else (egress proxy, gateway passthrough, patch extraction, no credentials in the sandbox) stays identical.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: fac-TASKID-N
  namespace: factory-sandbox            # label: pod-security.kubernetes.io/enforce=restricted
  labels: { factory.task: TASKID, factory.env: ENVID }
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  activeDeadlineSeconds: 3000
  # runtimeClassName: gvisor            # optional stronger isolation [VERIFY cluster class name]
  securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001, seccompProfile: { type: RuntimeDefault } }
  containers:
    - name: work
      image: IMAGE@sha256:DIGEST
      command: ["sleep", "infinity"]
      securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } }
      resources: { requests: { cpu: "1", memory: 2Gi }, limits: { cpu: "2", memory: 4Gi, ephemeral-storage: 5Gi } }
      env:
        - { name: HTTPS_PROXY, value: "http://TASKID:TOKEN@factory-egress:3128" }
        - { name: NO_PROXY,    value: "factory-gateway" }
      volumeMounts: [ { name: work, mountPath: /work }, { name: tmp, mountPath: /tmp } ]
  volumes: [ { name: work, emptyDir: { sizeLimit: 5Gi } }, { name: tmp, emptyDir: { sizeLimit: 1Gi } } ]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: sandbox-default-deny, namespace: factory-sandbox }
spec:
  podSelector: { matchLabels: { factory.task: "" } }     # selects task pods (use a common label in practice)
  policyTypes: [Egress]
  egress:
    - to: [ { podSelector: { matchLabels: { app: factory-egress } } }, { podSelector: { matchLabels: { app: factory-gateway } } } ]
    - to: [ { namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } } ]   # DNS only
      ports: [ { protocol: UDP, port: 53 }, { protocol: TCP, port: 53 } ]
```
Requirements: a CNI that **enforces** NetworkPolicy; no `hostPath`, `hostNetwork`, privileged or service-account token in sandbox pods; the per-task proxy token is short-lived (it is visible to anyone who can read the Pod spec, so restrict that RBAC); `emptyDir` for `/work`; copy-out via the API or a sidecar-free `kubectl cp`-equivalent; Pod deleted in `finally`; TTL controller + leak detector as in `04` §7. The conformance test is the **same** A3.1/A3.2 and AT-9/AT-10 suite — a provider that fails them is not a valid `IsolationProvider`.

---

## 9. Decisions this file adds (to `01` §6)

| ADR | Decision |
|---|---|
| **0013 (amended)** | The factory stack is a **profile** (§4). TypeScript is the reference rendering; Python/Go/.NET/Java profiles exist. Choose by review speed (§4.3). |
| **0026** | The command surface is **task names** run by a language-neutral task runner (`just` recommended); test ids follow the §3 naming rule. |
| **0027** | **Adapters over products**: every external system sits behind an interface with a documented swap map (§7); **PostgreSQL is the one fixed infrastructure dependency**. |
