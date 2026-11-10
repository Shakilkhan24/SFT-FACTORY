/**
 * The scheduler's rules (pack 02 §4.8).
 *
 * Everything here is a *decision*: should this job be claimed? Is the cap
 * reached? Is the kill-switch on? Has this result already been committed?
 *
 * The decisions are pure functions of their inputs. The side effects — the
 * SQL that moves a row — are behind {@link JobQueue}. That is what makes the
 * oracle provable without a database:
 *
 * > 1000-iteration race ⇒ no double-claim; an expired lease is re-queued
 * > **once**; a duplicate completion is recorded as `node.duplicateExecution`
 * > and the first wins; caps are respected; **no auto-fill** of spare
 * > capacity
 *
 * ## The three rules that carry the ticket
 *
 * ### 1. Caps are enforced *before* a claim, not after
 *
 * The cap check happens in the scheduler, before `queue.claim` is called.
 * That ordering matters for I-11: if the cap were enforced by the queue's
 * own transaction only, then a caller who ignored the cap could still start
 * work. The scheduler refuses to *ask*; the queue refuses to *over-lease*.
 * Both are needed, and they are not the same check.
 *
 * ### 2. No auto-fill of spare capacity
 *
 * I-11: "Surplus capacity is allocated by policy, not by default."
 *
 * The temptation in a queue is to keep the workers busy: if one job is
 * waiting and three workers are idle, start three. That is *exactly* what
 * I-11 forbids, and the temptation is strongest at the moment the cap is
 * not yet reached — there is "spare capacity" by any naive reading.
 *
 * The rule the scheduler implements is narrower and precise: **the
 * scheduler claims at most one job per claim request, and it never claims
 * more than the cap allows.** A worker that wants more work asks again. The
 * number of workers therefore does not change the factory's load; only the
 * definition's caps do.
 *
 * The concrete consequence, and the thing the oracle test asserts: adding
 * capacity (a second worker, a third) must not increase the number of
 * concurrently leased jobs beyond the cap, and must not cause the scheduler
 * to lease *additional* jobs to fill the idle workers.
 *
 * ### 3. The first committed result wins
 *
 * blueprint 09 §6: node execution is idempotent by `(taskId,nodeId,attempt)`
 * and "the first committed result wins"; exactly-once *side effects* on
 * external systems are explicitly **not** guaranteed.
 *
 * So a stale worker that reports after its lease was reaped is *not* an
 * error to be tolerated silently — it is an event to be recorded:
 * `node.duplicateExecution` with `['nodeId','attempt','winnerRunId']`. The
 * payload names the winner, so the log answers "which run's result was
 * kept?" without a join.
 */

import type {
  CapProvider,
  JobQueue,
  KillSwitch,
  SchedulerDeps,
  SchedulerEvent,
  SchedulerEventSink,
} from './ports.js';
import {
  type ClaimOutcome,
  type ClaimRefusal,
  type Clock,
  type ConcurrencyCaps,
  type CompleteOutcome,
  type EnqueueJob,
  type EnqueueOutcome,
  type HeartbeatOutcome,
  type Job,
  type Lease,
  type ReapOutcome,
} from './types.js';

/**
 * The event type for a lease.
 *
 * The name is fixed by `packages/contracts/src/event-log.ts` — it is already
 * in `EVENT_TYPES`, with the payload `['nodeId','attempt','leaseOwner',
 * 'leaseExpiresAt']`.
 */
export const NODE_LEASED_EVENT = 'node.leased';

/**
 * The event type for a duplicate execution.
 *
 * Payload: `['nodeId','attempt','winnerRunId']`.
 */
export const NODE_DUPLICATE_EXECUTION_EVENT = 'node.duplicateExecution';

/**
 * The options for a {@link Scheduler}.
 */
export interface SchedulerOptions {
  /**
   * Whether the definition says the kill-switch is to be honoured.
   *
   * `factory.spec.global.killSwitch.honour` (pack 03 §4.1). When it is
   * `false`, the scheduler keeps scheduling and the switch is inert — the
   * operator asked for it to be inert.
   *
   * When it is `true` (the default when the definition does not say), the
   * scheduler refuses to claim new work while the switch is engaged.
   */
  readonly honourKillSwitch?: boolean;
}

/**
 * The scheduler.
 */
export class Scheduler {
  readonly #queue: JobQueue;
  readonly #caps: CapProvider;
  readonly #killSwitch: KillSwitch;
  readonly #clock: Clock;
  readonly #events: SchedulerEventSink | undefined;
  readonly #honourKillSwitch: boolean;

