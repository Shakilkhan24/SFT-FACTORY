# `checklists/` — the Software Factory execution layer

> **Start here:** [`00-START-HERE.md`](00-START-HERE.md).
> Then [`PROTOCOL.md`](PROTOCOL.md) — the four-stage loop, read once.
> Then **the one checklist for the phase you are in.** Deliver them to the agent
> **one at a time**, never all at once.

---

## What this folder is

The **Software Factory Pack** is the source of truth: architecture, contracts, the
ticket backlog, the gate rows, the verification plan, the agent contracts. It is
read-only and it is not modified.

This folder is the **execution layer over it**. It adds nothing new to the spec. It
adds:

* **order** — which of the 66 tickets comes before which, and what blocks what;
* **focus** — for each phase, the exact pack files and sections to open, and the
  ones to leave closed;
* **a goal** — what "done" means for the phase, in one paragraph;
* **the loop** — the Stage 0 / 1 / 2 / 3 protocol that keeps oracle independence
  and the human review floor intact;
* **traps** — the specific ways each phase goes wrong in practice.

The reason the pack alone is not enough: handed the whole corpus at once, an agent
loses the plot. A checklist is a **context boundary** — a small, closed slice of
work with a defined end.

---

## The files

| File | What it is |
|---|---|
| `00-START-HERE.md` | **The entrypoint.** The briefing, the repo layout, the phase order with the blocking reason for each, and the rules for this folder. |
| `PROTOCOL.md` | The shared four-stage loop every checklist references: the oracle prompt, the implementer prompt, the reviewer prompt, the owner-review table by tier, escalation, evidence rules. |
| `01-bootstrap.md` … `16-peak-decision.md` | The sixteen phase checklists. One per phase, in order. |
| `17-full-index.md` | The map: where you are, what is left, which ticket and gate row lives where, and the verifier's contract. |
| `verify_checklists.py` | The coverage verifier. Read-only. Run it before you start and after you change anything. |

---

## The sixteen phases

| # | Phase | Weeks | Tickets |
|---|---|---|---|
| 01 | Bootstrap | W0 | T-0.01 … T-0.06 + spikes S-1…S-6 |
| 02 | Contracts and the database | W1 | T-1.01 … T-1.05 |
| 03 | Control plane | W2 | T-1.06 … T-1.17 |
| 04 | Context and intake | W3 | T-2.01 … T-2.08 |
| 05 | Execution and gates | W3–W5 | T-2.09 … T-2.19 |
| 06 | Safety hardening | W5–W6 | T-3.01 … T-3.06 |
| 07 | Resilience | W7 | T-3.07, T-3.08 |
| 08 | Measurement and calibration | W3–W7 | T-4.01 … T-4.05 |
| 09 | More workflows | W6–W7 | T-5.01 … T-5.05 |
| 10 | Production deploy | W7 | T-6.01 … T-6.03 |
| 11 | Runbooks and drill | W8 | T-6.04 |
| 12 | Soak | W5–W8 | T-6.05 |
| 13 | Production readiness review | W8 | T-6.06 |
| 14 | Invariants sweep | — | PRD-2 |
| 15 | Red-team sweep | — | PRD-3 |
| 16 | The v1 → peak decision | — | **builds nothing** |

**66 tickets · 6 spikes · 90 gate rows.** Every one has exactly one home.

---

## The verifier

```bash
python3 checklists/verify_checklists.py
```

Expected final line:

```
ALL CHECKLIST COVERAGE VERIFIED AGAINST THE PACK
```

It proves nine claims — one ticket, one home; one spike, one runner; one gate row,
one closer; every referenced pack file and section exists; every referenced
invariant and attack exists; and the map in `17-full-index.md` matches reality.
See `17-full-index.md` §4 for the full table.

---

## The rules for this folder

1. **The pack is read-only.** Never edit `software-factory-pack/`. Never edit the
   three root READMEs. If the pack is wrong, fix it in the pack — separately, with
   the owner — and re-run the verifier.
2. **These checklists are read-only too**, once written. If a checklist is wrong,
   say so and fix it in the open; do not silently work around it.
3. **One checklist per session.** The agent stops at that checklist's exit criteria.
4. **Evidence or it did not happen.** A row is ticked with a command output or a
   file reference, never with a claim.
5. **The oracle is written before the implementation, by someone who has not seen
   it.** Stage 0 is a separate session. This is not a formality — it is the
   mechanism that stops a self-graded factory.
