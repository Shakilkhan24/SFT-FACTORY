/**
 * `t1/reclaim` — **the reclaimer and the leak detector** (T-1.12).
 *
 * ## The rule
 *
 * ADR-0006 §4, verbatim:
 *
 * > Environments, worktrees, containers, and credentials are destroyed when
 * > the task reaches a terminal state, **including failure**. Cleanup is a
 * > reconciler responsibility (ADR-0001), so a crashed task's resources are
 * > reclaimed rather than leaked.
 *
 * And A0.9 (blueprint 16 §3.5):
 *
 * > A worktree is reclaimed when its task reaches a terminal state, including
 * > failure | Leak detector.
 *
 * FR-42: *"Execution environments, credentials, and worktrees shall be
 * reclaimed when a task reaches a terminal state, including on failure."*
 *
 * ## Which states are terminal
 *
 * `TERMINAL` from `@factory/contracts` — the six:
 * `MERGED`, `DEPLOYED`, `REJECTED`, `FAILED`, `ABANDONED`, `INCOMPLETE`.
 *
 * `ESCALATED` is **not** terminal: pack 03 §6 says it is *resumable*. A
 * task that is waiting for a human still owns its workspace, so reclaiming
 * it would destroy the state the human is about to look at. This is the
 * distinction the oracle proves.
 *
 * ## Reclaim by record, not by task
 *
 * The reclaimer works from the **registry**, which is the durable record of
 * the workspaces that exist. It does not ask "what does task X own?" — it
 * asks "what workspaces are recorded?" and then, for each, "has its task
 * reached a terminal state?"
 *
 * The reason is ADR-0006 §4's last sentence: a crashed task's resources
 * must be reclaimed *rather than leaked*. If reclamation depended on the
 * task still existing, a crashed task would leak. This is the same shape as
 * `packages/credentials/src/broker.ts`, where the reaper revokes **by
 * lease** because *"the task may be long dead — there may be nothing to
 * call `revokeAll` on. The lease is the durable record."*
 *
 * ## The leak detector
 *
 * The detector is the oracle's other half. The reclaimer proves that
 * reclamation *happens*; the detector proves that **nothing is left
 * behind**. A reclaimer that silently failed to remove a directory would
 * leave a green test suite and a leaked snapshot.
 */

import { isTerminal } from '@factory/contracts';

import type {
  Leak,
  ReclaimResult,
  SnapshotRegistry,
  TaskState,
  Workspace,
  WorkspaceStore,
} from './ports.js';

/**
 * What the reclaimer needs.
 */
export interface ReclaimerOptions {
  /** The durable record of the workspaces that exist. */
  readonly registry: SnapshotRegistry;
  /** The filesystem, so a directory can actually be removed. */
  readonly store: WorkspaceStore;
  /**
   * The directory the workspaces live under.
   *
   * The detector walks it to find a directory the registry does not know
   * about — the other half of a leak.
   */
  readonly root: string;
  /**
   * The task's current state.
   *
   * Injected rather than read from a database, because the reclaimer is
   * called by the orchestrator (T-1.13) which already knows the state,
   * and because a *detector* has to be able to ask about a task that is
   * long gone.
   */
  readonly stateOf: (taskId: string) => Promise<TaskState | undefined>;
}

/**
 * The reclaimer.
 */
export class WorkspaceReclaimer {
  readonly #options: ReclaimerOptions;

  constructor(options: ReclaimerOptions) {
    this.#options = options;
  }

  /**
   * Reclaim every workspace whose task has reached a terminal state.
   *
   * The terminal states include **failure** — `FAILED`, `ABANDONED` and
   * `INCOMPLETE` reclaim exactly like `MERGED` does. That is the whole
   * point of the rule: a failed task's workspace is exactly the workspace
   * most likely to be forgotten.
   */
  public async reclaimTerminal(): Promise<ReclaimResult> {
    const reclaimed: Workspace[] = [];
    const failures: Error[] = [];

    const workspaces = await this.#options.registry.list();
    for (const workspace of workspaces) {
      const state = await this.#options.stateOf(workspace.taskId);
      if (state === undefined) {
        // The task is **gone**. Its workspace is still ours — that is the
        // leak the detector is for, and the reconciler's job is to close
        // it. A task that no longer exists cannot be resumed, so the
        // workspace cannot come back into use.
        const removed = await this.#remove(workspace);
        if (removed === undefined) {
          reclaimed.push(workspace);
        } else {
          failures.push(removed);
        }
        continue;
      }

      if (!isTerminal(state)) {
        // `ESCALATED` lands here: resumable, so it keeps its workspace.
        continue;
      }

      const removed = await this.#remove(workspace);
      if (removed === undefined) {
        reclaimed.push(workspace);
      } else {
        failures.push(removed);
      }
    }

    return { reclaimed, failures };
  }

  /**
   * Reclaim the workspaces of one task, whatever its state.
   *
   * This is the path the orchestrator takes when it *knows* the task has
   * ended — the happy path of the rule, and the one that does not depend
   * on the registry being complete.
   */
  public async reclaimTask(taskId: string): Promise<ReclaimResult> {
    const reclaimed: Workspace[] = [];
    const failures: Error[] = [];

    const workspaces = await this.#options.registry.list(taskId);
    for (const workspace of workspaces) {
      const removed = await this.#remove(workspace);
      if (removed === undefined) {
        reclaimed.push(workspace);
      } else {
        failures.push(removed);
      }
    }

    return { reclaimed, failures };
  }

  /**
   * The **leak detector**.
   *
   * A leak is a workspace that exists on disk but is not in the registry —
   * or is in the registry while its task is still running.
   *
   * The second case matters: a workspace whose task is *alive* is not a
   * leak, it is a **live** workspace. A detector that reported those would
   * cry wolf, and a detector that is never wrong because it reports
   * nothing would prove nothing. So the detector reports a leak when the
   * directory exists and the registry does not know about it, or when the
   * registry knows about it and the task is gone or terminal.
   */
  public async detectLeaks(): Promise<readonly Leak[]> {
    const leaks: Leak[] = [];

    const recorded = await this.#options.registry.list();
    const known = new Set(recorded.map((workspace) => workspace.root));

    for (const workspace of recorded) {
      const state = await this.#options.stateOf(workspace.taskId);
      if (state === undefined || isTerminal(state)) {
        leaks.push({
          taskId: workspace.taskId,
          kind: workspace.kind,
          root: workspace.root,
          createdAt: workspace.createdAt,
        });
      }
    }

    // The directories on disk that the registry does not know about. This
    // is the other half of the leak: a snapshot that was created and whose
    // record was lost.
    const present = await this.#options.store.readDir(this.#options.root);
    if (present !== undefined) {
      for (const name of present) {
        const root = `${this.#options.root}/${name}`;
        if (known.has(root)) {
          continue;
        }
        leaks.push({
          taskId: '<unknown>',
          kind: 'snapshot',
          root,
          createdAt: '',
        });
      }
    }

    return leaks;
  }

  /**
   * Remove a workspace: the directory, then the record.
   *
   * The order matters. The directory goes first, because a record that says
   * "reclaimed" while the directory is still there is a **lie** the detector
   * would catch — and a directory that is gone while the record survives is
   * a stale record, which the next sweep removes harmlessly.
   */
  async #remove(workspace: Workspace): Promise<Error | undefined> {
    try {
      if (await this.#options.store.exists(workspace.root)) {
        await this.#options.store.remove(workspace.root);
      }
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }

    try {
      await this.#options.registry.forget(workspace.root);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
    return undefined;
  }
}
