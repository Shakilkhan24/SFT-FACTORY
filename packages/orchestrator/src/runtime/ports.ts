/**
 * `runtime/ports` — **the orchestrator's ports** (T-1.13).
 *
 * ## Why ports, not implementations
 *
 * The orchestrator owns the *stage*, not the world. It does not run the
 * tests (`packages/verify`), it does not sandbox the code
 * (`packages/isolation`), it does not call the model (`packages/gateway`),
 * and it does not wait for a human (T-1.14's access point).
 *
 * If it held those implementations directly, then v1 could not be built:
 * three of the four executor kinds have no production implementation yet.
 * So each kind gets a **port**, the orchestrator ships a fake for each, and
 * the production implementations arrive in the tickets that own them.
 *
 * This is the same split `packages/broker` uses (a `Transport` port, with a
 * CLI adapter and a fake) and `packages/state` uses (a `StateMachineStore`
 * port, with a Postgres implementation and an in-memory double).
 *
 * ## The `StageInput`
 *
 * pack `02` §4.9 enumerates what the input carries:
 *
 * > build `StageInput` (spec, assembled context, tools/grants, budget,
 * > isolation, model policy, **upstream artefact only**)
 *
 * The last clause is the load-bearing one. "**upstream artefact only**"
 * means the stage sees the artefact its immediate predecessor produced —
 * **not** the whole history. A stage that could read every prior artefact
 * would re-derive the pipeline inside itself, and the context envelope
 * would stop being the thing that bounds what a stage sees.
 */

/* -------------------------------------------------------------------------- */
/* The cancellation token                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The cooperative cancellation flag.
 *
 * pack `02` §4.9: "Cancellation/pause: cooperative flag checked between
 * steps and via `docker kill` for harness nodes; always followed by
 * cleanup."
 *
 * The flag is **cooperative**: it is checked *between* steps, not
 * asynchronously. A stage that is one long model call is not interrupted
 * mid-call — it is interrupted at the next step boundary. That is the
 * design: an executor cannot be killed at an arbitrary point without
 * leaving the environment in an unknown state, and the cleanup that always
 * follows a cancellation depends on the executor returning.
 */
export interface CancellationToken {
  /** Is the cancellation requested? */
  readonly cancelled: boolean;
  /**
   * The reason the cancellation was requested, when it was.
   *
   * Carried so the run record says *why* the stage stopped — "cancelled by
   * an operator" and "paused for capacity" are different facts.
   */
  readonly reason?: string;
}

/**
 * A token that is never cancelled.
 */
export const NEVER_CANCELLED: CancellationToken = { cancelled: false };

/**
 * A token that is cancelled.
 */
export const cancelledToken = (reason: string): CancellationToken => ({
  cancelled: true,
  reason,
});

/* -------------------------------------------------------------------------- */
/* The stage input and output                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The isolation tier a stage runs in.
 *
 * ADR-0020's tiers: `T1` is a host worktree with no code execution, `T2` is
 * a rootless container. v1 registers no `T3`.
 */
export type IsolationTier = 'T1' | 'T2';

/**
 * The model policy for a stage.
 */
export interface ModelPolicy {
  /** The role the model plays — the routing policy keys on it. */
  readonly role: string;
  /** The model the workflow named, when it named one. */
  readonly model?: string;
  /** The routing hints for the request. */
  readonly complexity?: 'low' | 'medium' | 'high';
}

/**
 * The tool and grant context for a stage.
 */
export interface ToolGrantContext {
  /**
   * The capability ids the stage may invoke.
   *
   * The list is the stage's **effective grant** — the intersection of the
   * workflow's grant, the stage's narrower grant and the resource's scope
   * (pack 02 §4.4 step 4). It is the *resolved* list, not the raw one, so
   * a stage cannot widen its own authority by reading the workflow.
   */
  readonly capabilities: readonly string[];
  /** The scopes the stage's tools may use. */
  readonly scopes: readonly string[];
}

/**
 * The stage input — everything the executor is given.
 */
