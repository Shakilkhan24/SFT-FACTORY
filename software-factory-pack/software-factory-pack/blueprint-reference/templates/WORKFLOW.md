# Template — Workflow Definition (`Workflow`)

**Use when:** defining a workflow the factory can execute — an ordered composition of stages, gates, and state transitions.
**Authority:** `09_ORCHESTRATION_STATE_AND_EVENTS.md` (state machine, stage kinds, task graph) and `12_END_TO_END_WORKFLOWS.md` (the thirteen-field specification format) are the sources of truth.
**Submission:** this file is a **definition change**. It is reviewed at the **workflow-scope** approval class (`09_...` §9.1) and must survive a replay evaluation before it is applied (`09_...` §9).

---

## Authoring rules

Read these before filling the template.

1. **A workflow is a durable machine, not a script.** It must be resumable from any point using only the event log. If a stage's correctness depends on conversational context that was not persisted, it is not a workflow stage.
2. **Deterministic stages outnumber agent stages.** If a step can be expressed as code, it is code (`09_...` §8.1). An agent stage exists only where judgement or generation is genuinely required.
3. **Every agent stage is bounded.** Turn, wall-clock, token, and cost budgets are declared. Budget exhaustion returns a labelled incomplete result, never a silent truncation (FR-32).
4. **Every agent stage carries an acceptance oracle reference.** A stage whose success cannot be decided by an oracle is not ready to run.
5. **Every fan-out carries a chunkability justification.** The four conditions from ADR-0010 are checked at admission; a missing justification is a validation failure, not a warning.
6. **Autonomy is declared, not assumed.** A workflow's autonomy level is the ceiling of what it may do unattended. Every workflow starts at or below L2 (ADR-0003). Raising it requires calibration evidence, not a version bump.
7. **Effect classes bound the gates.** A workflow that can invoke an E2, E3, or E4 capability must declare the approval that precedes each such invocation. Undeclared high-effect capability usage is a submission blocker.
8. **The context rule is explicit.** Each stage declares what context it needs; the assembler selects, the stage does not choose at runtime (`10_...` §5).
9. **Failure handling is per-step, not global.** Every step declares what happens when it fails, and where the failure is classified. A workflow without a documented failure path is incomplete.
10. **No duplicated truth.** Where a rule is already stated — in a skill, a standard, a policy — the workflow points at it rather than restating it.

---

## The template

