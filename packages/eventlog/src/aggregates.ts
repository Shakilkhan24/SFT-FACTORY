/**
 * The aggregate registry — which table backs which `aggregate_kind`, and how
 * its row is addressed.
 *
 * pack 03 §2 (`events` table) declares
 * `aggregate_kind text NOT NULL CHECK (aggregate_kind IN ('task','node','approval','definition','run','change','system'))`,
 * and `aggregate_id text NOT NULL`.
 *
 * The corpus does **not** say how `aggregate_id` is formed for an aggregate
 * whose table has a composite key. `nodes` has `PRIMARY KEY (task_id,
 * node_id)` — a node id is only unique *within a task* ("Node ids are slugs
 * unique within a task", pack 03 §1). So a node's aggregate id must carry
 * the task as well.
 *
 * The encoding chosen here is `<task_id>/<node_id>` — the same shape the
 * corpus already uses for task-scoped references elsewhere in the factory.
 * It is unambiguous: a task id never contains `/`, because it is a prefixed
 * ULID (`tsk_01JCZ8…`), and a node id never contains `/` either, because it
 * is a slug ("n1-implement").
 *
 * Only `task` and `node` rows carry a `version` column, so only those two
 * kinds can be CAS-bumped. For the others the log *records* the aggregate's
 * version but does not bump it — the `version` on such an event is the
 * version the caller asserted, and it is the caller's business (T-1.04's
 * state machines) to keep it honest.
 */

import type { AggregateKind } from '@factory/contracts';

/**
 * How one aggregate kind is stored.
 */
export interface AggregateBinding {
  /** The `aggregate_kind` value in the log. */
  readonly kind: AggregateKind;

  /** The table that holds the aggregate's row. */
  readonly table: string;

  /**
   * The column (or columns) that identify the row.
   *
   * A single-element array means the row is addressed by one column; a
   * two-element array means the row is addressed by a composite key.
   */
  readonly keyColumns: readonly string[];

  /**
   * Whether the table has a `version` column that the log may CAS-bump.
   *
   * `true` for `task` and `node` — the two stateful aggregates whose
   * versions implement "exactly-once state transition" (blueprint `09` §6).
   */
  readonly versioned: boolean;

  /**
   * How to turn the log's `aggregate_id` back into the key column values.
   *
   * Only needed for composite-key aggregates; `undefined` means the
   * `aggregate_id` *is* the key value.
   */
  readonly decodeId?: (aggregateId: string) => readonly string[];
}

/**
 * The separator between the parts of a composite aggregate id.
 */
export const AGGREGATE_ID_SEPARATOR = '/';

/**
 * Build the aggregate id of a node.
 *
 * `nodeAggregateId('tsk_1', 'n1-implement')` → `'tsk_1/n1-implement'`.
 */
export const nodeAggregateId = (taskId: string, nodeId: string): string =>
  `${taskId}${AGGREGATE_ID_SEPARATOR}${nodeId}`;

/**
 * Split a node's aggregate id back into its task id and node id.
 *
 * @throws {Error} when the id is not in the `task/node` form.
 */
export const decodeNodeAggregateId = (
  aggregateId: string,
): readonly [string, string] => {
  const index = aggregateId.indexOf(AGGREGATE_ID_SEPARATOR);
  if (index <= 0 || index === aggregateId.length - 1) {
    throw new Error(
      `node aggregate id must be "<task_id>/<node_id>", got ${JSON.stringify(aggregateId)}`,
    );
  }
  return [aggregateId.slice(0, index), aggregateId.slice(index + 1)];
};

/**
 * The bindings for every `aggregate_kind`.
 *
 * `system` has no table: a system aggregate is the log itself — a
 * system-wide event ("budget.exhausted") that belongs to no task. There is
 * no row to CAS, so `versioned` is `false` and `table` is `''` (the log
 * never issues an UPDATE for it).
 */
export const AGGREGATE_BINDINGS: Readonly<Record<AggregateKind, AggregateBinding>> = {
  task: {
    kind: 'task',
    table: 'tasks',
    keyColumns: ['id'],
    versioned: true,
  },
  node: {
    kind: 'node',
    table: 'nodes',
    keyColumns: ['task_id', 'node_id'],
    versioned: true,
    decodeId: decodeNodeAggregateId,
  },
  approval: {
    kind: 'approval',
    table: 'approvals',
    keyColumns: ['id'],
    versioned: false,
  },
  definition: {
    kind: 'definition',
    table: 'definition_versions',
    keyColumns: ['sha'],
    versioned: false,
  },
  run: {
    kind: 'run',
    table: 'runs',
    keyColumns: ['run_id'],
    versioned: false,
  },
  change: {
    kind: 'change',
    table: 'changes',
    keyColumns: ['id'],
    versioned: false,
  },
  system: {
    kind: 'system',
    table: '',
    keyColumns: [],
    versioned: false,
  },
};

/**
 * The binding for an aggregate kind.
 *
 * @throws {Error} when the kind is not one of the seven.
 */
export const bindingFor = (kind: string): AggregateBinding => {
  const binding = AGGREGATE_BINDINGS[kind as AggregateKind];
  if (binding === undefined) {
    throw new Error(
      `unknown aggregate kind ${JSON.stringify(kind)}; expected one of ${Object.keys(
        AGGREGATE_BINDINGS,
      ).join(', ')}`,
    );
  }
  return binding;
};
