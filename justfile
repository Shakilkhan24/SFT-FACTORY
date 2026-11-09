# justfile — the language-neutral task surface (A1 §3, ADR-0026).
#
# The pack's checklists and tickets name TASKS, not `pnpm`:
#
#   pnpm test:acceptance -t "A0.1"   →   just test-acceptance "A0.1"
#
# In the TypeScript profile these are pnpm scripts; in another profile they
# map to that profile's tools. The task NAMES never change — only the
# implementation behind them. That is what keeps the checklist readable when
# the stack changes.
#
# The test-id selector per stack is in A1 §3:
#
#   TypeScript / Vitest  -t "A0.1"
#   Python / pytest      -k "A0_1"
#   Go                   -run 'A0_1'
#   .NET / xUnit         --filter "FullyQualifiedName~A0_1"
#   Java / JUnit 5       --tests '*A0_1*'
#   Rust                 cargo test A0_1

set shell := ["bash", "-uc"]

default:
    @just --list

# --- The canonical tasks -------------------------------------------------

# The full gate: lint, typecheck, dependency rules, unit, acceptance,
# invariants, red team.
ci:
    pnpm run ci

lint:
    pnpm lint

# The dependency rules (pure packages have no I/O).
lint-deps:
    pnpm lint:deps

typecheck:
    pnpm typecheck

# Unit and property tests.
test:
    pnpm test

# Acceptance / oracle tests. Pass an id to select: just test-acceptance "A0.1"
test-acceptance id="":
    pnpm test:acceptance {{ if id != "" { "--testNamePattern=" + id } else { "" } }}

# Invariant tests INV-1…INV-12. Pass an id to select: just test-invariants "INV-4"
test-invariants id="":
    pnpm test:invariants {{ if id != "" { "--testNamePattern=" + id } else { "" } }}

# Red-team tests AT-1…AT-15. Pass an id to select: just test-redteam "AT-7"
test-redteam id="":
    pnpm test:redteam {{ if id != "" { "--testNamePattern=" + id } else { "" } }}

test-fault:
    pnpm test:fault

test-concurrency:
    pnpm test:concurrency

test-e2e:
    pnpm test:e2e

# The mutation runner: apply each entry of tests/invariants/mutations.md in a
# scratch worktree and expect the matching INV test to fail.
mutation:
    pnpm test:mutation

# The requirement-coverage gate: every blueprint requirement is mapped in the
# pack's Part C, and Part C's tally is current.
coverage-check:
    node tools/coverage-check.mjs

# --- The repo's own tooling ---------------------------------------------

# Create a worktree for a ticket: just worktree T-1.02
worktree ticket:
    tools/worktree.sh {{ ticket }}

# Build the agent's context bundle: just context-bundle T-1.02
context-bundle ticket:
    node tools/context-bundle {{ ticket }}

# The two CI guards, runnable locally.
scope-guard:
    node tools/scope-guard.ts

oracle-guard:
    node tools/oracle-guard.ts

# --- The two day-one clocks ---------------------------------------------

# The pre-factory baseline (T-0.04). Measured once; never regenerated.
#   just baseline /path/to/target-repo
baseline repo=".":
    node tools/baseline --repo {{ repo }} --out baselines

# The calibration corpus mining (T-0.06). Git only.
#   just mining /path/to/target-repo
mining repo=".":
    node tools/mining --repo {{ repo }} --out calibration/candidates.jsonl

# --- Local services ------------------------------------------------------

up:
    docker compose -f docker-compose.dev.yml up -d

down:
    docker compose -f docker-compose.dev.yml down