```yaml
apiVersion: factory/v1
kind: Workflow
metadata:
  id: wf_<kebab-case-name>          # stable across versions
  version: <integer>                # increment on any semantic change
  owner: <team-or-person>           # accountable for this workflow's behaviour
  title: <short human title>
  description: >
    What this workflow accomplishes. Also what it explicitly does not do.
  # The autonomy ceiling. Raising it requires calibration evidence (ADR-0003).
  autonomy:
    level: L0 | L1 | L2 | L3 | L4
    grantedAt: <date>
    grantedBy: <approver>
    calibrationEvidence: <calibration-report-ref>
    # Optional ceiling for a subset of stages that have earned more.
    perStageOverrides:
      - {node: n_05, level: L3, evidence: <ref>}

# ── Entry ───────────────────────────────────────────────────────────────
trigger:
  # A workflow starts from a declared entry point. There is no implicit
  # "the agent decided to run this".
  type: access-point | scheduled | event | internal
  accessPoint: ap_intake | ap_intent | ap_incident | ap_batch
  # The human-authorised starting condition.
  condition: >
    A human submits an intent through the access-point API carrying the
    goal and any stated constraints.
  # Whether the trigger may fire unattended.
  automatic: false
  # Rate/back-pressure constraints on automatic triggers.
  maxConcurrent: <integer>

# ── Inputs ──────────────────────────────────────────────────────────────
inputs:
  - name: <input>
    type: artefact | specification | context-envelope | grant | budget
    source: <access-point | upstream-stage | external-system>
    required: true | false
    # For artefacts: how the producer's output is validated before use.
    validation: <validator-id> | none
    # Whether the input is trusted content or untrusted-content (ADR-0004).
    trust: trusted | untrusted-content | derived

# ── Outputs ─────────────────────────────────────────────────────────────
outputs:
  - name: <output>
    type: artefact | specification | task-graph | verdict | report
    description: <what it is>
    # Terminal condition of the workflow, expressed as a check.
    completionCheck: <checkable condition>

# ── Stages ──────────────────────────────────────────────────────────────
stages:
  - id: s01
    kind: specify | plan | implement | verify | review | aggregate |
          approve | merge | deploy | sweep | investigate | record |
          evaluate | propose
    name: <short name>
    # The role spec that executes it, or `deterministic` for code stages.
    executor: role.<name> | deterministic | human | model-assisted
    objective: >
      What this stage is for, in one or two sentences.
    # What the stage is explicitly not responsible for.
    nonResponsibilities:
      - <responsibility belonging to another stage>
    # The oracle that decides this stage's success. Required for agent stages.
    acceptanceOracle:
      ref: <oracle-id>@<version>
      constructedBefore: true
      provenance: deterministic-generator | human-authored | imported
      independence: agent-independent
    contextScope:
      include: [<stage.specification>, <skill.*>, <standards.applicable>, ...]
      exclude: [<sibling.stage.context>, <planner.fullGraph>, ...]
    toolScope:
      grant: [<capability.id>]
      deny:  [<capability.id>]
    # Budgets. Every agent stage is bounded.
    limits:
      turns: <integer>
      wallClockSeconds: <integer>
      tokenBudget: <integer>
      costBudgetUsd: <number>
    # For stages that fan out or hand work to others.
    spawns:
      permitted: false
      maxDepth: <integer>
      inheritsGrants: true
    # What happens when this stage fails.
    onFailure:
      classification: model.reasoning | context.insufficient |
                      workflow.composition | verification.failed |
                      infrastructure | budget.exhausted | approval.refused
      action: retry | escalate | fail-task | skip-dependent | abort
      retryBudget: <integer>
      # The scope a proposal would go to, if the failure suggests a change.
      attributionScope: run | skill | workflow | harness
    # For a human stage: what the human is being asked to decide.
    approval:
      class: <approval-class>
      binding: artefact-hash
      approvers: [<role-or-group>]
      expiresSeconds: <integer>

# ── Graph ───────────────────────────────────────────────────────────────
graph:
  nodes: [s01, s02, ...]
  edges:
    - from: s01
      to: s02
      classification: dependent | independent
      # Mandatory on every edge. For dependent edges: why the artefact is
      # needed. For independent edges: the four chunkability conditions.
      justification: >
        ...
  # The order in which nodes may be integrated when several complete.
  integrationOrder: [s01, s02]
  integrationNote: >
    Which nodes may merge in any order, and which are strictly ordered.

# ── Gates ───────────────────────────────────────────────────────────────
gates:
  - id: g1
    name: <gate name>
    kind: acceptance | verification | standard | review | approval |
          policy | blast-radius | confidence
    runsAt: <stage id>
    # The check performed.
    check: <deterministic-check-id> | <verifier-id> | human-review
    # A failing gate means: retry the producing stage, or escalate.
    onFailure: retry-stage | fail-task | escalate | reject
    # Gates that may never be weakened by a failing run.
    nonWeakening: true
  # The approval gate set by blast-radius tier (13_... §5).
  approvalByBlastRadius:
    R0: [<approval-class>]
    R1: [<approval-class>]
    R2: [<approval-class>]
    R3: [<approval-class>]
    R4: [<approval-class>]

# ── Completion ──────────────────────────────────────────────────────────
completionCriteria:
  - <the checkable condition that means this workflow is done>
failureHandling:
  # The workflow-level failure taxonomy and where each class is routed.
  routing:
    model.reasoning: retry-and-escalate
    context.insufficient: skill-scope-proposal
    workflow.composition: workflow-scope-proposal
    verification.failed: retry-stage
    infrastructure: fail-task
    budget.exhausted: incomplete-result-to-human
    approval.refused: task-rejected
observability:
  # What is emitted beyond the standard event envelope.
  metrics: [<metric.name>]
  projections: [<projection.name>]
  # The dashboards / views this workflow appears in.
  surfaces: [<surface.name>]
relatedWorkflows: [wf_<name>]
relatedSkills: [skill.<name>]
```

---

## Worked example — the bug-fix workflow (Workflow C, abridged)

