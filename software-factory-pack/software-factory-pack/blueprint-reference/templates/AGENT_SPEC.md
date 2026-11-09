# Template — Agent Specification (`RoleSpec`)

**Use when:** defining a role the factory recognises.
**Authority:** `08_AGENT_CATALOG_AND_CONTRACTS.md` §8 is the source of truth for the schema's meaning.
**Submission:** this file is a **definition change**. It goes through the reviewed path (`13_...` §9.2).

---

## Authoring rules

Read these before filling the template.

1. **A role is a specification, not a deployment.** Do not create a role because "agents should specialise". A role is created only when its responsibilities genuinely differ from an existing role in **tools, authority, context scope, or evaluation**.
2. **Check for a merge first.** If an existing role has the same context scope, tool scope, authority, and evaluation, extend that role instead. Duplication is a defect (FR-31).
3. **Prefer determinism.** If the output can be specified exactly, the stage is code, not an agent role. Do not write a `RoleSpec` for a deterministic step.
4. **A role never grants capability.** `toolScope` declares what the role *requests*; the policy engine decides what is granted. The intersection of the workflow's grant, the stage's scope, and the resource scope is the effective capability set.
5. **Model policy is a routing hint, not a selection.** The gateway makes the final choice, and the fallback chain must have provider diversity.
6. **Every evaluation must be computable from the run artefact.** If you cannot compute it from what the framework records, it is not a metric.
7. **`contextScope.exclude` is not optional.** The exclusions are what keep cost predictable and prevent context bleed. List what this role must *not* see.

---

## The template

```yaml
apiVersion: factory/v1
kind: RoleSpec
metadata:
  name: <kebab-case-role-name>          # unique; the role's identity
  version: <integer>                    # increment on any semantic change
  owner: <team-or-person>               # accountable for this role's behaviour
  scope:
    kind: control-plane | data-plane    # control-plane roles are decision roles;
                                         # data-plane roles execute bounded work
  responsibility: >
    <One paragraph. What this role is for, in the imperative. Not a persona.
    If it takes more than three sentences, it is probably two roles.>
  # What this role is explicitly NOT responsible for.
  nonResponsibilities:
    - <responsibility that belongs to another role>
  # The inputs this role receives. Each must be produced by a named upstream stage.
  inputs:
    - name: <input>
      type: artefact | specification | context-envelope | grant | budget
      source: <stage or component that produces it>
      required: true | false
  # The outputs this role produces. Each is a typed artefact with a hash.
  outputs:
    - name: <output>
      type: artefact | specification | task-graph | verdict | report
      description: <what it is>
  contextScope:
    include:
      - <stage.specification>            # always
      - <stage.upstream>                 # only for dependent stages
      - <repo.local-context>             # scoped by the assembler
      - <standards.applicable>           # narrowed by file pattern
      - <skill.*>                        # named skills this role requires
    exclude:
      - <sibling.stage.context>
      - <planner.fullGraph>
      - <agent.ownTranscripts>
      - <agent.peerTranscripts>
  toolScope:
    grant:                              # requested; the policy engine decides
      - <capability.id>
    deny:                               # deny wins over grant at every level
      - <capability.id>
  modelPolicy:
    strategy: cheapest-above-threshold | strongest-above-threshold | fixed
    thresholdRef: <metric.name>          # the measured quality threshold
    fallbacks:
      - provider: <provider.id>
        tier: <tier>
        on: [provider-error, budget-exhausted, quality-signal]
    # A fallback to the same provider under the same failure mode is not a fallback.
    requiresProviderDiversity: true
  evaluation:
    primary: <metric.name>              # the one that decides the role's quality
    secondary:
      - <metric.name>
    failureClassification:
      model.reasoning: <retry-and-escalate policy>
      context.insufficient: <skill-scope proposal>
      workflow.composition: <workflow-scope proposal>
      # Unlisted classes default to workflow.composition for improvement purposes.
  limits:
    turns: <integer>                    # default 100
    wallClockSeconds: <integer>
    tokenBudget: <integer>
    costBudgetUsd: <number>
  autonomy:
    maxLevel: L0 | L1 | L2 | L3 | L4    # the ceiling this role may operate at
  spawning:
    permitted: true | false
    maxDepth: <integer>                 # default 1
    requiresChunkabilityJustification: true
    # A sub-agent cannot exceed its parent's authority.
    inheritsGrants: true
    globalConcurrencyLimit: <integer>
  # A role that must not be the same agent that produced what it reviews.
  independence:
    requiresDistinctFrom: <role.name>   # e.g. worker
    rationale: <why>
```