export interface StageInput {
  /** The task. */
  readonly taskId: string;
  /** The node. */
  readonly nodeId: string;
  /** The attempt number — 1 for the first attempt. */
  readonly attempt: number;
  /** The stage kind. */
  readonly stageKind: string;
  /** The executor kind that will run it. */
  readonly executorKind: string;
  /** The specification the stage works against. */
  readonly spec: unknown;
  /** The assembled context envelope. */
  readonly context: unknown;
  /** The tools and grants. */
  readonly tools: ToolGrantContext;
  /** The stage's budget, and the spend so far. */
  readonly budget: unknown;
  /** The isolation tier the stage runs in. */
  readonly isolation: IsolationTier;
  /** The model policy. */
  readonly modelPolicy: ModelPolicy;
  /**
   * The **upstream artefact only** — the artefact the immediate predecessor
   * produced.
   *
   * `undefined` for a stage with no predecessor. It is deliberately a
   * single artefact rather than a list: a stage that could see every prior
   * artefact would re-derive the pipeline inside itself.
   */
  readonly upstreamArtefact?: { readonly ref: string; readonly sha256: string };
}

/**
 * The status of a stage outcome.
 *
 * blueprint `08` §4.2: "`result.status` | Yes | `success`, `failure`, or
 * `incomplete`. 'Incomplete' is used when a budget was exhausted with
 * partial work preserved."
 */
export type StageStatus = 'success' | 'failure' | 'incomplete';

/**
 * An artefact a stage produced.
 *
 * The `label` is what makes FR-32's promise checkable: a partial artefact
 * is **preserved** and **labelled** `incomplete`, so a consumer can tell a
 * finished artefact from a fragment of one without asking the stage that
 * produced it. `undefined` means the artefact is complete.
 */
export interface StageArtefact {
  /** The artefact's reference — a URI or a store key. */
  readonly ref: string;
  /** The artefact's content digest. */
  readonly sha256: string;
  /** The label — `incomplete` for a partial artefact. */
  readonly label?: string;
}

/**
 * The result of a stage.
 */
export interface StageResult {
  /** The status. */
  readonly status: StageStatus;
  /** The artefacts the stage produced. */
  readonly artefacts?: readonly StageArtefact[];
  /** The failure class, when the status is `failure`. */
  readonly failureClass?: string;
  /** A human-readable summary, when the status is `failure`. */
  readonly summary?: string;
  /** The observability record — tool trail, tokens, cost, duration, turns. */
  readonly observability?: {
    readonly toolCalls?: readonly unknown[];
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly costUsdMicros?: number;
    readonly durationMs?: number;
    readonly turns?: number;
  };
  /**
   * The proposed next state — "the proposed transition, which the
   * orchestrator may accept or override" (blueprint `08` §4.2).
   */
  readonly nextState?: string;
}

/* -------------------------------------------------------------------------- */
/* The executors                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A stage executor.
 *
 * The four executor kinds differ in *what they are*, not in what they
 * receive: every executor gets the same {@link StageInput} and returns the
 * same {@link StageResult}. That is what makes the registry a lookup rather
 * than a chain of type-specific branches.
 */
export interface StageExecutor {
  /** The executor kind this executor implements. */
  readonly kind: string;
  /**
   * Run the stage.
   *
   * The executor must **not** throw for an expected failure — it returns a
   * `failure` result with a class. A throw means a programmer error, and
   * the runner turns it into `unknown` (which classifies as
   * `workflow.composition`).
   */
  run(input: StageInput, token: CancellationToken): Promise<StageResult>;
}

/**
 * The harness adapter — the port the `harness` executor needs.
 *
 * pack 02 §4.13: the harness adapter is "the coding agent inside the T2
 * sandbox". The production implementation is T-2.x; v1 ships the port.
 */
