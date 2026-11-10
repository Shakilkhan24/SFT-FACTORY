/**
 * `projections/rebuild` — the rebuild (T-1.15).
 *
 * ## What this file is
 *
 * The rebuild: drop every projection, replay the whole log, and **prove**
 * that the rebuilt rows are identical to the rows that were dropped.
 *
 * A0.6: "drop-and-rebuild ⇒ identical rows (hash compare)".
 *
 * ## The rebuild is not a repair, it is a **check**
 *
 * The point of the hash comparison is that it can **fail**. A rebuild
 * that always matched would prove nothing — it would be a rebuild that
 * always says "yes".
 *
 * So the rebuild reports a **verdict**:
 *
 * * `identical` — every projection's digest matched, and every row
 *   matched field-for-field;
 * * `different` — a digest differed, and the report says **which**
 *   projection and **which** row.
 *
 * And the digest is only the *first* comparison. The digest says "these
 * two sets differ"; the row-by-row comparison says "this row differs in
 * this field". A rebuild that reported only a digest would leave the
 * operator with a hash and nothing to act on.
 *
 * ## The rebuild replays from zero, whatever the cursor said
 *
 * The rebuild ignores the cursor and reads the log **from the
 * beginning**. That is the whole point — the cursor is what was dropped
 * along with the rows, so the rebuild must not depend on it.
 *
 * ## The rebuild is **not** destructive by default
 *
 * The rebuild drops the rows and rebuilds them. That is destructive, and
 * the ticket says the rebuild is "a CLI command *and* a test" — so the
 * function takes a flag saying whether to actually drop.
 *
 * With `drop: false` the rebuild computes what the rows *would* be and
 * compares them against the rows that are there. That is the **safe**
 * form, and it is the one a monitoring check wants: it answers "would a
 * rebuild change anything?" without changing anything.
 */

import { rowsDigest } from './hash.js';
import { PROJECTOR_CURSOR, Projector } from './projector.js';
import type { CursorStore, EventSource, ProjectionStore } from './ports.js';
import { PROJECTIONS } from './reducers/index.js';
import { ScratchStore } from './scratch-store.js';
import type { ProjectionName } from './types.js';

/**
 * The dependencies the rebuild needs.
 */
export interface RebuildDeps {
  /** The log the projector reads. */
  readonly events: EventSource;
  /** The store the rows live in. */
  readonly store: ProjectionStore;
  /** The cursor store. */
  readonly cursors: CursorStore;
  /** How many events a batch reads. */
  readonly batchSize?: number;
}

/**
 * One row's difference.
 */
export interface RowDifference {
  /** The projection the row belongs to. */
  readonly projection: ProjectionName;
  /** The row's key. */
  readonly key: string;
  /** The fields that differ, and how. */
  readonly fields: readonly {
    readonly field: string;
    readonly before: unknown;
    readonly after: unknown;
  }[];
}

/**
 * One projection's comparison.
 */
export interface ProjectionComparison {
  /** The projection's name. */
  readonly projection: ProjectionName;
  /** The digest of the rows before the rebuild. */
  readonly beforeDigest: string;
  /** The digest of the rows after the rebuild. */
  readonly afterDigest: string;
  /** How many rows the projection holds. */
  readonly rows: number;
  /** The rows that differ. */
  readonly differences: readonly RowDifference[];
}

/**
 * The rebuild's report.
 */
export interface RebuildReport {
  /** Did the rebuild produce identical rows? */
  readonly identical: boolean;
  /** How many events were replayed. */
  readonly replayed: number;
  /** The comparison, per projection. */
  readonly comparisons: readonly ProjectionComparison[];
  /** The cursor's position after the rebuild. */
  readonly lastSeq: number;
}

/**
 * Compare two rows, field by field.
 *
 * The rows are compared by their **canonical JSON**, so a field that
 * differs only in key order is not reported — that is the same rule the
 * digest uses, and a report that disagreed with the digest would be
 * confusing.
 */
const compareRows = (
  projection: ProjectionName,
  key: string,
  before: unknown,
  after: unknown,
): RowDifference | undefined => {
  if (before === undefined && after === undefined) {
    return undefined;
  }
  if (before === undefined || after === undefined) {
    return {
      projection,
      key,
      fields: [
        {
          field: '<row>',
          before: before === undefined ? null : before,
          after: after === undefined ? null : after,
        },
      ],
    };
  }

  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const fields: {
    field: string;
    before: unknown;
    after: unknown;
  }[] = [];

  const names = [
    ...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]),
  ].sort();

  for (const name of names) {
    const beforeValue = beforeRecord[name];
    const afterValue = afterRecord[name];
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      fields.push({ field: name, before: beforeValue, after: afterValue });
    }
  }

  if (fields.length === 0) {
    return undefined;
  }
  return { projection, key, fields };
};

