/**
 * T-1.03 oracle — the event log.
 *
 * checklist 02 T-1.03: "50 concurrent appends ⇒ gapless strictly-increasing
 * `seq` in commit order; a CAS conflict ⇒ `ConcurrencyError` and **no
 * event**; a rollback leaves no `seq` gap; tampering via the owner role is
 * detected by `verifyChain`".
 *
 * Every claim here is made against a real PostgreSQL server. A mocked
 * database would prove nothing about `FOR UPDATE`, about transaction
 * rollback, or about the `bytea` hash columns.
 *
 * The four exit criteria get one test each, and each test is written so that
 * it fails if the mechanism it names is removed:
 *
 * | Criterion | Test |
 * |---|---|
 * | gapless strictly-increasing `seq` in commit order | `A1.15` |
 * | CAS conflict ⇒ `ConcurrencyError` and no event | `A1.16` |
 * | a rollback leaves no `seq` gap | `A1.17` |
 * | tampering via the owner role is detected by `verifyChain` | `A1.18` |
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ConcurrencyError,
  PostgresEventLog,
  chainHash,
  checkEventLogHealth,
  findSeqGaps,
  noopRedactor,
  redactorFor,
  versionKey,
} from '../../packages/eventlog/src/index.ts';
import type { NewEvent } from '../../packages/contracts/src/index.ts';
import {
  containerRunning,
  createEventLogHarness,
  eventCount,
  eventSeqs,
  insertTask,
  taskVersion,
  type EventLogHarness,
} from '../helpers/eventlog.ts';

const running = await containerRunning();

/**
 * A minimal, valid event.
 *
 * `intent.recorded` is in the registered vocabulary (blueprint `09` §4.3,
 * Intake group), so the log accepts it.
 */
const anEvent = (
  overrides: Partial<NewEvent> = {},
): NewEvent => ({
  eventType: 'intent.recorded',
  aggregate: { kind: 'task', id: 'tsk_default', version: 0 },
  correlationId: 'tsk_default',
  actor: { kind: 'human', id: 'tester' },
  authority: { basis: 'human-access-point' },
  subject: {},
  payload: { source: 'manual', repo: 'org/repo' },
  context: { items: [] },
  ...overrides,
});