export interface HarnessAdapter {
  /**
   * Run the coding agent in the sandbox.
   *
   * @param input the stage input
   * @param token the cancellation token
   */
  run(input: StageInput, token: CancellationToken): Promise<StageResult>;
  /**
   * Kill the sandbox.
   *
   * pack 02 §4.9: cancellation is "a cooperative flag checked between steps
   * and via `docker kill` for harness nodes". A harness node runs code, so
   * its sandbox has to be killed rather than asked politely.
   */
  kill(runId: string): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The stores                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A run — the record of one attempt at one node.
 *
 * It mirrors the `runs` table (`migrations/0001_core.sql`): the run id, the
 * task and node, the attempt, the role, the stage kind, the executor kind,
 * the status, the outcome, the failure class and the cost.
 */
export interface RunRecord {
  readonly runId: string;
  readonly taskId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly role: string;
  readonly stageKind: string;
  readonly executorKind: string;
  readonly status: 'running' | 'succeeded' | 'failed' | 'incomplete';
  readonly outcome?: string;
  readonly failureClass?: string;
  readonly costUsdMicros: number;
  readonly startedAt: string;
  readonly endedAt?: string;
}

/**
 * The run store — the ledger of attempts.
 *
 * The store is a **port** because `migrations/**` is R4 and the ticket does
 * not name it: the Postgres implementation is a later ticket. The port
 * carries the semantics the runner depends on, and the in-memory double
 * implements them.
 */
export interface RunStore {
  /** Start a run. */
  start(run: RunRecord): Promise<void>;
  /**
   * Finish a run.
   *
   * The store is responsible for the **idempotency** of this call: a run
   * that has already finished is not finished again, and the first committed
   * result wins (pack 02 §4.8). The store returns the outcome so the
   * caller can tell whether its result was the one that stuck.
   */
  finish(runId: string, patch: {
    readonly status: 'succeeded' | 'failed' | 'incomplete';
    readonly outcome?: string;
    readonly failureClass?: string;
    readonly costUsdMicros?: number;
    readonly endedAt: string;
  }): Promise<{ readonly applied: boolean; readonly winnerRunId?: string }>;
  /** The runs for a node. */
  runsFor(taskId: string, nodeId: string): Promise<readonly RunRecord[]>;
  /**
   * The runs that are still **live** — started and not finished.
   *
   * The resume path asks this question: "is there a node still being
   * worked on?" A task in `RUNNING` with no live node is the A0.5 case.
   */
  liveRuns(taskId: string): Promise<readonly RunRecord[]>;
}

/**
 * The lease of a node — the scheduler's record of who is working on it.
 */
export interface NodeLease {
  readonly taskId: string;
  readonly nodeId: string;
  readonly owner: string;
  /** The attempt the lease is for. */
  readonly attempt: number;
  /** The ISO-8601 instant the lease expires. */
  readonly expiresAt: string;
}

/**
 * The lease store — the orchestrator's view of the scheduler's leases.
 */
export interface LeaseStore {
  /** The live leases for a task. */
  liveLeases(taskId: string): Promise<readonly NodeLease[]>;
  /**
   * Release a lease — return the node to the queue.
   *
   * The re-queue must happen **once**: a lease that is re-queued twice
   * would run the node twice (pack 02 §4.8: "the reaper re-queues expired
   * leases (`node.leased → ready`)"). The store owns the once-ness, because
   * only it can see the lease's current state atomically.
   */
  release(lease: NodeLease): Promise<{ readonly released: boolean }>;
}

/**
 * The environment registry — what to reclaim when a run ends.
 *
 * The T1 implementation is `packages/isolation`'s reclaimer; v1 talks to it
 * through this port so the orchestrator does not depend on the isolation
 * package's internals.
 */
export interface EnvironmentRegistry {
  /** The environment for a run, if it has one. */
  environmentFor(runId: string): Promise<{ readonly root: string; readonly kind: string } | undefined>;
  /** Reclaim the environment for a run. */
  reclaim(runId: string): Promise<void>;
}

/**
 * The credential reclaimer — what to reclaim when a run ends.
 *
 * pack 02 §4.6's `revokeAll` is the precedent: the credentials are
 * reclaimed by the **lease record**, not by the run, because a crashed run
 * cannot be asked what it owned.
 */
export interface CredentialReclaimer {
  /** Reclaim every credential lease a run holds. */
  reclaim(runId: string): Promise<void>;
}

/**
 * The state sink — where the orchestrator's transitions go.
 *
 * The orchestrator does not implement the state machine; `@factory/state`
 * owns it. This port is the seam, so the runner can be tested without a
 * database and the real machine can be dropped in.
 */
export interface StateSink {
  /**
   * Apply a transition.
   *
   * The orchestrator's own transition is the *node* transition
   * (`READY → LEASED → RUNNING → SUCCEEDED|FAILED|INCOMPLETE`), and the task
   * transition is the state machine's business.
   */
  transition(input: {
    readonly taskId: string;
    readonly nodeId: string;
    readonly to: string;
    readonly trigger: string;
    readonly facts?: unknown;
  }): Promise<{ readonly ok: boolean; readonly reason?: string }>;
}
