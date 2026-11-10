/**
 * `runtime/failures` — **the failure classification and the retry policy**
 * (T-1.13).
 *
 * ## The one table
 *
 * blueprint `08` §4.3 gives ten failure classes and, for each, a "Default
 * response". pack `02` §4.9 restates the same thing as a retry policy:
 *
 * > Failure classes (10) per [BP: 08 §4.3]; unknown ⇒
 * > `workflow.composition`. Retries per policy (default max 2 for
 * > model-reasoning/verification failures, 0 for `policy.denied`, 3 with
 * > backoff for `tool.unavailable`).
 *
 * These are the **same** rule stated twice. So this file holds **one**
 * table, from which both the classification and the retry decision are
 * derived. A class cannot have one retry policy here and another in the
 * runner — there is nowhere for the second one to live.
 *
 * ## The `unknown → workflow.composition` rule
 *
 > The `unknown` → `workflow.composition` default is a deliberate choice.
 * It reflects V02's observation that agent failures are frequently
 > misattributed to the agent when the real cause is the pipeline.
 * Defaulting the ambiguous class toward the pipeline makes the
> workflow-defect rate visible instead of hiding it inside the agent-failure
> rate.
 *
 * So the classification is a **two-step** function: first the *raw* class
 * (which may be `unknown`), then the **effective** class (which never is).
 * Both are returned, because the raw class is what the run record carries —
 * losing it would destroy the very signal the rule exists to preserve.
 *
 * ## Why the retry counts differ so much
 *
 * * `policy.denied` ⇒ **0**. The policy engine refused the action. Retrying
 *   it is "let it try and see", which blueprint 13 §2.3 forbids outright:
 *   "'Let the orchestrator try and see' is not available anywhere in the
 *   system." A denial routes to a human with the policy reason.
 * * `model.reasoning` / `verification.failure` ⇒ **2**. The agent produced
 *   an incorrect result given correct context and correct tools. A retry
 *   with a different model or decomposition is the documented response.
 * * `tool.unavailable` ⇒ **3 with backoff**. An integration was down; a
 *   transient outage resolves itself, and the backoff keeps the retries
 *   from hammering it.
 * * `budget.exhausted` ⇒ **0**. A budget that is spent stays spent; the
 *   documented response is "return partial artefacts labelled incomplete to
 *   a human", not another attempt.
 *
 * The rest are **not retried by the agent**. `model.capability` needs a
 * re-plan, `workflow.composition` needs a workflow fix, `context.insufficient`
 * needs better context, `environment.failure` is retried *with backoff by the
 * infrastructure* rather than by the agent, and `unknown` is treated as
 * `workflow.composition`.
 *
 * ## The backoff
 *
 * The backoff is **exponential** with a base, and the default base is
 * injected so the tests are deterministic. The `tool.unavailable` class is
 * the one the pack names explicitly ("3 with backoff"), and the others that
 * retry use the same schedule.
 */

import { FAILURE_CLASSES, type FailureClass } from '@factory/contracts';

/**
 * The **raw** classes — the ten of blueprint `08` §4.3, in the blueprint's
 * order.
 *
 * `FAILURE_CLASSES` is the contracts' own list, so the two cannot drift.
 */
export const RAW_FAILURE_CLASSES: readonly FailureClass[] = FAILURE_CLASSES;

/**
 * The retry policy for a failure class.
 */
export interface RetryPolicy {
  /**
   * The maximum number of **retries** after the first attempt.
   *
   * Zero means the stage is not retried at all. So `policy.denied` has
   * `maxRetries: 0` — the first attempt is the only one.
   */
  readonly maxRetries: number;
  /**
   * Whether the retries are **spaced** by a backoff.
   *
   * The pack names backoff for `tool.unavailable` explicitly. The classes
   * that retry a *model* do not need one — a re-prompt is not a load on a
   * shared resource.
   */
  readonly backoff: boolean;
  /**
   * The class this failure is **treated as** for improvement purposes.
   *
   * This is where the `unknown → workflow.composition` rule lives: the
   * `unknown` entry's `treatedAs` is `workflow.composition`.
   */
  readonly treatedAs: FailureClass;
}

/**
 * The retry policy per class.
 *
 * The keys are the blueprint's ten class names. `unknown` is included with
 * `maxRetries: 0` and `treatedAs: 'workflow.composition'` — it is *not*
 * retried, because an unclassifiable failure is a workflow defect, and a
 * workflow defect is fixed by fixing the workflow.
 */
