# 07 — Resilience: fault injection and concurrency

> **Phase W7 (4 days) · Tickets T-3.07, T-3.08**
>
> Two tickets, one enormous idea: **prove the factory does not lose work and does not
> contaminate work.** Everything else in this factory is designed to fail closed; this
> phase is where you find out whether it actually does when the machine breaks.
>
> **PRDs 7 and the NFR-04 / NFR-05 / NFR-10 rows depend on this phase.** PRD-7
> (fault injection) is checked again in checklist 13 against the production topology
> with `--prod-like`.

---

## PREREQUISITES

* Checklist 06 complete. The orchestrator, the scheduler, the leases, the T2 sandbox,
  the artefact store and the egress proxy all exist and are red-team clean.
* The `H.hello` workflow and Workflow B both run end to end.

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-3.07 | **zero silent losses**; every scenario ends **resumed or explicitly failed/escalated**; leases heal | R-G |
| T-3.08 | **zero contamination events**; cross-repo access is refused **and recorded** | R-G |

> Both oracles are negative ("nothing bad happened"), which is the hardest kind to
> write. The trick is to make the *expected* behaviour explicit and enumerable: for
> every fault scenario, name the terminal state that is legal. Anything else is a loss.

---

## STAGE 1 — The work

### T-3.07 · Fault-injection suite · W7 · L · R2

**Open ONLY:** blueprint `09` §6, blueprint `14` §10.

**Build:** the fault-injection suite with scenarios **FI-1 … FI-14** (pack `08` §5), plus
a runner flag `--prod-like` to run against the production compose topology.

**The scenarios to cover:**

* kill the **api** mid-run
* kill the **worker** mid-run
* **Postgres** restart
* **object-store** outage
* **provider** outage, and a provider that is merely *slow*
* **Docker daemon** restart
* **egress proxy** down, **gateway** down
* **clock skew**

**The oracle, stated precisely:**

1. **Zero silent losses.** Every event written is accounted for; every task reaches a
   legal terminal state.
2. Every scenario ends **resumed** (the work continues where it stopped) **or explicitly
   failed/escalated** (a human is told). There is no third option — "stuck" is a loss.
3. **Leases heal.** An expired lease is re-queued exactly once; the first committed
   result wins; a stale worker reporting later is recorded as `node.duplicateExecution`,
   not applied.

**Reference behaviours from the degradation matrix** (pack `02` §8):

| Component down | Behaviour |
|---|---|
| Postgres | api read-only/503; the worker stops claiming; leases expire and resume after recovery; **no work proceeds without the log** |
| Object store | writes spool to bounded local disk, then the stage fails `environment.failure`; reads degrade views |
| Primary provider | failover per the routing policy; else tasks queue, then `INCOMPLETE` |
| GitHub | intake pauses; push/PR retried with idempotency keys |
| Docker host | the node is retried on another attempt; **no fallback to unsandboxed execution — ever** |
| Egress proxy / gateway | **fail closed** (no network / no model calls) |
| Policy engine error | `DENY` |
| Dashboard | api + CLI remain the access points |

> The row that matters most: **"no fallback to unsandboxed execution — ever."** A
> degraded sandbox must not become "run it on the host instead". If your fault suite
> does not cover Docker-host-down, it does not cover the worst case.

---

### T-3.08 · Concurrency suite · W7 · M · R2

**Open ONLY:** blueprint `07` §10 (the scaling model).

**Build:** N parallel tasks, in the same repo and in different repos, with checks on
worktrees, containers, credentials, edge tokens and caps.

**The oracle:** **zero contamination events**; a cross-repo access attempt is **refused
and recorded**.

**What to check for each isolation dimension:**

| Dimension | The contamination to look for |
|---|---|
| Worktrees | one task's working directory visible in another's |
| Containers | a container from task A still running when task B starts; a labelled container surviving a terminal state (the leak detector) |
| Credentials | task B able to use task A's token; a lease not revoked after termination (A3.4) |
| Edge tokens | one task's gateway token accepted for another's model calls |
| Caps | more than the configured concurrency running |

> This suite also exercises **I-11** (surplus capacity allocated by policy, not by
> default) and **SEC-12** (cross-repository access refused and recorded, A3.8).

---

## STAGE 2 — Review

Standard reviewer pass. Both tickets are **R2**, but the owner runs the suites locally
before the phase is called done — a fault suite that only passes on the agent's machine
proves nothing.

---

## GATE ROWS

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G3-24 | Fault-injection suite green (NFR-04, NFR-10) | `pnpm test:fault` | agent |
| CL-G3-25 | Concurrency suite green (NFR-05) | `pnpm test:concurrency` | agent |
| CL-G3-16 🔒 | **A3.8** a cross-repository access attempt is refused and recorded (SEC-12) | `… -t "A3.8"` | agent |

---

## EXIT CRITERIA — before checklist 08

- [ ] All 14 fault scenarios run; **zero silent losses**.
- [ ] Every scenario ends resumed or explicitly failed/escalated — never stuck.
- [ ] Leases heal: an expired lease is re-queued exactly once; the first result wins.
- [ ] A Docker-host-down scenario proves there is **no** unsandboxed fallback.
- [ ] The egress-proxy-down and gateway-down scenarios prove **fail-closed**, not
      fail-open.
- [ ] The policy-engine-error scenario proves `DENY`.
- [ ] The concurrency suite shows **zero contamination events** across worktrees,
      containers, credentials, edge tokens and caps.
- [ ] A cross-repo access attempt is refused **and** recorded.

---

## TRAPS

1. **Writing a fault suite that asserts the system keeps working.** Some faults should
   stop work. A Postgres outage must stop the worker from claiming. "The suite is green
   because nothing failed" is a suite that tested nothing.
2. **Omitting Docker-host-down.** It is the scenario with the scariest wrong answer:
   "the sandbox is unavailable, so run it on the host" is exactly the failure the
   isolation tiers exist to prevent.
3. **Letting the fault suite leave state behind** — a stopped container, a leaked
   credential lease, an orphaned worktree. The suite must assert its own cleanliness,
   or the next scenario inherits the previous one's mess.
4. **Running concurrent tasks in the same repo only.** The interesting contamination is
   *cross-repo* — the one the factory explicitly promises to refuse (SEC-12).
5. **Testing concurrency with a sleep instead of a barrier.** A timing-based test passes
   on a fast machine and flakes on a slow one. Use a barrier so the tasks genuinely
   overlap.
6. **Trusting a green fault suite that never actually killed the process.** Assert that
   the kill happened.
