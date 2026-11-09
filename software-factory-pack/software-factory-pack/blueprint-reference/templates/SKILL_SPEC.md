# Template — Skill Specification (`Skill`)

**Use when:** defining a skill — either a **procedure** (how to do something) or a **standard** (a property to adhere to).
**Authority:** `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md` §4 is the source of truth.
**Submission:** this file is a **definition change** at **skill scope**. Under ADR-0007, it may be merged automatically if it is additive and below the risk threshold; otherwise it needs review.

---

## The procedure/standard distinction

Choose one. If you need both, write two skills — a skill that needs "and" is two skills.

| | Procedure | Standard |
|---|---|---|
| Describes | *How to do* something | *What must be true* |
| Contains | Ordered steps, inputs, outputs, tools, failure handling, completion criteria | Rules, invariants, prohibited patterns, checkable properties |
| Executed as | A workflow stage | Not executed — consulted, and optionally checked |
| Contains `steps:` | Yes | No |
| Contains `properties:` | No | Yes |

---

## Authoring rules

1. **Specificity is the ruler of quality.** Every instruction names a concrete artefact, a command pattern, or a property. "Handle errors appropriately" is not an instruction.
2. **State properties; do not inject derivable facts.** If the agent could compute it in one step with its tools, it does not belong in the skill. Write "read the test command from `package.json`", not "run `pnpm test`".
3. **One purpose per skill.** A skill expressing one procedure or one standard.
4. **A skill never grants capability.** It may *request* a tool in its steps; the policy engine decides. A skill that says "run the deploy command" is a capability grant written in English.
5. **Every standard states at least one checkable property** — or explicitly records that it is not mechanisable, and why. That record is part of the skill.
6. **No duplicate truth.** A fact stated in two skills is a defect; one must point to the other.
7. **Every reference resolves.** A reference to a skill, file, or endpoint that does not resolve is a validation failure.
8. **Bounded size.** A skill exceeding the per-item context budget is split.
9. **Privileged skills get the elevated review.** A skill that changes what an agent may do requires the security-relevant review class (FR-16).

---

## The template

```yaml
apiVersion: factory/v1
kind: Skill
metadata:
  id: skill.<kebab-case-name>       # stable across versions
  version: <integer>                 # increment on any semantic change
  owner: <team-or-person>            # accountable for this skill's correctness
  kind: standard | procedure
  title: <short human title>
  description: >
    One or two sentences. What this covers and, importantly, what it does not.
  appliesTo:
    paths: [<glob>]                  # the files it governs
    repositories: [<glob>]           # omit for a universal skill
    taskTypes: [change, incident, sweep, research]
  body:
    format: markdown
    contentRef: skills/<name>.md     # the content is versioned separately
  # ── For kind: standard ─────────────────────────────────────────────
  properties:
    - id: prop.<kebab-case-name>
      statement: >
        A binary, checkable condition. "X must be Y." Not "X should be reasonable."
      severity: error | warning
      scope:
        paths: [<glob>]
      # The mechanism that checks it. Leave out only if not mechanisable.
      verifier:
        kind: static-rule | lllm-judge | deterministic-check
        generator: <verifier.id>@<version>
        deterministic: true | false
        # For lllm-judge: the rubric lives with the property.
        rubric: <rubric-reference>
        calibration:
          status: uncalibrated | calibrated | expired
          corpus: <calibration-corpus-id>
          detectionRate: <0..1>
          falsePositiveRate: <0..1>
          lastCalibrated: <date>
      # If not mechanisable, say so and why. This record is required.
      # notMechanisableBecause: <explanation>
  # ── For kind: procedure ─────────────────────────────────────────────
  steps:
    - id: s1
      instruction: >
        A concrete instruction naming the artefact, command pattern, or check.
      tools: [<capability.id>]       # requested; the policy engine decides
      produces: [<artefact.name>]
      onFailure: <what to do when this step fails>
  inputs:
    - {name: <input>, type: artefact | specification | context}
  outputs:
    - {name: <output>, type: artefact}
  completionCriteria:
    - <the checkable condition that means this skill's work is done>
  relatedSkills: [skill.<name>]     # one-directional pointers; no duplicated truth
  trust:
    classification: trusted          # skills are trusted content
    privileged: false                # true ⇒ elevated review class required
  evaluation:
    benchmark: <benchmark-id>        # this skill's own benchmark, if it has one
    lastCalibrated: <date>
    successMetric: <metric.name>     # how to tell the skill worked
  supersedes: <skill.id>@<version>   # for the next version
```

---

## Worked example — a standard with a generated verifier