  public constructor(deps: SchedulerDeps, options: SchedulerOptions = {}) {
    this.#queue = deps.queue;
    this.#caps = deps.caps;
    this.#killSwitch = deps.killSwitch;
    this.#clock = deps.clock;
    this.#events = deps.events;
    this.#honourKillSwitch = options.honourKillSwitch ?? true;
  }

  /**
   * Enqueue a job.
   *
   * Idempotent on the idempotency key, so a retry of the enqueue is safe.
   */
  public async enqueue(job: EnqueueJob): Promise<EnqueueOutcome> {
    return this.#queue.enqueue(job);
  }

  /**
   * Claim one job for `owner`.
   *
   * The order of the checks is the specification:
   *
   * 1. **kill-switch** — an engaged switch stops new claims. The work stays
   *    `ready`; nothing is failed or re-queued. This is a *pause*, not a
   *    cancellation.
   * 2. **claim** — exactly one job, or none. The concurrency caps are
   *    enforced *inside* the claim, under the same lock that counts the
   *    leased jobs.
   *
   * The claim is for one job only. The scheduler never asks for a second
   * job to fill a second idle worker (I-11).
   */
  public async claim(input: {
    readonly owner: string;
    readonly leaseMs: number;
    readonly workflow?: string;
  }): Promise<ClaimOutcome> {
    const now = this.#clock.now();

    const switchState = await this.#killSwitch.state();
    if (this.#honourKillSwitch && switchState.engaged) {
      return { claimed: false, reason: { kind: 'kill-switch-engaged' } };
    }

    const caps = await this.#caps.caps();

    // The caps are enforced **inside** the queue's claim, under the same
    // lock that counts the leased jobs. A separate "count, then claim"
    // would let N workers all read the same stale count and all claim.
    const job = await this.#queue.claim({
      owner: input.owner,
      leaseMs: input.leaseMs,
      now,
      caps,
    });

    if (job === undefined) {
      // The queue refused, and it knows why. A caller that cannot tell
      // "nothing to do" from "policy forbids it now" cannot report the
      // factory's state honestly, so the reason is carried, not guessed.
      const refusal = this.#queue.claimRefusal();
      return { claimed: false, reason: refusal ?? { kind: 'empty' } };
    }

    const lease: Lease = {
      jobId: job.id,
      owner: input.owner,
      attempt: job.attempt,
      expiresAt: job.leaseExpiresAt ?? now,
    };

    await this.#appendLeased(job, lease);

    return { claimed: true, job, lease };
  }

  /**
   * Renew a lease.
   *
   * A `renewed: false` means the lease was lost — the job was re-queued by
   * the reaper or completed by someone else. The worker must stop; its
   * result is no longer authoritative.
   */
  public async heartbeat(input: {
    readonly jobId: number;
    readonly owner: string;
    readonly leaseMs: number;
  }): Promise<HeartbeatOutcome> {
    return this.#queue.heartbeat({
      jobId: input.jobId,
      owner: input.owner,
      leaseMs: input.leaseMs,
      now: this.#clock.now(),
    });
  }

  /**
   * Re-queue expired leases and dead-letter the exhausted ones.
   *
   * Each expired lease is re-queued **once**: the queue's reap path is
   * responsible for the once-ness, because only it can see the job's
   * current status atomically.
   */
  public async reap(): Promise<ReapOutcome> {
    return this.#queue.reap({ now: this.#clock.now() });
  }

  /**
   * Report a result for a leased job.
   *
   * If another worker already committed a result for this node, the result
   * is **not** applied and a `node.duplicateExecution` event is recorded
   * naming the winner. The first committed result wins.
   */
  public async complete(input: {
    readonly jobId: number;
    readonly owner: string;
    readonly taskId: string;
    readonly nodeId: string | null;
    readonly workflow: string;
    readonly attempt: number;
    readonly runId: string;
    readonly outcome: 'succeeded' | 'failed';
    readonly result?: unknown;
  }): Promise<CompleteOutcome> {
    const outcome = await this.#queue.complete(input);

    if (outcome.duplicate && input.nodeId !== null) {
      await this.#appendDuplicateExecution(input.nodeId, input.attempt, outcome.winnerRunId);
    }

    return outcome;
  }

  /**
   * The job with the given id.
   */
  public async byId(jobId: number): Promise<Job | undefined> {
    return this.#queue.byId(jobId);
  }

  /**
   * Append the `node.leased` event.
   */
  async #appendLeased(job: Job, lease: Lease): Promise<void> {
    const sink = this.#events;
    if (sink === undefined || job.nodeId === null) {
      return;
    }

    const event: SchedulerEvent = {
      eventType: NODE_LEASED_EVENT,
      aggregate: { kind: 'node', id: `${job.taskId}:${job.nodeId}`, version: 0 },
      correlationId: job.taskId,
      actor: { kind: 'system', id: lease.owner },
      authority: { basis: 'system-rule' },
      subject: { taskId: job.taskId, nodeId: job.nodeId },
      payload: {
        nodeId: job.nodeId,
        attempt: lease.attempt,
        leaseOwner: lease.owner,
        leaseExpiresAt: lease.expiresAt,
      },
      context: { items: [] },
    };

    await sink.append([event]);
  }

  /**
   * Append the `node.duplicateExecution` event.
   */
  async #appendDuplicateExecution(
    nodeId: string,
    attempt: number,
    winnerRunId: string | undefined,
  ): Promise<void> {
    const sink = this.#events;
    if (sink === undefined) {
      return;
    }

    const event: SchedulerEvent = {
      eventType: NODE_DUPLICATE_EXECUTION_EVENT,
      aggregate: { kind: 'node', id: nodeId, version: 0 },
      correlationId: nodeId,
      actor: { kind: 'system', id: 'scheduler' },
      authority: { basis: 'system-rule' },
      subject: { nodeId },
      payload: {
        nodeId,
        attempt,
        winnerRunId: winnerRunId ?? 'unknown',
      },
      context: { items: [] },
    };

    await sink.append([event]);
  }
}

