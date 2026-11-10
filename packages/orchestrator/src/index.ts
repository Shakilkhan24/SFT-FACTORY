/**
 * `orchestrator` — the orchestration runtime (pack 02 §3).
 *
 * pack 02 §3: "`orchestrator` may import everything except `apps`." So this
 * is where the pieces that talk to storage are wired together.
 *
 * For checklist 02 (T-1.04) it holds the Postgres implementation of the
 * state machine's storage interface — the row lock, and the one transaction
 * that carries the state change and its event.
 *
 * The *machine* itself is in `@factory/state`, which is a **pure** package
 * (pack 02 §3): no `pg`, no network, no clock. The separation is what makes
 * the guards testable without a database.
 *
 * For checklist 03 (T-1.07) it holds the **scheduler** — the job queue with
 * leases (pack 02 §4.8, blueprint ADR-0012). The same split applies: the
 * rules live in `scheduler/scheduler.ts`, behind ports, and the Postgres
 * implementation of the queue lives in `scheduler/postgres-job-queue.ts`.
 */

export {
  PostgresStateMachineStore,
  type PostgresStateMachineStoreOptions,
} from './postgres-state-store.js';

export type {
  CapProvider,
  JobQueue,
  KillSwitch,
  SchedulerDeps,
  SchedulerEvent,
  SchedulerEventSink,
} from './scheduler/ports.js';

export {
  NODE_DUPLICATE_EXECUTION_EVENT,
  NODE_LEASED_EVENT,
  Scheduler,
  capBlocks,
  capsFromDefinition,
  type SchedulerOptions,
} from './scheduler/scheduler.js';

export {
  InMemoryJobQueue,
  type RecordingJobQueue,
} from './scheduler/in-memory-job-queue.js';

export {
  PostgresJobQueue,
  rowToJob,
  type PostgresJobQueueOptions,
} from './scheduler/postgres-job-queue.js';

export {
  attemptOf,
  fixedClock,
  heartbeatIntervalMs,
  nodeIdempotencyKey,
  systemClock,
  type ClaimOutcome,
  type ClaimRefusal,
  type Clock,
  type CompleteOutcome,
  type ConcurrencyCaps,
  type EnqueueJob,
  type EnqueueOutcome,
  type HeartbeatOutcome,
  type Job,
  type JobStatus,
  type KillSwitchState,
  type Lease,
  type ReapOutcome,
  type RequeuedJob,
} from './scheduler/types.js';

export const packageName = 'orchestrator';
