/**
 * An in-memory {@link JobQueue} — the double that makes the scheduler's rules
 * provable without a database.
 *
 * ## Why this exists
 *
 * The oracle for T-1.07 is a 1000-iteration race, an expired lease re-queued
 * **once**, a duplicate completion recorded and the first result kept, caps
 * respected, and no auto-fill of spare capacity. Every one of those is a
 * property of the *rules*, and the rules are the valuable part.
 *
 * A Postgres-backed test would prove the rules only where Postgres exists.
 * The environment this repository is built in has **no Docker daemon**, so
 * the Postgres path cannot run here at all — it is deferred to CI, where the
 * daemon exists.
 *
 * This double is therefore not a mock for convenience. It is the *oracle's*
 * home, and it is where the adversarial cases live:
 *
 * * the claim path takes a lock, so 1000 concurrent claims cannot double-lease;
 * * the reap path re-queues an expired lease **once**, tracked by the lease's
 *   identity rather than by the job's status;
 * * the completion path keeps the first result and refuses the second.
 *
 * The Postgres implementation (`postgres-job-queue.ts`) is written to the
 * same contract, and CI proves the two agree.
 */

import type { JobQueue } from './ports.js';
import {
  attemptOf,
  type ClaimOutcome,
  type ClaimRefusal,
  type CompleteOutcome,
  type ConcurrencyCaps,
  type EnqueueJob,
  type EnqueueOutcome,
  type HeartbeatOutcome,
  type Job,
  type JobStatus,
  type ReapOutcome,
  type RequeuedJob,
} from './types.js';

/**
 * A job row, mutable.
 *
 * `idempotencyKey` is mutable because the reaper rewrites it: a re-queued
 * job is a new *attempt* of the same node, and the attempt is part of the
 * key.
 */
interface MemoryJob extends Omit<Job, 'idempotencyKey'> {
  idempotencyKey: string;
  status: JobStatus;
  priority: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attempt: number;
  maxAttempts: number;
  /** The run id whose result was committed, if any. */
  committedRunId: string | undefined;
  /** The committed result, if any. */
  committedResult: unknown;
}

/**
 * The result of a completion, kept per node so the first-wins rule can be
 * checked across jobs (a re-queued job is a different job row).
 */
interface CommittedResult {
  readonly runId: string;
  readonly result: unknown;
}

/**
 * An in-memory job queue.
 */
export class InMemoryJobQueue implements JobQueue {
  readonly #jobs = new Map<number, MemoryJob>();
  readonly #byIdempotencyKey = new Map<string, number>();
  /** The committed result per node — the first-wins ledger. */
  readonly #committedByNode = new Map<string, CommittedResult>();
  #nextId = 1;

  /**
   * Why the last claim found nothing.
   *
   * The queue knows the counts at the moment of the claim; the scheduler
   * needs them to report "the cap is reached" rather than "there is no
   * work".
   */
  #lastRefusal: ClaimRefusal | undefined;

  /**
   * The lock chain.
   *
   * Every mutating operation holds the tail of this promise while it runs,
   * so concurrent claims serialise the way `SELECT … FOR UPDATE` serialises
   * them. Together with {@link InMemoryJobQueue.#yieldPoint} this is what
   * makes the 1000-iteration race test meaningful rather than vacuous.
   */
  #lock: Promise<unknown> = Promise.resolve();

