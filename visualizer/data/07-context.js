/* ============================================================
   DATA — Context, skills, prompts and memory
   GENERATED from blueprint-reference/10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md
   Do not hand-edit; regenerate with scratchpad/gen_ctx.py
   ============================================================ */

export const PRINCIPLES = [
  {
    "id": "C1",
    "name": "Context is selected, never maximal.",
    "consequence": "The assembler has a budget and fails rather than truncating (§5.4)."
  },
  {
    "id": "C2",
    "name": "Context is pinned per run.",
    "consequence": "Every run records the resolved context (§5.6)."
  },
  {
    "id": "C3",
    "name": "Context is authority-bearing and therefore privilege-bearing.",
    "consequence": "Context that changes what an agent may do is security-relevant (§2.4)."
  },
  {
    "id": "C4",
    "name": "Context is two-tiered with deterministic precedence.",
    "consequence": "Repository-local by default; central for organisation-wide policy (§3)."
  }
];

export const NOT_CONTEXT = [
  {
    "it": "a transcript of prior runs",
    "is": "that is a run artefact, §7.1"
  },
  {
    "it": "a memory of what the agent learned about a specific codebase",
    "is": "that is knowledge, §7.3, or repo-local context, §3"
  },
  {
    "it": "a place to put facts the agent should have derived from its tools",
    "is": "§4.2 — the \"derive, do not inject\" rule"
  }
];

export const FIELDS = [
  {
    "f": "id",
    "req": "Yes",
    "why": "Stable identity across versions; the key used in the run's context manifest."
  },
  {
    "f": "version",
    "req": "Yes",
    "why": "Pinning. A run must be reproducible against a known context state."
  },
  {
    "f": "sha256",
    "req": "Yes",
    "why": "Integrity. SEC-09 requires integrity checking; a changed file must be detectable."
  },
  {
    "f": "tier",
    "req": "Yes",
    "why": "Determines precedence (ADR-0009 §2)."
  },
  {
    "f": "scope",
    "req": "Yes",
    "why": "The assembler must know when an item applies, or it will over- or under-select."
  },
  {
    "f": "kind",
    "req": "Yes",
    "why": "Determines selection strategy (§4.3) and whether the item is a skill or plain context."
  },
  {
    "f": "provenance",
    "req": "Yes",
    "why": "SEC-09; ADR-0004's requirement that authority-bearing artefacts be attributable."
  },
  {
    "f": "trust.classification",
    "req": "Yes",
    "why": "ADR-0004 §4. Untrusted items are quarantined."
  },
  {
    "f": "trust.privileged",
    "req": "Yes",
    "why": "Marks items that alter permitted behaviour; triggers the elevated review class (FR-16)."
  }
];

export const TRUST_CLASSES = [
  {
    "cls": "trusted",
    "meaning": "Authored or reviewed within the trusted boundary; content is instruction-bearing and may be acted upon.",
    "handling": "Assembled normally."
  },
  {
    "cls": "untrusted-content",
    "meaning": "Originates outside the trusted boundary: issue text, PR descriptions, code comments, documentation, web pages, dependency files, external tool output.",
    "handling": "Assembled inside a marked envelope (ADR-0004 §4). May be quoted, analysed, summarised. Never instruction-bearing."
  },
  {
    "cls": "derived",
    "meaning": "Produced by the factory itself from trusted sources: a summarisation, an extraction, an index.",
    "handling": "Assembled normally, but marked as derived so that provenance is not overstated — a derived item is only as good as its source's trust."
  }
];

export const PRIVILEGED_RULES = [
  "cannot be authored or modified by an agent (SEC-11);",
  "requires the elevated review class — the same bar as a policy change (FR-16);",
  "is recorded in the audit trail with its provenance;",
  "is subject to the integrity check on every load."
];

