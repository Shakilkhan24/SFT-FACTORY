/**
 * `projections` — the staleness thresholds (T-1.15).
 *
 * blueprint `15` §3.4: "**Staleness is itself a signal.** A task that has
 * not produced an event within its expected stage duration is not merely
 * stale — it is likely wedged, and the reconciler must act."
 *
 * So the thresholds are the pack's own numbers, and the verdicts
 * distinguish three cases that are easy to conflate:
 *
 * * **empty** — the projection has no rows. Nothing has gone invisible,
 *   so it is not stale.
 * * **unparseable** — the row's timestamp cannot be read. It is reported
 *   as stale, because the alternative is an invisible task.
 * * **known** — the signal is not in the table. It reports `known: false`
 *   rather than a default threshold, because a default would silently
 *   decide how long an unrecognised projection may be invisible.
 */

import { describe, expect, it } from 'vitest';

import {
  STALENESS_THRESHOLDS,
  isWedged,
  measureStaleness,
  thresholdFor,
} from '@factory/projections';

describe('projections · staleness', () => {
  it('carries the pack’s thresholds', () => {
    // blueprint 15 §3.4 / pack 02 §4.18.
    expect(thresholdFor('task_current')?.maxAgeMs).toBe(60_000);
    expect(thresholdFor('review_queue')?.maxAgeMs).toBe(60_000);
    expect(thresholdFor('cost_attribution')?.maxAgeMs).toBe(15 * 60_000);
    expect(thresholdFor('agent_performance')?.maxAgeMs).toBe(60 * 60_000);
    expect(thresholdFor('calibration_state')?.maxAgeMs).toBe(24 * 60 * 60_000);
  });

  it('says what happens on a breach', () => {
    expect(thresholdFor('task_current')?.onBreach).toBe('alert');
    expect(thresholdFor('cost_attribution')?.onBreach).toBe('warning');
  });

  it('does not give an unknown signal a default threshold', () => {
    expect(thresholdFor('nonsense')).toBeUndefined();

    const verdict = measureStaleness('nonsense', '2026-11-10T00:00:00.000Z', new Date());
    expect(verdict.known).toBe(false);
    expect(verdict.stale).toBe(false);
  });

  it('does not call an empty projection stale', () => {
    const verdict = measureStaleness('task_current', undefined, new Date('2026-11-10T01:00:00.000Z'));
    expect(verdict.stale).toBe(false);
    expect(verdict.known).toBe(true);
    expect(verdict.ageMs).toBe(0);
  });

  it('calls an unparseable timestamp stale', () => {
    const verdict = measureStaleness('task_current', 'not a date', new Date());
    expect(verdict.stale).toBe(true);
    expect(verdict.known).toBe(true);
  });

  it('measures the age of the newest row', () => {
    const now = new Date('2026-11-10T01:00:00.000Z');
    const verdict = measureStaleness('task_current', '2026-11-10T00:59:30.000Z', now);
    expect(verdict.ageMs).toBe(30_000);
    expect(verdict.stale).toBe(false);
  });

  it('is stale past the threshold', () => {
    const now = new Date('2026-11-10T01:00:00.000Z');
    const verdict = measureStaleness('task_current', '2026-11-10T00:58:00.000Z', now);
    expect(verdict.ageMs).toBe(120_000);
    expect(verdict.stale).toBe(true);
  });

  it('never reports a negative age', () => {
    // A row whose activity is in the future — a clock skew, or an event
    // stamped ahead. The age is clamped at zero rather than negative.
    const now = new Date('2026-11-10T01:00:00.000Z');
    const verdict = measureStaleness('task_current', '2026-11-10T02:00:00.000Z', now);
    expect(verdict.ageMs).toBe(0);
    expect(verdict.stale).toBe(false);
  });

  it('ships the whole table, so a later ticket adds a row', () => {
    expect(STALENESS_THRESHOLDS.length).toBeGreaterThanOrEqual(5);
    for (const threshold of STALENESS_THRESHOLDS) {
      expect(threshold.maxAgeMs).toBeGreaterThan(0);
    }
  });
});

describe('projections · wedged', () => {
  it('calls a stale running task wedged', () => {
    expect(isWedged('RUNNING', 120_000, 60_000)).toBe(true);
    expect(isWedged('RUNNING', 30_000, 60_000)).toBe(false);
  });

  it('does not call a finished task wedged', () => {
    // A task in a terminal state will never produce another event, so it
    // cannot be stuck.
    for (const state of ['MERGED', 'DEPLOYED', 'REJECTED', 'FAILED', 'ABANDONED', 'INCOMPLETE']) {
      expect(isWedged(state, 999_999_999, 60_000)).toBe(false);
    }
  });
});
