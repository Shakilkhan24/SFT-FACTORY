# Stack profile — the ACTIVE profile for this factory

**Profile:** TypeScript (strict) · **Status:** Active · **Recorded:** 2026-11-09
**Amends:** ADR-0013 (see `docs/adr/0013-stack.md`) · **Set by:** T-0.01, owner decision D2

> This file is the profile `AGENTS.md` §4 refers to ("Follow the language conventions of the ACTIVE
> STACK PROFILE"). It is a **definition**, and changing it is an owner decision, not a refactor.

## Why this profile

The pack names a *reference profile* rather than a fixed language, because "the language you review
fastest" is a fact about the owner rather than about the project (`A1` §4). The owner has not selected
an alternative, so the reference profile stands: **TypeScript**.

Only the *paths* change under a different profile. The contracts, the dependency rules, the task
names, the security properties and the invariants do not. If the owner later answers D2 with Python,
`A1` §5 gives the re-targeting procedure and ADR-0013 is superseded — not silently edited.

## The profile

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript (strict) on Node LTS, `NodeNext` module resolution |
| Package manager / layout | pnpm workspaces, one package per bounded concern, per pack `02` §3 |
| Test runner | Vitest, with fast-check for property tests |
| Contract source of truth | **Zod** schemas, exported to JSON Schema |
| Migrations | SQL-first, applied by a migration runner; Kysely for typed queries |
| HTTP | Fastify with a Zod type provider; OpenAPI generated from the schemas |
| Dashboard | React + Vite |
| CLIs | `execa` (argv arrays only — never shell strings) |
| Observability | pino + prom-client |

## Conventions every profile must honour

These are stack-independent and are enforced by `pnpm lint:deps` and the CI gate:

- **Strict static typing.** No untyped data across a boundary: parse into a validated type and reject
  unknown fields.
- **No `any`-style escape hatches** and no non-null shortcuts in non-test code.
- **Exhaustive matching** on closed sets, with a `never` check.
- **Expected failures return `Result<T,E>`**; exceptions are for programmer errors. Every error maps to
  a `FailureClass`.
- **Time via an injected `Clock`**; ids via `core`; money as integer micro-USD; hashes over canonical
  JSON only.
- **Processes: argv arrays only**, never shell strings.
- **No ad-hoc printing** — the profile's structured logger, with redaction.
- **Anything that can be specified exactly is code, not a model call.**

In this profile specifically: `strict` `tsc`, `unknown` + Zod instead of `any`, no non-null `!` outside
tests, and an exhaustive `switch` with a `never` check.

## The task surface

The task names are canonical and stack-neutral (`ADR-0026`). The `justfile` is the surface; the
`pnpm` scripts are the TypeScript profile's implementation of it.

```
just ci                       # lint + typecheck + deps + unit + acceptance + invariants + redteam
just test-acceptance "A0.1"   # select one acceptance/oracle test by id
just test-invariants "INV-4"
just test-redteam "AT-7"
```

The **test-id selector** differs per stack and is specified in `A1` §3. The identifier rule
underneath it: the roadmap id appears **verbatim in the display name** and in **identifier-safe form in
the function name** (`A0.1` → `A0_1`).

## Owner decisions D1–D10 (T-0.01)

Defaults from pack `01` §7 apply until the owner overrides them. **D1 has no default** — it is the
target repo, and it is the decision that must be answered.

| # | Decision | Value in force | Status |
|---|---|---|---|
| **D1** | Target repo for the first slice | **unanswered** — the fallback `factory-sandbox` applies if this is still open at W4 | 🔴 owner |
| **D2** | Stack | **TypeScript** (this profile) | ✅ decided — ADR-0013 |
| **D3** | Hosting | One Linux VM (rootless Docker, ≥4 vCPU/8 GB) + managed Postgres 16 w/ PITR + S3-compatible bucket | ✅ default |
| **D4** | Provider accounts + cap | Anthropic primary; caps **$5/task, $50/day/workflow**, owner-set monthly cap | ✅ default — **owner must set the monthly cap** |
| **D5** | Second provider | OpenAI-compatible endpoint; FakeProvider only if none — **gap recorded** | 🟡 default — **owner must confirm** |
| **D6** | Approvers | the owner's GitHub login only | ✅ default |
| **D7** | Notification channel | none (dashboard only) | ✅ default |
| **D8** | Secrets mechanism | sops + age file on the host | ✅ default — **owner must create the key** |
| **D9** | Network exposure | private dashboard (VPN/tunnel); public `/webhooks/github` only | ✅ default |
| **D10** | Daily review time | 2–3 h | ✅ default — **owner must confirm** |

**Still requiring the owner** (they cannot be defaulted by an agent): D1, D4's monthly cap, D5, D8's
key, D10. These are recorded here so the gap is visible rather than assumed closed.

## GitHub App configuration (T-0.01 step 3, ADR-0018)

**Repository permissions** `[VERIFY names in the App settings UI]`:

| Permission | Level | Note |
|---|---|---|
| Contents | RW | pushes to the task branch only |
| Pull requests | RW | creates and updates PRs |
| Issues | RW | intake and triage |
| Checks | RW | publishes `factory/merge-gate` |
| Commit statuses | RW | optional |
| Actions | R | reads CI results |
| Dependabot alerts | R | optional |
| Metadata | R | mandatory |

**Deliberately NOT granted:** Administration, **Workflows**, Secrets, Environments, Members.
Without Workflows, GitHub rejects pushes that touch `.github/workflows/**` — a free second layer
behind the path-deny.

**Webhook events:** `issues`, `pull_request`, `pull_request_review`, `workflow_run`, `check_run`,
`push`, `installation`, `installation_repositories`.
**Not subscribed:** `issue_comment`, `pull_request_review_comment` — there is no chat-with-agent
channel, so comments carry no instructions (ADR-0002).

**Install on:** only the repos listed in `definition/repos/*.yaml`. Events from any other repo are
ignored and logged.

> 🔒 **CL-G0-02** — this is an owner action. The App settings export must be attached as evidence.
> The agent cannot create the App, and has not attempted to.

## Related

- `docs/adr/0013-stack.md` — the ADR this profile implements
- `docs/adr/0026-command-surface.md` — why the tasks are named, not the tools
- `AGENTS.md` — the contract every agent signs
- `justfile` — the task surface
