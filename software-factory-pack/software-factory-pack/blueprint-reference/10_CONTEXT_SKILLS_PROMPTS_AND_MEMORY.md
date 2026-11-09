# 10 — Context, Skills, Prompts and Memory

**Purpose:** how the factory decides *what an agent knows* at the moment it acts — the context model, the skill corpus, the context assembler, prompt construction, and the four memory classes.

**Source of truth for:** the context item schema, the skill schema, the assembler algorithm, the prompt structure, and the memory classification.
**Derived from:** ADR-0004, ADR-0007, ADR-0009, ADR-0010, ADR-0011, `06_REQUIREMENTS_AND_NFRS.md` (FR-10…FR-16, FR-80…FR-82), V08, V10, V13, V15.

**Critical framing.** This document is about **selection and provenance**, not about storage technology. Where the corpus specifies a *mechanism* (markdown files in a repository, a central skills registry), this blueprint adopts the *property* that mechanism provides — reviewability, versionability, diffability — and specifies it behind an interface (ADR-0012).

---

## 1. The context problem, stated precisely

The corpus's central disagreement about context (ADR-0009, `04_CROSS_SOURCE_SYNTHESIS.md` D-4) is a disagreement about *placement*. It is not a disagreement about *quantity*. Three separate findings converge on a quantity constraint:

- **V10 (16:42):** deferred context — a tool's full definition is not loaded until the tool is selected.
- **V10 (13:03):** sequential workers with **fresh context** — a shared context across dependent stages is a liability.
- **V08 (29:15):** the factory's context is markdown files; the load is the file, not the corpus.

And one finding converges on a quality constraint:

- **V15 (42:16):** "specificity is the ruler of quality" — a vague instruction is not better than no instruction.
- **V01 (24:24):** "no one who has finished" — the oracle is the specification, not the implementation.

### 1.1 The four principles

| # | Principle | Consequence in this document |
|---|---|---|
| **C1** | Context is **selected**, never maximal. | The assembler has a budget and fails rather than truncating (§5.4). |
| **C2** | Context is **pinned** per run. | Every run records the resolved context (§5.6). |
| **C3** | Context is **authority-bearing** and therefore **privilege-bearing**. | Context that changes what an agent may do is security-relevant (§2.4). |
| **C4** | Context is **two-tiered** with deterministic precedence. | Repository-local by default; central for organisation-wide policy (§3). |

### 1.2 What context is *not*

Context is not:

- a transcript of prior runs (that is a **run artefact**, §7.1);
- a memory of what the agent learned about a specific codebase (that is **knowledge**, §7.3, or **repo-local context**, §3);
- a place to put facts the agent should have derived from its tools (§4.2 — the "derive, do not inject" rule).

---

## 2. The context item model

### 2.1 The unit

A **context item** is the smallest independently versioned, independently provenance-recorded unit of context. Every item has an identity, a version, a content hash, a provenance record, and a trust classification.

```yaml
apiVersion: factory/v1
kind: ContextItem
metadata:
  id: skill.backend-conventions
  version: "7"
  sha256: "9f2c...e1"
  tier: central            # central | local
  scope:                   # where it applies
    repositories: ["org/*"]
    paths: ["services/**"] # optional path narrowing
  kind: standard           # standard | procedure | policy | reference | context
  provenance:
    authoredBy: "human:alice"
    reviewedBy: ["human:bob", "verifier:skill-lint@2"]
    sourceRepository: "org/factory-definition"
    sourcePath: "skills/backend-conventions.md"
    introducedBy: "chg_01JCZ8M..."
    firstSeen: "2026-08-14T10:02:11Z"
  trust:
    classification: trusted        # trusted | untrusted-content | derived
    privileged: false               # true ⇒ security-relevant review class
  integrity:
    signature: "sig:..."            # provenance signature
    verifiedAt: "2026-11-01T08:00:00Z"
  supersedes: "skill.backend-conventions@6"
  obsoletedBy: null
metadata_links:
  relatedSkills: ["skill.data-migrations", "skill.api-design"]
  seeAlso: ["adr:ADR-0009"]
```

### 2.2 Required fields and why each exists

