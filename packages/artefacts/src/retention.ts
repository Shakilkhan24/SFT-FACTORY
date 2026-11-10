/**
 * `artefacts` — **retention and purge**.
 *
 * blueprint 15 §2.5 gives the six classes and their periods. The DDL
 * stores the class and the expiry date: `runs.retention_class text NOT NULL
 * DEFAULT 'engineering'`, `runs.retain_until date` (migrations/0001_core.sql:118).
 *
 * ## The periods
 *
 * | Class | Retention |
 * |---|---|
 * | `engineering` | 12 months |
 * | `security-relevant` | 24 months |
 * | `incident` | 24 months |
 * | `evaluation` | until the set is retired |
 * | `sensitive` | per the data classification policy |
 * | `debug` | 30 days |
 *
 * Two of the six have **no period the table can express**:
 *
 * * `evaluation` — "until the set is retired" is an event, not a duration.
 *   The expiry is supplied by the caller.
 * * `sensitive` — "per the data classification policy". That policy is not
 *   in the corpus, so the period is the **operator's** to set. The class is
 *   supported; the default period is a conservative 30 days, and a caller
 *   may supply the policy's period.
 *
 * ## `retain_until` is a **date**
 *
 * The DDL column is `date`, not `timestamptz`. So the expiry stored on the
 * row is the **date** on which the record expires — the last day it is
 * retained, in UTC. The record's own `retention.expiresAt` (blueprint
 * 15 §2.3) is an ISO **instant**; the row's `retain_until` is the date that
 * instant falls on. Both are computed from the same moment, so they cannot
 * disagree.
 *
 * ## The purge job **never touches `events`**
 *
 * checklist 03: "implement `retain_until` and a purge job that **never
 * touches `events`**."
 *
 * The event log is the factory's **source of truth** (blueprint 15 §3.1:
 * "The event log is the source of truth. The projections are disposable.").
 * Purging a run's *artefact* must not delete the events that reference that
 * run — the events are what a later audit reads, and a record whose events
 * have vanished is a record that looks like it never happened.
 *
 * So the purge job deletes **objects** and marks **rows**, and it is
 * *provable* that it touched no event. That proof is a test that counts
 * events before and after.
 */

import { RETENTION_CLASSES, type RetentionClass } from './types.js';

export { RETENTION_CLASSES };
export type { RetentionClass };

/**
 * A retention period.
 *
 * A period in **months** or **days** — the two units blueprint 15 §2.5
 * uses. Months because a year is not 365 days; days because 30 days is
 * not a month either. The two are not interchangeable, so the unit is
 * named.
 */
export interface RetentionPeriod {
  /** The number of months. */
  readonly months?: number;
  /** The number of days. */
  readonly days?: number;
}

/**
 * The default period for each class.
 *
 * `evaluation` and `sensitive` have **no default period** — their expiry
 * is supplied by the caller, because their period is not a duration the
 * corpus states. `sensitive` gets a 30-day default because "per the data
 * classification policy" with no policy present should err towards
 * deleting rather than towards keeping: a record that was kept when it
 * should have gone is a privacy failure, and a record that went early is a
 * cost.
 */
export const DEFAULT_PERIODS: Readonly<Record<RetentionClass, RetentionPeriod | undefined>> = {
  engineering: { months: 12 },
  'security-relevant': { months: 24 },
  incident: { months: 24 },
  evaluation: undefined,
  sensitive: { days: 30 },
  debug: { days: 30 },
};

/**
 * The class the DDL defaults to.
 *
 * `runs.retention_class text NOT NULL DEFAULT 'engineering'`.
 */
export const DEFAULT_RETENTION_CLASS: RetentionClass = 'engineering';

/**
 * Whether a string is one of the six classes.
 */
export const isRetentionClass = (value: string): value is RetentionClass =>
  (RETENTION_CLASSES as readonly string[]).includes(value);

/**
 * Add a period to an instant.
 *
 * The month arithmetic is done on the **UTC** calendar, so a record
 * created on the 31st of a 31-day month still expires on the same day of
 * month twelve months later rather than being clamped into the previous
 * month's length.
 */
export const addPeriod = (from: Date, period: RetentionPeriod): Date => {
  const out = new Date(from.getTime());

  if (period.days !== undefined) {
    out.setUTCDate(out.getUTCDate() + period.days);
  }

  if (period.months !== undefined) {
    const day = out.getUTCDate();
    out.setUTCDate(1);
    out.setUTCMonth(out.getUTCMonth() + period.months);
    // Clamp the day to the target month's length.
    const lastDay = new Date(
      Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
    ).getUTCDate();
    out.setUTCDate(Math.min(day, lastDay));
  }

  return out;
};

/**
 * When a record of a class expires.
 *
 * @param retentionClass the record's class.
 * @param from the instant the run completed.
 * @param period the period to apply. Defaults to the class's own.
 *
 * @returns the expiry instant, or `undefined` for a class with no default
 * period and no period supplied.
 */
export const expiryFor = (
  retentionClass: RetentionClass,
  from: Date,
  period?: RetentionPeriod,
): Date | undefined => {
  const effective = period ?? DEFAULT_PERIODS[retentionClass];
  if (effective === undefined) {
    return undefined;
  }
  return addPeriod(from, effective);
};

/**
 * The `retain_until` **date** for a record.
 *
 * The DDL column is `date`, so the instant is reduced to its UTC calendar
 * day. The value is the last day the record is retained.
 *
 * @param expiresAt the record's expiry instant.
 */
export const retainUntilDate = (expiresAt: Date): string => expiresAt.toISOString().slice(0, 10);

/**
 * A record that is due for purging.
 */
export interface PurgeCandidate {
  /** The run whose record is to be purged. */
  readonly runId: string;
  /** Where the record's object lives. */
  readonly recordUri: string;
  /** The class the record fell under. */
  readonly retentionClass: RetentionClass;
  /** The date the record was retained until. */
  readonly retainUntil: string;
}

/**
 * A row the purge job may act on.
 *
 * The shape the store reads from the `runs` table.
 */
export interface PurgeRow {
  readonly runId: string;
  readonly recordUri: string | null;
  readonly retentionClass: string;
  readonly retainUntil: string | null;
}

/**
 * Select the rows that are due for purging.
 *
 * A row is due when its `retain_until` is **on or before** `asOf` — the
 * last day of retention is included, so a record is kept for its whole
 * period and purged after it.
 *
 * Rows with **no** `retain_until` are **not** selected. A record whose
 * expiry was never computed is not one the purge may guess about: the
 * `evaluation` and `sensitive` classes need a caller-supplied expiry, and
 * a missing one means the record's period was never decided.
 *
 * Rows whose class is **not** one of the six are not selected either. The
 * DDL does not constrain the column, so a typo'd class is possible, and
 * purging on a class nobody defined would delete records under a rule
 * that does not exist.
 *
 * @param rows the rows to consider.
 * @param asOf the day to purge up to.
 */
export const selectPurgeCandidates = (
  rows: readonly PurgeRow[],
  asOf: string,
): readonly PurgeCandidate[] =>
  rows
    .filter((row) => {
      if (row.retainUntil === null) {
        return false;
      }
      if (!isRetentionClass(row.retentionClass)) {
        return false;
      }
      if (row.recordUri === null) {
        return false;
      }
      // ISO dates compare lexicographically, so `<=` is the date comparison.
      return row.retainUntil <= asOf;
    })
    .map((row) => ({
      runId: row.runId,
      recordUri: row.recordUri as string,
      retentionClass: row.retentionClass as RetentionClass,
      retainUntil: row.retainUntil as string,
    }));
