/**
 * The scheduler's types (pack 02 §4.8, blueprint ADR-0012).
 *
 * ## What this is
 *
 * ADR-0012 picks a **relational-backed job queue with leases** for job
 * distribution: "At-least-once delivery, visibility timeout, idempotent
 * handlers, dead-letter, per-capability concurrency limits." The scheduler
 * is the component that owns that queue.
 *
 * pack 02 §4.8 is the specification of record:
 *
 * > * Relational queue `jobs`: claim with `UPDATE … WHERE id = (SELECT … FOR
 * >   UPDATE SKIP LOCKED LIMIT 1) RETURNING *`; lease `lease_expires_at`;
 * >   heartbeat every `lease/3`; reaper re-queues expired leases
 * >   (`node.leased → ready`) and records `node.duplicateExecution` if a
 * >   stale worker later reports; first committed result wins.
 * > * Concurrency caps come from the definition per workflow and globally;
 * >   **no auto-fill of spare capacity** (I-11).
 * > * Node handlers are idempotent by `(taskId,nodeId,attempt)`.
 *
 * ## Why the ports are here and not the SQL
 *
 * The rules that decide *whether* a job may be claimed — the caps, the
 * kill-switch, the idempotency key, "first committed result wins" — are
 * business rules, and business rules are testable. The SQL that *moves* a
 * row is an implementation detail of the queue.
 *
 * So the scheduler takes a {@link JobQueue} port. `PostgresJobQueue` is the
 * real one (`postgres-job-queue.ts`); `InMemoryJobQueue` is a double that
 * makes the rules provable without a database.
 *
 * This split is the same one `packages/state` makes with its
 * `StateMachineStore`, and for the same reason: pack 02 §3 keeps `state`
 * **pure** (no `pg`, no clock, no network) so the guards can be property-tested
 * everywhere. The scheduler is not itself pure — it needs a clock — but the
 * clock is *injected*, so the rules are still deterministic under test.
 *
 * ## The delivery semantics, stated plainly
 *
 * At-least-once. A job may be delivered **twice**: once to the worker that
 * held the lease, and again to a different worker after the lease expired and
 * the reaper re-queued it. That is not a bug to be designed away — it is the
 * contract, and it is why blueprint 09 §6 says the *node* is idempotent and
 * the *first committed result wins*.
 *
 * Exactly-once **side effects on external systems are explicitly not
 * guaranteed** (blueprint 09 §6). What is guaranteed is that the factory's
 * own record keeps the first result.
 */

/**
 * A job in the queue.
 *
 * The shape mirrors `jobs` in `migrations/0001_core.sql`, minus the fields
 * the scheduler does not reason about (`created_at`).
 */
export interface Job {
  /** The surrogate key. */
  readonly id: number;
  /** The task the job belongs to. */
  readonly taskId: string;
  /** The node the job belongs to, if the job is a node execution. */
  readonly nodeId: string | null;
  /** The workflow the task runs under — the per-workflow cap keys off this. */
  readonly workflow: string;
  /** The job kind. */
  readonly kind: string;
  /** The queue status. */
  readonly status: JobStatus;
  /** The queue priority — lower is claimed first. */
  readonly priority: number;
  /** The earliest time the job may be claimed. */
  readonly availableAt: string;
  /** The worker that holds the lease, if any. */
  readonly leaseOwner: string | null;
  /** The ISO-8601 instant the lease expires, if leased. */
  readonly leaseExpiresAt: string | null;
  /** The attempt number — incremented on each lease. */
  readonly attempt: number;
  /** The attempt ceiling; past it the job is dead-lettered. */
  readonly maxAttempts: number;
  /** The idempotency key — `(taskId,nodeId,attempt)` for node jobs. */
  readonly idempotencyKey: string;
}

/**
 * The queue status. Mirrors the `CHECK` constraint on `jobs.status`.
 */
export type JobStatus = 'ready' | 'leased' | 'done' | 'failed' | 'dead';

/**
 * The job to enqueue.
 *
 * `idempotencyKey` is `NOT NULL UNIQUE` in the DDL, so the key is what makes
 * enqueueing idempotent: enqueueing the same key twice yields one row.
 */
export interface EnqueueJob {
  readonly taskId: string;
  readonly nodeId: string | null;
  readonly workflow: string;
  readonly kind: string;
  readonly priority?: number;
  readonly availableAt?: string;
  readonly maxAttempts?: number;
  readonly idempotencyKey: string;
}

/**
 * The result of an enqueue.
 *
 * `created` is false when the idempotency key was already present — the
 * existing job is returned unchanged. Enqueueing is therefore safe to retry.
 */
export interface EnqueueOutcome {
  readonly job: Job;
  readonly created: boolean;
}

/**
 * The outcome of a claim.
 *
 * `job === undefined` means *nothing was claimed* — either the queue is
 * empty, or every ready job is blocked by a concurrency cap. The distinction
 * matters: the first is "no work", the second is "work exists but policy
 * forbids it now", and I-11 requires the difference to be visible rather
 * than papered over by starting extra work.
 */
export type ClaimOutcome =
  | { readonly claimed: true; readonly job: Job; readonly lease: Lease }
  | { readonly claimed: false; readonly reason: ClaimRefusal };

/**
 * Why a claim was refused.
 */
