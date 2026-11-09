# ADR-0013 — Build the factory on the TypeScript profile

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The factory touches four surfaces at once — an access-point API, a worker, a CLI and a dashboard —
and it must be reviewed line by line by one person. The pack's decision register names a **reference
profile** rather than a fixed language, because "the language you review fastest" is a fact about the
owner, not about the project. Until the owner answers D2, the reference profile is the only thing that
lets the checklist paths be written down at all.

The corpus is explicit that the choice is a *profile*: Python (FastAPI/Pydantic) is equally valid and
only the paths in the tickets change. What does **not** change is the contract source of truth, the
dependency rules, the task surface, or any of the security properties.

## Decision

The factory uses the **TypeScript profile** (strict) on the current Node LTS, with pnpm workspaces.

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

This ADR **confirms** the pack's ADR-0013: the pack already names the TypeScript reference profile and
the owner has not selected an alternative. The record exists so a later reader can see the choice was
made rather than inherited.

### Scope limits

This ADR does not settle the D2 alternative (the Python profile) — that path exists and is documented in
`A1` §5, and re-targeting it changes only paths and task names, not contracts or security properties.
It does not settle the version pins of individual dependencies; those are locked by the lockfile and
changed through ordinary dependency review.

## Consequences

**Positive**
- One language across API, worker, CLI and UI reduces the review surface for a solo owner, and gives strong runtime and static typing for a contract-heavy codebase.
- Vitest with fast-check covers example-based and property-based testing in one runner, which matters because the invariant suite depends on property tests.
- `execa` with argv arrays makes the 'never shell strings' rule (AGENTS.md §4) mechanically checkable rather than a code-review habit.

**Negative**
- The dashboard and the worker share a type system, so a contract change breaks the UI at compile time. That is a cost paid on every contract edit, and it is the price of the single-language choice.
- Zod is a runtime dependency in the trust-critical path: a schema is executable code, and a bug in a schema is a bug in the policy that decides whether a change is allowed.
- Node is a high-churn runtime. 'Current Node LTS' means the pin moves over time, and each move is a chance for a behavioural difference in the event loop or the stream handling the factory depends on.

**Neutral**
- The task surface is language-neutral (`just` recipes over canonical task names), so the choice is recorded once and the checklists carry no stack-specific syntax.
- The dependency rules (pack `02` §3) are enforced by dependency-cruiser, which understands the TypeScript project references used here.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Python with FastAPI and Pydantic | Equally valid, and the better choice if the target repos are Python-centric and the owner reviews Python faster. Not rejected on merit — deferred until D2 is answered; the re-targeting procedure in `A1` §5 exists precisely for this. |
| Go or Rust for the control plane | A stronger type system at the cost of a second language for the dashboard, and a much slower review-and-iterate loop for a solo owner inside an 8-week plan. |
| A mixed polyglot repository | Would multiply the review surface exactly where the plan has the least slack. |

## Validation

- `docs/stack-profile.md` exists and names this profile; `pnpm run ci` runs green on the scaffold.
- If the owner answers D2 with Python, this ADR is superseded and `A1` §5 is executed — the paths change, the contracts and the security properties do not.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0013)
- Related: ADR-0026 (command surface), ADR-0014 (definition location)