| Field | Required | Reason |
|---|---|---|
| `id` | Yes | Stable identity across versions; the key used in the run's context manifest. |
| `version` | Yes | Pinning. A run must be reproducible against a known context state. |
| `sha256` | Yes | Integrity. SEC-09 requires integrity checking; a changed file must be detectable. |
| `tier` | Yes | Determines precedence (ADR-0009 §2). |
| `scope` | Yes | The assembler must know *when* an item applies, or it will over- or under-select. |
| `kind` | Yes | Determines selection strategy (§4.3) and whether the item is a skill or plain context. |
| `provenance` | Yes | SEC-09; ADR-0004's requirement that authority-bearing artefacts be attributable. |
| `trust.classification` | Yes | ADR-0004 §4. Untrusted items are quarantined. |
| `trust.privileged` | Yes | Marks items that alter permitted behaviour; triggers the elevated review class (FR-16). |

### 2.3 Trust classification

| Classification | Meaning | Handling |
|---|---|---|
| `trusted` | Authored or reviewed within the trusted boundary; content is instruction-bearing and may be acted upon. | Assembled normally. |
| `untrusted-content` | Originates outside the trusted boundary: issue text, PR descriptions, code comments, documentation, web pages, dependency files, external tool output. | Assembled inside a **marked envelope** (ADR-0004 §4). May be quoted, analysed, summarised. **Never instruction-bearing.** |
| `derived` | Produced by the factory itself from trusted sources: a summarisation, an extraction, an index. | Assembled normally, but marked as derived so that provenance is not overstated — a derived item is only as good as its source's trust. |

**The `untrusted-content` classification is applied at ingest, not at read.** Every external fetch path — issue tracker, web, package registry, tool output — tags on entry. If an item could reach an agent untagged, the boundary is broken.

### 2.4 Privileged context

A context item is **privileged** if it changes what an agent is permitted or instructed to do. Examples: a skill that says "always run the deployment command", a local file that grants a tool scope, a standard that says "skip the review gate for changes under ten lines".

Privileged context:

1. cannot be authored or modified by an agent (SEC-11);
2. requires the **elevated review class** — the same bar as a policy change (FR-16);
3. is recorded in the audit trail with its provenance;
4. is subject to the integrity check on every load.

**Rationale.** A prompt that says "run this command" is a capability grant written in English. If privileged context can be modified by any party with write access to a repository, the capability grant is unauditable. This is [E3] engineering judgement; no source in the corpus addresses it.

---

## 3. The two-tier context model

Per ADR-0009, the partition rule is:

> Context whose truth is a property of the repository lives in the repository. Context whose truth is a property of the organisation lives centrally.

### 3.1 Tier comparison

| | Repository-local tier | Central tier |
|---|---|---|
| **Storage** | Versioned in the repository, alongside the code | Central context store + registry index |
| **Change path** | Ordinary pull request against the code | Definition change with elevated review |
| **Review** | Code review, by the repository's owners | Policy-class review, by the platform owners |
| **Examples** | Build/test commands, code conventions, architecture notes, domain vocabulary, local runbooks, repo-specific verification expectations | Security and compliance policy, organisation-wide standards, shared integration contracts, approved skill library, engineering knowledge, mandatory per-repository context requirements |
| **Failure mode** | Drifts from code — but visibly, as a diff | Drifts from code — silently. Mitigated by the inventory (§6) |

### 3.2 Precedence

Resolved by the assembler, deterministically, in this order:

1. **Central security and compliance policy always wins.** A repository cannot override it. This is the explicit, deliberate exception to locality.
2. **Otherwise, repository-local overrides central** for repository-scoped concerns.
3. **Neither covers the concern** → the stage proceeds under the general agent policy and the gap is **flagged** (it becomes an inventory finding and a candidate promotion).

```
        ┌─────────────────────────────────────────────┐
        │  Central security & compliance policy        │  ← always wins
        │  (non-overridable by any repository)          │
        └─────────────────────────────────────────────┘
                          │  higher priority
        ┌─────────────────────────────────────────────┐
        │  Repository-local context                   │  ← wins for repo scope
        └─────────────────────────────────────────────┘
                          │  higher priority
        ┌─────────────────────────────────────────────┐
        │  Central context (standards, contracts)     │
        └─────────────────────────────────────────────┘
                          │
        ┌─────────────────────────────────────────────┐
        │  General agent policy  (+ gap flag)         │  ← fallback
        └─────────────────────────────────────────────┘
```

### 3.3 Promotion and demotion

Both are **reviewed operations**, surfaced by the inventory, and never automatic:

