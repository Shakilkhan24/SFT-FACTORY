# 14 — The invariants sweep (PRD-2, the mutation check)

> **Cross-cutting · Closes PRD-2 and CL-G3-27**
>
> **This checklist does not build anything. It proves something.**
>
> Every one of the twelve invariants I-1…I-12 has an automated test. That is not
> sufficient. The test must **fail when its guard is broken**. A test that passes
> whether or not the guard exists is a comment with a green tick next to it.
>
> The proof is mechanical: for each invariant, apply a **mutation** — remove the guard
> — and watch the matching test go red.

---

## PREREQUISITES

* Checklists 01–13 complete (or at least: all twelve invariant tests exist).
* `tests/invariants/mutations.md` exists, with one entry per invariant naming the
  guard to disable.

---

## STAGE 0 — The oracle

| Item | Oracle | Route |
|---|---|---|
| PRD-2 / CL-G3-27 | for **each** INV-1…INV-12: break its guard in a scratch worktree ⇒ the matching test **fails**; record the mutations tried | R-G |

---

## STAGE 1 — The work

### The mutation runner

`pnpm test:invariants --mutation` — for each entry in `tests/invariants/mutations.md`:

1. create a scratch worktree at the current HEAD
2. apply the mutation (remove/disable the named guard)
3. run the matching invariant test
4. **assert it FAILS**
5. discard the worktree

**The runner must fail loudly if a mutation leaves the test green.** A silent pass here
means the invariant is not actually enforced, and the whole point of the exercise is
lost.

**Every mutation is recorded** — which guard, which test, and the failure output. That
record *is* the PRD-2 evidence.

### The twelve invariants and their mutations

The mutation for each is specified in pack `08` §3. Use those exact mutations.

| Test | Invariant | The mutation that must turn it red |
|---|---|---|
| **INV-1** | The data plane cannot mutate control-plane state | attach the container to `factory-core`; add a DB role to the env |
| **INV-2** | No agent can widen its scope, autonomy or credentials | delete `deny-factory-write` / the agent-actor check |
| **INV-3** | Every consequential action is attributable and in the event log | make the broker skip step 10 |
| **INV-4** | No merge without a passing acceptance oracle and the applicable approval | drop the SHA check; ignore the oracle result |
| **INV-5** | No factory change without a reviewed, evaluated, reversible change | grant the API role INSERT on `definition_versions` |
| **INV-6** | Untrusted content cannot become instruction | move the envelope before the standards; drop the tagging at ingest |
| **INV-7** | No production write outside an enumerated runbook | register a stub `git.merge` |
| **INV-8** | Every run's context is pinned and recoverable | skip the envelope persistence |
| **INV-9** | No dependency on one model provider for correctness/governance | hard-code one provider |
| **INV-10** | No agent-authored test alone satisfies an acceptance criterion | trust the authorship flag blindly |
| **INV-11** | Surplus capacity is allocated by policy, not by default | add an auto-fill loop |
| **INV-12** | Every component is replaceable without changing the definition/workflows/agent contracts | make a fake diverge |

### What each test asserts (pack `08` §3)

* **INV-1** — from inside a T2 container, try the Postgres host/port, `factory-api`, the
  object store, the Docker socket and the arbitrary internet ⇒ all fail. Statically: no
  DB handle type is reachable from `Environment` / `HarnessAdapter`.
* **INV-2** — a property test: for every agent-actor request that creates/edits grants,
  autonomy, credentials or the definition (API + tool + DB) ⇒ denied; the level and the
  grants are unchanged afterwards.
* **INV-3** — in a recorded fake run: `tool_invocations` ↔ events 1:1; state transitions
  ↔ events 1:1; every event has an actor and an authority.
* **INV-4** — a table over {oracle: pass/fail/none} × {approval: valid/void/expired/none}
  × {head sha: match/mismatch} ⇒ `ready` **only** for (pass, valid, match). The registry
  has no merge capability.
* **INV-5** — applying an unmerged SHA, or one without a bundle-bound approval, fails;
  no code path other than the applier writes `definition_versions` (route + grep
  inventory); proposals have no apply path.
* **INV-6** — a property test with random content tagged untrusted: it never appears
  outside the untrusted envelope in any assembled prompt; content-derived "grants" have
  no effect.
* **INV-7** — the registry contains no capability of effect class E3/E4 (except test
  fixtures), none with `prod.*`, `git.merge`, `git.push.protected`, `secret.read` or
  `factory.write`.
* **INV-8** — every run record has `resolvedContextSha256`; the envelope object
  retrieves and re-hashes to the same value.
* **INV-9** — a fake provider A that errors ⇒ routed to B with `model.failedOver`; lint
  proves no provider SDK/type is imported outside `gateway/providers/*` and no model-id
  string exists outside config.
* **INV-10** — an oracle with `implementationRunId != null` is rejected; agent-added
  tests are flagged untrusted; a criterion satisfied only by agent tests is
  **unsatisfied**.
* **INV-11** — with idle capacity and queued work for workflows without an allocation,
  the scheduler starts nothing beyond the configured caps.
* **INV-12** — the same contract suite passes against the real and the fake
  implementations of EventLog, PolicyEngine, ToolBroker, ModelGateway,
  IsolationProvider, HarnessAdapter, ScmAdapter, CredentialBroker and ApprovalService.

---

## STAGE 2 — Review

The owner witnesses **at least three** mutations applied live: INV-4 (drop the SHA
check), INV-10 (trust the authorship flag blindly) and INV-11 (add an auto-fill loop).
The point is to see the test go red in front of a human, not only in a CI log.

---

## GATE ROWS

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G3-27 🔒 | **PRD-2 mutation check:** for each INV test, temporarily break its guard ⇒ the test fails (record the mutations tried) | `pnpm test:invariants --mutation` | agent |
| CL-G4-02 🔒 | **PRD-2** invariants proven with the mutation check | the CL-G3-27 evidence | agent |

---

## EXIT CRITERIA

- [ ] All twelve mutations applied; **all twelve tests failed**.
- [ ] The record lists each mutation, the guard removed and the failure output.
- [ ] The owner witnessed three of them live.
- [ ] The runner **fails loudly** if a mutation leaves a test green (test this by
      adding a deliberately useless mutation and confirming the runner reports it).

---

## TRAPS

1. **Accepting a green test after a mutation.** That is the whole failure this
   checklist exists to catch. If the test is still green, the invariant is not
   enforced — fix the test, not the runner.
2. **Mutating something the test does not actually depend on.** The mutation must
   remove the *guard* the test is written against. A mutation elsewhere proves nothing.
3. **Running the mutation on `main` instead of a scratch worktree.** The runner is
   specified to use a scratch worktree and discard it. Mutating the branch is how you
   lose a day.
4. **Doing this once and forgetting it.** The mutation check must re-run whenever a
   guard changes. Wire it into CI as a **nightly** or pre-release job, not only as a
   one-time PRR exercise.
5. **Skipping INV-7 because "there's no merge capability to break".** Registering a stub
   `git.merge` is exactly the mutation — and it must be caught. The invariant is
   enforced by an assertion that the registry is empty of E3/E4 capabilities.