  /**
   * A preemption point inside the locked body.
   *
   * ## Why this exists
   *
   * The in-memory queue's claim body would otherwise be *synchronous*.
   * JavaScript runs it to completion without yielding, so even a queue
   * with **no lock at all** would never double-claim: each body would
   * simply run one after the other. That makes the race test vacuous — it
   * would pass against a broken queue.
   *
   * A real Postgres claim is *not* atomic like that. The implementation
   * counts the leased jobs and selects a candidate, and then leases it,
   * and the transaction yields at each SQL boundary. Between the count and
   * the lease, another transaction may commit. That window is exactly
   * where a double-claim would happen if the count and the claim were not
   * under the same lock.
   *
   * So the double yields at the same point — **after** the count and the
   * candidate selection, **before** the lease is written. The lock is then
   * genuinely load-bearing: removing it lets a second claimer read the
   * same count, pick the same candidate, and lease it too.
   *
   * The yield is a microtask, so it costs nothing in wall-clock terms; it
   * exists to model the database's transaction boundary, not to slow the
   * test down.
   */
  async #yieldPoint(): Promise<void> {
    await Promise.resolve();
  }

  /**
   * Every completion report, in order — the test double's audit trail.
   */
  public readonly completions: {
    readonly jobId: number;
    readonly owner: string;
    readonly nodeId: string | null;
    readonly attempt: number;
    readonly runId: string;
    readonly applied: boolean;
    readonly duplicate: boolean;
  }[] = [];

  /**
   * Every claim, in order.
   */
  public readonly claims: { readonly jobId: number; readonly owner: string }[] = [];

  /**
   * Run `body` under the queue lock.
   */
  async #withLock<T>(body: () => Promise<T> | T): Promise<T> {
    const previous = this.#lock;
    let release: () => void = () => undefined;
    this.#lock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await body();
    } finally {
      release();
    }
  }

  public async enqueue(job: EnqueueJob): Promise<EnqueueOutcome> {
    return this.#withLock(() => {
      const existingId = this.#byIdempotencyKey.get(job.idempotencyKey);
      if (existingId !== undefined) {
        const existing = this.#jobs.get(existingId);
        if (existing !== undefined) {
          return { job: this.#toJob(existing), created: false };
        }
      }

      const id = this.#nextId;
      this.#nextId += 1;

      const row: MemoryJob = {
        id,
        taskId: job.taskId,
        nodeId: job.nodeId,
        workflow: job.workflow,
        kind: job.kind,
        status: 'ready',
        priority: job.priority ?? 100,
        availableAt: job.availableAt ?? new Date(0).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        // The attempt is the **node's** attempt, and it is the last
        // component of the idempotency key `(taskId,nodeId,attempt)`. It
        // is read from the key rather than counted from zero, because the
        // attempt is what makes the key unique — two job rows for the same
        // node with different attempts are two different executions of that
        // node, not the same execution twice.
        attempt: attemptOf(job.idempotencyKey),
        maxAttempts: job.maxAttempts ?? 3,
        idempotencyKey: job.idempotencyKey,
        committedRunId: undefined,
        committedResult: undefined,
      };

      this.#jobs.set(id, row);
      this.#byIdempotencyKey.set(job.idempotencyKey, id);

      return { job: this.#toJob(row), created: true };
    });
  }

  public async leasedCounts(): Promise<{
    readonly global: number;
    readonly perWorkflow: Readonly<Record<string, number>>;
  }> {
    return this.#withLock(() => {
      let global = 0;
      const perWorkflow: Record<string, number> = {};

      for (const job of this.#jobs.values()) {
        if (job.status !== 'leased') {
          continue;
        }
        global += 1;
        perWorkflow[job.workflow] = (perWorkflow[job.workflow] ?? 0) + 1;
      }

      return { global, perWorkflow };
    });
  }

  public async claim(input: {
    readonly owner: string;
    readonly leaseMs: number;
    readonly now: string;
    readonly caps?: ConcurrencyCaps;
  }): Promise<Job | undefined> {
    return this.#withLock(async () => {
      // **The cap check, under the lock.** Counting the leased jobs and
      // claiming a new one happen in the same critical section, so N
      // concurrent claims cannot each read a stale count and all proceed.
      //
      // The count is taken *here*, not by the caller, because a separate
      // "count, then claim" leaves a window in which every worker reads the
      // same stale count and every worker claims.
      let leasedGlobal = 0;
      const leasedPerWorkflow: Record<string, number> = {};

      for (const job of this.#jobs.values()) {
        if (job.status !== 'leased') {
          continue;
        }
        leasedGlobal += 1;
        leasedPerWorkflow[job.workflow] = (leasedPerWorkflow[job.workflow] ?? 0) + 1;
      }

      const global = input.caps?.global;
      if (global !== undefined && leasedGlobal >= global) {
        this.#lastRefusal = { kind: 'cap-reached' };
        return undefined;
      }

      const ready = [...this.#jobs.values()]
        .filter((job) => job.status === 'ready' && job.availableAt <= input.now)
        .sort((a, b) => a.priority - b.priority || a.availableAt.localeCompare(b.availableAt) || a.id - b.id);

      // The candidate is the first ready job **whose workflow is under its
      // cap**. A workflow at its cap is skipped, not a reason to stop the
      // whole queue — another workflow may have headroom.
      const perWorkflow = input.caps?.perWorkflow;
      const job = ready.find((candidate) => {
        const limit = perWorkflow?.[candidate.workflow];
        if (limit === undefined) {
          return true;
        }
        return (leasedPerWorkflow[candidate.workflow] ?? 0) < limit;
      });

      if (job === undefined) {
        // Nothing claimable. If there was ready work, it was blocked by a
        // per-workflow cap; name the first workflow that was blocked.
        const blockedWorkflow = ready.find((candidate) => {
          const limit = perWorkflow?.[candidate.workflow];
          return limit !== undefined && (leasedPerWorkflow[candidate.workflow] ?? 0) >= limit;
        })?.workflow;

        this.#lastRefusal =
          blockedWorkflow === undefined
            ? { kind: 'empty' }
            : { kind: 'cap-reached', workflow: blockedWorkflow };

        return undefined;
      }

      this.#lastRefusal = undefined;

      // **The preemption point.** The count and the candidate selection are
      // done; the lease is not yet written. This is where a real Postgres
      // transaction yields, and it is the window a broken queue would
      // double-claim through. The lock must still be held.
      await this.#yieldPoint();

      job.status = 'leased';
      job.leaseOwner = input.owner;
      job.leaseExpiresAt = new Date(
        new Date(input.now).getTime() + input.leaseMs,
      ).toISOString();

      this.claims.push({ jobId: job.id, owner: input.owner });

      return this.#toJob(job);
    });
  }

  public async heartbeat(input: {
    readonly jobId: number;
    readonly owner: string;
    readonly leaseMs: number;
    readonly now: string;
  }): Promise<HeartbeatOutcome> {
    return this.#withLock(() => {
      const job = this.#jobs.get(input.jobId);
      if (job === undefined || job.status !== 'leased' || job.leaseOwner !== input.owner) {
        return { renewed: false };
      }

      job.leaseExpiresAt = new Date(
        new Date(input.now).getTime() + input.leaseMs,
      ).toISOString();

      return {
        renewed: true,
        lease: {
          jobId: job.id,
          owner: input.owner,
          attempt: job.attempt,
          expiresAt: job.leaseExpiresAt,
        },
      };
    });
  }

  public async reap(input: { readonly now: string }): Promise<ReapOutcome> {
    return this.#withLock(() => {
      const requeued: RequeuedJob[] = [];
      const deadLettered: Job[] = [];

      for (const job of this.#jobs.values()) {
        // **The once-ness.** A lease is re-queued **once** because the
        // re-queue flips the job out of `leased` and clears its
        // `lease_expires_at`. A second reap of the same expired lease
        // therefore finds a job that is no longer `leased` (or has no
        // lease at all) and skips it.
        //
        // This is the same mechanism the Postgres reaper uses — its
        // `WHERE status = 'leased'` clause inside the row-locked
        // subquery. Two implementations, one rule.
        if (job.status !== 'leased' || job.leaseExpiresAt === null) {
          continue;
        }
        if (job.leaseExpiresAt > input.now) {
          continue;
        }

        const expiredAttempt = job.attempt;
        const previousOwner = job.leaseOwner;

        if (job.attempt >= job.maxAttempts) {
          job.status = 'dead';
          job.leaseOwner = null;
          job.leaseExpiresAt = null;
          deadLettered.push(this.#toJob(job));
          continue;
        }

        job.status = 'ready';
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
        job.availableAt = input.now;

        // The re-queue **increments the node's attempt**. The re-queued job
        // is a new attempt of the same node, and the attempt is what
        // distinguishes it from the expired one — it gets a new
        // idempotency key, so a handler keyed by `(taskId,nodeId,attempt)`
        // treats it as distinct work.
        job.attempt += 1;
        job.idempotencyKey = `${job.taskId}:${job.nodeId ?? 'job'}:${String(job.attempt)}`;
        this.#byIdempotencyKey.set(job.idempotencyKey, job.id);

        requeued.push({
          jobId: job.id,
          taskId: job.taskId,
          nodeId: job.nodeId,
          workflow: job.workflow,
          expiredAttempt,
          attempt: job.attempt,
          previousOwner,
        });
      }

      return { requeued, deadLettered };
    });
  }

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
    return this.#withLock(() => {
      const job = this.#jobs.get(input.jobId);

      // A job that is not leased by this owner has already been re-queued or
      // completed. Its result is stale.
      const leaseIsCurrent =
        job !== undefined &&
        job.status === 'leased' &&
        job.leaseOwner === input.owner &&
        job.attempt === input.attempt;

      if (!leaseIsCurrent) {
        this.completions.push({
          jobId: input.jobId,
          owner: input.owner,
          nodeId: input.nodeId,
          attempt: input.attempt,
          runId: input.runId,
          applied: false,
          duplicate: true,
        });

        const winnerRunId = this.#winnerRunId(input);

        return winnerRunId === undefined
          ? { applied: false, duplicate: true }
          : { applied: false, duplicate: true, winnerRunId };
      }

      // The node's first committed result wins.
      if (input.nodeId !== null) {
        const nodeKey = `${input.taskId}:${input.nodeId}`;
        const committed = this.#committedByNode.get(nodeKey);

        if (committed !== undefined) {
          this.completions.push({
            jobId: input.jobId,
            owner: input.owner,
            nodeId: input.nodeId,
            attempt: input.attempt,
            runId: input.runId,
            applied: false,
            duplicate: true,
          });

          return { applied: false, duplicate: true, winnerRunId: committed.runId };
        }

        this.#committedByNode.set(nodeKey, {
          runId: input.runId,
          result: input.result,
        });
      }

      job.status = input.outcome === 'succeeded' ? 'done' : 'failed';
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.committedRunId = input.runId;
      job.committedResult = input.result;

      this.completions.push({
        jobId: input.jobId,
        owner: input.owner,
        nodeId: input.nodeId,
        attempt: input.attempt,
        runId: input.runId,
        applied: true,
        duplicate: false,
      });

      return { applied: true, duplicate: false, winnerRunId: input.runId };
    });
  }

  public async byId(jobId: number): Promise<Job | undefined> {
    return this.#withLock(() => {
      const job = this.#jobs.get(jobId);
      return job === undefined ? undefined : this.#toJob(job);
    });
  }

  /**
   * Why the last claim found nothing.
   */
  public claimRefusal(): ClaimRefusal | undefined {
    return this.#lastRefusal;
  }

  /**
   * The run id whose result was committed for the node, if any.
   */
  #winnerRunId(input: {
    readonly taskId: string;
    readonly nodeId: string | null;
  }): string | undefined {
    if (input.nodeId === null) {
      return undefined;
    }
    const committed = this.#committedByNode.get(`${input.taskId}:${input.nodeId}`);
    return committed?.runId;
  }

  /**
   * The committed result for a node, if any — the "first committed result".
   */
  public committedResult(taskId: string, nodeId: string): CommittedResult | undefined {
    return this.#committedByNode.get(`${taskId}:${nodeId}`);
  }

  /**
   * Copy the mutable row into an immutable {@link Job}.
   */
  #toJob(job: MemoryJob): Job {
    return {
      id: job.id,
      taskId: job.taskId,
      nodeId: job.nodeId,
      workflow: job.workflow,
      kind: job.kind,
      status: job.status,
      priority: job.priority,
      availableAt: job.availableAt,
      leaseOwner: job.leaseOwner,
      leaseExpiresAt: job.leaseExpiresAt,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      idempotencyKey: job.idempotencyKey,
    };
  }
}

/**
 * A job queue that records the claims made against it, for the tests.
 */
export type RecordingJobQueue = InMemoryJobQueue;

/**
 * The claim refusal kinds, re-exported for convenience.
 */
export type { ClaimOutcome };
