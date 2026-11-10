/**
 * `runtime/stage-kinds` — **the stage-kind → executor-kind mapping** (T-1.13).
 *
 * ## Why this file exists
 *
 * blueprint `09` §8.1 lists **fourteen** stage kinds, and pack `02` §4.9 says
 * "v1 implements 12". The gap is not a detail — it is the difference between
 * a workflow that runs and a workflow that hangs on a stage nobody
 * implemented.
 *
 * The two that are *not* implemented are named in the contracts already:
 *
 * ```ts
 * export const V1_STAGE_KINDS = STAGE_KINDS.filter(
 *   (kind) => kind !== 'deploy' && kind !== 'investigate',
 * );
 * ```
 *
 * (`packages/contracts/src/shared.ts`.) So the **support matrix** is a fact
 * the contracts already own, and this file does not re-declare it — it
 * *reads* it and derives the rest.
 *
 * ## The mapping
 *
 * blueprint `09` §8.1's table has a column "Agent?" — Yes, No, or Human —
 * and ADR-0017 splits that further into the four executor kinds:
 *
 * | Executor kind | What it is |
 * |---|---|
 * | `deterministic` | code — no model, no sandbox |
 * | `completion` | a single structured model call through the gateway |
 * | `harness` | a coding agent inside the T2 sandbox |
 * | `human` | an approval wait |
 *
 * So the mapping is derived from the blueprint's "Agent?" column:
 *
 * * **No** ⇒ `deterministic` — "The deterministic stages are the majority.
 *   This is deliberate and is the architectural expression of the directive's
 *   requirement that verification be agent-independent."
 * * **Human** ⇒ `human`.
 * * **Yes** ⇒ `completion`, except `implement`, which is the one stage that
 *   genuinely needs to read and write a codebase, and which ADR-0017 names
 *   as the **only** harness-eligible stage.
 *
 * ## The ADR-0017 restriction is load-bearing
 *
 * ADR-0017 says the harness "is a coding agent inside the T2 sandbox" and
 * "**the Worker**, and Workflow-D / C fixers only", and that "the boundary is
 * a policy that must be enforced at the definition level, not a type — a
 * misconfigured workflow could try to use `harness` for a Reviewer unless
 * the registry checks it."
 *
 * So the mapping is **not** a convenience: a workflow that declares
 * `executor: harness` for a `review` stage is refused. The registry checks
 * it, exactly as ADR-0017's validation section requires.
 *
 * ## The default is a *default*, not a decision
 *
 * A workflow stage may declare its own `executor` (the contracts'
 * `WorkflowStage` has the field). The declared value is honoured **only**
 * when it is permitted for that stage kind. Otherwise the default for the
 * kind applies. The refusal is not silent — it is a result the caller can
 * report.
 */

import {
  STAGE_KINDS,
  V1_STAGE_KINDS,
  type ExecutorKind,
  type StageKind,
} from '@factory/contracts';

/**
 * The stage kinds v1 implements — **read from the contracts**, not
 * re-declared.
 *
 * `V1_STAGE_KINDS` is the contracts' own filtered list, so the two can never
 * drift. A test asserts the list has twelve entries and that the two
 * excluded kinds are exactly `deploy` and `investigate`.
 */
export const IMPLEMENTED_STAGE_KINDS: readonly StageKind[] = V1_STAGE_KINDS;

/**
 * The stage kinds v1 does **not** implement.
 *
 * `deploy` because v1 registers no deploy capability and the
 * `MERGED → DEPLOYING` guard is hard-false; `investigate` because the
 * incident workflow is a later ticket.
 */
export const UNIMPLEMENTED_STAGE_KINDS: readonly StageKind[] = STAGE_KINDS.filter(
  (kind) => !(V1_STAGE_KINDS as readonly StageKind[]).includes(kind),
);

