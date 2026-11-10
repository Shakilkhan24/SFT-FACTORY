/**
 * `runtime/resume` — **the resume path** (T-1.13).
 *
 * ## What "resume" means
 *
 * pack `02` §4.9:
 *
 * > Resume: on start, rebuild in-flight state from DB; nodes with expired
 * > leases are re-queued; tasks in `RUNNING` with no live node become
 * > `ESCALATED(resume_failed)`.
 *
 * Three sentences, three actions. The third is the one A0.5 is about:
 *
 * > **A0.5** | Killing the control plane mid-run yields a resumed or
 * > explicitly failed task — **never a silent loss** | Fault injection
 *
 * So the resume path answers one question for every task it is asked about:
 * **"is this task still being worked on, or did it die?"** And the answer is
 * never "nothing happened".
 *
 * ## The three cases
 *
 * 1. **The task is not `RUNNING`.** Nothing to resume. It is left alone —
 *    a `DRAFT` task is not the resume path's business, and a `MERGED` task
 *    is finished.
 * 2. **The task is `RUNNING` and has a live node.** The task is alive. It
 *    is left running, and the expired leases among the *other* nodes are
 *    re-queued.
 * 3. **The task is `RUNNING` and has no live node.** The control plane
 *    died holding it. The task becomes `ESCALATED(resume_failed)` — an
 *    **explicit** outcome, and a resumable one (`ESCALATED` is not
 *    terminal; pack 03 §6).
 *
 * ## Why `ESCALATED` and not `FAILED`
 *
 * The task did not fail — the *control plane* failed. The distinction
 * matters because `FAILED` is terminal and `ESCALATED` is not: an escalated
 * task can be re-queued (`ESCALATED → QUEUED`, pack 03 §6's table), so the
 * work is recoverable. Marking a recoverable task `FAILED` would destroy
 * the very thing A0.5 promises — that nothing is *silently* lost.
 *
 * ## The re-queue happens **once**
 *
 * pack `02` §4.8: "the reaper re-queues expired leases (`node.leased →
 * ready`)". Exactly once — a lease released twice would run the node
 * twice. The once-ness belongs to the {@link LeaseStore}, because only it
 * can see the lease's current state atomically; this file asks it to
 * release and reports what it says.
 */

import { ESCALATION_TRIGGERS, type TaskState } from '@factory/contracts';

import type { LeaseStore, NodeLease, RunStore, StateSink } from './ports.js';

/**
 * The escalation trigger for a task whose control plane died.
 *
 * pack 03 §6's escalation trigger list includes `resume_failed` verbatim,
 * and pack `02` §4.9 names it: "tasks in `RUNNING` with no live node
 * become `ESCALATED(resume_failed)`".
 */
export const RESUME_FAILED_TRIGGER = 'resume_failed';

/**
 * A task the resume path considered.
 */
export interface ResumableTask {
  readonly taskId: string;
  readonly state: TaskState;
}

/**
 * The outcome of resuming one task.
 */
export type ResumeOutcome =
  | {
      /** The task was not `RUNNING`, so it was left alone. */
      readonly kind: 'not-running';
    }
  | {
      /** The task is `RUNNING` and alive. */
      readonly kind: 'still-running';
      readonly liveNodes: readonly string[];
    }
  | {
      /** The task is `RUNNING` and its control plane died. */
      readonly kind: 'escalated';
      readonly trigger: string;
      readonly reason: string;
    }
  | {
      /** The task is `RUNNING` with no live node, and the escalation failed. */
      readonly kind: 'escalation-refused';
      readonly reason: string;
    };

/**
 * The outcome of a resume pass.
 */
export interface ResumeReport {
  /** The outcome for each task. */
  readonly outcomes: readonly {
    readonly taskId: string;
    readonly outcome: ResumeOutcome;
  }[];
  /** The leases that were re-queued. */
  readonly requeued: readonly NodeLease[];
  /**
   * The leases that were **not** re-queued.
   *
   * A lease whose release was refused is one that was already re-queued —
   * the once-ness. The count is reported so a caller can tell "nothing
   * needed re-queueing" from "the re-queue was already done".
   */
  readonly notRequeued: readonly NodeLease[];
}

/**
 * The resume path's dependencies.
 */
export interface ResumeDeps {
  /** The run store — the live runs are the truth about what is running. */
  readonly runs: RunStore;
  /** The lease store — the leases are what gets re-queued. */
  readonly leases: LeaseStore;
  /** The state sink — where the escalation goes. */
  readonly state: StateSink;
  /** The clock. */
  readonly clock: { now(): string };
}

/**
 * The resume path.
 */
export class ResumePath {
  readonly #deps: ResumeDeps;

  public constructor(deps: ResumeDeps) {
    this.#deps = deps;
  }

  /**
   * Resume the given tasks.
   *
   * @param tasks the tasks in flight when the control plane stopped
   */
  public async resume(tasks: readonly ResumableTask[]): Promise<ResumeReport> {
    const outcomes: { taskId: string; outcome: ResumeOutcome }[] = [];
    const requeued: NodeLease[] = [];
    const notRequeued: NodeLease[] = [];

    for (const task of tasks) {
      // A task that is not `RUNNING` is not the resume path's business.
      if (task.state !== 'RUNNING') {
        outcomes.push({ taskId: task.taskId, outcome: { kind: 'not-running' } });
        continue;
      }

      // The live runs are the truth about what is still being worked on.
      const liveRuns = await this.#deps.runs.liveRuns(task.taskId);
      const liveNodes = liveRuns.map((run) => run.nodeId);

      // The expired leases are re-queued — once each.
      const leases = await this.#deps.leases.liveLeases(task.taskId);
      const now = this.#deps.clock.now();
      for (const lease of leases) {
        if (lease.expiresAt > now) {
          // The lease is still live. It belongs to a worker that is still
          // running, so it is left alone.
          continue;
        }
        const released = await this.#deps.leases.release(lease);
        if (released.released) {
          requeued.push(lease);
        } else {
          notRequeued.push(lease);
        }
      }

      if (liveNodes.length > 0) {
        outcomes.push({
          taskId: task.taskId,
          outcome: { kind: 'still-running', liveNodes },
        });
        continue;
      }

      // The task is `RUNNING` with no live node: the control plane died
      // holding it. It becomes `ESCALATED(resume_failed)` — explicit, and
      // resumable.
      const escalated = await this.#deps.state.transition({
        taskId: task.taskId,
        nodeId: task.taskId,
        to: 'ESCALATED',
        trigger: RESUME_FAILED_TRIGGER,
        facts: { escalationTrigger: RESUME_FAILED_TRIGGER },
      });

      if (!escalated.ok) {
        outcomes.push({
          taskId: task.taskId,
          outcome: {
            kind: 'escalation-refused',
            reason:
              escalated.reason ??
              `the task could not be escalated to ESCALATED(${RESUME_FAILED_TRIGGER})`,
          },
        });
        continue;
      }

      outcomes.push({
        taskId: task.taskId,
        outcome: {
          kind: 'escalated',
          trigger: RESUME_FAILED_TRIGGER,
          reason: `the task was RUNNING with no live node, so the control plane died holding it`,
        },
      });
    }

    return { outcomes, requeued, notRequeued };
  }
}

/**
 * Is this a trigger the escalation vocabulary knows?
 *
 * The `resume_failed` trigger is in pack 03 §6's list; the check is here so
 * a typo in the trigger name is caught by a test rather than by an operator
 * reading a log.
 */
export const isKnownEscalationTrigger = (trigger: string): boolean =>
  (ESCALATION_TRIGGERS as readonly string[]).includes(trigger);
