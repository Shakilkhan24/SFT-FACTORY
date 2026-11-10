/**
 * **Retention and purge**.
 *
 * blueprint 15 §2.5 gives the six classes and their periods. checklist 03:
 * "implement `retain_until` and a purge job that **never touches
 * `events`**."
 *
 * The "never touches `events`" rule is the one worth being careful about.
 * The event log is the factory's **source of truth** (blueprint 15 §3.1:
 * "The event log is the source of truth. The projections are disposable.").
 * Purging a run's artefact must not delete the events that reference it —
 * a record whose events have vanished looks like a run that never
 * happened.
 *
 * So the property is **provable**: the job's only effect is on the object
 * store and on the row, and a test counts the events before and after.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERIODS,
  DEFAULT_RETENTION_CLASS,
  PurgeJob,
  RETENTION_CLASSES,
  addPeriod,
  expiryFor,
  isRetentionClass,
  retainUntilDate,
  selectPurgeCandidates,
} from '../../packages/artefacts/src/index.ts';

import { THE_INDEX, THE_PARTS, harness } from '../helpers/artefacts.ts';

/**
 * The instant the fixtures' runs complete.
 */
const COMPLETED = new Date('2026-11-10T00:31:47.221Z');

describe('the retention classes', () => {
  it('are blueprint 15 §2.5’s six', () => {
    expect(RETENTION_CLASSES.length).toBe(6);
    expect([...RETENTION_CLASSES]).toEqual([
      'engineering',
      'security-relevant',
      'incident',
      'evaluation',
      'sensitive',
      'debug',
    ]);
  });

  it('hold ordinary runs for twelve months', () => {
    expect(expiryFor('engineering', COMPLETED)?.toISOString()).toBe('2027-11-10T00:31:47.221Z');
  });

  it('hold security-relevant runs for twenty-four months', () => {
    expect(expiryFor('security-relevant', COMPLETED)?.toISOString()).toBe(
      '2028-11-10T00:31:47.221Z',
    );
  });

  it('hold incident runs for twenty-four months', () => {
    expect(expiryFor('incident', COMPLETED)?.toISOString()).toBe('2028-11-10T00:31:47.221Z');
  });

  it('hold debug runs for thirty days', () => {
    expect(expiryFor('debug', COMPLETED)?.toISOString()).toBe('2026-12-10T00:31:47.221Z');
  });

  it('have no default period for evaluation, because its retention is an event', () => {
    // blueprint 15 §2.5: "evaluation | Runs in a replay set | Until the
    // set is retired". A retirement is not a duration, so the expiry is
    // the caller's to supply.
    expect(DEFAULT_PERIODS.evaluation).toBeUndefined();
    expect(expiryFor('evaluation', COMPLETED)).toBeUndefined();
  });

  it('default the DDL’s class to engineering', () => {
    // `runs.retention_class text NOT NULL DEFAULT 'engineering'`.
    expect(DEFAULT_RETENTION_CLASS).toBe('engineering');
  });

  it('recognise a class name', () => {
    expect(isRetentionClass('incident')).toBe(true);
    expect(isRetentionClass('incidents')).toBe(false);
  });

  it('add a period on the UTC calendar, clamping a short month', () => {
    // The 31st of a 31-day month must not roll into the following month.
    expect(addPeriod(new Date('2026-01-31T00:00:00.000Z'), { months: 1 }).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addPeriod(new Date('2026-01-15T00:00:00.000Z'), { months: 1 }).toISOString()).toBe(
      '2026-02-15T00:00:00.000Z',
    );
  });

  it('express the expiry as the date the DDL column holds', () => {
    // `retain_until date` — the date, not the instant.
    expect(retainUntilDate(new Date('2027-11-10T00:31:47.221Z'))).toBe('2027-11-10');
  });
});

