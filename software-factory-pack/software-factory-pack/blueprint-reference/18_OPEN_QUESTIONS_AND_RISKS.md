# 18 — Open Questions and Risks

**Purpose:** the honest register of what is not known, what could go wrong, and what would change the design.

**Source of truth for:** open questions, unresolved hypotheses, risk register, and the conditions under which the blueprint's decisions would be revisited.
**Related:** `03_EVIDENCE_LEDGER.md` §4 (evidence gaps) · `16_IMPLEMENTATION_ROADMAP.md` §10 (programme risks)

**The rule this document follows.** The directive (§14) requires that unverified hypotheses be distinguished from established findings. That distinction only works if the hypotheses are written down. Everything in §1 and §2 is an **[E4] unverified hypothesis** unless stated otherwise — a claim the blueprint treats as a planning assumption but has not verified.

---

## 1. Open questions

### 1.1 Questions the corpus does not answer at all

| ID | Question | Why it matters | Current handling | How to resolve |
|---|---|---|---|---|
| **Q-01** | **Is multi-tenancy required?** The corpus is entirely silent on running the factory for multiple organisations, or for multiple tenants within one organisation. | It changes the isolation model fundamentally: shared control plane with tenant partitioning versus per-tenant control planes. It affects the schema (every table needs a tenant key), the credential broker (cross-tenant leakage is catastrophic), and the policy engine. | **Not designed.** The blueprint assumes a single organisation. Cross-repository isolation *within* the organisation is designed and tested (SEC-12); cross-*organisation* isolation is not. | A decision before Phase 0, not after. If multi-tenancy is required, it must be designed in from the start — retrofitting a tenant key across every table and every projection is expensive. |
| **Q-02** | **What is the regulatory and compliance posture?** No source addresses regulated domains (finance, health, medical, safety-critical). | Determines what evidence the audit trail must retain, how long, in what form, and whether run artefacts contain data that cannot be stored. Also determines whether a model's output can be part of a regulated decision. | The audit trail satisfies a general reconstructability requirement (SEC-07) and the retention classes are policy-driven (NFR-08). Whether that satisfies a specific regime is unknown. | An explicit compliance requirement before Phase 1. It changes the run-artefact schema (retention classes, redaction rules) and possibly the review model. |
| **Q-03** | **How is the oracle authored for properties that cannot be mechanised?** V01 argues for black-box tests; V15 for generated verifiers. But some requirements are genuinely a matter of judgement: "the UX must feel trustworthy", "the error message must be actionable". | The oracle is the primary gate. If a property has no oracle, it is either ungated or gated by a human. The blueprint needs a principled answer. | Currently: such properties are gated by the reviewer, and the reviewer is explicitly told they are asked what the gates cannot check. This is honest but it moves the load onto review capacity, which is the binding constraint. | A decision per workflow. The options are: (a) accept human review for those properties, (b) define a proxy that is mechanisable and accept the approximation, (c) reformulate the criterion so it is checkable. Option (c) is preferred — it is the Refinement role's job. |
| **Q-04** | **How much does the reviewer's context cost the reviewer, and does it scale?** The corpus converges that review capacity is the bottleneck (CP-7) but says nothing about how to reduce the *per-item* review cost. | If each review takes 30 minutes, the factory's throughput is capped at roughly 30 reviews per hour per reviewer, regardless of how fast agents produce changes. | Blast-radius tiering rations it. The panel and the deterministic gates reduce what the reviewer must check. But the per-item cost is not yet measured. | Measure it in Phase 1. The pre-factory baseline (T1.16) should include the human review time per change. The metric set includes human time in the cost model (`15_...` §4.1). |
| **Q-05** | **What is the real relationship between agent throughput and accepted throughput?** The corpus's numbers (10–100×) are all code-production numbers, not accepted-change numbers. | It determines whether the factory is worth building at all. If agent throughput is 10× but accepted throughput is 1.2×, the economics are different. | The blueprint refuses to adopt the corpus's figures (MEAS-06) and measures both. MEAS-04's cost-per-accepted-change is the metric that settles it. | Measure in Phase 1 and Phase 4, once the baseline exists. **This is the single most important open question about the programme's value.** |
| **Q-06** | **What is the optimal oracle-to-implementation ratio?** A rigorous oracle is expensive; a thin one is weak. | The oracle's cost is the largest early cost, and it gates everything above L2. | Undetermined. The blueprint specifies the *properties* the oracle must have and the *cost* of the discipline, but not the optimal investment level. | Experiment in Phase 2: vary the oracle's depth on a fixed workload and measure accepted-change rate and cost. |
| **Q-07** | **Does the fresh-context rule scale to very large tasks?** V10's sequential-fresh-context finding is about dependent stages. For a single large task — a full-service implementation — the "fresh context" model may not fit. | The blueprint's model assumes decomposition into bounded work items. A task too large to decompose is a re-plan trigger, but what happens when it genuinely cannot be decomposed? | The chunkability rule and the planner's escalation handle it: a task that cannot be decomposed into independently verifiable items escalates to a human. | Observe in Phase 4. The frequency of un-decomposable tasks is itself a metric worth tracking. |
| **Q-08** | **What happens to the calibration corpus as the codebase changes fastest?** A corpus built for today's code may be irrelevant next quarter. | If the corpus decays silently, the calibration becomes fiction and the safety property above L2 degrades without anyone noticing. | Re-calibration on a schedule and on every skill change; an expired calibration removes the verifier from the gating set; calibration currency is a reported metric. | Measure the corpus's decay rate in Phase 2 and adjust the re-calibration window. |
| **Q-09** | **Is there a point where the control plane itself becomes the bottleneck, and what does that look like?** | The control plane is a single logical authority (`07_...` §12). If every tool call and every state transition goes through it, it is on the hot path for everything. | The control plane's write path is small — most writes are the data plane reporting artefacts. But this is a design intent, not a measurement. | Measure in Phase 4 as concurrency rises. ADR-0012's broker deferral trigger is the first place this would show. |
| **Q-10** | **How are model capability changes handled?** Models improve, are deprecated, and change behaviour silently. A workflow calibrated against one model's behaviour may not hold for another. | The calibration is per repository and change class — but is it also per model? | The routing policy is configuration and the replay evaluator can test a model change against the historical run set. The interaction between calibration and model change is **not** specified. | Decide in Phase 5: does a model change invalidate the calibration? The conservative answer is yes, which would make model updates expensive. |
| **Q-11** | **What is the acceptable rate of false-positive findings?** Too many false positives and the team ignores the gate (V14's slop problem in the tooling rather than the code); too few and defects escape. | The false-positive rate is a threshold per property (`14_...` §5.4), but the *aggregate* noise across all gates has no target. | Per-property thresholds only. | Measure the aggregate noise in Phase 2 and set a budget. |
| **Q-12** | **Does the factory work for tasks that are not code?** Design review, data analysis, incident postmortems, documentation architecture. | The factory's generality is a design goal (D-61's fungibility). But the gate set, the oracle model, and the criticality map are code-shaped. | The design is not code-specific in principle — the capability and gate model generalises. Whether the *implementation* does is untested. | A deliberate experiment in Phase 4 with one non-code workflow. |
| **Q-13** | **How do we know the human reviewers are good?** The blueprint assumes human review is a valid oracle substitute until calibrated verifiers exist. It never checks whether the human review is itself effective. | If human review is weak, the entire floor is weak. | The post-hoc defect rate is the indirect measure — it detects when review is failing, but not why. | A defect-postmortem process that asks "would our review have caught this?" once a quarter. Cheap, and it is the only available signal. |
| **Q-14** | **What is the organisational adoption path?** The factory's value depends on engineers using it. The corpus's adoption observation (V12's threshold) is the only evidence, and it is a single anecdote. | A technically excellent factory that nobody uses has no value. | The operational surface is built early (Phase 0) and the workflows must be the default path. | Measure in Phase 4: what fraction of eligible work goes through the factory? |
| **Q-15** | **Does the improvement loop actually improve things?** | It is the last phase and the most speculative. | ADR-0007's guards: batch evidence, replay evaluation, guardrails, automatic rollback, and the loop's own cost accounting. | Phase 5 measures the loop's net effect against its cost. If the loop is net negative, that is a finding, and the loop should be scaled back. |

### 1.2 Questions the corpus answers only partially

| ID | Question | Partial answer | What is missing |
|---|---|---|---|
| **Q-16** | What is the right model tier per task? | V12 and V03 propose tiers by context scope; the blueprint adopts "cheapest model above a quality threshold". | The threshold itself must be measured per role. Until then, the routing policy uses conservative defaults. |
| **Q-17** | How does deferred context actually behave? | V10 (16:42) reports a token reduction; the blueprint adopts the mechanism. | The interaction between deferred context and *quality* is unmeasured. Deferred context could reduce cost and also reduce correctness. The blueprint's fresh-context and oracle rules are the mitigation, but the trade-off is unquantified. |
| **Q-18** | How do evers get mined from historical behaviour? | V15 (31:41–32:05) says correctness can be extracted from history rather than written from scratch. | The mechanism for doing so — and its failure rate on a codebase with a poor history — is unspecified. The blueprint's Phase 2 task T2.4 is where this gets built. |
| **Q-19** | What is the real cost of a calibration corpus? | The blueprint calls it "the largest single cost of the roadmap" without a figure. | No figure. It is measured in Phase 2 as the loop's own cost. |
| **Q-20** | Does the panel's aggregation actually predict correctness? | V04's confidence-gated merge (6:18) depends on it; the blueprint measures it (ADR-0011's calibration). | V04 never defines its confidence function, so there is nothing to reproduce — only something to build and then measure. |
| **Q-21** | How do agents handle a task with no clear owner or specification? | The Refinement role escalates. | The corpus says nothing about how often this happens, so the escalation rate is unpredicted. It is one of the workflow's completion criteria to report it. |

---

## 2. Unresolved hypotheses

These are the claims the blueprint acts on but has not verified. They are stated as hypotheses so that a later measurement can refute them.

| ID | Hypothesis | Why the blueprint acts on it | How it could be wrong | Test |
|---|---|---|---|---|
| **H-01** | An agent-independent acceptance oracle can be built for a substantial fraction of real tasks at acceptable cost. | It is the foundation of everything above L2. | If the fraction is small, most tasks fall back to human review and the factory's value collapses to a code generator. | Measure the oracle coverage rate in Phase 1 (metric 17 in `14_...` §8). |
| **H-02** | The fresh-context rule does not materially hurt quality. | It makes cost predictable and enables the chunkability rule. | If dependent stages genuinely need shared context, every dependent edge is a quality risk. | Compare dependent-edge defect rates against a controlled subset in Phase 2. |
| **H-03** | Human review can be reduced to a well-chosen subset without reducing the defect escape rate. | It is what makes the economics work (Q-05). | If the subset misses correlated defects, the escape rate rises even as review volume falls. | The escape rate is tracked against the review volume in Phase 4. This is the decisive test of the whole programme. |
| **H-04** | The panel's confidence correlates with correctness well enough to gate. | It is the mechanism for reducing review at scale. | V04's function is undefined; a poorly-calibrated panel produces confident wrong agreement — the worst outcome. | The calibration measurement (A2.11). |
| **H-05** | A model-tier routing policy can find the cheapest sufficient model per task class. | It is the main cost lever. | The cheapest sufficient model may be task-specific in a way that resists a static policy. | The routing policy's per-class thresholds, tuned from measured data in Phase 4. |
| **H-06** | The context inventory's promotion/demotion cycle keeps the corpus bounded in practice. | Without it, the corpus grows and selection becomes arbitrary. | The inventory's "outdated" detection requires knowing what an item references; implicitly-referenced moving targets are missed. | The duplicate-and-stale count is tracked as a non-increasing metric. |
| **H-07** | The improvement loop produces net-positive changes. | It is the programme's compounding-value mechanism. | It could consume more capacity than it returns, or over-fit the replay set. | The loop's cost accounting against the value of what it promotes (Phase 5). |
| **H-08** | The blast-radius scorer is a good enough proxy for risk to ration review correctly. | It determines the gate set and the review depth. | A systematically under-estimating scorer erodes the governance model silently. | Track predicted against observed tiers; the observed tier is set by the post-hoc defect analysis. |
| **H-09** | Two implementation providers give genuine failover diversity. | NFR-09 requires no dependency on one provider. | If both providers route to the same underlying model family, the diversity is nominal. | The failover test (I-9), plus an inspection of what the fallback actually is. |
| **H-10** | The chunkability rule's fourth condition (cheaper separately than inline) can be judged accurately enough to be useful. | It is the rule that prevents V12's proliferation objection. | It is a judgement call in every case, and it is made by a model. | The recorded justifications are audited against outcomes. |
| **H-11** | The team will sustain the oracle-first discipline under schedule pressure. | Everything depends on it. | It is the most likely single point of failure in the programme. | Track the same-run-authored oracle rate — it is a direct measure of whether the discipline holds. |
| **H-12** | Default-deny egress can be maintained without excessive friction. | It is the exfiltration control. | The friction accumulates and the allow-lists grow. The allow-list size is the leading indicator. | Report the allow-list size and the number of additions per month. |

---

## 3. The risk register

Likelihood and impact are the blueprint's judgement. "Impact" means impact on the programme's ability to deliver a working factory.

### 3.1 Programme risks

| ID | Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| **R-01** | **The oracle-first discipline is abandoned.** The schedule pressure is real, the discipline is expensive, and writing the test first feels backwards to a team used to writing code first. | **High** | **Critical** | Make the oracle cheap (deterministic generators). Make its cost visible as a metric. Enforce the ordering mechanically, not by exhortation: the oracle's provenance records a null implementation run at construction, and the merge gate rejects a same-run-authored oracle. | **Medium.** This is the highest-probability programme failure and it is the one the blueprint can least fully prevent — the enforcement is mechanical but the *pressure* is organisational. |
| **R-02** | **The calibration corpus is never funded.** It is unglamorous, ongoing, and nobody's headline deliverable. | **High** | High — autonomy is capped at L2 forever, and the programme's ceiling is permanently lowered. | Assign a named owner in Phase 1. Mine the repository's existing fix history — the corpus largely already exists. Make calibration currency a reported metric with a threshold. | Medium |
| **R-03** | **Review capacity saturates.** | **High** | High — the system stalls, and the pressure to loosen the gate appears. | Measure review capacity from day one. Ration by blast-radius tiering. When the queue saturates, the response is to reduce scope or fix the workflow — **never** to loosen the gate. Monitor the rubber-stamp rate as the leading indicator of a gate that has stopped working. | High — this is the corpus's own central finding (CP-7) and the blueprint mitigates but does not solve it. |
| **R-04** | **The measurement layer is under-built** because it is not visibly valuable. | Medium | **Critical** — calibration, replay, promotion, cost attribution, and the improvement loop all become unbuildable. | ADR-0011 makes it a Phase 0 deliverable. Every component writes its own artefact slice as a by-product of its work. | Low |
| **R-05** | **The value proposition turns out to be weak** (Q-05). Agent throughput is high; accepted throughput is barely better. | Medium | **Critical** — the programme has failed its purpose even if the technology works. | Measure accepted throughput from Phase 1, not from Phase 4. Be willing to report a negative result. | Medium — this is an honest risk, not a design defect. The blueprint's value is reliability, not throughput, and if reliability is not valued the programme is misaligned. |
| **R-06** | **A workflow is promoted too early.** | Medium | High — a defect escapes and the promotion is retroactively wrong. | The calibration bar and the escape-rate threshold are gates, not guidance. Promotion is a reviewed change. Revocation is a normal path, not a crisis. | Low |
| **R-07** | **Infrastructure creep.** A broker, a Kubernetes cluster, a vector store, a workflow engine appear "just for this one thing". | Medium | Medium — the operational burden exceeds what a small team can carry, which is precisely what the directive warns against. | ADR-0012's deferral triggers are measured, not scheduled. Adding any of them requires demonstrating the trigger. | Low–Medium |
| **R-08** | **The factory is built and not used.** | Low–Medium | **Critical** | The operational surface is built in Phase 0, not last. The factory must be the default path for eligible work. Measure the fraction of eligible work that flows through it (Q-14). | Medium |
| **R-09** | **A single provider failure or a provider-behaviour change** degrades the factory. | Medium | Medium | Two providers from the start; provider-independent interfaces; replay evaluation detects quality changes; the routing policy is configuration. | Low |
| **R-10** | **The scope grows faster than the team's ability to maintain it.** More workflows, more skills, more context, more policies. | Medium | Medium | The context inventory tracks corpus growth; the duplicate-and-stale count must be non-increasing; each new workflow starts at L2 and must earn its way. | Medium |

### 3.2 Security risks

| ID | Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| **R-11** | **Prompt injection succeeds.** | Medium | **Critical** — an agent performs an action on an attacker's behalf. | Structural, not probabilistic: untrusted content is tagged at ingest and is never instruction-bearing; the agent can only *propose*; every consequential action is policy-checked; irreversible effects need a human who sees the raw content. The red-team suite (15 attacks) is a required check. | Medium — the residual is a *within-scope but wrong* action, which the review gate catches. A fully novel injection that produces an in-scope action is the residual risk. |
| **R-12** | **A compromised dependency.** | Medium | **Critical** — code runs inside a task's environment with credentials. | T2/T3 isolation, default-deny egress, per-task scoped credentials, image pinning by digest, lockfiles, dependency review by criticality tier. | Medium |
| **R-13** | **A credential leaks.** | Low–Medium | **Critical** — the blast radius reaches every system the credential touches. | Ephemeral, per-task, least-privilege, brokered credentials; never in context, prompt, arguments, results, or artefacts; revoked at task end; the leak check scans all of those. | Low |
| **R-14** | **The network allow-list grows into a permissive one.** | **High** | High — the exfiltration control quietly disappears. | Per-capability rather than per-host allow-lists; every addition is a security-relevant reviewed change; the allow-list size is a reported metric. | Medium |
| **R-15** | **An insider uses the control surface to widen permissions.** | Low | High | ADR-0001's read-and-request rule; definition changes are reviewed; the audit trail reconstructs every action; the audit reconstruction tool is built in Phase 3. | Low |
| **R-16** | **Untrusted-content tagging is missed at one ingest path.** | Medium | High — a hole in the injection defence. | The trust classification is a required field of the adapter contract, so an adapter without one is a registration error rather than a silent omission. | Low–Medium |
| **R-17** | **A gate is bypassed under pressure** (a CI config change disables a failing check). | Medium | **Critical** — the safety property silently disappears. | Gate weakening is itself R3 and requires security-scope approval; bypass attempts are security events; the gate's own health is tracked (a gate that never fails is suspect). | Low–Medium |

### 3.3 Operational risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R-18** | **The control plane becomes a single point of failure.** | Low | High | Durable transactional store; stateless data-plane workers; recovery by replay; managed-service replicas. Not eliminated — stated in `07_...` §12. |
| **R-19** | **Environment provisioning becomes the throughput bottleneck.** | Medium | Medium | Warm image pools for T2; hibernation for T3; provisioning time is a measured metric; ADR-0012's Kubernetes trigger watches this. |
| **R-20** | **The event log grows beyond what the relational store can serve.** | Low–Medium | Medium | Partitioning by time and aggregate kind; projections are disposable and rebuildable; ADR-0012's event-streaming trigger watches this. |
| **R-21** | **A bad deployment reaches production.** | Medium | High | Enumerated runbooks with abort conditions; tested rollbacks; canary where supported; post-hoc review; the deployment gate refuses an unenumerated operation. |
| **R-22** | **The drift between the declared definition and reality goes unnoticed.** | Medium | Medium | The applier reconciles and reports; drift is on the operational surface; unresolved drift beyond its window is an alert. |

---

## 4. What would change the blueprint

The directive (§17) forbids leaving critical architectural decisions unexplained. This section is the inverse: the conditions under which the blueprint's decisions should be revisited.

### 4.1 Decisions that would be revisited on evidence

| Decision | Revisited when | Current position |
|---|---|---|
| **The default autonomy level (L2)** | A workflow's verifiers are calibrated and its escape rate is below the threshold | ADR-0003: promotion is earned, revocation is normal |
| **The human review floor** | The calibration evidence exists for a workflow's acceptance criteria | ADR-0003 §3 |
| **The deferred technology profile** (broker, Kubernetes, vector DB, durable execution, event streaming) | The specific measured trigger in ADR-0012 fires | Deferred with triggers, not on a calendar |
| **The layered test strategy** | A repository's properties are almost entirely covered by generated verifiers, or almost entirely require human judgement | ADR-0005: the layering stays; the authorship policy is what changes |
| **The chunkability rule** | Recorded justifications show condition 4 is being misjudged systematically | ADR-0010 |
| **The blast-radius weights** | Observed tiers correlate poorly with observed defects | `13_...` §5.2; the weights are reviewed configuration |
| **The calibration thresholds** | Measured detection and false-positive rates are consistently far from the thresholds | `14_...` §5.4; per-property, reviewed |
| **The improvement loop's batch-evidence threshold** | The loop is too slow to react to genuine rare failures, or too eager | ADR-0007 §4; the threshold is per scope and reviewed |
| **The retention policy** | A compliance requirement is identified (Q-02) | `15_...` §2.5 |
| **The 100-turn default limit** | Observed runs hit the limit while making real progress, or never approach it | ADR-0006 §5; V13's 11:17 |

### 4.2 The three decisions that would require re-deriving the blueprint

These are load-bearing. If one of them turns out to be wrong, the consequences propagate widely.

| Decision | If it is wrong | What changes |
|---|---|---|
| **The authority split (ADR-0004)** — deterministic policy and probabilistic orchestration are separated | If a single component holds both, every safety property in `13_...` becomes aspirational. | The safety architecture is re-derived. This is not a parameter; it is the foundation. |
| **Oracle independence (ADR-0005)** — the acceptance oracle is independent of the implementation | If the oracle cannot be independent, the green signal is meaningless and no autonomy above L2 is defensible. | The autonomy ladder collapses to L2 permanently, or the factory's purpose changes. |
| **The human review floor (ADR-0003)** — human reading of code is mandatory until calibration proves otherwise | If the floor is wrong (either too strict or too lax), the programme's economics or its safety change | The ladder's promotion bar, the review queue's design, and the cost model all change. |

**These three are the ones the downstream agent should not quietly work around.** `17_DOWNSTREAM_BUILD_AGENT_BRIEF.md` §8.2 says the same thing: if you believe one of these is wrong, argue it explicitly.

---

## 5. The evidence gaps, restated as work

The corpus's silence on eleven topics is not a footnote. Each is a place where the blueprint is designing without support, and each needs validation before production deployment.

| Gap | Where the blueprint's answer lives | What must be validated | When |
|---|---|---|---|
| **Prompt injection** | ADR-0004 §4; `13_...` §1.4, §7.7 | The red-team suite must cover the real ingest paths, and the "within-scope but wrong" residual must be quantified | Phase 3, then continuously |
| **Secret management and credential scoping** | ADR-0006 §2; `11_...` §7 | The broker's scope computation must be correct for every capability in the registry; the leak check must run on every stored artefact | Phase 0/1, continuously |
| **Supply-chain security** | `13_...` §7.6 | Image pinning, lockfiles, and provenance signatures must be enforced, not merely present | Phase 3 |
| **Production-access policy** | `13_...` §7.9; SEC-08 | Each enumerated runbook needs its abort condition tested and its rollback drilled | Phase 4 |
| **Approval fatigue** | `13_...` §6.4 | The rubber-stamp rate must be measured against a known-good period to be interpretable | Phase 2, then continuously |
| **Multi-tenancy** | **Not designed** | Q-01 must be decided before Phase 0 | Before Phase 0 |
| **Regulatory / compliance** | `15_...` §2.5; `13_...` §7.8 | Q-02 must be decided before Phase 1 | Before Phase 1 |
| **Cost models at fleet scale** | `15_...` §4 | The cost model must be reconciled with billing within an agreed tolerance | Phase 1, continuously |
| **Formal verification tooling** | `14_...` §2 | Used only where a property is genuinely provable; the boundary is set per repository | Phase 2+ |
| **Rollback and bad-merge recovery** | `13_...` §5.6; SEC-10 | A rollback drill must restore a known-good state within the agreed time | Phase 4 |
| **Drift detection** | `15_...` §8 | Report-then-correct must be verified: an automatic correction of a wrong declaration must be impossible | Phase 3 |

---

## 6. How to keep this document alive

A risk register that is written once and never updated is decoration. This one has a maintenance rule:

| Trigger | Action |
|---|---|
| A risk materialises | Move it to an incident record; update its likelihood; check whether the mitigation worked. |
| A mitigation is shown to be ineffective | Replace it. Do not keep a mitigation that has failed. |
| An open question is answered | Move it to `03_EVIDENCE_LEDGER.md` if it is a finding, or to the ADR if it produced a decision. |
| A hypothesis is tested | Record the result and the sample. A refuted hypothesis is a valuable output. |
| A new capability or adapter is registered | Re-run the threat model review against it (`16_...` §9.3). |
| Any metric in `14_...` §8 crosses its threshold | Review the associated risks here. |

**The test of a good risk register is not that it is complete.** It is that each entry names a mitigation, and each mitigation is verified somewhere in the test suite.

---

## 7. The closing position

The corpus's most striking characteristic is its confidence. Fifteen sources describe working systems with large, specific, confident numbers, and in most cases they do not say how the numbers were measured.

This blueprint takes the opposite position, and it is a deliberate one:

> **The factory's value is that a human can trust what it tells them. That is a property maintained by measurement or destroyed by an unmeasured claim.**

Every number in this blueprint that matters is one the factory will measure for itself. Every gap is named. Every decision that could reasonably have gone another way is recorded as an ADR with its alternatives. And the open questions in §1 — particularly Q-05, on whether agent throughput converts into accepted throughput — are stated plainly because **if the answer is unfavourable, the honest response is to report that, not to explain it away.**

That is the operating philosophy the 1968 definition implies: a computer-controlled programming environment with standardised development tools **and historical information for management and measurement**. The third component is not an accessory. It is what makes the first two trustworthy.

---

## 8. Related documents

- `03_EVIDENCE_LEDGER.md` §4 — the evidence gaps this document restates as work
- `04_CROSS_SOURCE_SYNTHESIS.md` — the disagreements and their recommended resolutions
- `14_QUALITY_TESTING_AND_EVALUATION.md` §8 — the metric catalogue whose thresholds surface these risks
- `16_IMPLEMENTATION_ROADMAP.md` §10 — the programme risks and the phase exit criteria
- `17_DOWNSTREAM_BUILD_AGENT_BRIEF.md` §8.2 — the decisions a downstream agent must not quietly work around
- `architecture-decisions/ADR-0001…0012` — the decisions whose revisit conditions appear in §4