export const TIER_COMPARE = [
  {
    "k": "Storage",
    "local": "Versioned in the repository, alongside the code",
    "central": "Central context store + registry index"
  },
  {
    "k": "Change path",
    "local": "Ordinary pull request against the code",
    "central": "Definition change with elevated review"
  },
  {
    "k": "Review",
    "local": "Code review, by the repository's owners",
    "central": "Policy-class review, by the platform owners"
  },
  {
    "k": "Examples",
    "local": "Build/test commands, code conventions, architecture notes, domain vocabulary, local runbooks, repo-specific verification expectations",
    "central": "Security and compliance policy, organisation-wide standards, shared integration contracts, approved skill library, engineering knowledge, mandatory per-repository context requirements"
  },
  {
    "k": "Failure mode",
    "local": "Drifts from code — but visibly, as a diff",
    "central": "Drifts from code — silently. Mitigated by the inventory (§6)"
  }
];

export const PRECEDENCE = [
  {
    "n": 1,
    "rule": "Central security and compliance policy always wins.",
    "detail": "A repository cannot override it. This is the explicit, deliberate exception to locality."
  },
  {
    "n": 2,
    "rule": "Otherwise, repository-local overrides central",
    "detail": "for repository-scoped concerns."
  },
  {
    "n": 3,
    "rule": "Neither covers the concern",
    "detail": "→ the stage proceeds under the general agent policy and the gap is flagged (it becomes an inventory finding and a candidate promotion)."
  }
];

export const PROMOTION = [
  {
    "dir": "**Promotion** (local → central)",
    "trigger": "The inventory detects the same artefact in ≥N repositories, or a reviewer proposes it.",
    "effect": "The local artefact becomes a pointer to the central one. The central copy is created and reviewed.",
    "approval": "Definition change, standard class"
  },
  {
    "dir": "**Demotion** (central → local)",
    "trigger": "The inventory detects that a central artefact's scope is narrower than declared, or a repository owner reports it as inapplicable.",
    "effect": "The central artefact is scoped down or moved; affected repositories receive a local copy.",
    "approval": "Definition change, standard class"
  }
];

export const SKILL_VS_STANDARD = [
  {
    "k": "Purpose",
    "procedure": "Describes how to do something — a repeatable process with steps.",
    "standard": "Describes what must be true — a property to adhere to."
  },
  {
    "k": "Contains",
    "procedure": "Ordered steps, inputs, outputs, tools used, failure handling, completion criteria.",
    "standard": "Rules, invariants, prohibited patterns, required properties, and — where derivable — a machine-checkable verifier."
  },
  {
    "k": "Executable?",
    "procedure": "Executed as a workflow stage.",
    "standard": "Not executed. It is consulted by a stage and, optionally, checked by a generated verifier."
  },
  {
    "k": "Example",
    "procedure": "\"Migrating a database schema\" (procedure).",
    "standard": "\"All SQL parameters must be bound, never interpolated\" (constraint)."
  }
];

export const DERIVE_TEST = {
  "test": "",
  "bad": [
    "\"The API base URL is https://api.internal/v2.\"",
    "\"The orders table has 14 columns.\"",
    "\"Run pnpm test to run tests.\""
  ],
  "good": [
    "\"The API base URL is read from the environment variable API_BASE_URL; never hard-code it.\"",
    "\"Schema shape is discovered via the repository's schema definitions; never assume column names.\"",
    "\"The test command is defined by the repository's package.json test script; do not assume a package manager.\""
  ]
};

export const QUALITY_RULES = [
  {
    "rule": "Specificity",
    "test": "Every instruction names a concrete artefact, command pattern, or property. No \"handle errors appropriately\".",
    "source": "V15 42:16"
  },
  {
    "rule": "Single purpose",
    "test": "A skill expresses one procedure or one standard. A skill that needs \"and\" is two skills.",
    "source": "[E3]"
  },
  {
    "rule": "Verifiable where possible",
    "test": "A standard states at least one checkable property, or explicitly records that it is not mechanisable and why.",
    "source": "V15 28:49–30:10"
  },
  {
    "rule": "No ambient authority",
    "test": "A skill cannot grant capability. It may request a tool; the policy engine decides.",
    "source": "ADR-0004"
  },
  {
    "rule": "No duplicate truth",
    "test": "A fact stated in two skills is a defect; one must point to the other.",
    "source": "V15 22:51–24:20"
  },
  {
    "rule": "No stale reference",
    "test": "Every referenced skill, file, or endpoint resolves at load time.",
    "source": "V15 22:51–24:20"
  },
  {
    "rule": "Bounded size",
    "test": "A skill that exceeds the per-item context budget is split.",
    "source": "C1, ADR-0010 §4"
  }
];

