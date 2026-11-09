# 08 — Measurement and calibration

> **Phase W3 → W7 (staggered) · Tickets T-4.01 … T-4.05**
>
> Five tickets that run across the whole programme. T-4.01 starts in W3, T-4.02 in W3,
> T-4.03 in W4, T-4.04 in W6, T-4.05 in W7. **Do not defer them to the end** — the
> baseline clock started in W0 and the measurement infrastructure has to exist before
> the numbers it produces are worth anything.
>
> This phase answers the question the entire blueprint exists to answer:
> **does agent throughput become *accepted* throughput?** (Q-05)

---

## PREREQUISITES

* Checklist 03 (the event log, the projections) and checklist 05 (the merge gate).
* T-0.04 has produced `baselines/pre-factory-<date>.json` — **day-one clock #1**.
* T-0.06 has produced `calibration/candidates.jsonl` — **day-one clock #2**.
* `packages/contracts` is frozen.

---

## STAGE 0 — Oracles

| Ticket | Oracle highlights | Route |
|---|---|---|
| T-4.01 | metrics are derived **only** from events; the report **refuses to print a delta without a baseline**; the failure-taxonomy split is computed | R-G |
| T-4.02 | **A2.3** a violation-only corpus is rejected; threshold table tests; the report hash is stable | R-G |
| T-4.03 | **A2.4** a seeded violation is caught through the **whole pipeline** (verifier → gate → merge block); **A2.5** a realistic non-violation is not flagged | R-G |
| T-4.04 | **A2.1** a verifier without a report cannot gate; **A2.2** an expired report drops the verifier automatically | R-G |
| T-4.05 | the breaker trips in a simulated spike; a breach is `incomplete`, **not** failure | R-G |

---

## STAGE 1 — The work

### T-4.01 · Metrics projections and baseline report · W3 → W6 · M · R2

**Open ONLY:** blueprint `14` §8–9, blueprint `15` §3.

**Build:** the metrics subset (`02` §4.22), `factory metrics report` (baseline, delta,
cost, guardrail), oracle coverage, and the **same-run-authored-oracle rate**.

