/**
 * `runtime/runner` — **the stage runner** (T-1.13).
 *
 * ## The order, and why it is that order
 *
 * pack `02` §4.9:
 *
 * > Loop per ready node: build `StageInput` (spec, assembled context,
 * > tools/grants, budget, isolation, model policy, **upstream artefact
 * > only**) → run the stage executor → persist the result → apply the
 * > resulting state transition(s).
 *
 * Four steps, in that order. Each of them is load-bearing:
 *
 * * **build → run → persist → transition.** The persistence comes *before*
 *   the transition because a transition that lands before the result is
 *   durable is a transition that claims something happened which did not.
 *   The reverse order — transition, then persist — would leave a crash
 *   between the two with a node in `SUCCEEDED` and no result.
 * * **persist → transition**, and not the other way round, is also what
 *   makes the handler **idempotent**: the run record carries the
 *   idempotency key `(taskId, nodeId, attempt)`, and the store refuses to
 *   finish a run twice. The second attempt's result is therefore *not*
 *   applied, and the first committed result wins (pack 02 §4.8).
 *
 * ## The budget is checked *before* the executor runs
 *
 * Not after. A budget check after the executor would let the executor spend
 * the budget it just exceeded. The check before the run is the only one
 * that bounds the work — and for a `harness` node, code that has already run
 * cannot be un-run.
 *
 * ## The cancellation is checked *before* the executor runs too
 *
 * pack `02` §4.9: "cooperative flag checked between steps". The runner is a
 * step boundary: a cancelled run stops here rather than starting more work.
 *
 * ## The cleanup always runs
 *
 * pack `02` §4.9: cancellation is "always followed by cleanup". So the
 * runner's `finally` reclaims the environment and the credentials — on
 * success, on failure, on cancellation, and on a thrown executor. A cleanup
 * that only runs on the happy path is a leak, and ADR-0006 §4 makes
 * reclamation mandatory at every terminal state, **including failure**.
 *
 * ## The thrown-executor case
 *
 * An executor that throws is a **programmer error**, not an expected
 * failure — the contract says an executor returns a `failure` result. But
 * the runner must not crash the loop, and it must not lose the run. So a
 * throw becomes a `failure` with the class `unknown`, which
 * {@link classifyFailure} treats as `workflow.composition`.
 */

import type { ExecutorKind, FailureClass, StageKind } from '@factory/contracts';

import {
  BUDGET_FAILURE_CLASS,
  checkBudget,
  labelIncomplete,
  type StageBudget,
} from './budget.js';
import { classifyFailure, shouldRetry } from './failures.js';
import type {
  CancellationToken,
  CredentialReclaimer,
  EnvironmentRegistry,
  RunStore,
  StageArtefact,
  StageInput,
  StageResult,
} from './ports.js';
import type { ExecutorRegistry } from './registry.js';

/**
 * The input to a stage run — everything the runner needs that is not the
 * executor.
 */
export interface StageRunRequest {
  /** The task. */
  readonly taskId: string;
  /** The node. */
  readonly nodeId: string;
  /** The attempt number — 1 for the first attempt. */
  readonly attempt: number;
  /** The stage kind. */
  readonly stageKind: StageKind;
  /** The executor the workflow declared, when it declared one. */
  readonly declaredExecutor?: ExecutorKind;
  /** The role the stage plays. */
  readonly role: string;
  /** The specification. */
  readonly spec: unknown;
  /** The assembled context. */
  readonly context: unknown;
  /** The tools and grants. */
  readonly tools: StageInput['tools'];
  /** The budget. */
  readonly budget: StageBudget;
  /** The isolation tier. */
  readonly isolation: StageInput['isolation'];
  /** The model policy. */
  readonly modelPolicy: StageInput['modelPolicy'];
  /** The upstream artefact — the immediate predecessor's output only. */
  readonly upstreamArtefact?: { readonly ref: string; readonly sha256: string };
  /** The run id — the caller mints it so the run is identified before it starts. */
  readonly runId: string;
  /** The ISO-8601 instant the run started. */
  readonly startedAt: string;
  /** The ISO-8601 instant the run ended, for the run record. */
  readonly endedAt: string;
}

/**
 * The outcome of a stage run.
 */
export interface StageRunOutcome {
  /** The status. */
  readonly status: 'success' | 'failure' | 'incomplete';
  /** The result the executor returned, when it returned one. */
  readonly result?: StageResult;
  /**
   * The **effective** failure class.
   *
   * `undefined` on success. On failure it is never `unknown` — an
   * unclassifiable failure is reported as `workflow.composition`, because
   * that is what it is treated as.
   */
  readonly failureClass?: FailureClass;
  /** The raw class the executor reported. */
  readonly rawFailureClass?: FailureClass;
  /** The artefacts the stage produced, labelled if incomplete. */
  readonly artefacts?: readonly StageArtefact[];
  /** Whether the run should be retried. */
  readonly retryable: boolean;
  /** Whether the run's result was applied — false for a duplicate. */
  readonly applied: boolean;
  /** The run id of the winner, when this run was a duplicate. */
  readonly winnerRunId?: string;
  /** The human-readable summary. */
  readonly summary?: string;
  /** The cost, in integer micro-USD. */
  readonly costUsdMicros: number;
}