export const LIFECYCLE_STATES = [
  "DRAFT",
  "VALIDATED",
  "REJECTED",
  "PROPOSED",
  "EVALUATED",
  "APPROVAL",
  "ACTIVE",
  "DEPRECATED"
];

export const LIFECYCLE_EDGES = [
  {
    "from": "start",
    "to": "DRAFT"
  },
  {
    "from": "DRAFT",
    "to": "VALIDATED"
  },
  {
    "from": "DRAFT",
    "to": "REJECTED"
  },
  {
    "from": "VALIDATED",
    "to": "PROPOSED"
  },
  {
    "from": "PROPOSED",
    "to": "EVALUATED"
  },
  {
    "from": "EVALUATED",
    "to": "APPROVAL"
  },
  {
    "from": "EVALUATED",
    "to": "REJECTED"
  },
  {
    "from": "APPROVAL",
    "to": "ACTIVE"
  },
  {
    "from": "APPROVAL",
    "to": "REJECTED"
  },
  {
    "from": "ACTIVE",
    "to": "DEPRECATED"
  },
  {
    "from": "ACTIVE",
    "to": "PROPOSED"
  }
];

export const LIFECYCLE_RULES = [
  {
    "n": 1,
    "t": "A skill is never applied directly by a running agent. The meta-factory proposes; the review path applies (ADR-0007 §1)."
  },
  {
    "n": 2,
    "t": "The EVALUATED step requires batch evidence across ≥N runs (FR-93). A proposal derived from a single run is rejected as noise-fitting — and as a defence against a single poisoned run manipulating the factory (ADR-0007 §4)."
  },
  {
    "n": 3,
    "t": "The ACTIVE skill is pinned by version in every run that uses it; a run does not silently pick up a newer skill."
  },
  {
    "n": 4,
    "t": "A skill that is deprecated is not deleted; the pointer remains so that historical runs remain reproducible."
  }
];

export const OUTER_LOOP = [
  {
    "n": 1,
    "stage": "SELECT",
    "what": "collect the run set (≥N runs) in the target class"
  },
  {
    "n": 2,
    "stage": "ANALYSE",
    "what": "classify failures; find the dominant pattern"
  },
  {
    "n": 3,
    "stage": "ATTRIBUTE",
    "what": "determine the layer: skill / workflow / harness / model / policy"
  },
  {
    "n": 4,
    "stage": "PROPOSE",
    "what": "emit a structured change proposal (evidence + effect + measurement + rollback)"
  },
  {
    "n": 5,
    "stage": "EVALUATE",
    "what": "benchmark the candidate against the run set"
  },
  {
    "n": 6,
    "stage": "REVIEW",
    "what": "human review at the scope's approval class"
  },
  {
    "n": 7,
    "stage": "APPLY",
    "what": "merge the change; the applier reconciles"
  },
  {
    "n": 8,
    "stage": "OBSERVE",
    "what": "measure over the observation window"
  },
  {
    "n": 9,
    "stage": "PROMOTE",
    "what": "or ROLLBACK — the outcome is decided by the observation window"
  }
];

export const META_LOOP = [
  {
    "k": "Evidence",
    "v": "Systemic analysis over a long window. A single-run pattern is insufficient for harness scope (ADR-0007 §3)."
  },
  {
    "k": "Evaluation",
    "v": "Full replay evaluation against the historical run set, plus an explicit experiment design (ADR-0011 §3: baseline, delta, cost, guardrail)."
  },
  {
    "k": "Approval",
    "v": "Human review required, always (ADR-0007 §3)."
  },
  {
    "k": "Rollback",
    "v": "Automatic on guardrail breach within the observation window."
  }
];

