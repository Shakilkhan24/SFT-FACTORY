/**
 * `projections/staleness` — the staleness thresholds (T-1.15).
 *
 * ## Where the thresholds come from
 *
 * blueprint `15` §3.4 gives the table, and pack `02` §4.18 restates it:
 *
 * | Signal | Maximum staleness | On breach |
 * |---|---|---|
 * | `task_current` | 60 seconds | Alert; the task's last activity is shown as unknown |
 * | `review_queue` | 60 seconds | Alert |
 * | `cost_attribution` | 15 minutes | Warning; billing reconciliation is deferred |
 * | `agent_performance` | 1 hour | Warning |
 * | `calibration_state` | 24 hours | Warning; an expired calibration removes the verifier from the gate set |
 *
 * So the thresholds are **the pack's**, not a design choice, and they are
 * constants here rather than configuration (HR-10 forbids hard-coding
 * *names*, not the pack's own numbers).
 *
 * T-1.15 owns the projections `task_current` and `cost_attribution`, and
 * it ships the **whole table** — because the table is one thing, and a
 * later ticket adding a row must not have to invent the format.
 *
 * ## What "stale" means
 *
 * NFR-03: "no task invisible for longer than the declared staleness
 * threshold". So the staleness of a projection is the age of its
 * **newest row** — the time since the projector last wrote anything.
 *
 * And blueprint `15` §3.4's last line is the load-bearing one:
 * "**Staleness is itself a signal.** A task that has not produced an
 * event within its expected stage duration is not merely stale — it is
 * likely wedged, and the reconciler must act."
 *
 * So the verdict distinguishes two things: the projection is **stale**
 * (its rows are old) and the projection is **wedged** (it has rows that
 * are individually old — a task that has not produced an event within
 * its expected duration).
 *
 * A task that has produced *no* events cannot be wedged — there is
 * nothing to be stuck.
 */

/**
 * One projection's staleness threshold.
 */
export interface StalenessThreshold {
  /** The projection's name. */
  readonly signal: string;
  /** The maximum staleness, in milliseconds. */
  readonly maxAgeMs: number;
  /** What happens when the threshold is breached. */
  readonly onBreach: 'alert' | 'warning';
}

/**
 * The threshold table.
 *
 * The whole table ships here, so the format is fixed for the projections
 * that arrive later.
 */
export const STALENESS_THRESHOLDS: readonly StalenessThreshold[] = [
  { signal: 'task_current', maxAgeMs: 60_000, onBreach: 'alert' },
  { signal: 'review_queue', maxAgeMs: 60_000, onBreach: 'alert' },
  { signal: 'cost_attribution', maxAgeMs: 15 * 60_000, onBreach: 'warning' },
  { signal: 'agent_performance', maxAgeMs: 60 * 60_000, onBreach: 'warning' },
  { signal: 'calibration_state', maxAgeMs: 24 * 60 * 60_000, onBreach: 'warning' },
];

/**
 * The threshold for a signal.
 *
 * `undefined` when the table does not name the signal — and an unknown
 * signal is **not** given a default threshold, because a default would
 * silently decide how long an unrecognised projection may be invisible.
 */
export const thresholdFor = (signal: string): StalenessThreshold | undefined =>
  STALENESS_THRESHOLDS.find((threshold) => threshold.signal === signal);

/**
 * The verdict on a projection's freshness.
 */
export interface StalenessVerdict {
  /** The projection's name. */
  readonly signal: string;
  /** How stale the projection is, in milliseconds. `0` when it is empty. */
  readonly ageMs: number;
  /** The threshold it was measured against. */
  readonly maxAgeMs: number;
  /** Is the projection past its threshold? */
  readonly stale: boolean;
  /** What happens on a breach. */
  readonly onBreach: 'alert' | 'warning';
  /** Is the signal known to the table at all? */
  readonly known: boolean;
}

/**
 * Measure a projection's staleness.
 *
 * @param signal the projection's name
 * @param lastActivityAt the newest row's timestamp, or `undefined` when
 *   the projection holds no rows
 * @param now the current time
 */
export const measureStaleness = (
  signal: string,
  lastActivityAt: string | undefined,
  now: Date,
): StalenessVerdict => {
  const threshold = thresholdFor(signal);

  if (threshold === undefined) {
    // An unrecognised signal has no threshold, so it cannot be said to
    // be stale — but it is also **not known**, and a caller that only
    // reads `stale` would treat "no threshold" as "fresh". The `known`
    // flag is what makes the difference visible.
    return {
      signal,
      ageMs: 0,
      maxAgeMs: 0,
      stale: false,
      onBreach: 'warning',
      known: false,
    };
  }

  if (lastActivityAt === undefined) {
    // An **empty** projection is not stale. There is no row that has
    // gone invisible — there are no rows at all. A projection that has
    // never had a row is "nothing to report", not "everything is late".
    return {
      signal,
      ageMs: 0,
      maxAgeMs: threshold.maxAgeMs,
      stale: false,
      onBreach: threshold.onBreach,
      known: true,
    };
  }

  const activity = Date.parse(lastActivityAt);
  if (!Number.isFinite(activity)) {
    // An unparseable timestamp cannot be measured, and it must not be
    // reported as fresh — that would hide the fault. It is reported as
    // stale, because the alternative is an invisible task.
    return {
      signal,
      ageMs: Number.POSITIVE_INFINITY,
      maxAgeMs: threshold.maxAgeMs,
      stale: true,
      onBreach: threshold.onBreach,
      known: true,
    };
  }

  const ageMs = Math.max(0, now.getTime() - activity);

  return {
    signal,
    ageMs,
    maxAgeMs: threshold.maxAgeMs,
    stale: ageMs > threshold.maxAgeMs,
    onBreach: threshold.onBreach,
    known: true,
  };
};

/**
 * Is a task's row wedged?
 *
 * blueprint `15` §3.4: "A task that has not produced an event within its
 * expected stage duration is not merely stale — it is likely wedged, and
 * the reconciler must act."
 *
 * A task in a **terminal** state is not wedged — it is done, and it will
 * never produce another event. So the check is only meaningful for a
 * task that is still running.
 */
export const isWedged = (state: string, ageMs: number, thresholdMs: number): boolean => {
  const TERMINAL_STATES: readonly string[] = [
    'MERGED',
    'DEPLOYED',
    'REJECTED',
    'FAILED',
    'ABANDONED',
    'INCOMPLETE',
  ];
  if (TERMINAL_STATES.includes(state)) {
    return false;
  }
  return ageMs > thresholdMs;
};
