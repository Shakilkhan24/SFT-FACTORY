/* ============================================================
   DATA — The six authoring templates
   GENERATED from blueprint-reference/templates/*.md
   Do not hand-edit; regenerate with scratchpad/gen_tpl.py
   ============================================================ */

export const TEMPLATES = [
  {
    "file": "ADR.md",
    "title": "Architecture Decision Record",
    "kind": "ADR",
    "useWhen": "recording an architectural decision that constrains the factory's shape, its dependencies, its trust boundaries, or its operational cost.",
    "authority": "ADR-0001 (declarative factory definition) and ADR-0007 (factory changes go through review) are the sources of truth for how decisions are made and changed.",
    "submission": "an ADR is a definition change and is reviewed at the approval class matching its blast radius — a decision touching policy or autonomy is a security-scope decision.",
    "rules": [
      {
        "n": 1,
        "t": "An ADR records a decision, not a document. The output is a choice with consequences, not a description of a design. If no choice was made, write a note elsewhere."
      },
      {
        "n": 2,
        "t": "The Context section states the forces, not the conclusion. The reader should be able to reconstruct why the decision was difficult without reading the Decision section."
      },
      {
        "n": 3,
        "t": "Every claim is evidence-classed. [E1] direct transcript evidence, [E2] cross-source synthesis, [E3] engineering judgement, [E4] unresolved hypothesis. A decision that rests on no corpus evidence says so plainly."
      },
      {
        "n": 4,
        "t": "Alternatives are mandatory and must be genuinely plausible. An ADR with one alternative is a justification, not a decision record. A rejected alternative that would obviously never have been considered is noise; remove it and say why it was never a candidate."
      },
      {
        "n": 5,
        "t": "Consequences include what is being given up. A consequences section with only positives is a sales document. The negative section is where the next reviewer learns the most."
      },
      {
        "n": 6,
        "t": "Validation states how the decision could be shown wrong. If nothing could falsify the decision, it is a preference, not an engineering decision."
      },
      {
        "n": 7,
        "t": "No dead ADRs. A superseded ADR is edited to point at its successor and its status is changed. It is not deleted, and it is not left claiming to be in force."
      },
      {
        "n": 8,
        "t": "An ADR states what it does not decide. Scope limits belong in the Decision section, so a later reader does not over-read the decision."
      }
    ],
    "body": "# ADR-NNNN — <the decision, stated as a choice>\n\n- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated | Rejected\n- **Date:** <YYYY-MM-DD>\n- **Decision owners:** <team-or-person>            # accountable for the decision\n- **Evidence class:** [E1] … | [E2] … | [E3] … | [E4] …\n- **Supersedes:** none | ADR-NNNN@<version>\n\n---\n\n## Context\n\n<The forces that made this a decision rather than a default. What was true\nabout the system, the constraints, the evidence, and the pressures. Name the\ndisagreements in the evidence. Where the corpus is silent, say so — silence\nis a finding.>\n\n## Decision\n\n<The choice, in the active voice: \"The factory uses X.\" or \"The factory\ndoes not do Y.\">\n\n### 1. <Sub-decision>\n### 2. <Sub-decision>\n\n### Scope limits\n<What this decision explicitly does not settle, and where that is decided.>\n\n## Consequences\n\n**Positive**\n- …\n\n**Negative**\n- …\n\n**Neutral**\n- …\n\n## Alternatives considered\n\n| Alternative | Why rejected |\n|---|---|\n| … | … |\n\n## Validation\n\n- <the check, test, or measurement that demonstrates the decision works>\n- <the condition that would show the decision was wrong>\n\n## References\n\n- Evidence: `../03_EVIDENCE_LEDGER.md` <IDs>\n- Synthesis: `../04_CROSS_SOURCE_SYNTHESIS.md` <IDs / sections>\n- Related: ADR-NNNN, ADR-NNNN",
    "lang": "markdown",
    "checklist": [
      "The title states a decision, not a topic.",
      "Context states the forces and names the evidence; it does not state the conclusion.",
      "Every factual claim carries an evidence class, and where the corpus is silent, the silence is stated.",
      "At least two genuinely plausible alternatives are recorded with reasons for rejection.",
      "Consequences include at least one negative and one neutral.",
      "Scope limits are explicit.",
      "Validation states both a check that demonstrates success and a condition that would falsify the decision.",
      "Every referenced ADR, evidence ID, and document path resolves.",
      "The status and supersession fields are correct, and no superseded ADR still claims to be in force.",
      "The approval class matches the decision's blast radius — policy or autonomy decisions require the security-scope class."
    ],
    "worked": true
  },
  {
    "file": "AGENT_SPEC.md",
    "title": "Agent Specification",
    "kind": "RoleSpec",
    "useWhen": "defining a role the factory recognises.",
    "authority": "08_AGENT_CATALOG_AND_CONTRACTS.md §8 is the source of truth for the schema's meaning.",
    "submission": "this file is a definition change. It goes through the reviewed path (13_... §9.2).",
    "rules": [
      {
        "n": 1,
        "t": "A role is a specification, not a deployment. Do not create a role because \"agents should specialise\". A role is created only when its responsibilities genuinely differ from an existing role in tools, authority, context scope, or evaluation."
      },
      {
        "n": 2,
        "t": "Check for a merge first. If an existing role has the same context scope, tool scope, authority, and evaluation, extend that role instead. Duplication is a defect (FR-31)."
      },
      {
        "n": 3,
        "t": "Prefer determinism. If the output can be specified exactly, the stage is code, not an agent role. Do not write a RoleSpec for a deterministic step."
      },
      {
        "n": 4,
        "t": "A role never grants capability. toolScope declares what the role requests; the policy engine decides what is granted. The intersection of the workflow's grant, the stage's scope, and the resource scope is the effective capability set."
      },
      {
        "n": 5,
        "t": "Model policy is a routing hint, not a selection. The gateway makes the final choice, and the fallback chain must have provider diversity."
      },
      {
        "n": 6,
        "t": "Every evaluation must be computable from the run artefact. If you cannot compute it from what the framework records, it is not a metric."
      },
      {
        "n": 7,
        "t": "contextScope.exclude is not optional. The exclusions are what keep cost predictable and prevent context bleed. List what this role must not see."
      }
    ],
    "body": "apiVersion: factory/v1\nkind: RoleSpec\nmetadata:\n  name: <kebab-case-role-name>          # unique; the role's identity\n  version: <integer>                    # increment on any semantic change\n  owner: <team-or-person>               # accountable for this role's behaviour\n  scope:\n    kind: control-plane | data-plane    # control-plane roles are decision roles;\n                                         # data-plane roles execute bounded work\n  responsibility: >\n    <One paragraph. What this role is for, in the imperative. Not a persona.\n    If it takes more than three sentences, it is probably two roles.>\n  # What this role is explicitly NOT responsible for.\n  nonResponsibilities:\n    - <responsibility that belongs to another role>\n  # The inputs this role receives. Each must be produced by a named upstream stage.\n  inputs:\n    - name: <input>\n      type: artefact | specification | context-envelope | grant | budget\n      source: <stage or component that produces it>\n      required: true | false\n  # The outputs this role produces. Each is a typed artefact with a hash.\n  outputs:\n    - name: <output>\n      type: artefact | specification | task-graph | verdict | report\n      description: <what it is>\n  contextScope:\n    include:\n      - <stage.specification>            # always\n      - <stage.upstream>                 # only for dependent stages\n      - <repo.local-context>             # scoped by the assembler\n      - <standards.applicable>           # narrowed by file pattern\n      - <skill.*>                        # named skills this role requires\n    exclude:\n      - <sibling.stage.context>\n      - <planner.fullGraph>\n      - <agent.ownTranscripts>\n      - <agent.peerTranscripts>\n  toolScope:\n    grant:                              # requested; the policy engine decides\n      - <capability.id>\n    deny:                               # deny wins over grant at every level\n      - <capability.id>\n  modelPolicy:\n    strategy: cheapest-above-threshold | strongest-above-threshold | fixed\n    thresholdRef: <metric.name>          # the measured quality threshold\n    fallbacks:\n      - provider: <provider.id>\n        tier: <tier>\n        on: [provider-error, budget-exhausted, quality-signal]\n    # A fallback to the same provider under the same failure mode is not a fallback.\n    requiresProviderDiversity: true\n  evaluation:\n    primary: <metric.name>              # the one that decides the role's quality\n    secondary:\n      - <metric.name>\n    failureClassification:\n      model.reasoning: <retry-and-escalate policy>\n      context.insufficient: <skill-scope proposal>\n      workflow.composition: <workflow-scope proposal>\n      # Unlisted classes default to workflow.composition for improvement purposes.\n  limits:\n    turns: <integer>                    # default 100\n    wallClockSeconds: <integer>\n    tokenBudget: <integer>\n    costBudgetUsd: <number>\n  autonomy:\n    maxLevel: L0 | L1 | L2 | L3 | L4    # the ceiling this role may operate at\n  spawning:\n    permitted: true | false\n    maxDepth: <integer>                 # default 1\n    requiresChunkabilityJustification: true\n    # A sub-agent cannot exceed its parent's authority.\n    inheritsGrants: true\n    globalConcurrencyLimit: <integer>\n  # A role that must not be the same agent that produced what it reviews.\n  independence:\n    requiresDistinctFrom: <role.name>   # e.g. worker\n    rationale: <why>",
    "lang": "yaml",
    "checklist": [
      "The role is not a duplicate of an existing one (context, tools, authority, evaluation all compared).",
      "The role is not a deterministic step that could be code.",
      "contextScope.exclude is populated and non-trivial.",
      "toolScope.deny includes the dangerous capabilities explicitly.",
      "The fallback chain has provider diversity.",
      "The primary evaluation is computable from the run artefact.",
      "Every failure class has a response that routes to the right scope.",
      "autonomy.maxLevel is justified; anything above L2 requires a calibration report.",
      "independence is declared where the role judges another's output.",
      "The owner is a named human who will notice if the role's metrics degrade."
    ],
    "worked": true
  },
  {
    "file": "WORKFLOW.md",
    "title": "Workflow Definition",
    "kind": "Workflow",
    "useWhen": "defining a workflow the factory can execute — an ordered composition of stages, gates, and state transitions.",
    "authority": "09_ORCHESTRATION_STATE_AND_EVENTS.md (state machine, stage kinds, task graph) and 12_END_TO_END_WORKFLOWS.md (the thirteen-field specification format) are the sources of truth.",
    "submission": "this file is a definition change. It is reviewed at the workflow-scope approval class (09_... §9.1) and must survive a replay evaluation before it is applied (09_... §9).",
    "rules": [
      {
        "n": 1,
        "t": "A workflow is a durable machine, not a script. It must be resumable from any point using only the event log. If a stage's correctness depends on conversational context that was not persisted, it is not a workflow stage."
      },
      {
        "n": 2,
        "t": "Deterministic stages outnumber agent stages. If a step can be expressed as code, it is code (09_... §8.1). An agent stage exists only where judgement or generation is genuinely required."
      },
      {
        "n": 3,
        "t": "Every agent stage is bounded. Turn, wall-clock, token, and cost budgets are declared. Budget exhaustion returns a labelled incomplete result, never a silent truncation (FR-32)."
      },
      {
        "n": 4,
        "t": "Every agent stage carries an acceptance oracle reference. A stage whose success cannot be decided by an oracle is not ready to run."
      },
      {
        "n": 5,
        "t": "Every fan-out carries a chunkability justification. The four conditions from ADR-0010 are checked at admission; a missing justification is a validation failure, not a warning."
      },
      {
        "n": 6,
        "t": "Autonomy is declared, not assumed. A workflow's autonomy level is the ceiling of what it may do unattended. Every workflow starts at or below L2 (ADR-0003). Raising it requires calibration evidence, not a version bump."
      },
      {
        "n": 7,
        "t": "Effect classes bound the gates. A workflow that can invoke an E2, E3, or E4 capability must declare the approval that precedes each such invocation. Undeclared high-effect capability usage is a submission blocker."
      },
      {
        "n": 8,
        "t": "The context rule is explicit. Each stage declares what context it needs; the assembler selects, the stage does not choose at runtime (10_... §5)."
      },
      {
        "n": 9,
        "t": "Failure handling is per-step, not global. Every step declares what happens when it fails, and where the failure is classified. A workflow without a documented failure path is incomplete."
      },
      {
        "n": 10,
        "t": "No duplicated truth. Where a rule is already stated — in a skill, a standard, a policy — the workflow points at it rather than restating it."
      }
    ],
    "body": "apiVersion: factory/v1\nkind: Workflow\nmetadata:\n  id: wf_<kebab-case-name>          # stable across versions\n  version: <integer>                # increment on any semantic change\n  owner: <team-or-person>           # accountable for this workflow's behaviour\n  title: <short human title>\n  description: >\n    What this workflow accomplishes. Also what it explicitly does not do.\n  # The autonomy ceiling. Raising it requires calibration evidence (ADR-0003).\n  autonomy:\n    level: L0 | L1 | L2 | L3 | L4\n    grantedAt: <date>\n    grantedBy: <approver>\n    calibrationEvidence: <calibration-report-ref>\n    # Optional ceiling for a subset of stages that have earned more.\n    perStageOverrides:\n      - {node: n_05, level: L3, evidence: <ref>}\n\n# ── Entry ───────────────────────────────────────────────────────────────\ntrigger:\n  # A workflow starts from a declared entry point. There is no implicit\n  # \"the agent decided to run this\".\n  type: access-point | scheduled | event | internal\n  accessPoint: ap_intake | ap_intent | ap_incident | ap_batch\n  # The human-authorised starting condition.\n  condition: >\n    A human submits an intent through the access-point API carrying the\n    goal and any stated constraints.\n  # Whether the trigger may fire unattended.\n  automatic: false\n  # Rate/back-pressure constraints on automatic triggers.\n  maxConcurrent: <integer>\n\n# ── Inputs ──────────────────────────────────────────────────────────────\ninputs:\n  - name: <input>\n    type: artefact | specification | context-envelope | grant | budget\n    source: <access-point | upstream-stage | external-system>\n    required: true | false\n    # For artefacts: how the producer's output is validated before use.\n    validation: <validator-id> | none\n    # Whether the input is trusted content or untrusted-content (ADR-0004).\n    trust: trusted | untrusted-content | derived\n\n# ── Outputs ─────────────────────────────────────────────────────────────\noutputs:\n  - name: <output>\n    type: artefact | specification | task-graph | verdict | report\n    description: <what it is>\n    # Terminal condition of the workflow, expressed as a check.\n    completionCheck: <checkable condition>\n\n# ── Stages ──────────────────────────────────────────────────────────────\nstages:\n  - id: s01\n    kind: specify | plan | implement | verify | review | aggregate |\n          approve | merge | deploy | sweep | investigate | record |\n          evaluate | propose\n    name: <short name>\n    # The role spec that executes it, or `deterministic` for code stages.\n    executor: role.<name> | deterministic | human | model-assisted\n    objective: >\n      What this stage is for, in one or two sentences.\n    # What the stage is explicitly not responsible for.\n    nonResponsibilities:\n      - <responsibility belonging to another stage>\n    # The oracle that decides this stage's success. Required for agent stages.\n    acceptanceOracle:\n      ref: <oracle-id>@<version>\n      constructedBefore: true\n      provenance: deterministic-generator | human-authored | imported\n      independence: agent-independent\n    contextScope:\n      include: [<stage.specification>, <skill.*>, <standards.applicable>, ...]\n      exclude: [<sibling.stage.context>, <planner.fullGraph>, ...]\n    toolScope:\n      grant: [<capability.id>]\n      deny:  [<capability.id>]\n    # Budgets. Every agent stage is bounded.\n    limits:\n      turns: <integer>\n      wallClockSeconds: <integer>\n      tokenBudget: <integer>\n      costBudgetUsd: <number>\n    # For stages that fan out or hand work to others.\n    spawns:\n      permitted: false\n      maxDepth: <integer>\n      inheritsGrants: true\n    # What happens when this stage fails.\n    onFailure:\n      classification: model.reasoning | context.insufficient |\n                      workflow.composition | verification.failed |\n                      infrastructure | budget.exhausted | approval.refused\n      action: retry | escalate | fail-task | skip-dependent | abort\n      retryBudget: <integer>\n      # The scope a proposal would go to, if the failure suggests a change.\n      attributionScope: run | skill | workflow | harness\n    # For a human stage: what the human is being asked to decide.\n    approval:\n      class: <approval-class>\n      binding: artefact-hash\n      approvers: [<role-or-group>]\n      expiresSeconds: <integer>\n\n# ── Graph ───────────────────────────────────────────────────────────────\ngraph:\n  nodes: [s01, s02, ...]\n  edges:\n    - from: s01\n      to: s02\n      classification: dependent | independent\n      # Mandatory on every edge. For dependent edges: why the artefact is\n      # needed. For independent edges: the four chunkability conditions.\n      justification: >\n        ...\n  # The order in which nodes may be integrated when several complete.\n  integrationOrder: [s01, s02]\n  integrationNote: >\n    Which nodes may merge in any order, and which are strictly ordered.\n\n# ── Gates ───────────────────────────────────────────────────────────────\ngates:\n  - id: g1\n    name: <gate name>\n    kind: acceptance | verification | standard | review | approval |\n          policy | blast-radius | confidence\n    runsAt: <stage id>\n    # The check performed.\n    check: <deterministic-check-id> | <verifier-id> | human-review\n    # A failing gate means: retry the producing stage, or escalate.\n    onFailure: retry-stage | fail-task | escalate | reject\n    # Gates that may never be weakened by a failing run.\n    nonWeakening: true\n  # The approval gate set by blast-radius tier (13_... §5).\n  approvalByBlastRadius:\n    R0: [<approval-class>]\n    R1: [<approval-class>]\n    R2: [<approval-class>]\n    R3: [<approval-class>]\n    R4: [<approval-class>]\n\n# ── Completion ──────────────────────────────────────────────────────────\ncompletionCriteria:\n  - <the checkable condition that means this workflow is done>\nfailureHandling:\n  # The workflow-level failure taxonomy and where each class is routed.\n  routing:\n    model.reasoning: retry-and-escalate\n    context.insufficient: skill-scope-proposal\n    workflow.composition: workflow-scope-proposal\n    verification.failed: retry-stage\n    infrastructure: fail-task\n    budget.exhausted: incomplete-result-to-human\n    approval.refused: task-rejected\nobservability:\n  # What is emitted beyond the standard event envelope.\n  metrics: [<metric.name>]\n  projections: [<projection.name>]\n  # The dashboards / views this workflow appears in.\n  surfaces: [<surface.name>]\nrelatedWorkflows: [wf_<name>]\nrelatedSkills: [skill.<name>]",
    "lang": "yaml",
    "checklist": [
      "kind on each stage matches 09_... §8.1; deterministic stages are marked deterministic and not given an agent.",
      "Every agent stage has budgets, a context scope with a non-trivial exclude, and a tool scope with an explicit deny.",
      "Every agent stage has an acceptanceOracle with constructedBefore: true and independence: agent-independent.",
      "Every edge carries a justification; independent edges satisfy the four chunkability conditions.",
      "The graph is acyclic and every node is reachable from the trigger.",
      "Every E2/E3/E4 capability in a tool scope has a declared approval gate preceding its use.",
      "autonomy.level is at or below L2 unless calibration evidence is referenced.",
      "completionCriteria are checkable and each output has a completion check.",
      "Every stage has an onFailure with a classification and an action.",
      "Approval classes match the blast-radius tier table in 13_... §5.",
      "No gate is marked nonWeakening: false if it is an acceptance or standards gate.",
      "The workflow survives a replay: every stage's inputs are persisted artefacts, not conversational state."
    ],
    "worked": true
  },
  {
    "file": "MCP_INTEGRATION.md",
    "title": "Integration Registration",
    "kind": "McpServerRegistration / ToolCapability",
    "useWhen": "registering an external system with the factory — an MCP server, an HTTP service, a CLI, or an in-process library.",
    "authority": "11_TOOLS_MCP_AND_INTEGRATIONS.md §2 (capability record), §3 (MCP story and reconciliation), §4 (grants and scopes), §7 (credentials) are the sources of truth.",
    "submission": "this file is a definition change. It is reviewed at the security-scope approval class whenever the capability's effect class is E2 or above, because the registration defines what the factory can reach.",
    "rules": [
      {
        "n": 1,
        "t": "The registry is authoritative. A capability that is not in the registry does not exist for the factory, regardless of what a server advertises. A server operator adding a tool does not thereby add it (FR-62)."
      },
      {
        "n": 2,
        "t": "MCP is a transport, not a capability model. The registration is factory-owned and transport-independent. Changing transport must not require changing a workflow's grant."
      },
      {
        "n": 3,
        "t": "Declare the effect class honestly, and conservatively when unsure. The effect class determines which gates the capability passes through. A misclassification weakens the gate. An over-restrictive classification is a friction cost; an under-restrictive one is a safety defect."
      },
      {
        "n": 4,
        "t": "Never name a secret. The capability names a credentialRef; the credential broker resolves it at call time. A capability record containing secret material is a rejection, not a review comment."
      },
      {
        "n": 5,
        "t": "Trust levels are explicit. untrusted servers are never offered to an agent, regardless of how useful their tools are."
      },
      {
        "n": 6,
        "t": "Input and output trust are classified separately. An issue body's text is untrusted even when the issue was filed by a colleague; a build result from your own CI is trusted output but may contain untrusted upstream material."
      },
      {
        "n": 7,
        "t": "Prefer the transport with the strongest output contract. A schema-validated output is a cheap failure; a prose output is a silent corruption risk."
      },
      {
        "n": 8,
        "t": "Every capability has an owner and a health check. A capability without an owner is unmaintained; one without a health check is discovered broken by a user's task."
      },
      {
        "n": 9,
        "t": "Scope is expressed in the registry. The resourcePattern is what the broker checks against the actual resource at invocation time — this is the check that catches a capability handed the wrong repository."
      },
      {
        "n": 10,
        "t": "An integration that cannot state its degraded behaviour is not ready. Every capability must say what happens when it is unavailable."
      }
    ],
    "body": "apiVersion: factory/v1\nkind: McpServerRegistration\nmetadata:\n  id: mcp.<vendor>.<purpose>       # stable identity\n  version: <integer>\n  owner: <team-or-person>           # accountable for this integration\n  title: <short human title>\n  description: >\n    What this server provides and what it is used for.\n  transport:\n    type: stdio | http-sse | streamable-http\n    # For stdio: the command and its pinned version.\n    command: [<binary>]\n    version: \"<pinned>\"\n    args: []\n    # For HTTP: the endpoint and its authentication reference.\n    endpoint: <url>\n    # Where the server process runs. Not inside an agent's environment.\n    runsIn: control-plane | broker-side\n  trust:\n    level: internal | external | untrusted\n    verified: true | false\n    # Where the provenance was established.\n    provenance: <evidence-reference>\n    signature: <signature-ref> | null\n    # External servers: the per-tool approval that is mandatory before use.\n    perToolApprovalRequired: true | false\n  scope:\n    # The capabilities this server may expose. A tool outside this list is\n    # not reconciled into the registry at all.\n    allowedCapabilities: [<glob or id>]\n    # Explicitly excluded, even if advertised.\n    deniedCapabilities: [<capability.id>]\n  credentials:\n    # A reference, never a secret.\n    credentialRef: cred.<name>\n    # The scopes the credential carries.\n    scopes: [<scope>]\n    # Whether the credential is minted per invocation or pooled.\n    issuance: per-invocation | pooled\n    ttlSeconds: <integer>\n  network:\n    egress: none | <declared-hosts>\n    # For a stdio server: the hosts it is permitted to reach.\n    allowedHosts: []\n    denyAllElse: true\n  health:\n    checkType: spawn-and-list | http-probe | <custom>\n    intervalSeconds: <integer>\n    timeoutSeconds: <integer>\n    degradedBehaviour: fail-fast | degrade | queue\n    # When `degrade`, the named reduced mode.\n    reducedMode: <description> | null\n  discovery:\n    # registered-static: the registry entry is the only truth.\n    # probed-and-diffed: the server is probed and the difference recorded.\n    mode: registered-static | probed-and-diffed\n    reconciledAt: <timestamp>\n    # Where the findings from the last reconciliation are recorded.\n    findingsRef: <finding-record-ref> | null",
    "lang": "yaml",
    "checklist": [
      "The server's trust level is justified, with provenance recorded; untrusted means no tool is offered to an agent.",
      "Every advertised tool has a corresponding registry record, or a reconciliation finding explaining why not.",
      "Every capability has an effect class, and the class is consistent with the undo claim: reversible: true requires a real undo.",
      "No capability record contains secret material — only a credentialRef.",
      "scope.resourcePattern is specific enough to catch a capability handed the wrong resource.",
      "trust.inputTrust and trust.resultTrust are classified, and any content originating outside the organisation is untrusted-content.",
      "health.degradedBehaviour is set for every capability, and a degrade names its reduced mode.",
      "The server does not run inside an agent's execution environment; it runs control-plane or broker-side.",
      "The credential's scopes are no broader than the capability's required scopes.",
      "E2+ capabilities have an enumerated runbook or an approval gate declared in the consuming workflow.",
      "discovery.mode is registered-static unless a probe exists; the reconciliation record is retained.",
      "The transport's output is schema-validated, or the capability is explicitly marked structured: false with a rationale."
    ],
    "worked": true
  },
  {
    "file": "SKILL_SPEC.md",
    "title": "Skill Specification",
    "kind": "Skill",
    "useWhen": "defining a skill — either a procedure (how to do something) or a standard (a property to adhere to).",
    "authority": "10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md §4 is the source of truth.",
    "submission": "this file is a definition change at skill scope. Under ADR-0007, it may be merged automatically if it is additive and below the risk threshold; otherwise it needs review.",
    "rules": [
      {
        "n": 1,
        "t": "Specificity is the ruler of quality. Every instruction names a concrete artefact, a command pattern, or a property. \"Handle errors appropriately\" is not an instruction."
      },
      {
        "n": 2,
        "t": "State properties; do not inject derivable facts. If the agent could compute it in one step with its tools, it does not belong in the skill. Write \"read the test command from package.json\", not \"run pnpm test\"."
      },
      {
        "n": 3,
        "t": "One purpose per skill. A skill expressing one procedure or one standard."
      },
      {
        "n": 4,
        "t": "A skill never grants capability. It may request a tool in its steps; the policy engine decides. A skill that says \"run the deploy command\" is a capability grant written in English."
      },
      {
        "n": 5,
        "t": "Every standard states at least one checkable property — or explicitly records that it is not mechanisable, and why. That record is part of the skill."
      },
      {
        "n": 6,
        "t": "No duplicate truth. A fact stated in two skills is a defect; one must point to the other."
      },
      {
        "n": 7,
        "t": "Every reference resolves. A reference to a skill, file, or endpoint that does not resolve is a validation failure."
      },
      {
        "n": 8,
        "t": "Bounded size. A skill exceeding the per-item context budget is split."
      },
      {
        "n": 9,
        "t": "Privileged skills get the elevated review. A skill that changes what an agent may do requires the security-relevant review class (FR-16)."
      }
    ],
    "body": "apiVersion: factory/v1\nkind: Skill\nmetadata:\n  id: skill.<kebab-case-name>       # stable across versions\n  version: <integer>                 # increment on any semantic change\n  owner: <team-or-person>            # accountable for this skill's correctness\n  kind: standard | procedure\n  title: <short human title>\n  description: >\n    One or two sentences. What this covers and, importantly, what it does not.\n  appliesTo:\n    paths: [<glob>]                  # the files it governs\n    repositories: [<glob>]           # omit for a universal skill\n    taskTypes: [change, incident, sweep, research]\n  body:\n    format: markdown\n    contentRef: skills/<name>.md     # the content is versioned separately\n  # ── For kind: standard ─────────────────────────────────────────────\n  properties:\n    - id: prop.<kebab-case-name>\n      statement: >\n        A binary, checkable condition. \"X must be Y.\" Not \"X should be reasonable.\"\n      severity: error | warning\n      scope:\n        paths: [<glob>]\n      # The mechanism that checks it. Leave out only if not mechanisable.\n      verifier:\n        kind: static-rule | lllm-judge | deterministic-check\n        generator: <verifier.id>@<version>\n        deterministic: true | false\n        # For lllm-judge: the rubric lives with the property.\n        rubric: <rubric-reference>\n        calibration:\n          status: uncalibrated | calibrated | expired\n          corpus: <calibration-corpus-id>\n          detectionRate: <0..1>\n          falsePositiveRate: <0..1>\n          lastCalibrated: <date>\n      # If not mechanisable, say so and why. This record is required.\n      # notMechanisableBecause: <explanation>\n  # ── For kind: procedure ─────────────────────────────────────────────\n  steps:\n    - id: s1\n      instruction: >\n        A concrete instruction naming the artefact, command pattern, or check.\n      tools: [<capability.id>]       # requested; the policy engine decides\n      produces: [<artefact.name>]\n      onFailure: <what to do when this step fails>\n  inputs:\n    - {name: <input>, type: artefact | specification | context}\n  outputs:\n    - {name: <output>, type: artefact}\n  completionCriteria:\n    - <the checkable condition that means this skill's work is done>\n  relatedSkills: [skill.<name>]     # one-directional pointers; no duplicated truth\n  trust:\n    classification: trusted          # skills are trusted content\n    privileged: false                # true ⇒ elevated review class required\n  evaluation:\n    benchmark: <benchmark-id>        # this skill's own benchmark, if it has one\n    lastCalibrated: <date>\n    successMetric: <metric.name>     # how to tell the skill worked\n  supersedes: <skill.id>@<version>   # for the next version",
    "lang": "yaml",
    "checklist": [
      "kind is correctly standard or procedure, and the body matches.",
      "Every instruction is specific — it names an artefact, a command pattern, or a property.",
      "No derivable fact is injected.",
      "Every standard has at least one checkable property, or an explicit notMechanisableBecause.",
      "Every verifier's calibration state is current; an expired one is not merged.",
      "Every reference (contentRef, relatedSkills, benchmark, corpus) resolves.",
      "No fact is stated in two skills.",
      "appliesTo is narrow enough that the skill is selected only when it applies.",
      "privileged is correct; a privileged skill carries the elevated review.",
      "The skill body is within the per-item context budget.",
      "The completion criteria are checkable."
    ],
    "worked": true
  },
  {
    "file": "EXPERIMENT.md",
    "title": "Experiment Report",
    "kind": "Experiment",
    "useWhen": "reporting the evidence for a change to the factory — a new skill version, a workflow change, a model or routing change, a policy change, an autonomy promotion.",
    "authority": "ADR-0011 §3 (the four required elements) and 14_QUALITY_TESTING_AND_EVALUATION.md §7 (the evaluation framework) are the sources of truth.",
    "submission": "an experiment report is an evidence artefact, not a decision. It accompanies a proposal; it does not authorise anything. A proposal that references a report with a missing element is rejected at validation.",
    "rules": [
      {
        "n": 1,
        "t": "Four elements, always: baseline, delta, cost, guardrail. A change with no baseline is not evidence. A change with no guardrail is not safe. This is ADR-0011 §3 and is non-negotiable."
      },
      {
        "n": 2,
        "t": "The baseline is measured, not remembered. It is the same metric, on the same workload, over a stated window, before the change — not a figure quoted from a slide."
      },
      {
        "n": 3,
        "t": "The comparison is controlled. Both sides use the same run set, the same window, and the same evaluation criteria. A comparison across different workloads is not a comparison."
      },
      {
        "n": 4,
        "t": "Model outputs are regenerated, not replayed. A replay that reused recorded outputs would measure nothing; see 15_... §7.2."
      },
      {
        "n": 5,
        "t": "The run set's limits are stated. Every report names what the run set cannot represent. A report that claims generality from a historical set is overclaiming."
      },
      {
        "n": 6,
        "t": "Cost includes the evaluation's own cost. An experiment that consumed more than it returned is a negative result and must be reported as one."
      },
      {
        "n": 7,
        "t": "The guardrail set is drawn from the standing list, and any guardrail the change was expected to affect is stated even when it did not."
      },
      {
        "n": 8,
        "t": "A null result is a result. \"No measurable difference\" is a finding worth recording; it prevents the same proposal being re-proposed with a different name."
      },
      {
        "n": 9,
        "t": "The report is an artefact. It is retained, joinable to the proposal and to the definition revision, and it is itself subject to the retention policy."
      }
    ],
    "body": "# Experiment EXP-NNNN — <what is being evaluated>\n\n- **Experiment id:** EXP-NNNN\n- **Date:** <YYYY-MM-DD>\n- **Author:** <team-or-person>\n- **Proposal under test:** <proposal-id> — <one line>\n- **Scope of the change:** skill | workflow | harness | policy | autonomy | routing | environment\n- **Status:** Complete | Incomplete | Inconclusive | Abandoned\n- **Decision:** Proceed | Proceed with changes | Reject | Defer pending <what>\n\n---\n\n## 1. Hypothesis\n\n<What you expect to happen, stated so that it can be wrong. Include the\ndirection of the expected effect and the metric it should show up in.>\n\n## 2. Method\n\n### 2.1 Change under test\n<Exactly what differs between baseline and candidate. A single change; if\nseveral changed, the experiment is a bundle and that is stated here.>\n\n### 2.2 Run set\n\n| Property | Value |\n|---|---|\n| Class (what kind of task) | <the affected class> |\n| Window | <start> to <end> |\n| Size (N runs) | <n> |\n| Held-out portion | <n> or none |\n| Selection rule | <how the runs were selected — must be reproducible> |\n| Known composition | <the mix of task types in the set> |\n\n### 2.3 Procedure\n1. Evaluate the **baseline** configuration on the run set.\n2. Evaluate the **candidate** configuration on the same run set.\n3. Compare on the stated metric set and the stated guardrail set.\n4. Report the four elements.\n\n### 2.4 Repetitions\n<How many times each side was run. Model behaviour is non-deterministic;\na single pass on each side is a comparison of two samples, not of two\nconfigurations.>\n\n### 2.5 Evaluation criteria\n<The metrics compared, with their definitions and collection points.>\n\n## 3. Baseline\n\n| Metric | Value | Window | Workload | Notes |\n|---|---|---|---|---|\n| <metric> | <value> | <window> | <same run set> | <collection point> |\n\n## 4. Delta\n\n| Metric | Baseline | Candidate | Delta | Confidence | Interpretation |\n|---|---|---|---|---|---|\n| <metric> | <value> | <value> | <±value> | <interval or \"sample too small\"> | <one line> |\n\n**What this does and does not support.** <The claim the evidence supports,\nand the stronger claim it does not.>\n\n## 5. Cost\n\n| Component | Baseline | Candidate | Delta |\n|---|---|---|---|\n| Inference (tokens / USD) | | | |\n| Tool execution | | | |\n| Infrastructure | | | |\n| Human time (if material) | | | |\n| **Evaluation cost (this experiment)** | | | |\n\n**Cost per accepted change:** <baseline> → <candidate>\n**Does the improvement pay for itself?** <yes/no/insufficient data, with the\nbreak-even stated if computable>\n\n## 6. Guardrails\n\n| Guardrail | Baseline | Candidate | Breach? | Threshold |\n|---|---|---|---|---|\n| Defect escape rate | | | | |\n| Revert rate | | | | |\n| Human intervention rate | | | | |\n| Cost per accepted change | | | | |\n| Context budget compliance | | | | |\n| Approval rubber-stamp rate | | | | |\n| Gate failure rate | | | | |\n| Total system cost | | | | |\n\n<Any guardrail the change was expected to affect is discussed even if it did\nnot move.>\n\n## 7. Observations and anomalies\n\n<What happened that was not predicted. Failures, flakiness, side effects,\nsegments where the effect reversed. A report that lists only what was\nexpected is a summary, not an experiment.>\n\n## 8. Limits of this evidence\n\n- <what the run set cannot represent>\n- <what the sample size does not support>\n- <what a field trial would capture that this did not>\n- <what would change the conclusion>\n\n## 9. Conclusion and next step\n\n<Proceed / Proceed with changes / Reject / Defer. What was learned that\ngeneralises beyond this proposal? What is the next experiment this suggests?>\n\n## 10. Artefact references\n\n- Run set: <run-set-id>\n- Baseline run: <run-id>\n- Candidate run: <run-id>\n- Proposal: <proposal-id>\n- Definition revision: <revision-id>\n- Event log window: <event-log-query-ref>",
    "lang": "markdown",
    "checklist": [
      "All four elements are present: baseline, delta, cost, guardrail.",
      "The baseline was measured on the same workload and window as the candidate.",
      "The run set is class-matched, sized, time-windowed, reproducible, and — where the sample permits — held out.",
      "Both sides were evaluated with the same criteria, and the repetition count is stated.",
      "The guardrail table covers all eight standing guardrails, including those the change was not expected to affect.",
      "Cost includes the evaluation's own cost.",
      "The limits section states what the run set cannot represent.",
      "Observations include what was not predicted; the section is not empty.",
      "Every artefact reference resolves to a retained run, proposal, or revision.",
      "The decision is one of the four permitted values, and the approval class is named.",
      "No metric in this report uses a corpus figure as a target or a threshold."
    ],
    "worked": true
  }
];