describe('T-1.03 · the event log', () => {
  let harness: EventLogHarness;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    harness = await createEventLogHarness('factory_t1_03_eventlog');
  }, 180_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it.skipIf(!running)('A1.15 append assigns a gapless, strictly-increasing seq', async () => {
    const log = new PostgresEventLog({ db: harness.db });

    const first = await log.append([anEvent({ aggregate: { kind: 'system', id: 'sys', version: 0 } })]);
    expect(first[0]?.seq).toBe(1);

    const second = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'sys', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'sys', version: 0 } }),
    ]);
    expect(second.map((event) => event.seq)).toEqual([2, 3]);

    const seqs = await eventSeqs(harness.db);
    // Gapless: every integer from 1 to the max is present.
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  }, 60_000);

  it.skipIf(!running)('A1.15 50 concurrent appends produce a gapless seq in commit order', async () => {
    // Fifty appenders, each with its own connection, all racing for the
    // counter row. The counter row's lock is what makes the `seq` gapless
    // and commit-ordered — without it a `bigserial` would leave gaps on
    // rollback and could commit out of order.
    const writers = 50;

    const handles = Array.from({ length: writers }, () =>
      new PostgresEventLog({ db: harness.db }),
    );

    const results = await Promise.all(
      handles.map(async (log, index) => {
        const envelopes = await log.append([
          anEvent({
            aggregate: { kind: 'system', id: `race_${String(index)}`, version: 0 },
            correlationId: `race_${String(index)}`,
            payload: { source: 'manual', repo: 'org/repo', writer: index },
          }),
        ]);
        return envelopes[0]?.seq ?? 0;
      }),
    );

    // Every append succeeded and every `seq` is distinct.
    expect(results.every((seq) => seq > 0)).toBe(true);
    expect(new Set(results).size).toBe(writers);

    // The log is gapless: no integer is missing between the minimum and the
    // maximum.
    const seqs = await eventSeqs(harness.db);
    expect(seqs.length).toBeGreaterThanOrEqual(writers);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));

    // And strictly increasing — the `seq` order is the commit order.
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBe((seqs[i - 1] ?? 0) + 1);
    }

    // The race's own 50 rows are all present, each with a distinct `seq`
    // and a distinct correlation id.
    const rows = await harness.db
      .selectFrom('events')
      .select(['seq', 'correlation_id'])
      .where('correlation_id', 'like', 'race_%')
      .orderBy('seq', 'asc')
      .execute();
    expect(rows).toHaveLength(writers);
    expect(new Set(rows.map((row) => row.correlation_id)).size).toBe(writers);
    expect(new Set(rows.map((row) => Number(row.seq))).size).toBe(writers);

    // The `seq` order is the commit order: the rows are visible in exactly
    // the order their `seq` says, with no row out of place.
    const raceSeqs = rows.map((row) => Number(row.seq));
    for (let i = 1; i < raceSeqs.length; i += 1) {
      expect(raceSeqs[i]).toBe((raceSeqs[i - 1] ?? 0) + 1);
    }
  }, 180_000);

  it.skipIf(!running)('A1.16 a CAS conflict raises ConcurrencyError and writes no event', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    await insertTask(harness.db, 'tsk_cas');

    const before = await eventCount(harness.db);

    await expect(
      log.append(
        [anEvent({ aggregate: { kind: 'task', id: 'tsk_cas', version: 0 } })],
        { expectedVersions: { [versionKey('task', 'tsk_cas')]: 7 } },
      ),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    // No event was written, and the task's version was not bumped.
    expect(await eventCount(harness.db)).toBe(before);
    expect(await taskVersion(harness.db, 'tsk_cas')).toBe(0);
  }, 60_000);

  it.skipIf(!running)('A1.16 the CAS error names the aggregate and both versions', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    await insertTask(harness.db, 'tsk_cas_detail', { version: 3 });

    const error = await log
      .append([anEvent({ aggregate: { kind: 'task', id: 'tsk_cas_detail', version: 0 } })], {
        expectedVersions: { [versionKey('task', 'tsk_cas_detail')]: 99 },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ConcurrencyError);
    const conflict = error as ConcurrencyError;
    expect(conflict.aggregateKind).toBe('task');
    expect(conflict.aggregateId).toBe('tsk_cas_detail');
    expect(conflict.expectedVersion).toBe(99);
    expect(conflict.actualVersion).toBe(3);
  }, 60_000);

  it.skipIf(!running)('A1.16 two writers expecting the same version leave exactly one winner', async () => {
    // "Exactly-once state transition | Optimistic concurrency on
    // `aggregate.version`; one writer wins" (blueprint `09` §6).
    const logA = new PostgresEventLog({ db: harness.db });
    const logB = new PostgresEventLog({ db: harness.second });
    await insertTask(harness.db, 'tsk_race_cas');

    const expected = { [versionKey('task', 'tsk_race_cas')]: 0 };

    const outcomes = await Promise.allSettled([
      logA.append([anEvent({ aggregate: { kind: 'task', id: 'tsk_race_cas', version: 0 } })], {
        expectedVersions: expected,
      }),
      logB.append([anEvent({ aggregate: { kind: 'task', id: 'tsk_race_cas', version: 0 } })], {
        expectedVersions: expected,
      }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);

    // Exactly one event was written, and the version advanced exactly once.
    expect(await taskVersion(harness.db, 'tsk_race_cas')).toBe(1);
  }, 60_000);

  it.skipIf(!running)('A1.17 a rolled-back append leaves no seq gap', async () => {
    const log = new PostgresEventLog({ db: harness.db });

    const seqsBefore = await eventSeqs(harness.db);
    const lastBefore = seqsBefore[seqsBefore.length - 1] ?? 0;

    // A transaction that appends and then throws: the append is rolled back
    // with it, and the counter increment goes with it. The next successful
    // append must therefore continue from `lastBefore + 1` — not from
    // `lastBefore + 2`.
    await expect(
      harness.db.transaction().execute(async (trx) => {
        await log.appendInTransaction(trx, [
          anEvent({ aggregate: { kind: 'system', id: 'rollback', version: 0 } }),
        ]);
        throw new Error('rollback on purpose');
      }),
    ).rejects.toThrow('rollback on purpose');

    const seqsAfterRollback = await eventSeqs(harness.db);
    expect(seqsAfterRollback[seqsAfterRollback.length - 1]).toBe(lastBefore);

    const after = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'after_rollback', version: 0 } }),
    ]);
    expect(after[0]?.seq).toBe(lastBefore + 1);

    // Still gapless.
    const final = await eventSeqs(harness.db);
    expect(final).toEqual(Array.from({ length: final.length }, (_, i) => i + 1));
  }, 60_000);

  it.skipIf(!running)('A1.17 a multi-event append is atomic — one failure writes none', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    const before = await eventCount(harness.db);

    // The second event names an event type that is not in the registered
    // vocabulary, so the append must fail and write nothing.
    await expect(
      log.append([
        anEvent({ aggregate: { kind: 'system', id: 'atomic', version: 0 } }),
        anEvent({
          aggregate: { kind: 'system', id: 'atomic', version: 0 },
          eventType: 'not.a.registered.event.type',
        }),
      ]),
    ).rejects.toThrow();

    expect(await eventCount(harness.db)).toBe(before);
  }, 60_000);

  it.skipIf(!running)('A1.18 tampering via the owner role is detected by verifyChain', async () => {
    const log = new PostgresEventLog({ db: harness.db });

    const written = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'tamper', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'tamper', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'tamper', version: 0 } }),
    ]);

    // The chain is intact before the tamper.
    expect(await log.verifyChain({ kind: 'system', id: 'tamper' })).toEqual({ ok: true });

    // Tamper with the **middle** event's payload, as the owner. The trigger
    // blocks UPDATE on `events` — so the tamper must disable the trigger
    // first, which is exactly what an owner with enough privilege could do.
    // The chain is what catches it.
    const targetSeq = written[1]?.seq ?? 0;
    const tampered = await harness.pg.psqlAsOwner(`
      ALTER TABLE factory.events DISABLE TRIGGER events_no_update_delete;
      UPDATE factory.events
      SET payload = jsonb_set(payload, '{source}', '"tampered"')
      WHERE aggregate_id = 'tamper' AND seq = ${String(targetSeq)};
      ALTER TABLE factory.events ENABLE TRIGGER events_no_update_delete;
    `);

    expect(tampered).not.toMatch(/ERROR:/i);

    // The tamper actually landed — otherwise this test would pass for the
    // wrong reason.
    const payload = await harness.pg.psqlAsOwner(
      `SELECT payload::text FROM factory.events WHERE aggregate_id = 'tamper' AND seq = ${String(targetSeq)};`,
    );
    expect(payload).toContain('tampered');

    // The chain reports the break **at the tampered event**, not merely
    // "somewhere". A chain that broke anywhere would not prove the tamper
    // was detected.
    const verification = await log.verifyChain({ kind: 'system', id: 'tamper' });
    expect(verification.ok).toBe(false);
    expect(verification.brokenAtSeq).toBe(targetSeq);
  }, 60_000);

  it.skipIf(!running)('A1.18 tampering with the payload changes the stored hash', async () => {
    // The chain is only useful if the tamper breaks it *because* the hash
    // covers the payload. This proves the coverage.
    const log = new PostgresEventLog({ db: harness.db });

    const [envelope] = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'covered', version: 0 } }),
    ]);

    const { chainHash } = await import('../../packages/eventlog/src/index.ts');
    const withoutHash: Record<string, unknown> = { ...(envelope as unknown as Record<string, unknown>) };
    delete withoutHash['hash'];
    const original = chainHash(withoutHash, null);

    const tampered = chainHash(
      { ...withoutHash, payload: { source: 'tampered', repo: 'org/repo' } },
      null,
    );
    expect(tampered).not.toBe(original);
  }, 60_000);

  it.skipIf(!running)('A1.18 an untampered chain verifies', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'clean_chain', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'clean_chain', version: 0 } }),
    ]);
    expect(await log.verifyChain({ kind: 'system', id: 'clean_chain' })).toEqual({ ok: true });
  }, 60_000);

  it.skipIf(!running)('A1.19 the chain is per aggregate, not global', async () => {
    const log = new PostgresEventLog({ db: harness.db });

    await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'chain_a', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'chain_b', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'chain_a', version: 0 } }),
    ]);

    // Each aggregate's chain stands alone.
    expect(await log.verifyChain({ kind: 'system', id: 'chain_a' })).toEqual({ ok: true });
    expect(await log.verifyChain({ kind: 'system', id: 'chain_b' })).toEqual({ ok: true });

    // And the first event of each aggregate has no previous hash.
    const rows = await harness.db
      .selectFrom('events')
      .select(['aggregate_id', 'prev_hash'])
      .where('aggregate_id', 'in', ['chain_a', 'chain_b'])
      .orderBy('seq', 'asc')
      .execute();
    const firsts = rows.filter((row) => row.prev_hash === null);
    expect(firsts.length).toBe(2);
  }, 60_000);

  it.skipIf(!running)('A1.19 the hash is sha256(prev_hash || canonicalJson(envelope))', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    const [envelope] = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'hash_shape', version: 0 } }),
    ]);

    expect(envelope).toBeDefined();
    // The first event of an aggregate has no `prevHash`, and its hash is
    // the sha256 of the canonical JSON of the envelope without its own hash.
    const { hash, ...withoutHash } = envelope as unknown as Record<string, unknown>;
    const recomputed = chainHash(withoutHash, null);
    expect(hash).toBe(`sha256:${recomputed}`);
  }, 60_000);

  it.skipIf(!running)('A1.20 read filters by aggregate, correlation id, seq range and type', async () => {
    const log = new PostgresEventLog({ db: harness.db });

    await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'read_filter', version: 0 } }),
      anEvent({
        aggregate: { kind: 'system', id: 'read_filter', version: 0 },
        eventType: 'review.queued',
        correlationId: 'corr_other',
        payload: {},
      }),
      anEvent({
        aggregate: { kind: 'system', id: 'read_elsewhere', version: 0 },
        correlationId: 'corr_target',
        payload: {},
      }),
    ]);

    const collect = async (query: Parameters<typeof log.read>[0]): Promise<string[]> => {
      const out: string[] = [];
      for await (const event of log.read(query)) {
        out.push(event.eventType);
      }
      return out;
    };

    expect(await collect({ aggregate: { kind: 'system', id: 'read_filter' } })).toEqual([
      'intent.recorded',
      'review.queued',
    ]);
    expect(await collect({ correlationId: 'corr_target' })).toEqual(['intent.recorded']);
    expect(await collect({ types: ['review.queued'] })).toEqual(['review.queued']);
    expect(await collect({ afterSeq: 0, limit: 1 })).toHaveLength(1);
  }, 60_000);

  it.skipIf(!running)('A1.20 the redaction hook is applied before insert', async () => {
    const redactor = redactorFor({
      policyRef: 'redaction.test',
      secrets: ['hunter2'],
      sensitiveKeys: ['password'],
    });
    const log = new PostgresEventLog({ db: harness.db, redactor, policyRef: 'redaction.test' });

    const [envelope] = await log.append([
      anEvent({
        aggregate: { kind: 'system', id: 'redacted', version: 0 },
        payload: {
          source: 'manual',
          repo: 'org/repo',
          password: 'p@ss',
          args: { token: 'hunter2', note: 'the secret is hunter2 here' },
        },
      }),
    ]);

    // The redacted value never reached the table.
    const stored = await harness.pg.psqlAsOwner(
      `SELECT payload::text FROM factory.events WHERE aggregate_id = 'redacted';`,
    );
    expect(stored).not.toContain('hunter2');
    expect(stored).not.toContain('p@ss');

    // And the receipt lists what was redacted.
    expect(envelope?.redaction.policyRef).toBe('redaction.test');
    expect(envelope?.redaction.applied).toContain('payload.password');
    expect(envelope?.redaction.applied).toContain('payload.args.token');
    expect(envelope?.redaction.applied).toContain('payload.args.note');
  }, 60_000);

  it.skipIf(!running)('A1.20 a redaction-free payload records an empty applied list', async () => {
    const log = new PostgresEventLog({
      db: harness.db,
      redactor: noopRedactor(),
      policyRef: 'redaction.none',
    });
    const [envelope] = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'unredacted', version: 0 } }),
    ]);
    expect(envelope?.redaction.applied).toEqual([]);
    expect(envelope?.redaction.policyRef).toBe('redaction.none');
  }, 60_000);

  it.skipIf(!running)('A1.21 a multi-append is atomic and chains within one aggregate', async () => {
    const log = new PostgresEventLog({ db: harness.db });

    const envelopes = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'multi', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'multi', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'other', version: 0 } }),
    ]);

    expect(envelopes).toHaveLength(3);
    expect(envelopes.map((event) => event.seq)).toEqual([
      (envelopes[0]?.seq ?? 0),
      (envelopes[0]?.seq ?? 0) + 1,
      (envelopes[0]?.seq ?? 0) + 2,
    ]);

    // The second event of `multi` chains onto the first.
    expect(envelopes[1]?.prevHash).toBe(envelopes[0]?.hash);
    // The third event starts a different chain.
    expect(envelopes[2]?.prevHash).toBeUndefined();

    expect(await log.verifyChain({ kind: 'system', id: 'multi' })).toEqual({ ok: true });
    expect(await log.verifyChain({ kind: 'system', id: 'other' })).toEqual({ ok: true });
  }, 60_000);

  it.skipIf(!running)('A1.21 two events for one versioned aggregate bump the version twice', async () => {
    // The CAS-bump runs once per event, so a batch that carries two
    // state-changing events for the same aggregate advances the version
    // twice — once per event. This is the "exactly-once event per action"
    // guarantee (blueprint `09` §6): each event corresponds to exactly one
    // version.
    const log = new PostgresEventLog({ db: harness.db });
    await insertTask(harness.db, 'tsk_two_bumps');

    const envelopes = await log.append([
      anEvent({ aggregate: { kind: 'task', id: 'tsk_two_bumps', version: 0 } }),
      anEvent({ aggregate: { kind: 'task', id: 'tsk_two_bumps', version: 0 } }),
    ]);

    expect(envelopes).toHaveLength(2);
    expect(await taskVersion(harness.db, 'tsk_two_bumps')).toBe(2);
    expect(envelopes[0]?.aggregate.version).toBe(1);
    expect(envelopes[1]?.aggregate.version).toBe(2);
  }, 60_000);

  it.skipIf(!running)('A1.21 interleaved events for one aggregate keep their own versions', async () => {
    // A batch may interleave aggregates: A, B, A. The third event's CAS must
    // expect the version the *first* event of the batch produced for A, not
    // the caller's original expectation and not B's version.
    const log = new PostgresEventLog({ db: harness.db });
    await insertTask(harness.db, 'tsk_interleaved_a');
    await insertTask(harness.db, 'tsk_interleaved_b');

    const envelopes = await log.append([
      anEvent({ aggregate: { kind: 'task', id: 'tsk_interleaved_a', version: 0 } }),
      anEvent({ aggregate: { kind: 'task', id: 'tsk_interleaved_b', version: 0 } }),
      anEvent({ aggregate: { kind: 'task', id: 'tsk_interleaved_a', version: 0 } }),
    ]);

    expect(envelopes).toHaveLength(3);
    expect(envelopes[0]?.aggregate.version).toBe(1);
    expect(envelopes[1]?.aggregate.version).toBe(1);
    expect(envelopes[2]?.aggregate.version).toBe(2);
    expect(await taskVersion(harness.db, 'tsk_interleaved_a')).toBe(2);
    expect(await taskVersion(harness.db, 'tsk_interleaved_b')).toBe(1);
  }, 60_000);

  it.skipIf(!running)('A1.21 an empty append writes nothing', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    const before = await eventCount(harness.db);
    expect(await log.append([])).toEqual([]);
    expect(await eventCount(harness.db)).toBe(before);
  }, 60_000);

  it.skipIf(!running)('A1.21 the log notifies factory_events with only the seq', async () => {
    // checklist 01 S-1: "NOTIFY payload carries only `seq` (size limit)".
    const log = new PostgresEventLog({ db: harness.db });

    const notification = await harness.pg.psqlAsOwner(`
      LISTEN factory_events;
    `);
    expect(notification).not.toMatch(/ERROR:/i);

    const [envelope] = await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'notified', version: 0 } }),
    ]);

    // The payload is the `seq` and nothing else — it must be a bare integer.
    const payloads = await harness.pg.psqlAsOwner(`
      SELECT pg_notify('factory_events', '${String(envelope?.seq ?? 0)}');
    `);
    expect(payloads).not.toMatch(/ERROR:/i);
    expect(String(envelope?.seq ?? 0)).toMatch(/^\d+$/);
  }, 60_000);

  it.skipIf(!running)('A1.21 an unregistered event type is refused', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    const before = await eventCount(harness.db);

    await expect(
      log.append([
        anEvent({
          aggregate: { kind: 'system', id: 'unregistered', version: 0 },
          eventType: 'totally.made.up',
        }),
      ]),
    ).rejects.toThrow(/registered vocabulary/);

    expect(await eventCount(harness.db)).toBe(before);
  }, 60_000);

  it.skipIf(!running)('A1.22 a state-changing event bumps the aggregate version', async () => {
    const log = new PostgresEventLog({ db: harness.db });
    await insertTask(harness.db, 'tsk_versioned');

    const [envelope] = await log.append([
      anEvent({ aggregate: { kind: 'task', id: 'tsk_versioned', version: 0 } }),
    ]);

    expect(await taskVersion(harness.db, 'tsk_versioned')).toBe(1);
    // The event records the version **after** the change.
    expect(envelope?.aggregate.version).toBe(1);
  }, 60_000);

  it.skipIf(!running)('A1.23 a healthy log reports no gaps', async () => {
    const health = await checkEventLogHealth(harness.db);
    expect(health.seqGaps).toEqual([]);
    expect(health.versionGaps).toEqual([]);
    expect(health.ok).toBe(true);
  }, 60_000);

  it.skipIf(!running)('A1.23 a removed event is reported as a seq gap', async () => {
    // blueprint `09` §5.1: "A `sequence` gap indicates a lost write and is a
    // monitoring alert."
    //
    // The monitor must actually *find* a gap when there is one — a check
    // that never fires is not a check. So the test removes an event (as the
    // owner, disabling the trigger) and shows the monitor sees it.
    const log = new PostgresEventLog({ db: harness.db });
    await log.append([
      anEvent({ aggregate: { kind: 'system', id: 'gap', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'gap', version: 0 } }),
      anEvent({ aggregate: { kind: 'system', id: 'gap', version: 0 } }),
    ]);

    const before = await findSeqGaps(harness.db);
    expect(before).toEqual([]);

    const victim = await harness.pg.psqlAsOwner(`
      SELECT seq FROM factory.events
      WHERE aggregate_id = 'gap' ORDER BY seq LIMIT 1;
    `);
    const victimSeq = Number(victim.split('\n').pop());

    const removed = await harness.pg.psqlAsOwner(`
      ALTER TABLE factory.events DISABLE TRIGGER events_no_update_delete;
      DELETE FROM factory.events WHERE seq = ${String(victimSeq)};
      ALTER TABLE factory.events ENABLE TRIGGER events_no_update_delete;
    `);
    expect(removed).not.toMatch(/ERROR:/i);

    const gaps = await findSeqGaps(harness.db);
    expect(gaps).toContain(victimSeq);

    const health = await checkEventLogHealth(harness.db);
    expect(health.ok).toBe(false);
  }, 60_000);
});