export const RETRY_POLICY_BY_CLASS: Readonly<Record<FailureClass, RetryPolicy>> = {
  'model.reasoning': { maxRetries: 2, backoff: false, treatedAs: 'model.reasoning' },
  'model.capability': { maxRetries: 0, backoff: false, treatedAs: 'model.capability' },
  'workflow.composition': {
    maxRetries: 0,
    backoff: false,
    treatedAs: 'workflow.composition',
  },
  'context.insufficient': {
    maxRetries: 0,
    backoff: false,
    treatedAs: 'context.insufficient',
  },
  'verification.failure': { maxRetries: 2, backoff: false, treatedAs: 'verification.failure' },
  'environment.failure': { maxRetries: 0, backoff: true, treatedAs: 'environment.failure' },
  'policy.denied': { maxRetries: 0, backoff: false, treatedAs: 'policy.denied' },
  'budget.exhausted': { maxRetries: 0, backoff: false, treatedAs: 'budget.exhausted' },
  'tool.unavailable': { maxRetries: 3, backoff: true, treatedAs: 'tool.unavailable' },
  unknown: { maxRetries: 0, backoff: false, treatedAs: 'workflow.composition' },
};

/**
 * The classification of a failure.
 */
export interface FailureClassification {
  /**
   * The class as it was reported — `unknown` if nothing could be said.
   */
  readonly raw: FailureClass;
  /**
   * The class the failure is **treated as**.
   *
   * For every class except `unknown` this equals `raw`. For `unknown` it is
   * `workflow.composition`, because "an unclassifiable failure is treated as
   * `workflow.composition` for improvement purposes".
   */
  readonly effective: FailureClass;
  /**
   * The retry policy that applies.
   */
  readonly policy: RetryPolicy;
  /**
   * Whether the failure should be **escalated** rather than retried.
   *
   * `policy.denied` escalates: "Not retried by the agent. Route to a human
   * with the policy reason."
   */
  readonly escalate: boolean;
}

/**
 * Classify a failure.
 *
 * The raw class is carried alongside the effective one, because the raw class
 * is what the run record keeps — a run that failed with `unknown` is a
 * different observation from a run that failed with `workflow.composition`,
 * and the rule only exists to make the *second* one visible.
 *
 * @param raw the class the failure was reported with
 */
export const classifyFailure = (raw: FailureClass): FailureClassification => {
  const policy = RETRY_POLICY_BY_CLASS[raw];
  const effective = policy.treatedAs;
  return {
    raw,
    effective,
    policy,
    // `policy.denied` is the only class that routes to a human with a reason
    // rather than being fixed by the agent or the infrastructure.
    escalate: effective === 'policy.denied',
  };
};

/**
 * The default backoff base, in milliseconds.
 *
 * The delay before retry `n` is `base * 2^(n-1)`: 1s, 2s, 4s.
 */
export const DEFAULT_BACKOFF_BASE_MS = 1_000;

/**
 * The delay before a retry.
 *
 * @param attempt the attempt number the retry will be (1-based: the first
 *   retry is attempt 2)
 * @param baseMs the backoff base
 */
export const backoffMs = (
  attempt: number,
  baseMs: number = DEFAULT_BACKOFF_BASE_MS,
): number => {
  if (attempt < 2) {
    return 0;
  }
  const exponent = attempt - 2;
  // Cap the exponent so the delay cannot overflow into a nonsense value.
  const scaled = baseMs * 2 ** Math.min(exponent, 16);
  return Math.min(scaled, 2 ** 31 - 1);
};

/**
 * Should this failure be retried, given how many attempts have been made?
 *
 * @param raw the class the failure was reported with
 * @param attemptsSoFar how many attempts have already been made, including
 *   the one that just failed
 */
export const shouldRetry = (
  raw: FailureClass,
  attemptsSoFar: number,
): boolean => {
  const policy = RETRY_POLICY_BY_CLASS[raw];
  return attemptsSoFar <= policy.maxRetries;
};

/**
 * The escalation trigger a failure class escalates under, when it escalates.
 *
 * pack 03 §6's escalation triggers are: `review-fatigue`,
 * `unresolvable-conflict`, `policy-escalation`, `repeated-classification`,
 * `resume_failed`, `not_reproducible`.
 *
 * A `policy.denied` failure escalates under `policy-escalation` — the pack's
 * name for "the policy engine refused and a human must look".
 */
export const ESCALATION_TRIGGER_BY_CLASS: Readonly<
  Partial<Record<FailureClass, string>>
> = {
  'policy.denied': 'policy-escalation',
};