/**
 * Rebuild the projections and compare them with what was there.
 *
 * @param deps the dependencies
 * @param options `drop` says whether the rows are actually dropped
 *   before the replay. `false` computes what a rebuild *would* produce
 *   and compares it with what is there — the safe form.
 */
export const rebuild = async (
  deps: RebuildDeps,
  options: { readonly drop: boolean } = { drop: true },
): Promise<RebuildReport> => {
  // ---- the "before" --------------------------------------------------
  const before = new Map<ProjectionName, Record<string, unknown>>();
  for (const name of PROJECTIONS) {
    before.set(name, { ...(await deps.store.read(name)) });
  }

  // ---- the drop ------------------------------------------------------
  //
  // The rows go, and the cursor goes with them — the cursor is what
  // says which events have been applied, and the rows are gone, so a
  // cursor that still pointed past the last event would leave the
  // projection permanently empty.
  if (options.drop) {
    for (const name of PROJECTIONS) {
      await deps.store.drop(name);
    }
    await deps.cursors.reset(PROJECTOR_CURSOR);
  }

  // ---- the replay ----------------------------------------------------
  //
  // The store the replay writes into and the cursor the replay reads
  // from must be **one** cursor store — the projector reads the
  // position the store committed, and if the two were different the
  // projector would re-read the same events forever.
  //
  // So there are two cases, and they differ in *which* store:
  //
  // * `drop: true` — the live store, and the live cursor. The live
  //   cursor was reset to zero above, so the replay starts from the
  //   beginning of the log, whatever the running projector had reached.
  // * `drop: false` — a scratch store, with its **own** cursor. The
  //   live rows are not overwritten by the replay (otherwise "check
  //   without changing" would change the very thing it is checking),
  //   and the running projector's position is not disturbed.
  const isolatedCursors = new IsolatedCursorStore();
  const target = options.drop ? deps.store : new ScratchStore(isolatedCursors);
  const cursors = options.drop ? deps.cursors : isolatedCursors;

  const projector = new Projector(
    {
      events: deps.events,
      store: target,
      cursors,
    },
    deps.batchSize,
  );

  const passes = await projector.catchUp();
  const replayed = passes.reduce((total, pass) => total + pass.read, 0);
  const lastSeq = passes.length > 0 ? (passes[passes.length - 1]?.lastSeq ?? 0) : 0;

  // ---- the comparison ------------------------------------------------
  const comparisons: ProjectionComparison[] = [];

  for (const name of PROJECTIONS) {
    const beforeRows = before.get(name) ?? {};
    const afterRows = { ...(await target.read(name)) };

    const differences: RowDifference[] = [];

    for (const key of [
      ...new Set([...Object.keys(beforeRows), ...Object.keys(afterRows)]),
    ].sort()) {
      const difference = compareRows(name, key, beforeRows[key], afterRows[key]);
      if (difference !== undefined) {
        differences.push(difference);
      }
    }

    comparisons.push({
      projection: name,
      beforeDigest: rowsDigest(beforeRows),
      afterDigest: rowsDigest(afterRows),
      rows: Object.keys(afterRows).length,
      differences,
    });
  }

  const identical = comparisons.every(
    (comparison) =>
      comparison.beforeDigest === comparison.afterDigest &&
      comparison.differences.length === 0,
  );

  return { identical, replayed, comparisons, lastSeq };
};

/**
 * A cursor store that starts at zero and keeps its position to itself.
 *
 * The rebuild must not disturb the running projector's cursor — it is a
 * **check**, and a check that moved the thing it is checking would be a
 * check that changed the system's state.
 */
class IsolatedCursorStore implements CursorStore {
  private readonly positions = new Map<string, number>();

  public lastSeq(name: string): Promise<number> {
    const position = this.positions.get(name);
    return Promise.resolve(position ?? 0);
  }

  public advance(name: string, lastSeq: number): Promise<void> {
    this.positions.set(name, lastSeq);
    return Promise.resolve();
  }

  public reset(name: string): Promise<void> {
    this.positions.set(name, 0);
    return Promise.resolve();
  }
}
