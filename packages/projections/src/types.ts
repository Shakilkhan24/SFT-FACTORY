/**
 * `projections/types` — the rows the projections maintain (T-1.15).
 *
 * ## The columns are normative, and they come from the pack
 *
 * pack `03` §2's "Further tables" table is the authority, and it says
 * "columns normative, DDL written in the owning ticket". So the column
 * list here is a **transcription**, not a design:
 *
 * | Table | Columns | Ticket |
 * |---|---|---|
 * | `task_current` (projection) | `task_id pk, repo, workflow, state, risk_tier, needs_human bool, last_activity_at, spent_usd_micros, budget_usd_micros, summary jsonb` | **T-1.15** |
 * | `approval_queue` | `approval_id pk, task_id, type, requested_at, expires_at, urgency` | T-2.09 |
 * | `cost_attribution` | `day, workflow, role, model, tokens_in, tokens_out, usd_micros, accepted_change_count` | T-4.05 |
 *
 * T-1.15 owns `task_current`'s DDL. The other two are **shells** here —
 * the ticket names them ("shells for `approval_queue` and
 * `cost_attribution`"), so the projector knows how to compute them and
 * keeps a cursor for each, but their tables belong to later tickets.
 *
 * ## Why the row types live here and not in `contracts`
 *
 * HR-12: `packages/contracts` is frozen inside another ticket. A
 * projection's row shape is not a *contract* — it is a disposable view's
 * shape, and the pack already fixes it. So the types live in the package
 * that owns them, and the only thing crossing a boundary is the row
 * itself.
 *
 * ## The money is integer micro-USD
 *
 * AGENTS.md §4: "money as integer micro-USD". So `spent_usd_micros` and
 * `usd_micros` are `number`s holding integer micro-dollars — never
 * floats of dollars.
 */

import type { TaskState, Tier } from '@factory/contracts';

/**
 * The risk tier of a task.
 *
 * The contracts call it `Tier` ("R0 trivial · R1 low · R2 moderate · R3
 * high · R4 critical"). The column is `risk_tier`.
 */
export type RiskTier = Tier;

/**
 * The state of a task, as the projection sees it.
 *
 * The contracts own the vocabulary (`TaskState`), so this is not a
 * re-declaration — it is the projection's *view* of it, and the two must
 * not drift.
 */
export type { TaskState };

/**
 * One row of `task_current`.
 *
 * blueprint `15` §3.3: "State, stage, age, last activity, cost so far".
 *
 * `state` is the task's state; `summary` is the free-form `jsonb` that
 * carries the rest of the view (the current stage, the blast-radius tier,
 * the risk score) without the projection having to invent columns for
 * every measure the corpus grows.
 */
export interface TaskCurrentRow {
  /** The task's id — the primary key. */
  readonly taskId: string;
  /** The repository the task is in. */
  readonly repo: string;
  /** The workflow the task runs. */
  readonly workflow: string;
  /** The task's state. */
  readonly state: TaskState;
  /** The task's risk tier, when it has one. */
  readonly riskTier: RiskTier | null;
  /** Does the task need a human? */
  readonly needsHuman: boolean;
  /** When the task last did something. */
  readonly lastActivityAt: string;
  /** How much the task has spent, in integer micro-USD. */
  readonly spentUsdMicros: number;
  /** The task's budget, in integer micro-USD. */
  readonly budgetUsdMicros: number;
  /** The free-form summary. */
  readonly summary: Readonly<Record<string, unknown>>;
}

/**
 * One row of `approval_queue` — the **shell** (T-2.09 owns the table).
 */
export interface ApprovalQueueRow {
  /** The approval's id — the primary key. */
  readonly approvalId: string;
  /** The task the approval belongs to. */
  readonly taskId: string;
  /** The approval's type. */
  readonly type: string;
  /** When the approval was requested. */
  readonly requestedAt: string;
  /** When the approval expires. */
  readonly expiresAt: string;
  /** The urgency — how soon it must be answered. */
  readonly urgency: string;
}

/**
 * One row of `cost_attribution` — the **shell** (T-4.05 owns the table).
 *
 * The key is the four-part `(day, workflow, role, model)` tuple; the
 * measures are the sums over it.
 */
export interface CostAttributionRow {
  /** The day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The workflow. */
  readonly workflow: string;
  /** The role that incurred the cost. */
  readonly role: string;
  /** The model that incurred the cost. */
  readonly model: string;
  /** The input tokens. */
  readonly tokensIn: number;
  /** The output tokens. */
  readonly tokensOut: number;
  /** The cost, in integer micro-USD. */
  readonly usdMicros: number;
  /** How many accepted changes the cost is attributed to. */
  readonly acceptedChangeCount: number;
}

/**
 * The key of a `cost_attribution` row.
 *
 * The four parts are the key, so they are compared as a tuple rather than
 * field by field at every call site.
 */
export const costAttributionKey = (
  row: CostAttributionRow,
): string =>
  [row.day, row.workflow, row.role, row.model].join(' ');

/**
 * The name of a projection.
 *
 * The name is the **cursor's** name — the same string identifies the
 * projection's rows and its position in the log. So a projection's name
 * appears in `projection_cursors.name`.
 */
export type ProjectionName =
  | 'task_current'
  | 'approval_queue'
  | 'cost_attribution';

/**
 * Every projection this package knows.
 */
export const PROJECTION_NAMES: readonly ProjectionName[] = [
  'task_current',
  'approval_queue',
  'cost_attribution',
];
