# 17 — The full index: where am I, and what is left?

> **Reference file.** Read it once now to see the whole map; come back to it whenever
> you lose your place.
>
> Every ticket in pack `05`, every gate row in pack `06` Part A, every spike, every
> invariant and every red-team attack has exactly one home in this folder. **No ticket
> is in two checklists; no ticket is missing.** A verifier script checks this
> (see §4).

---

## 1. The checklist order

| # | Checklist | Phase | Tickets | Spikes | Gate |
|---|---|---|---|---|---|
| 00 | `00-START-HERE.md` | orientation | — | — | — |
| — | `PROTOCOL.md` | the loop, read once | — | — | — |
| 01 | `01-bootstrap.md` | W0 | T-0.01 … T-0.06 | S-1 … S-6 | **G0** |
| 02 | `02-contracts-and-db.md` | W1 | T-1.01 … T-1.05 | — | — |
| 03 | `03-control-plane.md` | W2 | T-1.06 … T-1.17 | — | **G1** |
| 04 | `04-context-and-intake.md` | W3 | T-2.01 … T-2.08 | — | — |
| 05 | `05-execution-and-gates.md` | W3–W5 | T-2.09 … T-2.19 | — | **G2** |
| 06 | `06-safety-hardening.md` | W5–W6 | T-3.01 … T-3.06 | — | G3 (partial) |
| 07 | `07-resilience.md` | W7 | T-3.07, T-3.08 | — | G3 (partial) |
| 08 | `08-measurement-calibration.md` | W3–W7 | T-4.01 … T-4.05 | — | G2 (partial) + G3 |
| 09 | `09-more-workflows.md` | W6–W7 | T-5.01 … T-5.05 | — | G3 (partial) |
| 10 | `10-production-deploy.md` | W7 | T-6.01 … T-6.03 | — | G4 (partial) |
| 11 | `11-runbooks-and-drill.md` | W8 | T-6.04 | — | G4 (partial) |
| 12 | `12-soak.md` | W5–W8 | T-6.05 | — | G4 (partial) |
| 13 | `13-production-readiness.md` | W8 | T-6.06 | — | **G4** |
| 14 | `14-invariants-sweep.md` | cross-cutting | — | — | PRD-2 |
| 15 | `15-redteam-sweep.md` | cross-cutting | — | — | PRD-3 |
| 16 | `16-peak-decision.md` | beyond v1 | — | — | — |

---

## 2. Ticket → checklist map (66 tickets + 6 spikes)

| Epic | Tickets | Checklist |
|---|---|---|
| **E0** Bootstrap | T-0.01, T-0.02, T-0.03, T-0.04, T-0.05, T-0.06 | **01** |
| **E1** Spine | T-1.01, T-1.02, T-1.03, T-1.04, T-1.05 | **02** |
| | T-1.06, T-1.07, T-1.08, T-1.09, T-1.10, T-1.11, T-1.12, T-1.13, T-1.14, T-1.15, T-1.16, T-1.17 | **03** |
| **E2** Workflow B | T-2.01, T-2.02, T-2.03, T-2.04, T-2.05, T-2.06, T-2.07, T-2.08 | **04** |
| | T-2.09, T-2.10, T-2.11, T-2.12, T-2.13, T-2.14, T-2.15, T-2.16, T-2.17, T-2.18, T-2.19 | **05** |
| **E3** Safety | T-3.01, T-3.02, T-3.03, T-3.04, T-3.05, T-3.06 | **06** |
| | T-3.07, T-3.08 | **07** |
| **E4** Measurement | T-4.01, T-4.02, T-4.03, T-4.04, T-4.05 | **08** |
| **E5** More workflows | T-5.01, T-5.02, T-5.03, T-5.04, T-5.05 | **09** |
| **E6** Production | T-6.01, T-6.02, T-6.03 | **10** |
| | T-6.04 | **11** |
| | T-6.05 | **12** |
| | T-6.06 | **13** |
| **Spikes** | S-1, S-2, S-3, S-4, S-5, S-6 | **01** |

**Count:** 6 + 17 + 19 + 8 + 5 + 5 + 6 = **66 tickets**, plus **6 spikes**. ✔

---

## 3. Gate row → checklist map

> **"Closed in" means: this is the checklist whose GATE ROWS table contains the row
> in its ID column.** A row named in another checklist's *Verify* column is an
> evidence citation, not a second home. A row in a `Row (closed later)` table is a
> forward reference — the row is *created* there and closed elsewhere. The verifier
> enforces this distinction, so this table cannot drift from the checklists without
> the verifier failing.

### G0 (11 rows) → checklist **01**

CL-G0-01 … CL-G0-11.

### G1 (18 rows) → checklist **03**

CL-G1-01 … CL-G1-18. (CL-G1-07, CL-G1-11 and CL-G1-18 are *created* in checklist 02
and *closed* in 03.)