| Direction | Trigger | Effect | Approval |
|---|---|---|---|
| **Promotion** (local → central) | The inventory detects the same artefact in ≥N repositories, or a reviewer proposes it. | The local artefact becomes a pointer to the central one. The central copy is created and reviewed. | Definition change, standard class |
| **Demotion** (central → local) | The inventory detects that a central artefact's scope is narrower than declared, or a repository owner reports it as inapplicable. | The central artefact is scoped down or moved; affected repositories receive a local copy. | Definition change, standard class |

The local copy becoming a *pointer* (not a deletion) means the promotion is visible in the repository's own diff — the property that makes repository-local context trustworthy.

---

## 4. The skill corpus

### 4.1 What a skill is

V15 distinguishes two things that are often conflated. This blueprint adopts the distinction:

| | **Skill (procedure)** | **Standard (constraint)** |
|---|---|---|
| **Purpose** | Describes *how to do* something — a repeatable process with steps. | Describes *what must be true* — a property to adhere to. |
| **Contains** | Ordered steps, inputs, outputs, tools used, failure handling, completion criteria. | Rules, invariants, prohibited patterns, required properties, and — where derivable — a machine-checkable verifier. |
| **Executable?** | Executed as a workflow stage. | **Not** executed. It is *consulted* by a stage and, optionally, *checked* by a generated verifier. |
| **Example** | "Migrating a database schema" (procedure). | "All SQL parameters must be bound, never interpolated" (constraint). |

Both are stored as context items of kind `procedure` or `standard`. The distinction determines how the assembler selects them and whether a verifier can be generated from them.

### 4.2 The skill schema

```yaml
apiVersion: factory/v1
kind: Skill
metadata:
  id: skill.data-migrations
  version: "4"
  owner: platform-data
  kind: standard            # standard | procedure
  appliesTo:
    paths: ["services/**/migrations/**"]
    repositories: ["org/*"]
    taskTypes: ["change", "incident"]
  body:
    format: markdown
    contentRef: "skills/data-migrations.md"   # content is versioned, not inlined
  # For a standard: the checkable properties
  properties:               # present only for kind: standard
    - id: prop.no-interpolated-sql
      statement: "SQL statements must use bound parameters; string interpolation of values is prohibited."
      severity: error
      verifier:
        kind: static-rule
        generator: verifier.sql-parameterization@2
        calibrationStatus: calibrated
        detectionRate: 0.93        # from the calibration corpus (FR-57)
  # For a procedure: the steps
  steps:                    # present only for kind: procedure
    - id: s1
      instruction: "Produce a forward-only migration; never mutate an applied migration."
      tools: ["repo.read", "db.migrate.local"]
      produces: ["migration.sql"]
  inputs:
    - name: schemaDiff
      type: artefact
  outputs:
    - name: migration
      type: artefact
  relatedSkills: ["skill.sql-conventions"]
  trust:
    classification: trusted
    privileged: true
  evaluation:
    benchmark: "bench.data-migrations@1"
    lastCalibrated: "2026-09-30"
```

### 4.3 The derive-don't-inject rule

**A skill states a property; it does not restate a fact the agent can derive.** V15's "specificity is the ruler of quality" (42:16) is applied as a drafting rule with a mechanical test:

> **Derive-don't-inject test.** If the agent, given the skill and its tools, could compute the fact in one step, the fact does not belong in the skill.

| Bad skill text (injects a derivable fact) | Good skill text (states a property) |
|---|---|
| "The API base URL is `https://api.internal/v2`." | "The API base URL is read from the environment variable `API_BASE_URL`; never hard-code it." |
| "The `orders` table has 14 columns." | "Schema shape is discovered via the repository's schema definitions; never assume column names." |
| "Run `pnpm test` to run tests." | "The test command is defined by the repository's `package.json` `test` script; do not assume a package manager." |

The right-hand column is also the version-stable one — it survives the fact changing, and the version bump is not required.

### 4.4 Skill quality rules

| Rule | Test | Source |
|---|---|---|
| **Specificity** | Every instruction names a concrete artefact, command pattern, or property. No "handle errors appropriately". | V15 42:16 |
| **Single purpose** | A skill expresses one procedure or one standard. A skill that needs "and" is two skills. | [E3] |
| **Verifiable where possible** | A standard states at least one checkable property, or explicitly records that it is not mechanisable and why. | V15 28:49–30:10 |
| **No ambient authority** | A skill cannot grant capability. It may *request* a tool; the policy engine decides. | ADR-0004 |
| **No duplicate truth** | A fact stated in two skills is a defect; one must point to the other. | V15 22:51–24:20 |
| **No stale reference** | Every referenced skill, file, or endpoint resolves at load time. | V15 22:51–24:20 |
| **Bounded size** | A skill that exceeds the per-item context budget is split. | C1, ADR-0010 §4 |