**The v1 metrics** (pack `02` §4.22): lead time · task completion time · PR cycle time ·
accepted-PR rate · first-pass success · human intervention frequency · agent failure rate
(**model-reasoning vs workflow-composition split**) · retry frequency · **cost per
accepted change** · token consumption · tool execution cost · oracle coverage ·
**same-run-authored oracle rate (must be 0)** · approval latency by tier ·
context-budget compliance · rubber-stamp rate · defect-escape proxy (reverts within 14
days + the owner's "defect found" flag) · calibration currency.

**The report is four elements** (blueprint `14` §7): **baseline · delta · cost ·
guardrail.** And:

> **No targets.** MEAS-06. No productivity claim is made without a baseline, and no
> number is copied from the research corpus (HR-14). If you cannot produce the baseline,
> produce nothing.

---

### T-4.02 · Calibration corpus format and harness · W3 · M · R3

**Open ONLY:** blueprint `14` §5.2–5.4.

**Build** `packages/calibration`: the corpus schema + validation, the runner, the
thresholds by property kind, and the report + currency window.

**The corpus must contain both violation and conforming samples.** A corpus with only
violations is **rejected** (A2.3) — otherwise the detection rate is meaningless.

**Thresholds by property kind** (blueprint `14` §5):

| Property kind | Detection rate (min) | False-positive rate (max) |
|---|---|---|
| security | 0.98 | 0.005 |
| correctness | 0.95 | 0.02 |
| contract | 0.90 | 0.05 |
| convention | 0.85 | 0.10 |

Reports are stored with a **90-day currency window**.

---

### T-4.03 · Violation-injection harness · W4 · M · R3

**Open ONLY:** blueprint `14` §5.6.

**Build:** historical mining → samples, seed injection, **≥5 mutation operators** for
the target language, and a **mandatory negative control**.

**Seed injection is the most valuable technique** (blueprint `14` §5.6) — it takes a
real historical violation and re-injects it.

---

### T-4.04 · First calibration reports and gating consult · W6 · M · R3

**Open ONLY:** blueprint `14` §5.3–5.8.

**Build:** calibrate **2 properties** on the target repo — one security-flavoured and one
correctness-flavoured — and make the merge gate consult the calibration store.

**The two rules that make calibration meaningful:**

* **A2.1** — a verifier with **no valid report cannot gate** a merge.
* **A2.2** — an **expired report drops the verifier from the gating set automatically**.

> Blueprint `17` §7: *"The calibration corpus rots — a verifier that used to catch
> things stops catching them."* The cure is a schedule and a currency window, and the
> enforcement is A2.2. A verifier with a stale report must **stop being consulted**,
> not keep being trusted.

---

### T-4.05 · Cost reports and budget circuit breakers · W7 · M · R2

**Open ONLY:** blueprint `15` §4.

**Build:** `cost_attribution`, cost per accepted change, and the circuit breaker (spend
rate > 2× the trailing mean, or the day cap ⇒ pause intake + notify).

**A budget breach is `incomplete`, not `failure`.** The distinction matters: an
incomplete task preserves partial artefacts and can be resumed; a failed one is a defect.

---

## STAGE 2 — Review

Standard reviewer pass. T-4.02, T-4.03 and T-4.04 are **R3** — the owner reads the
thresholds and the corpus schema personally, because these numbers gate merges.

---

## GATE ROWS — these close the rows left open in checklist 05

| ID | Statement | Verify | By |
|---|---|---|---|
| CL-G2-11 | **A1.11** baseline and cost-per-accepted-change computed; no delta printed without a baseline | `factory metrics report` | agent |
| CL-G2-12 | **A1.12** the first calibration corpus has violation **and** conforming samples + a measured detection rate | `factory calibrate report` | agent |
| CL-G2-20 🔒 | **Same-run-authored oracle rate = 0**; oracle coverage rate reported (H-01, H-11) | `factory metrics report` | agent |
| CL-G3-01 🔒 | **A2.1** a verifier with no calibration report cannot gate a merge | `… -t "A2.1"` | agent |
| CL-G3-02 🔒 | **A2.2** an expired calibration removes the verifier from the gating set automatically | `… -t "A2.2"` | agent |
| CL-G3-03 | **A2.3** a violation-only corpus is rejected | `… -t "A2.3"` | agent |
| CL-G3-04 🔒 | **A2.4** a seeded violation is detected through verifier → gate → merge block | `… -t "A2.4"` | agent |
| CL-G3-05 | **A2.5** the negative control is not flagged | `… -t "A2.5"` | agent |

---

## EXIT CRITERIA — before checklist 09

- [ ] `factory metrics report` prints baseline, delta, cost and guardrail — and
      **refuses** to print a delta when the baseline is absent.
- [ ] The **same-run-authored oracle rate is 0** and is reported every time.
- [ ] The failure taxonomy is split (model-reasoning vs workflow-composition).
- [ ] A corpus with only violations is rejected.
- [ ] A seeded violation is caught through verifier → gate → **merge block**.
- [ ] A realistic non-violation is not flagged.
- [ ] A verifier with no report cannot gate; an expired report drops it automatically.
- [ ] Two properties are calibrated on the target repo, with a measured detection rate.
- [ ] The cost circuit breaker trips on a simulated spike, and the breach is
      `incomplete`, not `failure`.
- [ ] **No productivity claim exists anywhere that is not backed by the baseline.**

---

## TRAPS

1. **Printing a delta with no baseline.** The report must refuse. If it computes a delta
   anyway, every number the factory ever produces is decoration.
2. **Quoting a multiplier from the research corpus** ("10× faster"). MEAS-06 and HR-14
   forbid it. The baseline exists precisely so you never have to.
3. **Building a violation-only corpus** because it is easier to assemble. It is
   rejected by design (A2.3), and a detection rate computed against it is a lie: it
   measures nothing about false positives.
4. **Letting a verifier keep gating after its report expires.** A2.2 exists because a
   stale calibration is worse than no calibration — it looks like assurance.
5. **Treating a budget breach as a failure.** It is `incomplete`, with partial artefacts
   preserved and labelled.
6. **Adding metrics later.** They must derive from events that already exist. This is
   why the artefact store lands in Phase 0.
7. **Running T-4.04 for 20 properties instead of 2.** The calibration cost is the
   programme's biggest risk (RP-02). Two, done properly, prove the machinery. Twenty,
   done badly, prove nothing and blow the schedule.