export const ASSEMBLER_IFACE = {
  "inputs": [
    {
      "k": "stageSpec",
      "src": "The node specification from the task graph (09_ORCHESTRATION_STATE_AND_EVENTS.md §7)"
    },
    {
      "k": "taskInputs",
      "src": "Upstream artefacts (if a dependent edge), and the task's own inputs"
    },
    {
      "k": "repoScope",
      "src": "Repository identity, path scope, task type"
    }
  ],
  "outputs": [
    {
      "k": "envelopeId",
      "v": "Unique identity of this resolved envelope"
    },
    {
      "k": "items[]",
      "v": "Ordered list of resolved context items with id, version, sha256, trust, byte size"
    },
    {
      "k": "resolvedContextSha256",
      "v": "Hash over the ordered item list — the single value recorded in the event envelope"
    },
    {
      "k": "truncations[]",
      "v": "Items excluded by the budget, with the reason — so exclusion is visible, not silent"
    },
    {
      "k": "gaps[]",
      "v": "Concerns no context covered (precedence rule 3)"
    },
    {
      "k": "budget",
      "v": "The budget applied and the usage against it"
    }
  ]
};

export const ASSEMBLER_STEPS = [
  {
    "id": "T1",
    "n": "1",
    "label": "Apply central policy filter: privileged items only from the policy tier"
  },
  {
    "id": "T2",
    "n": "2",
    "label": "Select candidates by appliesTo (paths, repos, taskType)"
  },
  {
    "id": "T3",
    "n": "3",
    "label": "Apply precedence central security > local > central > policy"
  },
  {
    "id": "T4",
    "n": "4",
    "label": "Classify trust tag untrusted, mark derived"
  },
  {
    "id": "T5",
    "n": "5",
    "label": "Select by kind standards → property set; procedures → steps"
  },
  {
    "id": "T6",
    "n": "6",
    "label": "Order policy, then standards, then procedures, then reference, then local context"
  },
  {
    "id": "T7",
    "n": "7",
    "label": "Defer full tool defs & long refs → deferred refs"
  },
  {
    "id": "T8",
    "n": "8",
    "label": "Budget check"
  },
  {
    "id": "T9",
    "n": "8a",
    "label": "Re-select by relevance score"
  }
];

export const ASSEMBLER_EDGES = [
  {
    "from": "T1",
    "to": "T2",
    "label": ""
  },
  {
    "from": "T2",
    "to": "T3",
    "label": ""
  },
  {
    "from": "T3",
    "to": "T4",
    "label": ""
  },
  {
    "from": "T4",
    "to": "T5",
    "label": ""
  },
  {
    "from": "T5",
    "to": "T6",
    "label": ""
  },
  {
    "from": "T6",
    "to": "T7",
    "label": ""
  },
  {
    "from": "T7",
    "to": "T8",
    "label": ""
  },
  {
    "from": "T8",
    "to": "OK",
    "label": "within budget"
  },
  {
    "from": "T8",
    "to": "T9",
    "label": "exceeds budget"
  },
  {
    "from": "T9",
    "to": "T8",
    "label": ""
  },
  {
    "from": "T8",
    "to": "FAIL",
    "label": "still exceeds"
  }
];

export const DETERMINISM = [
  {
    "p": "Determinism",
    "m": "Same inputs → same envelope. The assembler is a pure function; it holds no hidden state."
  },
  {
    "p": "Pinning",
    "m": "Every item carries its resolved version; the envelope records the version list."
  },
  {
    "p": "Immutability during a run",
    "m": "A context item's version is fixed for the run's duration. A new version published mid-run does not alter the running stage."
  },
  {
    "p": "Reproducibility",
    "m": "resolvedContextSha256 is written to the event envelope, so the exact context of any run is recoverable."
  },
  {
    "p": "Auditability",
    "m": "The envelope is an artefact; a reviewer can see precisely what the agent was told."
  }
];