```yaml
apiVersion: factory/v1
kind: Workflow
metadata:
  id: wf_bugfix
  version: 3
  owner: engineering
  title: Autonomous bug fixing
  description: >
    Turns a reported defect into a pull request containing a fix and a
    regression test. Does not merge, deploy, or decide whether the defect
    is worth fixing.
  autonomy:
    level: L2
    grantedAt: "2026-11-05"
    grantedBy: platform architecture
    calibrationEvidence: calib.regression-suite@1

trigger:
  type: access-point
  accessPoint: ap_intake
  condition: >
    A human submits a defect report through the access-point API naming the
    observed behaviour and the expected behaviour.
  automatic: false
  maxConcurrent: 8

inputs:
  - name: defectReport
    type: artefact
    source: access-point
    required: true
    validation: none
    trust: untrusted-content          # a report may quote an untrusted source
  - name: repositoryScope
    type: context
    source: triage
    required: true
    trust: derived

outputs:
  - name: pullRequest
    type: artefact
    description: A PR containing the fix and a failing-then-passing regression test.
    completionCheck: >
      The regression test failed against the pre-fix revision and passes
      against the fixed revision, and every applicable gate passed.

stages:
  - id: s01
    kind: specify
    name: Reproduce
    executor: role.investigator
    objective: >
      Establish a reproducible failing case for the reported behaviour and
      name the suspected location.
    nonResponsibilities:
      - Changing any file — this stage observes only.
    acceptanceOracle:
      ref: oracle.repro-case@2
      constructedBefore: true
      provenance: deterministic-generator
      independence: agent-independent
    contextScope:
      include: [stage.specification, repo.local-context, skill.bug-reproduction]
      exclude: [sibling.stage.context, planner.fullGraph]
    toolScope:
      grant: [repo.read, shell.sandboxed]
      deny: [repo.write, prod.*, secret.read]
    limits: {turns: 40, wallClockSeconds: 900, tokenBudget: 120000, costBudgetUsd: 2.00}
    onFailure:
      classification: model.reasoning
      action: escalate
      retryBudget: 1
      attributionScope: run

  - id: s02
    kind: implement
    name: Fix and regression test
    executor: role.worker
    objective: >
      Produce the minimal fix together with a regression test that fails
      before the fix and passes after it.
    acceptanceOracle:
      ref: oracle.regression-suite@3
      constructedBefore: true
      provenance: human-authored
      independence: agent-independent
    contextScope:
      include: [stage.specification, repo.local-context, skill.test-authorship]
      exclude: [sibling.stage.context, implementer.transcript]
    toolScope:
      grant: [repo.read, repo.write.scoped, shell.sandboxed, ci.run]
      deny: [git.push.protected, prod.*, secret.read, factory.write]
    limits: {turns: 60, wallClockSeconds: 1800, tokenBudget: 200000, costBudgetUsd: 5.00}
    onFailure:
      classification: verification.failed
      action: retry-stage
      retryBudget: 2
      attributionScope: run

  - id: s03
    kind: verify
    name: Gate suite
    executor: deterministic
    objective: >
      Run the acceptance oracle, the applicable standards verifiers, and the
      repository's own test suite.
    contextScope:
      include: [stage.specification]
      exclude: [sibling.stage.context]
    toolScope:
      grant: [ci.run, ci.read]
      deny: [repo.write, prod.*]
    onFailure:
      classification: verification.failed
      action: retry-stage
      attributionScope: run

  - id: s04
    kind: review
    name: Review
    executor: role.reviewer
    objective: >
      Judge the change against its acceptance criteria and the applicable
      standards, and report findings with locations and rationale.
    acceptanceOracle:
      ref: oracle.review-completeness@1
      constructedBefore: true
      provenance: human-authored
      independence: agent-independent
    contextScope:
      include: [stage.specification, changeArtefact, standards.applicable]
      exclude: [implementer.transcript, sibling.stage.context, planner.fullGraph]
    toolScope:
      grant: [repo.read, ci.read, verifier.run]
      deny: [repo.write, git.push.protected, prod.*, secret.read, factory.write]
    limits: {turns: 60, wallClockSeconds: 1200, tokenBudget: 300000, costBudgetUsd: 8.00}
    onFailure:
      classification: model.reasoning
      action: escalate
      attributionScope: run

  - id: s05
    kind: approve
    name: Approval
    executor: human
    objective: >
      A human decides whether the proposed fix should proceed to a PR.
    approval:
      class: review-approval
      binding: artefact-hash
      approvers: [engineering-reviewer]
      expiresSeconds: 86400
    onFailure:
      classification: approval.refused
      action: abort
      attributionScope: run

  - id: s06
    kind: merge
    name: Open the pull request
    executor: deterministic
    objective: Push the branch and open the PR with the review context attached.
    contextScope:
      include: [stage.specification]
      exclude: [sibling.stage.context]
    toolScope:
      grant: [git.write.branch, git.write.commit, git.write.pr]
      deny: [git.push.protected, git.forcePush, prod.*, secret.read]
    onFailure:
      classification: infrastructure
      action: retry
      retryBudget: 2
      attributionScope: run

graph:
  nodes: [s01, s02, s03, s04, s05, s06]
  edges:
    - from: s01
      to: s02
      classification: dependent
      justification: >
        The fix cannot be authored without the reproducible failing case;
        the failing output is the input to the regression test.
    - from: s02
      to: s03
      classification: dependent
      justification: The gates evaluate the produced change.
    - from: s03
      to: s04
      classification: dependent
      justification: The reviewer is given the gate report, not the raw change alone.
  integrationOrder: [s02]
  integrationNote: >
    A single change is integrated. The PR is opened only after s05.

gates:
  - id: g1
    name: Acceptance oracle
    kind: acceptance
    runsAt: s03
    check: oracle.regression-suite@3
    onFailure: retry-stage
    nonWeakening: true
  - id: g2
    name: Standards verifiers
    kind: standard
    runsAt: s03
    check: standards.applicable
    onFailure: retry-stage
    nonWeakening: true
  - id: g3
    name: Confidence gate
    kind: confidence
    runsAt: s03
    check: policy.confidence.threshold@2
    onFailure: escalate
    nonWeakening: true
  approvalByBlastRadius:
    R0: [review-approval]
    R1: [review-approval]
    R2: [review-approval]
    R3: [review-approval, security-approval]
    R4: [review-approval, security-approval, release-approval]

completionCriteria:
  - The regression test fails against the pre-fix revision and passes against the fixed revision.
  - Every applicable gate passed.
  - The PR is open with the review verdict and the gate report attached.
  - No file outside the task's declared scope was modified.

failureHandling:
  routing:
    model.reasoning: retry-and-escalate
    context.insufficient: skill-scope-proposal
    workflow.composition: workflow-scope-proposal
    verification.failed: retry-stage
    infrastructure: fail-task
    budget.exhausted: incomplete-result-to-human
    approval.refused: task-rejected

observability:
  metrics: [workflow.cycleTime, workflow.firstPassGateRate, human.interventionRate]
  projections: [workflow_performance, agent_performance, cost_attribution]
  surfaces: [review-queue, task-detail]

relatedSkills: [skill.bug-reproduction, skill.test-authorship]
```