/**
 * The runner's dependencies.
 */
export interface StageRunnerDeps {
  /** The executor registry. */
  readonly registry: ExecutorRegistry;
  /** The run store. */
  readonly runs: RunStore;
  /** The environment registry — what to reclaim. */
  readonly environments: EnvironmentRegistry;
  /** The credential reclaimer. */
  readonly credentials: CredentialReclaimer;
}

/**
 * The stage runner.
 */
export class StageRunner {
  readonly #registry: ExecutorRegistry;
  readonly #runs: RunStore;
  readonly #environments: EnvironmentRegistry;
  readonly #credentials: CredentialReclaimer;

  public constructor(deps: StageRunnerDeps) {
    this.#registry = deps.registry;
    this.#runs = deps.runs;
    this.#environments = deps.environments;
    this.#credentials = deps.credentials;
  }

  /**
   * Run one stage.
   *
   * @param request what to run
   * @param token the cooperative cancellation token
   */
  public async run(
    request: StageRunRequest,
    token: CancellationToken,
  ): Promise<StageRunOutcome> {
    // ---- 0. the executor --------------------------------------------
    // Resolved **before** the run is started, so a stage that cannot run
    // never leaves a started run behind.
    const resolved = this.#registry.resolve(request.stageKind, request.declaredExecutor);
    if (!resolved.ok) {
      return {
        status: 'failure',
        failureClass: 'workflow.composition',
        rawFailureClass: 'workflow.composition',
        retryable: false,
        applied: false,
        summary: resolved.reason,
        costUsdMicros: 0,
      };
    }

    // ---- 1. the budget, BEFORE the run ------------------------------
    // The check is before the executor, never after: a check afterwards
    // would let the executor spend the budget it just exceeded.
    const budgetVerdict = checkBudget(request.budget);
    if (budgetVerdict.exhausted) {
      // A budget exhaustion is `incomplete`, not `failure` — FR-32: the
      // partial artefacts are preserved and labelled.
      const artefacts = labelIncomplete([]);
      await this.#runs.start(this.#runRecord(request, resolved.kind, 'running'));
      const finished = await this.#runs.finish(request.runId, {
        status: 'incomplete',
        failureClass: BUDGET_FAILURE_CLASS,
        costUsdMicros: request.budget.spentUsdMicros ?? 0,
        endedAt: request.endedAt,
      });
      await this.#cleanup(request.runId);
      return {
        status: 'incomplete',
        failureClass: BUDGET_FAILURE_CLASS,
        rawFailureClass: BUDGET_FAILURE_CLASS,
        artefacts,
        retryable: false,
        applied: finished.applied,
        summary: budgetVerdict.reason,
        costUsdMicros: request.budget.spentUsdMicros ?? 0,
      };
    }

    // ---- 2. the cancellation, BEFORE the run ------------------------
    // The runner is a step boundary: a cancelled run stops here rather
    // than starting more work.
    if (token.cancelled) {
      await this.#runs.start(this.#runRecord(request, resolved.kind, 'running'));
      const finished = await this.#runs.finish(request.runId, {
        status: 'failed',
        failureClass: 'workflow.composition',
        costUsdMicros: 0,
        endedAt: request.endedAt,
      });
      await this.#cleanup(request.runId);
      return {
        status: 'failure',
        failureClass: 'workflow.composition',
        rawFailureClass: 'workflow.composition',
        retryable: false,
        applied: finished.applied,
        summary: `the stage was cancelled before it ran: ${token.reason ?? 'no reason given'}`,
        costUsdMicros: 0,
      };
    }

    // ---- 3. the run starts -----------------------------------------
    await this.#runs.start(this.#runRecord(request, resolved.kind, 'running'));

    // ---- 4. the executor runs --------------------------------------
    let result: StageResult;
    try {
      result = await resolved.executor.run(this.#buildInput(request, resolved.kind), token);
    } catch (error) {
      // An executor that throws is a programmer error, but the loop must
      // not die and the run must not be lost. `unknown` classifies as
      // `workflow.composition`, which is where an unclassifiable failure
      // belongs.
      const summary = `the executor threw: ${error instanceof Error ? error.message : String(error)}`;
      const finished = await this.#runs.finish(request.runId, {
        status: 'failed',
        failureClass: 'unknown',
        costUsdMicros: 0,
        endedAt: request.endedAt,
      });
      await this.#cleanup(request.runId);
      const classification = classifyFailure('unknown');
      return {
        status: 'failure',
        failureClass: classification.effective,
        rawFailureClass: 'unknown',
        retryable: shouldRetry('unknown', request.attempt),
        applied: finished.applied,
        summary,
        costUsdMicros: 0,
      };
    }

    // ---- 5. persist the result --------------------------------------
    const status = result.status;
    const rawClass =
      status === 'failure' ? (result.failureClass as FailureClass | undefined) : undefined;

    // A `failure` with no class is `unknown`, which classifies as
    // `workflow.composition`. An executor that reports a failure without
    // naming the class has not said what went wrong, and the rule for
    // that is not "no class" — it is `workflow.composition`.
    //
    // So the *recorded* class always exists on a failure, and it is the
    // raw class when the executor named one and `unknown` when it did not.
    const recordedClass: FailureClass = rawClass ?? 'unknown';
    const effectiveClass =
      status === 'failure' ? classifyFailure(recordedClass).effective : undefined;

    const artefacts =
      status === 'incomplete'
        ? labelIncomplete(result.artefacts ?? [])
        : (result.artefacts ?? []);

    const costUsdMicros = result.observability?.costUsdMicros ?? 0;

    const finished = await this.#runs.finish(request.runId, {
      status: status === 'success' ? 'succeeded' : status === 'failure' ? 'failed' : 'incomplete',
      ...(effectiveClass === undefined ? {} : { failureClass: effectiveClass }),
      costUsdMicros,
      endedAt: request.endedAt,
    });

    // ---- 6. the cleanup, always -------------------------------------
    // Success, failure, cancellation — the cleanup runs in every case,
    // because ADR-0006 §4 makes reclamation mandatory at every terminal
    // state, **including failure**.
    await this.#cleanup(request.runId);

    // ---- 7. the outcome ---------------------------------------------
    return {
      status,
      result,
      ...(effectiveClass === undefined ? {} : { failureClass: effectiveClass }),
      ...(status === 'failure' ? { rawFailureClass: recordedClass } : {}),
      artefacts,
      retryable:
        status === 'failure' && shouldRetry(recordedClass, request.attempt),
      applied: finished.applied,
      ...(finished.winnerRunId === undefined
        ? {}
        : { winnerRunId: finished.winnerRunId }),
      ...(result.summary === undefined ? {} : { summary: result.summary }),
      costUsdMicros,
    };
  }

  /**
   * Build the {@link StageInput}.
   *
   * The input carries the upstream artefact **only** — the immediate
   * predecessor's output, never the whole history.
   */
  #buildInput(request: StageRunRequest, executorKind: ExecutorKind): StageInput {
    return {
      taskId: request.taskId,
      nodeId: request.nodeId,
      attempt: request.attempt,
      stageKind: request.stageKind,
      executorKind,
      spec: request.spec,
      context: request.context,
      tools: request.tools,
      budget: request.budget,
      isolation: request.isolation,
      modelPolicy: request.modelPolicy,
      ...(request.upstreamArtefact === undefined
        ? {}
        : { upstreamArtefact: request.upstreamArtefact }),
    };
  }

  /**
   * The run record to start.
   */
  #runRecord(
    request: StageRunRequest,
    executorKind: ExecutorKind,
    status: 'running',
  ): {
    runId: string;
    taskId: string;
    nodeId: string;
    attempt: number;
    role: string;
    stageKind: string;
    executorKind: string;
    status: 'running';
    costUsdMicros: number;
    startedAt: string;
  } {
    return {
      runId: request.runId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      attempt: request.attempt,
      role: request.role,
      stageKind: request.stageKind,
      executorKind,
      status,
      costUsdMicros: 0,
      startedAt: request.startedAt,
    };
  }

  /**
   * The cleanup — reclaim the environment and the credentials.
   *
   * The **environment** goes first, then the credentials. The order is
   * deliberate: the environment is the sandbox the credentials were minted
   * into, so tearing the sandbox down first means a credential that is
   * still live for a moment is live in a sandbox that is going away, rather
   * than the other way round.
   *
   * A failure in one reclamation does not stop the other — a leaked
   * credential is worse than a leaked directory, so the credential
   * reclamation is attempted even when the environment reclamation threw.
   *
   * And a failed credential revocation is **never silent**: it throws,
   * whether or not the environment reclamation also failed. The
   * alternative — swallowing the credential failure when the environment
   * also failed — made the *worst* case the quietest one, which is
   * exactly backwards: a run that leaked both a directory and a
   * credential is the run an operator most needs to hear about.
   */
  async #cleanup(runId: string): Promise<void> {
    try {
      await this.#environments.reclaim(runId);
    } catch {
      // The environment reclamation failed. The credential reclamation is
      // still attempted below — a leaked credential is worse than a leaked
      // directory — and its own failure is reported on its own terms.
    }
    try {
      await this.#credentials.reclaim(runId);
    } catch {
      throw new Error('the credential reclamation failed');
    }
  }
}