/**
 * Decide whether a cap blocks a claim for a *named* workflow.
 *
 * Returns `undefined` when the claim may proceed, and the refusal reason
 * when it may not.
 *
 * ## This is the advisory check, not the enforcement
 *
 * The caps are enforced inside {@link JobQueue.claim}, under the same lock
 * that counts the leased jobs. This function answers a *different* question:
 * "given these counts, would a claim for this workflow be refused right
 * now?" It is useful for reporting and for the pre-flight check, but it
 * cannot be the enforcement point — a separate count-then-claim leaves a
 * window in which every worker reads the same stale count.
 *
 * ## Why the global cap is checked first
 *
 * When both caps are reached, the *global* cap is reported. It is the
 * broader constraint, and reporting it tells the operator that adding
 * workflow-specific headroom would not help.
 *
 * ## Why an absent cap is no cap
 *
 * The definition's caps are optional (`maxConcurrentTasks` and
 * `maxConcurrent` are both `.optional()` in the contract). A cap that is
 * absent means "not configured", which is **not** the same as "zero". A cap
 * of zero would mean no work ever runs, which would be a spectacular way to
 * honour an omission.
 */
export const capBlocks = (
  caps: ConcurrencyCaps,
  counts: { readonly global: number; readonly perWorkflow: Readonly<Record<string, number>> },
  workflow: string | undefined,
): ClaimRefusal | undefined => {
  const global = caps.global;
  if (global !== undefined && counts.global >= global) {
    return { kind: 'cap-reached' };
  }

  const perWorkflow = caps.perWorkflow;
  if (workflow !== undefined && perWorkflow !== undefined) {
    const limit = perWorkflow[workflow];
    if (limit !== undefined) {
      const leased = counts.perWorkflow[workflow] ?? 0;
      if (leased >= limit) {
        return { kind: 'cap-reached', workflow };
      }
    }
  }

  return undefined;
};

/**
 * Build the caps from a definition bundle.
 *
 * pack 02 §4.8: "Concurrency caps come from the definition per workflow and
 * globally."
 *
 * The global cap is `factory.spec.global.maxConcurrentTasks`; the
 * per-workflow cap is `workflow.spec.limits.maxConcurrent`. Both are
 * optional, and both are *absent* rather than zero when unset.
 *
 * The function accepts the two shapes separately so it does not have to know
 * the whole definition document — it is a pure mapping from the definition's
 * limits to the caps the scheduler reads.
 */
export const capsFromDefinition = (input: {
  readonly globalMaxConcurrentTasks?: number;
  readonly workflows: readonly { readonly name: string; readonly maxConcurrent?: number }[];
}): ConcurrencyCaps => {
  const perWorkflow: Record<string, number> = {};

  for (const workflow of input.workflows) {
    if (workflow.maxConcurrent !== undefined) {
      perWorkflow[workflow.name] = workflow.maxConcurrent;
    }
  }

  return {
    ...(input.globalMaxConcurrentTasks === undefined
      ? {}
      : { global: input.globalMaxConcurrentTasks }),
    ...(Object.keys(perWorkflow).length === 0 ? {} : { perWorkflow }),
  };
};