export const ORDERING = [
  {
    "n": 1,
    "what": "Policy and authority",
    "why": "what the agent may do, and the trust rules it must apply."
  },
  {
    "n": 2,
    "what": "Acceptance criteria and the oracle reference",
    "why": "what \"done\" means. Placed early because V01's finding is that the oracle, not the implementation, defines the task."
  },
  {
    "n": 3,
    "what": "Applicable standards",
    "why": "the properties the change must satisfy, with their verifier references."
  },
  {
    "n": 4,
    "what": "Procedure steps",
    "why": "how to do the work."
  },
  {
    "n": 5,
    "what": "Repository-local context",
    "why": "build/test commands, conventions, architecture notes."
  },
  {
    "n": 6,
    "what": "Reference material",
    "why": "deferred references, external documentation pointers."
  },
  {
    "n": 7,
    "what": "Untrusted content",
    "why": "always last, in a marked envelope, never above any trusted item."
  }
];

export const INVENTORY = [
  {
    "f": "Outdated",
    "def": "The item's referenced artefact has changed since the item was written (file modified, endpoint changed, dependency version moved).",
    "sev": "Warning",
    "fix": "Propose an update."
  },
  {
    "f": "Duplicate",
    "def": "Two items assert the same fact or the same property.",
    "sev": "Warning",
    "fix": "Merge; one becomes a pointer."
  },
  {
    "f": "Stale",
    "def": "The item has not been used in the observation window, and its subject has changed.",
    "sev": "Info",
    "fix": "Deprecate."
  },
  {
    "f": "Orphaned reference",
    "def": "The item references a skill, file, or endpoint that no longer resolves.",
    "sev": "Error",
    "fix": "Fix or remove."
  },
  {
    "f": "Unclassified",
    "def": "An item exists but has no kind, no scope, or no owner.",
    "sev": "Error",
    "fix": "Classify."
  },
  {
    "f": "Privileged-unreviewed",
    "def": "A privileged item is in use but has not passed the elevated review class.",
    "sev": "Error",
    "fix": "Suspend use."
  },
  {
    "f": "Scope mismatch",
    "def": "A central item's declared scope does not match its observed usage.",
    "sev": "Warning",
    "fix": "Demote or re-scope (ADR-0009 §4)."
  }
];

export const MEMORY_CLASSES = [
  {
    "id": "1",
    "label": "Class 1 — Run artefacts",
    "boxes": [
      "Per-run record prompts, tool calls, verification, artefacts, cost",
      "Immutable, append-only Retention: policy-driven"
    ]
  },
  {
    "id": "2",
    "label": "Class 2 — Context & skills",
    "boxes": [
      "Versioned, reviewable Repository-local + central",
      "Pinned per run Promotion/demotion cycle"
    ]
  },
  {
    "id": "3",
    "label": "Class 3 — Knowledge",
    "boxes": [
      "Decisions, rationale, outcomes, glossary",
      "Retrievable, linked to change Authored by humans + extracted"
    ]
  },
  {
    "id": "4",
    "label": "Class 4 — Local repo context",
    "boxes": [
      "Build commands, conventions, architecture notes, vocabulary",
      "Versioned with the code Reviewed as code"
    ]
  }
];

export const CLASS1_ATTRS = [
  {
    "k": "Content",
    "v": "Inputs, resolved context manifest, model/harness/config versions, every tool call (arguments summary, result summary, duration, cost), prompts and generated text (retention-policy subject), verification results per layer, produced artefacts with hashes, outcome, approval, authority, token counts, cost."
  },
  {
    "k": "Owner",
    "v": "The runtime (framework-emitted, never agent-reported — MEAS-02)."
  },
  {
    "k": "Lifetime",
    "v": "Immutable; append-only. Retention by class."
  },
  {
    "k": "Consumers",
    "v": "Replay evaluator, calibration harness, improvement loops, audit, humans."
  },
  {
    "k": "Write rule",
    "v": "Written by the framework as a by-product of execution, in the same transaction as the outcome."
  }
];