/**
 * The **default** executor kind for a stage kind.
 *
 * The mapping is derived from blueprint `09` §8.1's "Agent?" column:
 *
 * | Stage kind | Agent? | Default executor |
 * |---|---|---|
 * | `specify` | Yes (Refinement) | `completion` |
 * | `plan` | Yes (Planner) | `completion` |
 * | `implement` | Yes (Worker) | `harness` |
 * | `verify` | No (deterministic) | `deterministic` |
 * | `review` | Yes (Reviewer) | `completion` |
 * | `aggregate` | No (deterministic) | `deterministic` |
 * | `approve` | Human | `human` |
 * | `merge` | No (deterministic) | `deterministic` |
 * | `deploy` | No (deterministic) | `deterministic` — but not implemented |
 * | `sweep` | Yes (Maintenance) | `completion` |
 * | `investigate` | Yes (Incident) | `completion` — but not implemented |
 * | `record` | No (deterministic) | `deterministic` |
 * | `evaluate` | No (deterministic + model) | `deterministic` |
 * | `propose` | Model-assisted | `completion` |
 */
export const DEFAULT_EXECUTOR_BY_STAGE: Readonly<Record<StageKind, ExecutorKind>> = {
  specify: 'completion',
  plan: 'completion',
  implement: 'harness',
  verify: 'deterministic',
  review: 'completion',
  aggregate: 'deterministic',
  approve: 'human',
  merge: 'deterministic',
  deploy: 'deterministic',
  sweep: 'completion',
  investigate: 'completion',
  record: 'deterministic',
  evaluate: 'deterministic',
  propose: 'completion',
};

/**
 * The stage kinds that ADR-0017 permits the `harness` executor for.
 *
 * ADR-0017: the harness is for "the **Worker**, and Workflow-D / C fixers
 * only". In v1 the Worker is the `implement` stage — that is the stage whose
 * job is to produce a change. The Workflow-D / C fixers are the `ci-repair`
 * role, which v1's stage vocabulary does not carry, so the set is just
 * `implement` here and the rule is written so that adding a fixer kind later
 * is a one-line change.
 */
export const HARNESS_ELIGIBLE_STAGE_KINDS: readonly StageKind[] = ['implement'];

/**
 * Is this stage kind implemented in v1?
 */
export const isImplementedStageKind = (kind: StageKind): boolean =>
  IMPLEMENTED_STAGE_KINDS.includes(kind);

/**
 * Is the `harness` executor permitted for this stage kind?
 *
 * ADR-0017's validation section: "The capability registry rejects a workflow
 * that requests the `harness` kind for a stage outside the permitted set."
 */
export const harnessAllowedFor = (kind: StageKind): boolean =>
  HARNESS_ELIGIBLE_STAGE_KINDS.includes(kind);

/**
 * The outcome of resolving a stage's executor kind.
 *
 * A discriminated union rather than a boolean, so a caller cannot forget to
 * report the refusal. This is the repo's convention (`tools/guards/*.ts`,
 * `packages/isolation/src/t1/paths.ts`): an expected refusal is a **return**,
 * never a throw.
 */
export type ExecutorResolution =
  | { readonly ok: true; readonly executor: ExecutorKind }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve the executor kind for a stage.
 *
 * @param kind the stage kind
 * @param declared the executor the workflow declared, when it declared one
 */
export const resolveExecutorKind = (
  kind: StageKind,
  declared?: ExecutorKind,
): ExecutorResolution => {
  if (!isImplementedStageKind(kind)) {
    return {
      ok: false,
      reason: `the stage kind "${kind}" is not implemented in v1`,
    };
  }

  if (declared === undefined) {
    return { ok: true, executor: DEFAULT_EXECUTOR_BY_STAGE[kind] };
  }

  if (declared === 'harness' && !harnessAllowedFor(kind)) {
    return {
      ok: false,
      reason: `the stage kind "${kind}" may not use the "harness" executor, because ADR-0017 permits the harness for ${HARNESS_ELIGIBLE_STAGE_KINDS.join(', ')} only`,
    };
  }

  return { ok: true, executor: declared };
};