### 4.5 Skill lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT: authored
    DRAFT --> VALIDATED: schema, references, property checks pass
    DRAFT --> REJECTED: validation failed
    VALIDATED --> PROPOSED: submitted as a change
    PROPOSED --> EVALUATED: batch evidence + benchmark run
    EVALUATED --> APPROVAL: evaluation passed
    EVALUATED --> REJECTED: regression or guardrail breach
    APPROVAL --> ACTIVE: merged and applied
    APPROVAL --> REJECTED: reviewer refused
    ACTIVE --> DEPRECATED: superseded
    DEPRECATED --> [*]
    ACTIVE --> PROPOSED: improvement proposal from batch evidence
```

**Lifecycle rules.**

1. A skill is **never applied directly by a running agent**. The meta-factory proposes; the review path applies (ADR-0007 §1).
2. The `EVALUATED` step requires **batch evidence** across ≥N runs (FR-93). A proposal derived from a single run is rejected as noise-fitting — and as a defence against a single poisoned run manipulating the factory (ADR-0007 §4).
3. The `ACTIVE` skill is pinned by version in every run that uses it; a run does not silently pick up a newer skill.
4. A skill that is **deprecated** is not deleted; the pointer remains so that historical runs remain reproducible.

### 4.6 The improvement loop (outer loop)

Per FR-90 and ADR-0007, the outer loop improves a skill from batch evidence:

```
1. SELECT   → collect the run set (≥N runs) in the target class
2. ANALYSE  → classify failures; find the dominant pattern
3. ATTRIBUTE→ determine the layer: skill / workflow / harness / model / policy
4. PROPOSE  → emit a structured change proposal (evidence + effect + measurement + rollback)
5. EVALUATE → benchmark the candidate against the run set
6. REVIEW   → human review at the scope's approval class
7. APPLY    → merge the change; the applier reconciles
8. OBSERVE  → measure over the observation window
9. PROMOTE  or  ROLLBACK
```

**Attribution rule.** A pattern must be attributed to the *narrowest* layer that explains it. A pattern of `context.insufficient` failures on tasks touching one adapter is a **skill** problem if the skill exists and was not selected; it is a **context trigger** problem if no such skill exists; it is a **harness** problem if the trigger evaluator is broken. The loop stops at the narrowest layer that explains the evidence.

### 4.7 The meta loop (harness scope)

Per FR-91, the meta loop proposes changes to the harness itself — agent configuration, tool surface, model routing, context assembly, policy.

| Property | Requirement |
|---|---|
| Evidence | Systemic analysis over a long window. A single-run pattern is insufficient for harness scope (ADR-0007 §3). |
| Evaluation | Full replay evaluation against the historical run set, plus an explicit experiment design (ADR-0011 §3: baseline, delta, cost, guardrail). |
| Approval | **Human review required, always** (ADR-0007 §3). |
| Rollback | Automatic on guardrail breach within the observation window. |

**The meta loop is not permitted to write to the harness.** It emits a proposal that enters the same reviewed-change path as any other change. There is no privileged path (ADR-0007 §6).

---

## 5. The context assembler

### 5.1 Purpose and placement

The **context assembler** is a deterministic control-plane component. It computes the effective context for a stage. Its output is a **context envelope**: a pinned, ordered, size-bounded set of context items with their trust classifications.

It is deterministic by ADR-0009 §3: a pure function of (central policy, central context at applicable scope, repository-local context, task type, task inputs, stage specification).

### 5.2 The interface

```
resolve(stageSpec, taskInputs, repoScope) -> ContextEnvelope
```

| Input | Source |
|---|---|
| `stageSpec` | The node specification from the task graph (`09_ORCHESTRATION_STATE_AND_EVENTS.md` §7) |
| `taskInputs` | Upstream artefacts (if a dependent edge), and the task's own inputs |
| `repoScope` | Repository identity, path scope, task type |

| Output field | Meaning |
|---|---|
| `envelopeId` | Unique identity of this resolved envelope |
| `items[]` | Ordered list of resolved context items with id, version, sha256, trust, byte size |
| `resolvedContextSha256` | Hash over the ordered item list — the single value recorded in the event envelope |
| `truncations[]` | Items **excluded** by the budget, with the reason — so exclusion is visible, not silent |
| `gaps[]` | Concerns no context covered (precedence rule 3) |
| `budget` | The budget applied and the usage against it |

### 5.3 The algorithm

```mermaid
flowchart TD
    IN["stageSpec, taskInputs, repoScope"] --> T1["1. Apply central policy<br/>filter: privileged items only<br/>from the policy tier"]
    T1 --> T2["2. Select candidates<br/>by appliesTo (paths, repos, taskType)"]
    T2 --> T3["3. Apply precedence<br/>central security > local > central > policy"]
    T3 --> T4["4. Classify trust<br/>tag untrusted, mark derived"]
    T4 --> T5["5. Select by kind<br/>standards → property set; procedures → steps"]
    T5 --> T6["6. Order<br/>policy, then standards, then procedures,<br/>then reference, then local context"]
    T6 --> T7["7. Defer<br/>full tool defs & long refs → deferred refs"]
    T7 --> T8["8. Budget check"]
    T8 -->|"within budget"| OK["ContextEnvelope"]
    T8 -->|"exceeds budget"| T9["8a. Re-select by<br/>relevance score"]
    T9 --> T8
    T8 -->|"still exceeds"| FAIL["FAIL with context.budget_exceeded<br/>(never truncate silently)"]