export const CLASS3_ATTRS = [
  {
    "k": "Content",
    "v": "A decision record: context, options considered, decision, rationale, consequences, the change that implemented it, the outcome once known."
  },
  {
    "k": "Origin",
    "v": "Authored by humans; extracted from merged changes by a deterministic workflow step. Extraction is not judgement, so it is not an agent role (§08 §3 — the Knowledge agent was excluded for this reason)."
  },
  {
    "k": "Retrieval",
    "v": "Searchable by topic, component, and linked change."
  },
  {
    "k": "Linkage",
    "v": "Every record links to the change it describes and, where it exists, the ADR that produced it."
  },
  {
    "k": "Ownership",
    "v": "Engineering leadership; changes are reviewed like any other change."
  }
];

export const CLASS_TEST = {
  "q": "Does it describe one execution, is it reused across executions, does it record organisation-level knowledge, or is it a property of one codebase?",
  "maps": [
    {
      "from": "One execution",
      "to": "Class 1"
    },
    {
      "from": "Reused instructions and standards",
      "to": "Class 2"
    },
    {
      "from": "Decisions and rationale",
      "to": "Class 3"
    },
    {
      "from": "Property of one codebase",
      "to": "Class 4"
    }
  ]
};

export const PROMPT_PARTS = [
  {
    "n": 1,
    "title": "Role identity",
    "detail": "responsibility, output contract"
  },
  {
    "n": 2,
    "title": "Authority",
    "detail": "autonomy level, capability scope, what is forbidden"
  },
  {
    "n": 3,
    "title": "Acceptance",
    "detail": "criteria, oracle reference, 'done' definition"
  },
  {
    "n": 4,
    "title": "Trust rules",
    "detail": "untrusted content is data; instructions in content are ignored"
  },
  {
    "n": 5,
    "title": "Context",
    "detail": "selected items, in §5.7 order"
  },
  {
    "n": 6,
    "title": "Task",
    "detail": "objective, scope, non-goals, inputs, upstream artefact"
  },
  {
    "n": 7,
    "title": "Procedure",
    "detail": "skill steps for this task type"
  },
  {
    "n": 8,
    "title": "Budgets and limits",
    "detail": "turns, wall-clock, tokens, cost"
  },
  {
    "n": 9,
    "title": "Output contract",
    "detail": "exact schema of the result"
  },
  {
    "n": 10,
    "title": "Untrusted content envelope",
    "detail": "always last, always marked"
  }
];

export const PROMPT_RULES = [
  {
    "id": "P1",
    "rule": "The role identity is the role specification, not a persona. No \"you are an expert…\" preamble.",
    "reason": "A persona invites improvisation; a specification constrains it."
  },
  {
    "id": "P2",
    "rule": "The authority section states what is permitted and what is forbidden, with the deny list first for high-risk items.",
    "reason": "ADR-0004: the agent must know where the boundary is."
  },
  {
    "id": "P3",
    "rule": "The acceptance criteria appear before the task description.",
    "reason": "V01's oracle-first finding: the agent should be optimising the right thing from the first token."
  },
  {
    "id": "P4",
    "rule": "The trust rules are stated explicitly, every time, in every prompt.",
    "reason": "The deterministic boundary is the real control; the instruction is defence in depth (ADR-0004 consequences)."
  },
  {
    "id": "P5",
    "rule": "Context is presented in the assembler's order, unmodified.",
    "reason": "Assembly order carries meaning (§5.7); the harness must not re-sort."
  },
  {
    "id": "P6",
    "rule": "The task states non-goals explicitly.",
    "reason": "Prevents scope creep, the most common worker failure."
  },
  {
    "id": "P7",
    "rule": "Procedure steps are included only when a procedure skill matched.",
    "reason": "C1 — a procedure that does not apply is context cost."
  },
  {
    "id": "P8",
    "rule": "Budgets are stated as numbers.",
    "reason": "An agent can pace against a stated budget; it cannot pace against an unstated one."
  },
  {
    "id": "P9",
    "rule": "The output contract is given as a schema, not a description.",
    "reason": "Structure beats prose for machine-consumed output."
  },
  {
    "id": "P10",
    "rule": "Untrusted content is last, fenced, and labelled per item.",
    "reason": "§5.7."
  }
];

