/**
 * The scheduler's ports — the interfaces the scheduler talks to.
 *
 * The scheduler owns the *rules*; these interfaces own the *storage*. The
 * rules are the valuable part: they are what the oracle tests.
 */

import type {
  ClaimRefusal,
  Clock,
  CompleteOutcome,
  ConcurrencyCaps,
  EnqueueJob,
  EnqueueOutcome,
  HeartbeatOutcome,
  Job,
  KillSwitchState,
  ReapOutcome,
} from './types.js';

/**
 * The queue port.
 *
 * ## The contract the implementation must honour
 *
 * 1. **Claim is exclusive.** Two workers calling `claim` concurrently for the
 *    same job must never both get it. The Postgres implementation does this
 *    with `SELECT … FOR UPDATE SKIP LOCKED`; the in-memory one with a
 *    promise chain.
 *
 * 2. **A claim increments the attempt.** The attempt is the idempotency
 *    dimension, so a job must not be leased twice under the same attempt
 *    number.
 *
 * 3. **A lease has a deadline.** `leaseExpiresAt` is absolute, so a worker
 *    that stops heart-beating loses the job on its own.
 *
 * 4. **Reaping is idempotent per lease.** A lease may be re-queued **once**
 *    (pack 02 §4.8, and the ticket's oracle: "an expired lease is re-queued
 *    **once**"). The mechanism is the *status*: the re-queue flips the job
 *    out of `leased` and clears its `lease_expires_at`, so a second reap
 *    finds nothing to re-queue. (In Postgres that is the `WHERE status =
 *    'leased'` clause inside the row-locked subquery.)
 *
 * 5. **Completion is first-writer-wins.** A second completion for a node
 *    whose result is already committed must not overwrite it, and must
 *    report `duplicate: true`.
 *
 * 6. **The cap is checked inside the claim.** The count of leased jobs and
 *    the claim of a new one must happen under the *same* lock. A separate
 *    "count, then claim" would leave a window in which N workers all read
 *    "one leased, cap is two" and all claim — ending at three.
 */
export interface JobQueue {
  /**
   * Enqueue a job.
   *
   * Idempotent on `idempotencyKey`: a second enqueue of the same key
   * returns the existing job with `created: false`.
   */
  enqueue(job: EnqueueJob): Promise<EnqueueOutcome>;

  /**
   * The number of jobs currently leased, globally and for one workflow.
   *
   * This is a *read* for observability. It is **not** the enforcement point
   * — the enforcement is inside {@link JobQueue.claim}, under the same lock
   * as the count, because a separate count-then-claim would leave a window
   * in which every worker reads the same stale count and every worker
   * claims.
   */
  leasedCounts(): Promise<{ readonly global: number; readonly perWorkflow: Readonly<Record<string, number>> }>;

  /**
   * Claim one job for `owner`, leasing it until `now + leaseMs`.
   *
   * The caps are enforced **inside** this call, under the same lock that
   * counts the leased jobs. `caps` may be `undefined`, meaning no caps.
   *
   * Returns `undefined` when nothing could be claimed — either the queue is
   * empty, or a cap is reached. The reason is reported separately by
   * {@link JobQueue.claimRefusal}, so the caller can say *why* nothing was
   * claimed rather than guessing.
   */
  claim(input: {
    readonly owner: string;
    readonly leaseMs: number;
    readonly now: string;
    readonly caps?: ConcurrencyCaps;
  }): Promise<Job | undefined>;

  /**
   * Why the last claim on this queue found nothing.
   *
   * The queue knows the counts at the moment of the claim; the scheduler
   * needs them to report "the cap is reached" rather than "there is no
   * work". Those are different facts and a caller that cannot tell them
   * apart cannot report the factory's state honestly.
   */
  claimRefusal(): ClaimRefusal | undefined;

  /**
   * Renew a lease.
   *
   * Returns `renewed: false` when the lease was already lost.
   */
  heartbeat(input: {
    readonly jobId: number;
    readonly owner: string;
    readonly leaseMs: number;
    readonly now: string;
  }): Promise<HeartbeatOutcome>;

  /**
   * Re-queue expired leases.
   *
   * Each expired lease is re-queued **once**: the reaper must not re-queue a
   * job whose lease it already took back.
   */
  reap(input: { readonly now: string }): Promise<ReapOutcome>;

  /**
   * Report a result for a leased job.
   *
   * The first committed result wins. A duplicate reports
   * `duplicate: true` and changes nothing.
   */
  complete(input: {
    readonly jobId: number;
    readonly owner: string;
    readonly taskId: string;
    readonly nodeId: string | null;
    readonly workflow: string;
    readonly attempt: number;
    readonly runId: string;
    readonly outcome: 'succeeded' | 'failed';
    readonly result?: unknown;
  }): Promise<CompleteOutcome>;

  /**
   * The job with the given id, if it exists.
   */
  byId(jobId: number): Promise<Job | undefined>;
}

/**
 * The kill-switch port.
 *
 * The switch is a single row in `factory.kill_switch`. The scheduler reads
 * it; it never writes it (the owner does, through the access-point API in
 * T-1.14).
 */
export interface KillSwitch {
  /** The current state of the switch. */
  state(): Promise<KillSwitchState>;
}

/**
 * The caps port.
 *
 * A port rather than a plain value so the caps can come from the *active
 * definition version* — which changes under the scheduler — without the
 * scheduler re-reading the definition on every claim.
 */
export interface CapProvider {
  /** The caps in force right now. */
  caps(): Promise<ConcurrencyCaps>;
}

/**
 * The event sink.
 *
 * The scheduler records `node.leased` and `node.duplicateExecution` — both
 * are in the contracts' event types already
 * (`packages/contracts/src/event-log.ts`), with payloads fixed:
 *
 * * `node.leased`: `['nodeId', 'attempt', 'leaseOwner', 'leaseExpiresAt']`
 * * `node.duplicateExecution`: `['nodeId', 'attempt', 'winnerRunId']`
 *
 * The sink is the same shape as the one the definition package uses, so the
 * event log's hash chain and CAS apply unchanged.
 */
export interface SchedulerEventSink {
  append(events: readonly SchedulerEvent[]): Promise<readonly unknown[]>;
}

/**
 * An event to append.
 *
 * The shape is deliberately the same as the contracts' `NewEvent`, but
 * declared locally so this file does not depend on the event log's
 * internals. The Postgres sink converts it.
 */
export interface SchedulerEvent {
  readonly eventType: string;
  readonly aggregate: { readonly kind: string; readonly id: string; readonly version: number };
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actor: { readonly kind: string; readonly id: string };
  readonly authority: { readonly basis: string };
  readonly subject?: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly context?: { readonly items: readonly unknown[] };
}

/**
 * Everything the scheduler needs, in one bundle.
 */
export interface SchedulerDeps {
  readonly queue: JobQueue;
  readonly caps: CapProvider;
  readonly killSwitch: KillSwitch;
  readonly clock: Clock;
  readonly events?: SchedulerEventSink;
}
