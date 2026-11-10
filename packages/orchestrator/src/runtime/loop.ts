/**
 * `runtime/loop` — **the execution loop** (T-1.13).
 *
 * ## What the loop is
 *
 * blueprint `09` §8.2's mermaid, reduced to its spine:
 *
 * ```mermaid
 * loop Each node in topological order
 *   SCH->>ORCH: node.ready
 *   ORCH->>CTX: Assemble(node)
 *   CTX-->>ORCH: ContextEnvelope (pinned)
 *   ORCH->>POL: Evaluate(node action)
 *   POL-->>ORCH: allow
 *   ORCH->>RUN: Run(node, envelope)
 *   RUN-->>ORCH: StageResult
 *   ORCH->>EVT: node outcome recorded
 * end
 * ```
 *
 * So: for each ready node, assemble the context, evaluate the policy, run
 * the stage, record the outcome.
 *
 * ## The loop's own job
 *
 * The loop is the part that owns **ordering** and **the between-steps
 * cancellation check**. The stage itself is the runner's; the context
 * assembly and the policy evaluation are ports, because their packages
 * (`packages/context`, `packages/policy`) are not all built yet.
 *
 * The loop does four things the runner cannot:
 *
 * 1. it decides **which** nodes to run, in what order;
 * 2. it checks the **cancellation flag between steps** — pack `02` §4.9's
 *    "cooperative flag checked between steps";
 * 3. it **stops** the loop when the cancellation is requested, rather than
 *    running the remaining nodes;
 * 4. it applies the **state transitions** the results imply.
 *
 * ## The loop stops, it does not abort
 *
 * A cancelled loop returns the outcome of the nodes it *did* run. The nodes
 * it did not run stay `READY` — they were not run, so they cannot be
 * reported as failed. The loop is resumable: the nodes that are still ready
 * are the work that is left.
 */

import type { StageKind } from '@factory/contracts';

import type {
  CancellationToken,
  CredentialReclaimer,
  EnvironmentRegistry,
  RunStore,
  StateSink,
} from './ports.js';
import type { StageRunner, StageRunOutcome } from './runner.js';

/**
 * A node the loop is to run.
 */
export interface ReadyNode {
  readonly taskId: string;
  readonly nodeId: string;
  readonly stageKind: StageKind;
  readonly role: string;
  readonly attempt: number;
  readonly declaredExecutor?: 'deterministic' | 'completion' | 'harness' | 'human';
  readonly spec: unknown;
  readonly context: unknown;
  readonly tools: { readonly capabilities: readonly string[]; readonly scopes: readonly string[] };
  readonly budget: {
    readonly maxTurns?: number;
    readonly maxWallClockMs?: number;
    readonly maxTokens?: number;
    readonly maxCostUsdMicros?: number;
    readonly turns?: number;
    readonly wallClockMs?: number;
    readonly tokens?: number;
    readonly spentUsdMicros?: number;
  };
  readonly isolation: 'T1' | 'T2';
  readonly modelPolicy: { readonly role: string; readonly model?: string };
  readonly upstreamArtefact?: { readonly ref: string; readonly sha256: string };
}

/**
 * The loop's dependencies.
 */
export interface ExecutionLoopDeps {
  /** The stage runner. */
  readonly runner: StageRunner;
  /** The run store. */
  readonly runs: RunStore;
  /** The environment registry. */
  readonly environments: EnvironmentRegistry;
  /** The credential reclaimer. */
  readonly credentials: CredentialReclaimer;
  /** The state sink — where the node transitions go. */
  readonly state: StateSink;
  /** The id source for run ids. */
  readonly nextRunId: () => string;
  /** The clock. */
  readonly clock: { now(): string };
}

/**
 * The outcome of one loop pass.
 */
export interface LoopOutcome {
  /** The outcome of each node the loop ran. */
  readonly outcomes: readonly {
    readonly nodeId: string;
    readonly runId: string;
    readonly outcome: StageRunOutcome;
  }[];
  /**
   * Whether the loop stopped because of the cancellation flag.
   *
   * `true` means the nodes that were not run are still `READY` and the
   * loop is resumable.
   */
  readonly cancelled: boolean;
  /** The reason the loop stopped, when it stopped. */
  readonly cancelReason?: string;
}

/**
 * The node state a result implies.
 *
 * blueprint `09` §3's node table has `RUNNING → SUCCEEDED`, `RUNNING →
 * FAILED` and `RUNNING → INCOMPLETE`, so the mapping is direct: the
 * status *is* the target state.
 */
export const NODE_STATE_FOR_STATUS = {
  success: 'SUCCEEDED',
  failure: 'FAILED',
  incomplete: 'INCOMPLETE',
} as const;

/**
 * The execution loop.
 */
export class ExecutionLoop {
  readonly #deps: ExecutionLoopDeps;

  public constructor(deps: ExecutionLoopDeps) {
    this.#deps = deps;
  }

  /**
   * Run the given ready nodes.
   *
   * The nodes are run in the order they are given — the caller (the
   * scheduler's claim order) already established the topological order, and
   * re-sorting here would break the dependency the caller resolved.
   *
   * @param nodes the ready nodes, in order
   * @param token the cooperative cancellation token
   */
  public async run(
    nodes: readonly ReadyNode[],
    token: CancellationToken,
  ): Promise<LoopOutcome> {
    const outcomes: {
      nodeId: string;
      runId: string;
      outcome: StageRunOutcome;
    }[] = [];

    for (const node of nodes) {
      // The cancellation check is **between** steps — pack `02` §4.9.
      // The check happens *before* the node starts, so a cancelled loop
      // does not start the next node.
      if (token.cancelled) {
        return {
          outcomes,
          cancelled: true,
          cancelReason: token.reason ?? 'no reason given',
        };
      }

      const runId = this.#deps.nextRunId();
      const startedAt = this.#deps.clock.now();

      // The node is leased before it runs and running before it runs.
      await this.#deps.state.transition({
        taskId: node.taskId,
        nodeId: node.nodeId,
        to: 'RUNNING',
        trigger: 'stage.started',
      });

      const outcome = await this.#deps.runner.run(
        {
          taskId: node.taskId,
          nodeId: node.nodeId,
          attempt: node.attempt,
          stageKind: node.stageKind,
          ...(node.declaredExecutor === undefined
            ? {}
            : { declaredExecutor: node.declaredExecutor }),
          role: node.role,
          spec: node.spec,
          context: node.context,
          tools: node.tools,
          budget: node.budget,
          isolation: node.isolation,
          modelPolicy: node.modelPolicy,
          ...(node.upstreamArtefact === undefined
            ? {}
            : { upstreamArtefact: node.upstreamArtefact }),
          runId,
          startedAt,
          endedAt: this.#deps.clock.now(),
        },
        token,
      );

      // The transition is applied **after** the result is persisted — the
      // runner persists first, and this is the second half of that ordering.
      await this.#deps.state.transition({
        taskId: node.taskId,
        nodeId: node.nodeId,
        to: NODE_STATE_FOR_STATUS[outcome.status],
        trigger: 'stage.finished',
      });

      outcomes.push({ nodeId: node.nodeId, runId, outcome });
    }

    return { outcomes, cancelled: false };
  }
}