export type ClaimRefusal =
  /** The queue holds no ready job at all. */
  | { readonly kind: 'empty' }
  /**
   * The kill-switch is engaged and the definition says to honour it.
   *
   * The scheduler does **not** claim work while the switch is on, and does
   * **not** re-queue or fail anything — the work stays `ready`, exactly
   * where it was.
   */
  | { readonly kind: 'kill-switch-engaged' }
  /**
   * A concurrency cap is reached — globally, or for this job's workflow.
   *
   * `workflow` is the workflow whose cap was hit, or `undefined` for the
   * global cap.
   */
  | { readonly kind: 'cap-reached'; readonly workflow?: string };

/**
 * A lease.
 *
 * The lease is a *time*, not a lock: the worker must heartbeat before
 * `expiresAt` or the reaper will re-queue the job. That is the
 * "visibility timeout" ADR-0012 requires.
 */
export interface Lease {
  readonly jobId: number;
  readonly owner: string;
  /** The attempt this lease is for. */
  readonly attempt: number;
  /** The ISO-8601 instant the lease expires. */
  readonly expiresAt: string;
}

/**
 * The result of a heartbeat.
 *
 * `renewed: false` means the lease was already lost — the job was re-queued
 * (or completed) by someone else. A worker that gets `renewed: false` must
 * **stop**: its result is no longer authoritative, and reporting it would be
 * the duplicate execution the reaper watches for.
 */
export interface HeartbeatOutcome {
  readonly renewed: boolean;
  readonly lease?: Lease;
}

/**
 * The outcome of a completion report.
 *
 * `duplicate: true` means the result was **not** applied — another worker
 * already committed a result for this node. The first committed result wins
 * (pack 02 §4.8, blueprint 09 §6).
 */
export interface CompleteOutcome {
  readonly applied: boolean;
  readonly duplicate: boolean;
  /** The run id of the worker whose result was kept. */
  readonly winnerRunId?: string;
}

/**
 * The outcome of the reaper.
 */
export interface ReapOutcome {
  /** The jobs re-queued because their lease had expired. */
  readonly requeued: readonly RequeuedJob[];
  /** The jobs dead-lettered because the attempt ceiling was reached. */
  readonly deadLettered: readonly Job[];
}

/**
 * A job the reaper re-queued.
 */
export interface RequeuedJob {
  readonly jobId: number;
  readonly taskId: string;
  readonly nodeId: string | null;
  readonly workflow: string;
  /** The attempt the expired lease was for. */
  readonly expiredAttempt: number;
  /** The attempt the job now carries after the re-queue. */
  readonly attempt: number;
  /** The worker that held the expired lease. */
  readonly previousOwner: string | null;
}

/**
 * The concurrency caps, read from the definition.
 *
 * pack 02 §4.8: "Concurrency caps come from the definition per workflow and
 * globally". The definition carries them in two places:
 *
 * * `factory.spec.global.maxConcurrentTasks` — the global cap;
 * * `workflow.spec.limits.maxConcurrent` — the per-workflow cap.
 *
 * Both are optional in the contract, so **both are optional here**: a cap
 * that is absent is *no cap*, not zero.
 */
export interface ConcurrencyCaps {
  /**
   * The global cap on concurrently leased jobs. `undefined` means uncapped.
   */
  readonly global?: number;
  /**
   * The per-workflow caps. A workflow absent from the map is uncapped.
   */
  readonly perWorkflow?: Readonly<Record<string, number>>;
}

/**
 * The state of the kill-switch.
 */
export interface KillSwitchState {
  readonly engaged: boolean;
  readonly engagedBy?: string;
  readonly reason?: string;
}

/**
 * The clock the scheduler reads.
 *
 * Injected, so the rules are deterministic under test and the package does
 * not read the wall clock behind the caller's back.
 */
export interface Clock {
  /** The current instant, as an ISO-8601 string. */
  now(): string;
}

/**
 * A clock that reads the wall clock.
 */
export const systemClock: Clock = {
  now: (): string => new Date().toISOString(),
};

/**
 * A clock that returns a fixed instant.
 */
export const fixedClock = (iso: string): Clock => ({
  now: (): string => iso,
});

/**
 * The idempotency key for a node execution.
 *
 * pack 02 §4.8: "Node handlers are idempotent by `(taskId,nodeId,attempt)`."
 *
 * The key is the *attempt*, not the node — so a re-queued job (attempt 2)
 * is a *different* key from attempt 1. That is deliberate: the reaper's
 * re-queue is a new attempt of the same node, and the first committed
 * result is what wins, not the first attempt.
 */
export const nodeIdempotencyKey = (
  taskId: string,
  nodeId: string,
  attempt: number,
): string => `${taskId}:${nodeId}:${String(attempt)}`;

/**
 * The attempt component of an idempotency key.
 *
 * The key is `(taskId,nodeId,attempt)` — pack 02 §4.8: "Node handlers are
 * idempotent by `(taskId,nodeId,attempt)`." The attempt is the last
 * component, so it is the part after the final colon.
 *
 * A key that does not carry a numeric attempt yields 1 — the first attempt.
 */
export const attemptOf = (idempotencyKey: string): number => {
  const tail = idempotencyKey.slice(idempotencyKey.lastIndexOf(':') + 1);
  const parsed = Number.parseInt(tail, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

/**
 * The heartbeat interval for a lease.
 *
 * pack 02 §4.8: "heartbeat every `lease/3`". The division by three means two
 * heartbeats may be missed before the lease expires — the worker gets one
 * more chance to renew before the reaper takes the job back.
 */
export const heartbeatIntervalMs = (leaseMs: number): number =>
  Math.max(1, Math.floor(leaseMs / 3));
