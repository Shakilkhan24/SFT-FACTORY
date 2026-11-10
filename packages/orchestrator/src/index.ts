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
 *
 * For checklist 03 (T-1.13) it holds the **orchestration runtime** — the
 * stage runner, the executor registry, the execution loop, resume,
 * pause/cancel, budgets, failure classes and escalation (pack 02 §4.9,
 * blueprint `09` §8). The same split applies again: the *rules* —
 * which executor a stage uses, whether a failure is retried, whether a
 * budget is exhausted — are pure functions in `runtime/*.ts`, and the
 * side-effecting pipeline composes them behind ports.
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

/* -------------------------------------------------------------------------- */
/* The orchestration runtime (checklist 03, T-1.13)                           */
/* -------------------------------------------------------------------------- */

export {
  DEFAULT_EXECUTOR_BY_STAGE,
  HARNESS_ELIGIBLE_STAGE_KINDS,
  IMPLEMENTED_STAGE_KINDS,
  UNIMPLEMENTED_STAGE_KINDS,
  harnessAllowedFor,
  isImplementedStageKind,
  resolveExecutorKind,
  type ExecutorResolution,
} from './runtime/stage-kinds.js';

export {
  backoffMs,
  classifyFailure,
  DEFAULT_BACKOFF_BASE_MS,
  ESCALATION_TRIGGER_BY_CLASS,
  RAW_FAILURE_CLASSES,
  RETRY_POLICY_BY_CLASS,
  shouldRetry,
  type FailureClassification,
  type RetryPolicy,
} from './runtime/failures.js';

export {
  BUDGET_DIMENSIONS,
  BUDGET_FAILURE_CLASS,
  checkBudget,
  INCOMPLETE_ARTEFACT_LABEL,
  isIncompleteArtefact,
  labelIncomplete,
  type BudgetDimension,
  type BudgetVerdict,
  type StageArtefact,
  type StageBudget,
} from './runtime/budget.js';

export {
  cancelledToken,
  NEVER_CANCELLED,
  type CancellationToken,
  type CredentialReclaimer,
  type EnvironmentRegistry,
  type HarnessAdapter,
  type IsolationTier,
  type LeaseStore,
  type ModelPolicy,
  type NodeLease,
  type RunRecord,
  type RunStore,
  type StageExecutor,
  type StageInput,
  type StageResult,
  type StageStatus,
  type StateSink,
  type ToolGrantContext,
} from './runtime/ports.js';

export {
  ExecutorRegistry,
  type RegistryResolution,
} from './runtime/registry.js';

export {
  StageRunner,
  type StageRunOutcome,
  type StageRunRequest,
  type StageRunnerDeps,
} from './runtime/runner.js';

export {
  ExecutionLoop,
  NODE_STATE_FOR_STATUS,
  type ExecutionLoopDeps,
  type LoopOutcome,
  type ReadyNode,
} from './runtime/loop.js';

export {
  isKnownEscalationTrigger,
  RESUME_FAILED_TRIGGER,
  ResumePath,
  type ResumeDeps,
  type ResumeOutcome,
  type ResumeReport,
  type ResumableTask,
} from './runtime/resume.js';

export {
  CancelPath,
  type CancelDeps,
  type CancelOutcome,
} from './runtime/cancel.js';

export { InMemoryRunStore } from './runtime/fakes/in-memory-run-store.js';

export { InMemoryLeaseStore } from './runtime/fakes/in-memory-lease-store.js';

export {
  FakeExecutor,
  FakeHarnessAdapter,
} from './runtime/fakes/fake-executor.js';

export {
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeStateSink,
} from './runtime/fakes/fake-reclaimers.js';
