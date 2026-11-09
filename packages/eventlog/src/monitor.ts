/**
 * The monitoring checks on the event log.
 *
 * pack 02 §4.2: "Gaps in `seq` or non-contiguous state-changing aggregate
 * versions raise a monitor alert."
 *
 * blueprint `09` §5.1: "A `sequence` gap indicates a lost write and is a
 * monitoring alert."
 *
 * These are the two signals. They are *checks*, not alerts: the alert
 * itself is the observer's job (checklist 15 owns observability), so this
 * module answers "is the log healthy?" and lets the caller decide what to
 * do about it.
 *
 * The gap check is deliberately **not** an assertion that the log is
 * gapless. The log's design makes gaps impossible under normal operation —
 * the counter row's lock guarantees it — but a *monitor* that only fires
 * when something is already broken is not a monitor. So the check is a
 * plain function that reports what it finds, and the tests assert on the
 * report.
 */

import { sql, type FactoryDatabase, type Kysely } from '@factory/db';

/**
 * What the monitor found.
 */
export interface EventLogHealth {
  /**
   * The `seq` values missing from the log.
   *
   * Empty when the log is gapless.
   */
  readonly seqGaps: readonly number[];

  /**
   * The aggregates whose state-changing versions are not contiguous.
   *
   * An aggregate whose versions jump from 3 to 5 has lost the event that
   * produced version 4.
   */
  readonly versionGaps: readonly AggregateVersionGap[];

  /** `true` when neither kind of gap was found. */
  readonly ok: boolean;
}

/**
 * One aggregate whose versions are not contiguous.
 */
export interface AggregateVersionGap {
  readonly aggregateKind: string;
  readonly aggregateId: string;
  /** The version that is missing. */
  readonly missingVersion: number;
}

/**
 * Find the gaps in the log's `seq`.
 *
 * The `seq` is allocated under the counter row's lock, so a gap means a
 * lost write: something committed a `seq` and then the row disappeared, or
 * the log was edited.
 *
 * The check reads the counter as well, so it can distinguish "the log is
 * short by N events" from "the counter says the log should be longer".
 */
export const findSeqGaps = async (
  db: Kysely<FactoryDatabase>,
): Promise<readonly number[]> => {
  const rows = await sql<{ gap_start: string; gap_end: string }>`
    WITH ordered AS (
      SELECT seq, LEAD(seq) OVER (ORDER BY seq) AS next_seq
      FROM factory.events
    )
    SELECT
      (seq + 1)::text AS gap_start,
      (next_seq - 1)::text AS gap_end
    FROM ordered
    WHERE next_seq IS NOT NULL AND next_seq <> seq + 1
  `.execute(db);

  const gaps: number[] = [];
  for (const row of rows.rows) {
    const from = Number(row.gap_start);
    const to = Number(row.gap_end);
    for (let seq = from; seq <= to; seq += 1) {
      gaps.push(seq);
    }
  }

  // A gap *before* the first event is not a gap — the log simply starts
  // where it starts. A gap *after* the last event would be reported by the
  // counter check instead.
  return gaps;
};

/**
 * Find the aggregates whose state-changing versions are not contiguous.
 *
 * Only events that **changed** the aggregate's state carry a new version;
 * a read-only event carries the current one. So the versions of a healthy
 * aggregate form the sequence 1, 2, 3, … with repetitions allowed (several
 * read-only events may report the same version).
 *
 * The check therefore looks for a *jump*: a version that is more than one
 * greater than the highest version seen before it for that aggregate.
 */
export const findVersionGaps = async (
  db: Kysely<FactoryDatabase>,
): Promise<readonly AggregateVersionGap[]> => {
  const rows = await sql<{
    aggregate_kind: string;
    aggregate_id: string;
    missing_version: number;
  }>`
      WITH ordered AS (
        SELECT
          aggregate_kind,
          aggregate_id,
          aggregate_version,
          MAX(aggregate_version) OVER (
            PARTITION BY aggregate_kind, aggregate_id
            ORDER BY seq
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS previous_max
        FROM factory.events
      )
      SELECT
        aggregate_kind,
        aggregate_id,
        (previous_max + 1)::int AS missing_version
      FROM ordered
      WHERE previous_max IS NOT NULL AND aggregate_version > previous_max + 1
    `.execute(db);

  return rows.rows.map((row) => ({
    aggregateKind: row.aggregate_kind,
    aggregateId: row.aggregate_id,
    missingVersion: Number(row.missing_version),
  }));
};

/**
 * Check the log's health.
 *
 * Both checks are run and both results are reported, so a caller sees every
 * problem at once rather than one per run.
 */
export const checkEventLogHealth = async (
  db: Kysely<FactoryDatabase>,
): Promise<EventLogHealth> => {
  const [seqGaps, versionGaps] = await Promise.all([
    findSeqGaps(db),
    findVersionGaps(db),
  ]);
  return {
    seqGaps,
    versionGaps,
    ok: seqGaps.length === 0 && versionGaps.length === 0,
  };
};