```yaml
apiVersion: factory/v1
kind: Skill
metadata:
  id: skill.sql-conventions
  version: 3
  owner: platform-data
  kind: standard
  title: SQL construction conventions
  description: >
    Conventions for constructing SQL statements. Covers parameter binding and
    schema qualification. Does not cover query performance or schema design.
  appliesTo:
    paths: ["**/*.sql", "services/**/queries/**"]
    taskTypes: [change, sweep]
  body:
    format: markdown
    contentRef: skills/sql-conventions.md
  properties:
    - id: prop.bound-parameters
      statement: >
        SQL statements must use bound parameters. String interpolation of values
        into a statement is prohibited.
      severity: error
      scope:
        paths: ["**/*.sql"]
      verifier:
        kind: static-rule
        generator: verifier.sql-parameterization@2
        deterministic: true
        calibration:
          status: calibrated
          corpus: bench/sql-param@2
          detectionRate: 0.93
          falsePositiveRate: 0.01
          lastCalibrated: "2026-09-30"
    - id: prop.qualified-schema
      statement: >
        Table references in SQL must be schema-qualified.
      severity: warning
      scope:
        paths: ["**/*.sql"]
      verifier:
        kind: static-rule
        generator: verifier.sql-qualification@1
        deterministic: true
        calibration:
          status: uncalibrated
  relatedSkills: [skill.data-migrations]
  trust:
    classification: trusted
    privileged: false
  evaluation:
    benchmark: bench.sql-conventions@1
    lastCalibrated: "2026-09-30"
    successMetric: review.falsePositiveRate
  supersedes: skill.sql-conventions@2
```

---

## Worked example — a procedure

```yaml
apiVersion: factory/v1
kind: Skill
metadata:
  id: skill.data-migrations
  version: 4
  owner: platform-data
  kind: procedure
  title: Applying a database schema migration
  description: >
    Producing and applying a forward-only schema migration. Covers migration
    authoring and verification. Does not cover backfill strategy beyond one pass.
  appliesTo:
    paths: ["services/**/migrations/**"]
    taskTypes: [change, incident]
  body:
    format: markdown
    contentRef: skills/data-migrations.md
  steps:
    - id: s1
      instruction: >
        Read the current schema from the repository's schema definitions. Do not
        assume column names or table shape.
      tools: [repo.read]
      produces: [currentSchema]
    - id: s2
      instruction: >
        Produce a forward-only migration. Never mutate a migration that has been
        applied. Name the file with the migration tool's required convention.
      tools: [repo.write]
      produces: [migration]
    - id: s3
      instruction: >
        Apply the migration to a database seeded from the current schema snapshot
        and confirm it applies cleanly.
      tools: [db.migrate.local, db.read.local]
      produces: [migrationVerification]
    - id: s4
      instruction: >
        Record the migration's effect on the read path, and list the read paths
        that require updating.
      tools: [repo.read]
      produces: [readPathImpact]
  inputs:
    - {name: schemaDiff, type: artefact}
  outputs:
    - {name: migration, type: artefact}
  completionCriteria:
    - The migration applies cleanly to a seeded database.
    - The migration is forward-only and no applied migration was modified.
    - The affected read paths are listed.
  relatedSkills: [skill.sql-conventions]
  trust:
    classification: trusted
    privileged: false
  evaluation:
    benchmark: bench.data-migrations@1
    successMetric: acceptanceOraclePass
  supersedes: skill.data-migrations@3
```

---

## Review checklist

- [ ] `kind` is correctly `standard` or `procedure`, and the body matches.
- [ ] Every instruction is specific — it names an artefact, a command pattern, or a property.
- [ ] No derivable fact is injected.
- [ ] Every standard has at least one checkable property, or an explicit `notMechanisableBecause`.
- [ ] Every verifier's calibration state is current; an expired one is not merged.
- [ ] Every reference (`contentRef`, `relatedSkills`, `benchmark`, `corpus`) resolves.
- [ ] No fact is stated in two skills.
- [ ] `appliesTo` is narrow enough that the skill is selected only when it applies.
- [ ] `privileged` is correct; a privileged skill carries the elevated review.
- [ ] The skill body is within the per-item context budget.
- [ ] The completion criteria are checkable.

---

## Related

- `10_CONTEXT_SKILLS_PROMPTS_AND_MEMORY.md` §4 — the schema, the authoring rules, and the lifecycle
- `10_...` §4.3 — the derive-don't-inject rule with worked examples
- `10_...` §4.6 — the improvement loop that produces new skill versions
- `14_QUALITY_TESTING_AND_EVALUATION.md` §5 — the calibration procedure a verifier must pass
- `13_SECURITY_GOVERNANCE_AND_HUMAN_CONTROL.md` §2.4 — the privileged-context review rule