```

### 5.4 The budget rule

**If the resolved envelope exceeds the configured budget, the stage fails with `context.budget_exceeded`.** It does not truncate.

This is the single most important rule in this document, because it is the difference between a factory that fails loudly and one that produces confident wrong output. Truncation produces an envelope that looks complete and is not; the agent then reasons from a partial picture and produces output that satisfies its (mis)understanding. The failure is silent, and it is the failure mode ADR-0011 and the calibration harness exist to detect.

The rejection is recoverable by design: the failure classification is `context.insufficient`, the remediation is to fix the context sources or the trigger evaluator, and the improvement loop treats it as a skill-scope signal (§4.6).

**Sizing.** The budget is expressed in bytes of content, not tokens, because tokenisation varies by provider and the budget must be provider-independent (NFR-09). A token estimate is derived for the model in use, but the *decision* is made in bytes.

### 5.5 Deferred context

Per V10 (16:42): the full definition of a tool or a long reference is **not** part of the initial envelope. Instead:

- the envelope carries a **deferred reference**: an identifier, a summary, and a retrieval handle;
- the agent requests the full content when it selects the item;
- the retrieval is itself a governed tool call — it is logged, and it may be denied if the item's scope does not permit it.

Deferred references are how the envelope stays within budget as the corpus grows, without any loss of capability: the agent has the *index* at all times and the *content* on demand.

### 5.6 Determinism and pinning

| Property | Mechanism |
|---|---|
| **Determinism** | Same inputs → same envelope. The assembler is a pure function; it holds no hidden state. |
| **Pinning** | Every item carries its resolved version; the envelope records the version list. |
| **Immutability during a run** | A context item's *version* is fixed for the run's duration. A new version published mid-run does not alter the running stage. |
| **Reproducibility** | `resolvedContextSha256` is written to the event envelope, so the exact context of any run is recoverable. |
| **Auditability** | The envelope is an artefact; a reviewer can see precisely what the agent was told. |

The pinning rule is what makes ADR-0009's "runtime-fetched context with no version pinning" rejection hold: a context change must not silently alter the behaviour of an in-flight task.

### 5.7 Ordering

The order of items in the envelope is deterministic and **significant**, because position in a prompt affects attention:

1. **Policy and authority** — what the agent may do, and the trust rules it must apply.
2. **Acceptance criteria and the oracle reference** — what "done" means. Placed early because V01's finding is that the oracle, not the implementation, defines the task.
3. **Applicable standards** — the properties the change must satisfy, with their verifier references.
4. **Procedure steps** — how to do the work.
5. **Repository-local context** — build/test commands, conventions, architecture notes.
6. **Reference material** — deferred references, external documentation pointers.
7. **Untrusted content** — always **last**, in a marked envelope, never above any trusted item.

**Untrusted content goes last, always.** This is defence in depth within the prompt: even though the deterministic boundary is what actually prevents injection (ADR-0004 §4), placing untrusted material at the end reduces the chance of it occupying a high-attention position.

---

## 6. The context inventory

Per FR-14 and ADR-0009 §4, the inventory is the mechanism that keeps the corpus honest. It is a background scan, not an agent.

### 6.1 What it detects

| Finding | Definition | Severity | Remediation |
|---|---|---|---|
| **Outdated** | The item's referenced artefact has changed since the item was written (file modified, endpoint changed, dependency version moved). | Warning | Propose an update. |
| **Duplicate** | Two items assert the same fact or the same property. | Warning | Merge; one becomes a pointer. |
| **Stale** | The item has not been used in the observation window, and its subject has changed. | Info | Deprecate. |
| **Orphaned reference** | The item references a skill, file, or endpoint that no longer resolves. | Error | Fix or remove. |
| **Unclassified** | An item exists but has no `kind`, no `scope`, or no owner. | Error | Classify. |
| **Privileged-unreviewed** | A privileged item is in use but has not passed the elevated review class. | **Error** | Suspend use. |
| **Scope mismatch** | A central item's declared scope does not match its observed usage. | Warning | Demote or re-scope (ADR-0009 §4). |

### 6.2 The tracked metric

The count of `duplicate` and `stale` findings is **tracked over time and must be non-increasing**. This is ADR-0009's validation criterion, and it is the metric that distinguishes a maintained context corpus from an accumulating one.

A context corpus that only grows is a liability: it raises the selection problem, it dilutes attention, and it eventually makes selection arbitrary. The inventory plus the promotion/demotion cycle is what keeps it bounded.

### 6.3 The inventory is deterministic

The scan is code, not an agent. An agent may *interpret* a finding and propose a fix; it may not generate the finding list. This preserves the same split of authority as ADR-0004.

---

## 7. Memory: four classes

The word "memory" is used loosely in the corpus to mean several different things. The blueprint separates them, because they have different lifetimes, different owners, and different deletion rules.

```mermaid
graph TB
    subgraph Class1["Class 1 — Run artefacts"]
        A1["Per-run record<br/>prompts, tool calls,<br/>verification, artefacts, cost"]
        A2["Immutable, append-only<br/>Retention: policy-driven"]
    end
    subgraph Class2["Class 2 — Context & skills"]
        A3["Versioned, reviewable<br/>Repository-local + central"]
        A4["Pinned per run<br/>Promotion/demotion cycle"]
    end
    subgraph Class3["Class 3 — Knowledge"]
        A5["Decisions, rationale,<br/>outcomes, glossary"]
        A6["Retrievable, linked to change<br/>Authored by humans + extracted"]
    end
    subgraph Class4["Class 4 — Local repo context"]
        A7["Build commands, conventions,<br/>architecture notes, vocabulary"]
        A8["Versioned with the code<br/>Reviewed as code"]
    end
