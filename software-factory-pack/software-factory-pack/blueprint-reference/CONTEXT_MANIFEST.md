# CONTEXT MANIFEST — `blueprint-reference/`

Curated, **verbatim** copies of the blueprint files an implementing agent may need (byte-identical to the originals; verified). Everything else in the original zip is *provenance* (research analyses, source inventory, evidence ledger, synthesis, taxonomy, consistency audit) and is **never loaded by build agents**.

**Tier-0 (load for every ticket):** the six files marked ★ — about 60 KB in total. **Tier-1 (load only when a ticket's `Read:` line names it):** everything else; prefer the cited section over the whole file. A bundle above 120 KB means the ticket is too big or its `Read:` list is sloppy.

Short names used in tickets resolve here: `ADR-00NN` → `architecture-decisions/ADR-00NN-*.md`; a bare blueprint number `09`…`18` → the file with that prefix; `templates/X` → `templates/X.md`.

| Tier | File | Size | Gives you | Load for |
|---|---|---|---|---|
| ★ 0 | `17_DOWNSTREAM_BUILD_AGENT_BRIEF.md` | 23.6 KB | Implementation contract: build order, 12 invariants, must-not-build, rules, failure modes | every ticket |
| ★ 0 | `architecture-decisions/ADR-0003-staged-autonomy-ladder.md` | 6.1 KB | Autonomy L0–L4, human review floor, promotion evidence | every ticket |
| ★ 0 | `architecture-decisions/ADR-0004-authority-split.md` | 6.7 KB | Policy deterministic vs orchestration probabilistic; untrusted-content rule | every ticket |
| ★ 0 | `architecture-decisions/ADR-0005-test-authorship-policy.md` | 6.4 KB | Oracle independence; agent-authored tests untrusted | every ticket |
| ★ 0 | `architecture-decisions/ADR-0011-observability-prerequisite.md` | 6.7 KB | Measurement/run artefacts are a prerequisite, not a feature | every ticket |
| ★ 0 | `architecture-decisions/ADR-0012-mvp-technology-profile.md` | 8.8 KB | Minimal boring stack + deferral triggers | every ticket |
| 1 | `01_EXECUTIVE_VISION.md` | 22.2 KB | Vision and framing | orientation only |
| 1 | `06_REQUIREMENTS_AND_NFRS.md` | 26.6 KB | The 99 requirements (FR/NFR/SEC/MEAS) — coverage matrix source | T-0.02 (coverage-check), T-6.06 |
| 1 | `07_REFERENCE_ARCHITECTURE.md` | 59.5 KB | Components, planes, data ownership, security boundaries, technology profile | component tickets |
| 1 | `08_AGENT_CATALOG_AND_CONTRACTS.md` | 33.3 KB | Roles, agent contract, failure taxonomy, routing | T-1.13, T-2.05–2.14 |
| 1 | `09_ORCHESTRATION_STATE_AND_EVENTS.md` | 26.7 KB | State machines, event envelope/vocabulary, durability, task graph, runtime | T-1.01–1.04, T-1.07, T-1.13, T-2.08 |
| 1 | `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md` | 39.4 KB | Context assembler, skills, prompt structure, memory classes | T-2.01–2.03, T-2.18, T-5.04 |
| 1 | `11_TOOLS_MCP_AND_INTEGRATIONS.md` | 41.5 KB | Capability registry, broker order, credentials, model gateway, environments | T-1.08–1.10, T-3.01 |
| 1 | `12_END_TO_END_WORKFLOWS.md` | 50.3 KB | Workflows A–G in detail | T-2.04–2.06, T-2.19, T-5.01–5.03 |
| 1 | `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` | 43.5 KB | Threat model, access points, blast radius, approvals, secrets, supply chain | T-1.05, T-2.09, T-2.10, T-2.16, T-3.x |
| 1 | `14_QUALITY_TESTING_AND_EVALUATION.md` | 37.6 KB | Oracle, gates, calibration, metrics catalogue, red-team suite | T-2.07, T-2.13, T-4.x, T-3.02 |
| 1 | `15_OBSERVABILITY_COST_AND_FEEDBACK.md` | 34.2 KB | Run artefact, telemetry/projections, cost model, feedback loops | T-1.11, T-1.15, T-4.01, T-4.05 |
| 1 | `16_IMPLEMENTATION_ROADMAP.md` | 44.9 KB | Original 30-week roadmap with A-series acceptance criteria (source of A0.x…A4.x) | T-1.17, T-2.19, gates |
| 1 | `18_OPEN_QUESTIONS_AND_RISKS.md` | 31.4 KB | Risk register R-01…R-22, hypotheses H-01…H-12, open questions | weekly checkpoint, PRR |
| 1 | `GLOSSARY.md` | 24.6 KB | Terms | when a term is unclear |
| 1 | `architecture-decisions/ADR-0001-declarative-factory-definition.md` | 4.1 KB | Declarative definition, applier, drift | T-1.06, T-1.14 |
| 1 | `architecture-decisions/ADR-0002-control-plane-data-plane.md` | 4.9 KB | Two planes, six access points | T-1.14, T-2.10 |
| 1 | `architecture-decisions/ADR-0006-isolation-tiers.md` | 6.6 KB | T1/T2/T3, credential scoping | T-1.09, T-1.12, T-2.10 |
| 1 | `architecture-decisions/ADR-0007-factory-change-through-review.md` | 6.2 KB | Factory changes only via reviewed change | T-1.06, T-5.05 |
| 1 | `architecture-decisions/ADR-0008-workflow-state-and-event-log.md` | 8.6 KB | Event-sourced state, relational queue | T-1.02–1.04, T-1.07 |
| 1 | `architecture-decisions/ADR-0009-context-two-tier.md` | 5.6 KB | Central vs local context | T-2.01, T-2.02, T-5.04 |
| 1 | `architecture-decisions/ADR-0010-agent-topology.md` | 7.5 KB | Roles are specs; sequential fresh-context workers | T-2.05–2.14 |
| 1 | `templates/ADR.md` | 12.3 KB | ADR template | any new ADR |
| 1 | `templates/AGENT_SPEC.md` | 8.6 KB | Role spec template | role YAMLs |
| 1 | `templates/EXPERIMENT.md` | 14.6 KB | Experiment template | post-v1 evaluation |
| 1 | `templates/MCP_INTEGRATION.md` | 14.7 KB | MCP/integration template | T-1.08 |
| 1 | `templates/SKILL_SPEC.md` | 10.0 KB | Skill spec template | T-2.02 |
| 1 | `templates/WORKFLOW.md` | 19.2 KB | Workflow definition template (source of the slim kind in 03 §4.2) | T-2.19, T-5.x |

**Tier-0 total:** 58 KB · **Reference set total:** 697 KB · files: 33.

**Not included (stay in your original zip):** `README.md`, `00_START_HERE.md`, `02_SOURCE_INVENTORY.md`, `03_EVIDENCE_LEDGER.md`, `04_CROSS_SOURCE_SYNTHESIS.md`, `05_CONCEPT_TAXONOMY.md`, `19_CONSISTENCY_AUDIT.md`, `research/V01…V15_analysis.md`.

**Blueprint inconsistency noticed while building the pack:** the roadmap (16, deliverable 0.3) says "the 20 states"; the state machine in 09 §2.1 lists **19** and is authoritative.