export const INJECTION_CONTROLS = [
  {
    "c": "Untrusted content is tagged at ingest and passed in a marked envelope",
    "layer": "Deterministic (assembler)",
    "eff": "Yes — this is the control"
  },
  {
    "c": "Untrusted content placed last, fenced, item-labelled",
    "layer": "Deterministic (assembler)",
    "eff": "Partially — reduces salience, not a guarantee"
  },
  {
    "c": "The prompt states that embedded instructions are not to be followed",
    "layer": "Probabilistic (agent)",
    "eff": "Defence in depth only"
  },
  {
    "c": "The action the agent proposes is checked against the capability grant and policy",
    "layer": "Deterministic (policy engine)",
    "eff": "Yes — the real backstop"
  },
  {
    "c": "A privileged action requires an approval that a human sees the raw content for",
    "layer": "Deterministic (approval gate)",
    "eff": "Yes"
  }
];

export const CX_INVARIANTS = [
  {
    "id": "CX-1",
    "t": "The context envelope is deterministic: identical inputs produce an identical envelope.",
    "enf": "Assembler unit test against the precedence matrix; a golden-file test."
  },
  {
    "id": "CX-2",
    "t": "The envelope never exceeds its budget; it fails instead of truncating.",
    "enf": "A stage with an over-budget envelope returns context.budget_exceeded."
  },
  {
    "id": "CX-3",
    "t": "Every run records its resolved context identifiers, versions, and resolvedContextSha256.",
    "enf": "Event envelope field context is required for agent events."
  },
  {
    "id": "CX-4",
    "t": "Untrusted content is tagged at ingest and never appears in the context as instruction-bearing content.",
    "enf": "Ingest-path tagging is mandatory; the red-team suite tests injected instructions."
  },
  {
    "id": "CX-5",
    "t": "A context item's version is fixed for the duration of a run.",
    "enf": "The assembler resolves versions at run start; a mid-run publication does not alter the running envelope."
  },
  {
    "id": "CX-6",
    "t": "Central security policy is never overridden by repository-local context.",
    "enf": "A unit test asserts a repository cannot shadow a policy item."
  },
  {
    "id": "CX-7",
    "t": "Privileged context cannot be authored or modified by an agent.",
    "enf": "Tool-path denial test (SEC-11)."
  },
  {
    "id": "CX-8",
    "t": "A skill states properties and procedures; it never grants capability.",
    "enf": "The assembler resolves tools from the stage specification, not from skill content."
  },
  {
    "id": "CX-9",
    "t": "The duplicate-and-stale finding count is non-increasing.",
    "enf": "Inventory report tracks the count over time; a regression is an alert."
  }
];

export const LIMITATIONS = [
  {
    "n": 1,
    "t": "The relevance ordering in the assembler's budget-retry step is heuristic. A stage that fails on budget repeatedly indicates the selection rules need tuning; the failure is visible, but the first-failure experience is poor. Mitigated by the fact that a budget failure is loud and classified, unlike a silent truncation."
  },
  {
    "n": 2,
    "t": "The inventory's \"outdated\" detection requires knowing what an item references. An item that references a moving target implicitly (a service whose contract changed without a file change) is not detected. Partially mitigated by the review of privileged items."
  },
  {
    "n": 3,
    "t": "Classification of new context items is manual. A new item may be mis-tiered (local instead of central, or the reverse). Mitigated by the promotion/demotion cycle and the scope-mismatch finding."
  },
  {
    "n": 4,
    "t": "Knowledge retrieval is keyword-based. Semantic recall over the knowledge store is weaker than a vector store would be. Accepted deliberately (ADR-0012): approximate retrieval must not be authoritative, and a missed knowledge record degrades a search, whereas an authoritative-but-wrong retrieval corrupts a decision."
  },
  {
    "n": 5,
    "t": "Prompt-level injection defence is probabilistic. The deterministic boundary (§8.5) carries the guarantee. The residual risk is a change that is within the granted scope but is wrong for its context — which the review gate catches."
  }
];
