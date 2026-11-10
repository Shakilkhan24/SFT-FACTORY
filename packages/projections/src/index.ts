/**
 * `projections` — the projector and its rebuildable views (checklist 03,
 * T-1.15).
 *
 * pack `02` §4.18: "A **projector** (worker) tails `events` by `seq` with
 * a durable cursor … **Every projection can be dropped and rebuilt from
 * the log** (A0.6)."
 *
 * blueprint `15` §3.1: "The event log is the source of truth. The
 * projections are disposable."
 *
 * ## The shape of the package
 *
 * * `reducers/` — the **pure** folds. `(row, event) => row`. No clock, no
 *   I/O, no accumulation over the fold. That is what makes the rebuild
 *   produce identical rows.
 * * `projector.ts` — the loop. Reads the log from the cursor, reduces,
 *   and writes the rows **and** the cursor in **one** transaction.
 * * `rebuild.ts` — the rebuild, and the **comparison** that says whether
 *   the rebuilt rows are identical.
 * * `staleness.ts` — the pack's staleness thresholds and the verdicts.
 * * `hash.ts` — the row digest the rebuild compares.
 * * `ports.ts` — the ports; `fakes/` and the `postgres-*` modules are
 *   their implementations.
 *
 * ## No contract change
 *
 * The row shapes come from pack `03` §2's normative column list, and the
 * event vocabulary already covers every event the reducers read. So
 * T-1.15 needs **no** change to `packages/contracts` — HR-12 is
 * satisfied by construction.
 */

export {
  PROJECTION_NAMES,
  costAttributionKey,
  type ApprovalQueueRow,
  type CostAttributionRow,
  type ProjectionName,
  type TaskCurrentRow,
} from './types.js';

export {
  PROJECTIONS,
  REDUCERS,
  belongsToTask,
  costBucketKey,
  costRowOf,
  dayOf,
  isTransitionEvent,
  reducerFor,
  reduceApprovalQueue,
  reduceCostAttribution,
  reduceTaskCurrent,
  taskIdOf,
  totalsOf,
  urgencyOf,
  type ApprovalQueueEffect,
  type CostContribution,
  type CostContributions,
  type ProjectionEffect,
  type ProjectionKey,
  type ProjectionReducer,
  type ProjectionState,
} from './reducers/index.js';

export { rowDigest, rowsDigest } from './hash.js';

export {
  STALENESS_THRESHOLDS,
  isWedged,
  measureStaleness,
  thresholdFor,
  type StalenessThreshold,
  type StalenessVerdict,
} from './staleness.js';

export {
  DEFAULT_BATCH_SIZE,
  PROJECTOR_CURSOR,
  Projector,
  type ProjectorDeps,
  type ProjectorPass,
} from './projector.js';

export {
  rebuild,
  type ProjectionComparison,
  type RebuildDeps,
  type RebuildReport,
  type RowDifference,
} from './rebuild.js';

export {
  InMemoryCursorPositions,
  InMemoryProjectionStore,
  ScratchStore,
} from './scratch-store.js';

export {
  InMemoryCursorStore,
  InMemoryEventSource,
  ReplayingEventSource,
  envelopeOf,
} from './fakes/index.js';

export {
  PERSISTED_PROJECTIONS,
  PostgresProjectionStore,
  SHELL_PROJECTIONS,
  type PostgresProjectionStoreOptions,
} from './postgres-projection-store.js';

export { PostgresCursorStore } from './postgres-cursor-store.js';

export { PostgresEventSource } from './postgres-event-source.js';

export type {
  CursorStore,
  EventSource,
  LogEvent,
  ProjectionRows,
  ProjectionStore,
} from './ports.js';