```

### 7.1 Class 1 — Run artefacts

| Attribute | Specification |
|---|---|
| **Content** | Inputs, resolved context manifest, model/harness/config versions, every tool call (arguments summary, result summary, duration, cost), prompts and generated text (retention-policy subject), verification results per layer, produced artefacts with hashes, outcome, approval, authority, token counts, cost. |
| **Owner** | The runtime (framework-emitted, never agent-reported — MEAS-02). |
| **Lifetime** | Immutable; append-only. Retention by class. |
| **Consumers** | Replay evaluator, calibration harness, improvement loops, audit, humans. |
| **Write rule** | Written by the framework as a by-product of execution, in the same transaction as the outcome. |

**This class is the substrate for every measurement in the blueprint.** ADR-0011 makes it a prerequisite, and it is the reason the run-artefact store is Phase 1 work, not Phase 3.

### 7.2 Class 2 — Context and skills

The versioned corpus of §3–§4. Distinguished from Class 1 by being **reused across runs** rather than describing one run.

### 7.3 Class 3 — Knowledge

The engineering knowledge store: decisions, rationale, trade-offs, outcomes, glossary, and the answers to "why is it like this".

| Attribute | Specification |
|---|---|
| **Content** | A decision record: context, options considered, decision, rationale, consequences, the change that implemented it, the outcome once known. |
| **Origin** | Authored by humans; **extracted** from merged changes by a deterministic workflow step. Extraction is not judgement, so it is not an agent role (§`08` §3 — the Knowledge agent was excluded for this reason). |
| **Retrieval** | Searchable by topic, component, and linked change. |
| **Linkage** | Every record links to the change it describes and, where it exists, the ADR that produced it. |
| **Ownership** | Engineering leadership; changes are reviewed like any other change. |

**Class 3 is not a vector store.** ADR-0012 rejects a vector database as a dependency: approximate retrieval must never be authoritative. Knowledge retrieval is keyword- and structure-based (topic, component, change link, time). Semantic similarity may be offered as a *ranking signal* over a keyword-filtered candidate set, never as the retrieval mechanism itself.

### 7.4 Class 4 — Local repository context

Repository-local context: build and test commands, conventions, architecture notes, ADRs, domain vocabulary, local runbooks, repo-specific verification expectations. Versioned with the code and reviewed as code (ADR-0009).

### 7.5 The classification test

When deciding which class an artefact belongs to:

> **Does it describe one execution, is it reused across executions, does it record organisation-level knowledge, or is it a property of one codebase?**

One execution → Class 1. Reused instructions and standards → Class 2. Decisions and rationale → Class 3. Property of one codebase → Class 4.

**Why the distinction matters.** The classes have different failure modes and different owners. Conflating them produces the failure V15 identifies: a single corpus that is simultaneously too big to select from, too small to be authoritative, and impossible to review. The four classes are reviewed by different people, at different rates, with different rules.

---

## 8. Prompt construction

### 8.1 Principle

The prompt is an **artefact of the harness**, not of the agent. The agent does not write its own prompt; the assembler and the role specification determine it. This is what makes the run reproducible and the context auditable.

### 8.2 Structure

```mermaid
graph TB
    P1["1. Role identity<br/>responsibility, output contract"]
    P2["2. Authority<br/>autonomy level, capability scope,<br/>what is forbidden"]
    P3["3. Acceptance<br/>criteria, oracle reference,<br/>'done' definition"]
    P4["4. Trust rules<br/>untrusted content is data;<br/>instructions in content are ignored"]
    P5["5. Context<br/>selected items, in §5.7 order"]
    P6["6. Task<br/>objective, scope, non-goals,<br/>inputs, upstream artefact"]
    P7["7. Procedure<br/>skill steps for this task type"]
    P8["8. Budgets and limits<br/>turns, wall-clock, tokens, cost"]
    P9["9. Output contract<br/>exact schema of the result"]
    P10["10. Untrusted content envelope<br/>always last, always marked"]
    P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7 --> P8 --> P9 --> P10