---

## Worked example — the Reviewer

```yaml
apiVersion: factory/v1
kind: RoleSpec
metadata:
  name: reviewer
  version: 3
  owner: engineering
  scope:
    kind: data-plane
  responsibility: >
    Judge whether a produced change meets its stated acceptance criteria and
    applicable standards, and report the judgement with location and rationale.
  nonResponsibilities:
    - Deciding whether the change should be merged — that is the panel's policy
      and the human approver's decision.
    - Writing or correcting the change under review.
  inputs:
    - {name: changeArtefact, type: artefact, source: worker, required: true}
    - {name: specification, type: specification, source: refinement, required: true}
    - {name: acceptanceCriteria, type: specification, source: refinement, required: true}
    - {name: applicableStandards, type: context-envelope, source: context-assembler, required: false}
    - {name: gateReport, type: report, source: verification-runtime, required: true}
  outputs:
    - {name: verdict, type: verdict, description: "Findings with locations, rationale, and validation mode"}
  contextScope:
    include:
      - stage.specification
      - changeArtefact
      - acceptanceCriteria
      - standards.applicable
      - gateReport
    exclude:
      - implementer.transcript     # inheriting the reasoning reproduces its blind spots
      - sibling.stage.context
      - planner.fullGraph
  toolScope:
    grant: [repo.read, ci.read, verifier.run]
    deny: [repo.write, git.push.protected, prod.*, secret.read, factory.write]
  modelPolicy:
    strategy: strongest-above-threshold
    thresholdRef: review.precisionThreshold
    fallbacks:
      - {provider: providerB, tier: large, on: [provider-error]}
    requiresProviderDiversity: true
  evaluation:
    primary: review.precisionRecall
    secondary: [review.calibrationError, review.escapeRateContribution]
    failureClassification:
      model.reasoning: retry with a different lens; escalate after budget
      context.insufficient: skill-scope proposal
      workflow.composition: workflow-scope proposal
  limits:
    turns: 60
    wallClockSeconds: 1200
    tokenBudget: 300000
    costBudgetUsd: 8.00
  autonomy:
    maxLevel: L2
  spawning:
    permitted: false
  independence:
    requiresDistinctFrom: worker
    rationale: >
      FR-35 — the reviewer identity must differ from the implementer's on every
      merge path. A correlated reviewer inherits the implementer's blind spots.
```

---

## Review checklist

Before submitting:

- [ ] The role is not a duplicate of an existing one (context, tools, authority, evaluation all compared).
- [ ] The role is not a deterministic step that could be code.
- [ ] `contextScope.exclude` is populated and non-trivial.
- [ ] `toolScope.deny` includes the dangerous capabilities explicitly.
- [ ] The fallback chain has provider diversity.
- [ ] The primary evaluation is computable from the run artefact.
- [ ] Every failure class has a response that routes to the right scope.
- [ ] `autonomy.maxLevel` is justified; anything above L2 requires a calibration report.
- [ ] `independence` is declared where the role judges another's output.
- [ ] The `owner` is a named human who will notice if the role's metrics degrade.

---

## Related

- `08_AGENT_CATALOG_AND_CONTRACTS.md` §8 — the canonical example and the merge/escalation rules
- `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md` §4.2 — the skill schema a role's skills follow
- `11_TOOLS_MCP_AND_INTEGRATIONS.md` §4 — the scope vocabulary used in `toolScope`
- `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` §9.2 — the four approval scopes this change falls under
