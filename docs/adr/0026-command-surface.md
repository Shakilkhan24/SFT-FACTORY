# ADR-0026 — The command surface names tasks, not tools

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owners:** the factory owner (solo, per pack `01` §7 D6)
- **Evidence class:** [E2] cross-source synthesis of the pack's decision register and the
  blueprint's corresponding architecture decision; [E3] engineering judgement where the
  corpus is silent
- **Supersedes:** none

---

## Context

The pack's checklists and tickets are meant to survive a change of stack. If a ticket says
`pnpm test:acceptance -t "A0.1"`, then re-targeting the factory from TypeScript to Python means
rewriting every ticket — and rewriting tickets is exactly the kind of mass edit that introduces
silent drift between the checklist and the work.

The fix is to separate the *name* of the thing from the *tool* that runs it.

## Decision

The command surface names **tasks**, not tools.

- In the TypeScript profile, a task is a `pnpm` script.
- In another profile, it is that profile's tool — and the language-neutral task runner (`just`) is the
  recommended surface.
- The **task names never change**; only the implementation behind them does.
- The **test-id selector** differs per stack, and is specified in `A1` §3:

| Stack | Selector |
|---|---|
| TypeScript / Vitest | `-t "A0.1"` |
| Python / pytest | `-k "A0_1"` |
| Go | `-run 'A0_1'` |
| .NET / xUnit | `--filter "FullyQualifiedName~A0_1"` |
| Java / JUnit 5 | `--tests '*A0_1*'` |
| Rust | `cargo test A0_1` |

The identifier rule underneath it: **the roadmap id appears verbatim in the display name and in
identifier-safe form in the function name** (`A0.1` → `A0_1`).

### Scope limits

This ADR does not decide the internal build tooling of the `justfile`, nor the task runner's own
configuration format beyond the task names. It does not decide how a task is implemented in a profile
— only that the name is stable.

## Consequences

**Positive**
- Re-targeting the stack is a change to the `justfile` and the scripts, not to the checklists or the tickets. The pack's checklists stay readable across a stack change, which is the entire point.
- The identifier rule makes a test selectable by its requirement id in every stack, so an oracle row in a checklist maps to exactly one test in every profile.
- A task name is a stable contract that tooling (the CI workflow, the mutation runner, the coverage gate) can reference without knowing the stack.

**Negative**
- One indirection layer: a task name means nothing until the reader knows which profile is active, so every command has to be read together with the profile.
- The `justfile` and the `package.json` scripts can drift, and nothing mechanically checks that every `just` recipe has a matching script.
- The identifier rule is a convention, so a test named outside it simply cannot be selected by requirement id.

**Neutral**
- The task surface in this repo is the `justfile`; the TypeScript profile's implementation is the `pnpm` scripts in `package.json`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Name the tools directly (`pnpm test:acceptance`) | This is the obvious choice for a TypeScript-only project and it is what makes the checklists unreadable in another profile. |
| A generic wrapper script per task with its own syntax | Reinvents the task runner and adds a thing to maintain. |
| Document the stack differences in prose | Prose drifts. A `justfile` is executable and therefore checkable. |

## Validation

- The `justfile` exists and every canonical task in the pack resolves through it; the checklist text refers only to task names.
- If a stack change ever requires editing the checklist text to remain correct, the abstraction has leaked and this ADR is revisited.

## References

- Pack: `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` §6 (decision register row ADR-0026)
- Related: ADR-0013 (stack), ADR-0027 (adapters)