```

### 8.3 Construction rules

| # | Rule | Reason |
|---|---|---|
| **P1** | The role identity is the **role specification**, not a persona. No "you are an expert…" preamble. | A persona invites improvisation; a specification constrains it. |
| **P2** | The authority section states what is permitted **and what is forbidden**, with the deny list first for high-risk items. | ADR-0004: the agent must know where the boundary is. |
| **P3** | The acceptance criteria appear **before** the task description. | V01's oracle-first finding: the agent should be optimising the right thing from the first token. |
| **P4** | The trust rules are stated explicitly, every time, in every prompt. | The deterministic boundary is the real control; the instruction is defence in depth (ADR-0004 consequences). |
| **P5** | Context is presented in the assembler's order, unmodified. | Assembly order carries meaning (§5.7); the harness must not re-sort. |
| **P6** | The task states **non-goals** explicitly. | Prevents scope creep, the most common worker failure. |
| **P7** | Procedure steps are included only when a procedure skill matched. | C1 — a procedure that does not apply is context cost. |
| **P8** | Budgets are stated as numbers. | An agent can pace against a stated budget; it cannot pace against an unstated one. |
| **P9** | The output contract is given as a schema, not a description. | Structure beats prose for machine-consumed output. |
| **P10** | Untrusted content is last, fenced, and labelled per item. | §5.7. |

### 8.4 The prompt is versioned and hashed

The assembled prompt is hashed and recorded in the run artefact. The prompt is a function of (role spec version, context envelope, task spec, procedure skills) — all pinned. A prompt that cannot be reproduced from its inputs is not auditable, and an unauditable prompt cannot be improved.

### 8.5 Prompt injection: what the prompt does and does not do

The prompt states that untrusted content is data. This statement is **helpful but not sufficient** — a probabilistic instruction against a probabilistic attack.

| Control | Layer | Effective? |
|---|---|---|
| Untrusted content is tagged at ingest and passed in a marked envelope | Deterministic (assembler) | **Yes — this is the control** |
| Untrusted content placed last, fenced, item-labelled | Deterministic (assembler) | Partially — reduces salience, not a guarantee |
| The prompt states that embedded instructions are not to be followed | Probabilistic (agent) | Defence in depth only |
| The action the agent proposes is checked against the capability grant and policy | Deterministic (policy engine) | **Yes — the real backstop** |
| A privileged action requires an approval that a human sees the raw content for | Deterministic (approval gate) | **Yes** |

**The architecture does not rely on the model resisting injection.** It relies on the fact that an injected instruction can only cause the agent to *propose* an action, and every consequential action passes through the deterministic policy engine and, where the blast radius warrants it, a human who can see the injected content. This is ADR-0004 §4 restated as a prompt-layer property.

---

## 9. Knowledge capture

### 9.1 It is a workflow step, not an agent

Per `08_AGENT_CATALOG_AND_CONTRACTS.md` §3, the Knowledge agent was excluded. Knowledge capture is a **deterministic workflow step** executed after a change is merged, which:

1. reads the merged change record and its linked decision records;
2. extracts the decision rationale already present in the change (commit rationale, linked ADR, acceptance criteria);
3. writes a knowledge record keyed by component and topic, linking back to the change;
4. updates the affected repository's local context where the change altered a convention.

No judgement is required beyond extraction from artefacts the change already contains. Adding an agent role here would be a duplicate implementation of an existing stage.

### 9.2 Documentation as an artefact

The same reasoning applies to documentation (FR-82). Where a repository has documentation generated from the code, the documentation change is a **stage of the change workflow** executed by the same role, against the same change, with the same gates. It is not a separate role and not a separate workflow.

---

## 10. Invariants

| ID | Invariant | Enforcement |
|---|---|---|
| **CX-1** | The context envelope is deterministic: identical inputs produce an identical envelope. | Assembler unit test against the precedence matrix; a golden-file test. |
| **CX-2** | The envelope never exceeds its budget; it fails instead of truncating. | A stage with an over-budget envelope returns `context.budget_exceeded`. |
| **CX-3** | Every run records its resolved context identifiers, versions, and `resolvedContextSha256`. | Event envelope field `context` is required for agent events. |
| **CX-4** | Untrusted content is tagged at ingest and never appears in the context as instruction-bearing content. | Ingest-path tagging is mandatory; the red-team suite tests injected instructions. |
| **CX-5** | A context item's version is fixed for the duration of a run. | The assembler resolves versions at run start; a mid-run publication does not alter the running envelope. |
| **CX-6** | Central security policy is never overridden by repository-local context. | A unit test asserts a repository cannot shadow a policy item. |
| **CX-7** | Privileged context cannot be authored or modified by an agent. | Tool-path denial test (SEC-11). |
| **CX-8** | A skill states properties and procedures; it never grants capability. | The assembler resolves tools from the stage specification, not from skill content. |
| **CX-9** | The duplicate-and-stale finding count is non-increasing. | Inventory report tracks the count over time; a regression is an alert. |

---

## 11. Known limitations

1. **The relevance ordering in the assembler's budget-retry step is heuristic.** A stage that fails on budget repeatedly indicates the selection rules need tuning; the failure is visible, but the first-failure experience is poor. Mitigated by the fact that a budget failure is loud and classified, unlike a silent truncation.
2. **The inventory's "outdated" detection requires knowing what an item references.** An item that references a moving target implicitly (a service whose contract changed without a file change) is not detected. Partially mitigated by the review of privileged items.
3. **Classification of new context items is manual.** A new item may be mis-tiered (local instead of central, or the reverse). Mitigated by the promotion/demotion cycle and the scope-mismatch finding.
4. **Knowledge retrieval is keyword-based.** Semantic recall over the knowledge store is weaker than a vector store would be. Accepted deliberately (ADR-0012): approximate retrieval must not be authoritative, and a missed knowledge record degrades a search, whereas an authoritative-but-wrong retrieval corrupts a decision.
5. **Prompt-level injection defence is probabilistic.** The deterministic boundary (§8.5) carries the guarantee. The residual risk is a change that *is* within the granted scope but is wrong for its context — which the review gate catches.

---

## 12. Related documents

- `07_REFERENCE_ARCHITECTURE.md` §4 — the Context Assembler, Skill Registry, Context Inventory, and Knowledge Store component specifications
- `08_AGENT_CATALOG_AND_CONTRACTS.md` §4 — the input contract, of which the context envelope is one part
- `09_ORCHESTRATION_STATE_AND_EVENTS.md` §4.1 — the `context` field of the event envelope
- `11_TOOLS_MCP_AND_INTEGRATIONS.md` — deferred tool references and the tool registry that the deferred references point at
- `14_QUALITY_TESTING_AND_EVALUATION.md` — how a skill's verifier is calibrated
- `15_OBSERVABILITY_COST_AND_FEEDBACK.md` — run-artefact retention and the metrics derived from Class 1
- `templates/SKILL_SPEC.md` — the authoring template