---

## Review checklist

Before submitting:

- [ ] `kind` on each stage matches `09_...` §8.1; deterministic stages are marked `deterministic` and not given an agent.
- [ ] Every agent stage has budgets, a context scope with a non-trivial `exclude`, and a tool scope with an explicit `deny`.
- [ ] Every agent stage has an `acceptanceOracle` with `constructedBefore: true` and `independence: agent-independent`.
- [ ] Every edge carries a justification; independent edges satisfy the four chunkability conditions.
- [ ] The graph is acyclic and every node is reachable from the trigger.
- [ ] Every E2/E3/E4 capability in a tool scope has a declared approval gate preceding its use.
- [ ] `autonomy.level` is at or below L2 unless calibration evidence is referenced.
- [ ] `completionCriteria` are checkable and each output has a completion check.
- [ ] Every stage has an `onFailure` with a classification and an action.
- [ ] Approval classes match the blast-radius tier table in `13_...` §5.
- [ ] No gate is marked `nonWeakening: false` if it is an acceptance or standards gate.
- [ ] The workflow survives a replay: every stage's inputs are persisted artefacts, not conversational state.

---

## Related

- `09_ORCHESTRATION_STATE_AND_EVENTS.md` §2 — the task state machine and its transition guards
- `09_ORCHESTRATION_STATE_AND_EVENTS.md` §7 — the task graph schema
- `09_ORCHESTRATION_STATE_AND_EVENTS.md` §8.1 — the stage-kind vocabulary
- `09_ORCHESTRATION_STATE_AND_EVENTS.md` §9 — the definition change lifecycle and approval classes
- `12_END_TO_END_WORKFLOWS.md` — the seven canonical workflows in their thirteen-field form
- `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` §5 — blast-radius tiers and the asymmetry rule
- `14_QUALITY_TESTING_AND_EVALUATION.md` §3 — the acceptance oracle
- `templates/ADR.md` — recording an architectural decision surfaced by a workflow