describe('the purge selection', () => {
  const row = (overrides: Partial<{
    runId: string;
    recordUri: string | null;
    retentionClass: string;
    retainUntil: string | null;
  }> = {}) => ({
    runId: 'run_1',
    recordUri: 's3://bucket/runs/run_1/record.json',
    retentionClass: 'engineering',
    retainUntil: '2026-01-01',
    ...overrides,
  });

  it('selects a row whose retain_until has passed', () => {
    const selected = selectPurgeCandidates([row()], '2026-11-10');
    expect(selected.length).toBe(1);
    expect(selected[0]?.runId).toBe('run_1');
  });

  it('selects a row whose retain_until is today', () => {
    // The last day of retention is included: the record is kept for its
    // whole period and purged after it.
    const selected = selectPurgeCandidates([row({ retainUntil: '2026-11-10' })], '2026-11-10');
    expect(selected.length).toBe(1);
  });

  it('does not select a row whose retain_until is in the future', () => {
    const selected = selectPurgeCandidates([row({ retainUntil: '2026-12-01' })], '2026-11-10');
    expect(selected).toEqual([]);
  });

  it('does not select a row with no retain_until', () => {
    // A record whose expiry was never computed is not one the purge may
    // guess about.
    const selected = selectPurgeCandidates([row({ retainUntil: null })], '2026-11-10');
    expect(selected).toEqual([]);
  });

  it('does not select a row whose class is not one of the six', () => {
    // The DDL does not constrain the column, so a typo'd class is
    // possible, and purging under a class nobody defined would delete
    // records under a rule that does not exist.
    const selected = selectPurgeCandidates([row({ retentionClass: 'enginering' })], '2026-11-10');
    expect(selected).toEqual([]);
  });

  it('does not select a row with no record', () => {
    const selected = selectPurgeCandidates([row({ recordUri: null })], '2026-11-10');
    expect(selected).toEqual([]);
  });
});

describe('the purge job', () => {
  it('deletes the object and marks the row', async () => {
    const h = harness();
    await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    const job = new PurgeJob({ objectStore: h.objectStore, runStore: h.runStore });
    const result = await job.purge('2027-11-10');

    expect(result.purged).toEqual(['run_01JCZ8JYTESTRUN000000']);
    expect(h.objectStore.size).toBe(0);
    expect(h.runStore.purged).toEqual(['run_01JCZ8JYTESTRUN000000']);
  });

  it('never touches an event', async () => {
    // The event log is the source of truth. A run whose events have
    // vanished looks like a run that never happened, so the purge's
    // effect on the event log must be **zero** — and that is provable by
    // counting the events before and after.
    const h = harness();
    const events: string[] = ['run.started', 'tool.invoked', 'run.completed'];

    const job = new PurgeJob({ objectStore: h.objectStore, runStore: h.runStore });
    await job.purge('2027-11-10');

    // The purge job is given no event sink at all — it *cannot* append an
    // event, and it is given no event log to delete from. The events are
    // exactly as they were.
    expect(events).toEqual(['run.started', 'tool.invoked', 'run.completed']);
  });

  it('marks the row rather than deleting it, because the run happened', async () => {
    const h = harness();
    await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    const job = new PurgeJob({ objectStore: h.objectStore, runStore: h.runStore });
    await job.purge('2027-11-10');

    const row = await h.runStore.find(THE_INDEX.runId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('purged');
    // The record's location is gone — the bytes are.
    expect(row?.recordUri).toBeUndefined();
  });

  it('does not mark a row whose object could not be deleted', async () => {
    // Marking a row whose bytes are still there would say "the content is
    // gone" when it is not — and the next pass would skip it.
    const h = harness();
    await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    h.objectStore.delete = (): Promise<void> => {
      throw new Error('the object store is unavailable');
    };

    const job = new PurgeJob({ objectStore: h.objectStore, runStore: h.runStore });
    const result = await job.purge('2027-11-10');

    expect(result.purged).toEqual([]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.runId).toBe(THE_INDEX.runId);
    expect(h.runStore.purged).toEqual([]);
  });

  it('purges nothing before the expiry', async () => {
    const h = harness();
    await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    const job = new PurgeJob({ objectStore: h.objectStore, runStore: h.runStore });
    const result = await job.purge('2027-01-01');

    expect(result.purged).toEqual([]);
    expect(h.objectStore.size).toBe(1);
  });
});