### G2 (20 rows) → checklists **05** and **08**

| Rows | Closed in |
|---|---|
| CL-G2-01 … CL-G2-10, CL-G2-13 … CL-G2-19 | **05** |
| CL-G2-11, CL-G2-12, CL-G2-20 | **08** (they measure machinery built in 05) |

### G3 (28 rows) → checklists **03**, **05**, **06**, **07**, **08**, **09**, **12**, **14**

| Rows | Closed in |
|---|---|
| CL-G3-01, CL-G3-02, CL-G3-03, CL-G3-04, CL-G3-05 | **08** (measurement & calibration) |
| CL-G3-06 (A2.7), CL-G3-07 (A2.8), CL-G3-08 (A2.9/A2.10), CL-G3-09 (A3.1), CL-G3-10 (A3.2) | **05** (the scorer, the approvals and the T2 sandbox) |
| CL-G3-11 (A3.3), CL-G3-12 (A3.4) | **03** (the credential broker, T-1.09) |
| CL-G3-13, CL-G3-14, CL-G3-15, CL-G3-17 (A3.9), CL-G3-18 (A3.10), CL-G3-19, CL-G3-20, CL-G3-26 | **06** (the red-team suite and the secret scan) |
| CL-G3-16, CL-G3-24, CL-G3-25 | **07** (resilience) |
| CL-G3-21, CL-G3-22, CL-G3-23 | **09** (more workflows) |
| CL-G3-28 | **12** (the owner review receipt for the whole W3–W7 window) |
| CL-G3-27 | **14** (the mutation check) |

> A2.7, A2.8, A2.9, A2.10, A3.1, A3.2, A3.3, A3.4, A3.9 and A3.10 are **built** in
> checklists 05 and 03 (T-2.09, T-2.10, T-2.13, T-2.16, T-1.09) and their **gate rows**
> are closed where the machinery lives. The row's *Verify* command is an acceptance
> test; the PRR in checklist 13 **confirms** them against their evidence, but does not
> close them.

### G4 (13 rows) → checklists **12**, **13**, **14**, **15**

| Rows | Closed in |
|---|---|
| CL-G4-04, CL-G4-09 | **12** (the soak produces the data) |
| CL-G4-01, CL-G4-05, CL-G4-06, CL-G4-07, CL-G4-08, CL-G4-10, CL-G4-11, CL-G4-12, CL-G4-13 | **13** (the PRR signs them) |
| CL-G4-02 | **14** (the mutation check) |
| CL-G4-03 | **15** (the red-team sweep) |

> Checklists 10 and 11 produce the **evidence** for CL-G4-05, CL-G4-06, CL-G4-08,
> CL-G4-10 and CL-G4-11, but the rows are closed at the PRR. Checklists 14 and 15
> run after the PRR and close CL-G4-02 and CL-G4-03, which the PRR confirms against
> their evidence.

---

## 4. The verifier

The checklist folder ships with a verifier that proves the coverage claims above are
true. Run it before you start and after you change anything:

```bash
python3 checklists/verify_checklists.py
```

It is **read-only**: it never writes to the pack, to the checklists, or anywhere else.
Exit code 0 means every claim holds; exit code 1 means at least one does not, and
each failure is printed above the final line.

It checks:

| # | Claim | How it is decided |
|---|---|---|
| 1 | every ticket `T-x.yy` in pack `05` is **built by exactly one** checklist | the checklist with a `### T-x.yy` heading; a mention in prose is a cross-reference, not a second home |
| 2 | every spike `S-n` is **run by exactly one** checklist | the checklist whose spikes section lists it |
| 3 | every gate row `CL-G<n>-<nn>` in pack `06` Part A is **closed by exactly one** checklist | the row in the **ID column** of a GATE ROWS table; a `Row (closed later)` table is a forward reference, and a row named in the *Verify* column is an evidence citation |
| 4 | a forward reference names the checklist that actually closes the row | the prose target ("checklist 05 (T-2.13)") must match the real home |
| 5 | every invariant `INV-n` and every attack `AT-n` referenced exists in pack `08` | parsed from pack `08` itself |
| 6 | every pack file and **section** a checklist opens actually exists | every `§N`, including compound forms (`§2 + §4`, `§2–§11`); ambiguous numbers (`01`, `06`, `07`, `08` exist in both corpora) resolve against the "pack" / "blueprint" qualifier word |
| 7 | no checklist references a ticket, spike or gate row that does not exist | parsed from pack `05` / pack `06` |
| 8 | the map in §3 of this file matches where the rows are actually closed | the map is re-parsed and compared row by row |
| 9 | the ticket and spike totals claimed in §2 match pack `05` | 66 tickets, 6 spikes |

**Expected output:**

```
ALL CHECKLIST COVERAGE VERIFIED AGAINST THE PACK
```

> The verifier is not a rubber stamp. Each of the nine claims has been
> fault-injected — orphaning a ticket, deleting a spike table, closing one row in
> two checklists, pointing a forward reference at the wrong checklist, citing a
> non-existent pack file or section, inventing an attack ID and falsifying the
> index totals — and each fault was caught with a message naming the file and the
> row.

---

## 5. The phase-by-phase dependency graph

```
        01 bootstrap
             │
      ┌──────┴──────┐
      │             │
  02 contracts   (spikes S-1..S-6 land here)
      │
  03 control plane ────────────► G1
      │
  04 context + intake
      │
  05 execution + gates ────────► G2  ──► 12 soak starts here
      │                            │
  06 safety hardening            │
      │                            │
  07 resilience                   │
      │                            │
  08 measurement ─────────────────┘
      │
  09 more workflows
      │
  10 production deploy
      │
  11 runbooks + drill
      │
  12 soak (W5→W8, wall-clock bound)
      │
  13 production readiness ──────► G4, PRD-1..PRD-10
      │
  ├──► 14 invariants sweep (PRD-2)
  └──► 15 red-team sweep (PRD-3)
             │
  16 peak decision (evidence-gated, builds nothing)
```

**Parallelisable** (disjoint Build lines, ≤3 agents at a time, `05` §9):
T-1.06 ∥ T-1.07 ∥ T-1.08→T-1.09 ∥ T-1.10 ∥ T-1.11 ∥ T-1.12, then T-1.14 ∥ T-1.15,
then T-1.16.

**Never parallel:** T-1.01 first; the T-2.10→T-2.11→T-2.12→T-2.13 chain; T-2.15→T-2.17;
R4 tickets run alone with the owner present.

---

## 6. The three clocks that run the whole time

| Clock | Started | Ends | Consequence if missed |
|---|---|---|---|
| **Pre-factory baseline** | T-0.04, W0 | once, forever | every productivity number becomes a guess; `factory metrics report` refuses to print a delta |
| **Calibration corpus mining** | T-0.06, W0 | T-4.03 | no verifier can ever gate a merge (A2.1); L3 is unreachable |
| **The soak** | W5, first real issue | W8 | PRD-4 fails; the central question (Q-05) stays unanswered |

---

## 7. Where each kind of fact lives

| You need… | Open |
|---|---|
| The build order and the ticket text | `docs/pack/05_TICKET_BACKLOG.md` |
| What "done" means (the gate rows) | `docs/pack/06_MASTER_CHECKLIST_AND_COVERAGE.md` Part A |
| The interfaces you code against | `docs/pack/03_CONTRACTS_AND_DATA_MODEL.md` |
| The DDL | `docs/pack/03` §2 |
| The algorithms | `docs/pack/02_ARCHITECTURE_SPEC.md` §4 |
| The external systems | `docs/pack/04_INTEGRATIONS_AND_API_CATALOG.md` |
| The test layers, INV-n, AT-n, fault scenarios | `docs/pack/08_VERIFICATION_AND_PRODUCTION_READINESS.md` |
| The agent rules and the prompts | `docs/pack/07_AGENT_OPERATING_MANUAL.md` |
| The decisions, D1–D10, the risks | `docs/pack/01_MISSION_SCOPE_AND_DECISIONS.md` |
| A different language / a swap map | `docs/pack/A1_STACK_NEUTRALITY_AND_ADAPTERS.md` |
| Beyond v1 | `docs/pack/A2_PATH_TO_PEAK_AUTOMATION.md` |
| The blueprint's own reasoning | `docs/pack/blueprint-reference/` — **only what a checklist names** |

---

## 8. If you only read three things

1. `00-START-HERE.md` — how to work.
2. `PROTOCOL.md` — the four stages and the exact prompts.
3. The checklist for the phase you are in.

Everything else is a lookup.

---

## 9. When you are done

Factory v1 is done when **all ten** of blueprint `17` §10 are true:

1. An intent becomes a production release (FR-01).
2. An unauthorised action is denied and logged, every time (SEC-01).
3. A change cannot merge without an independent, passing oracle and the applicable
   approval (I-4).
4. A verifier that cannot discriminate cannot gate a merge (FR-55).
5. A human can answer "what is the factory doing and what does it need from me" in one
   view (NFR-07).
6. Any consequential action can be reconstructed with its authority and its context
   (SEC-07).
7. The factory proposes changes to itself and never applies them (SEC-11).
8. The factory has measured its own baseline and reports honestly against it
   (MEAS-03, MEAS-06).
9. A human's code review remains mandatory until the calibration evidence says otherwise
   (ADR-0003 §3).
10. The factory could be replaced component by component without editing the definition,
    the workflows or the agent contracts (I-12).

**If any of these is false, the factory is not done — regardless of how much code
exists.**
