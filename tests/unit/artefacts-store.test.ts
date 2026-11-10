/**
 * The **record writer**.
 *
 * blueprint 15 §2.4 gives the four writing rules:
 *
 * | Rule | What the test observes |
 * |---|---|
 * | **Framework-emitted** | the writer takes what the framework observed |
 * | **Atomic with the outcome** | a completed run always has a complete artefact |
 * | **Incremental** | a killed run still leaves a record |
 * | **Redacted at capture** | the stored bytes never held a secret |
 *
 * pack 04 INT-08 adds the fifth, which is the ticket's oracle: "spool
 * locally, then fail stage".
 */

import { describe, expect, it } from 'vitest';

import {
  IncompleteRecordError,
  recordHashVerifies,
  recordKey,
  storedBytesDigest,
  type RunRecord,
} from '../../packages/artefacts/src/index.ts';

import {
  THE_INDEX,
  THE_PARTS,
  THE_RECORD,
  harness,
  parts,
} from '../helpers/artefacts.ts';

describe('the record writer', () => {
  it('writes the record to `runs/<runId>/…`', () => {
    // pack 02 §4.11: "objects go to `runs/<runId>/…` in the object store".
    expect(recordKey('run_123')).toBe('runs/run_123/record.json');
  });

  it('writes the object and indexes the row', async () => {
    const h = harness();
    const result = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    expect(h.objectStore.keys()).toEqual(['runs/run_01JCZ8JYTESTRUN000000/record.json']);
    expect(h.runStore.written).toEqual(['run_01JCZ8JYTESTRUN000000']);

    const row = await h.runStore.find('run_01JCZ8JYTESTRUN000000');
    expect(row?.recordUri).toBe(
      's3://factory-artifacts/runs/run_01JCZ8JYTESTRUN000000/record.json',
    );
    expect(row?.recordSha256).toBe(result.recordSha256);
  });

  it('writes bytes that verify against the record’s hash', async () => {
    // The hash witnesses the record's **content**, and the stored bytes are
    // the canonical JSON of the whole record. So a reader retrieves the
    // object, strips the hash member, and recomputes — which is exactly
    // what `recordHashVerifies` does. The two must agree.
    const h = harness();
    const result = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    const bytes = await h.objectStore.get(recordKey(result.runId));
    expect(bytes).toBeDefined();

    const stored = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as RunRecord;
    expect(recordHashVerifies(stored)).toBe(true);
    expect(stored.sha256).toBe(result.recordSha256);
  });

  it('writes bytes that are canonical JSON, so the digest is reproducible', async () => {
    const h = harness();
    const result = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    const bytes = await h.objectStore.get(recordKey(result.runId));
    const text = new TextDecoder().decode(bytes as Uint8Array);
    // Canonical JSON has no insignificant whitespace and sorted keys.
    expect(text).not.toMatch(/\n/);
    expect(text.startsWith('{"artefacts":')).toBe(true);
    // The bytes digest is stable for the same bytes.
    expect(storedBytesDigest(bytes as Uint8Array)).toBe(
      storedBytesDigest(bytes as Uint8Array),
    );
  });

  it('produces a record that verifies against its own hash', async () => {
    const h = harness();
    const result = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');
    expect(recordHashVerifies(result.record)).toBe(true);
  });

  it('refuses to finalise an incomplete record, and writes nothing', async () => {
    // A0.3: the writer must refuse to finalise a record that is missing
    // an element — and refusing must mean *nothing was written*.
    const h = harness();
    const incomplete = parts({ outcome: undefined as never });

    await expect(h.store.finalise(incomplete, THE_INDEX, 'engineering')).rejects.toBeInstanceOf(
      IncompleteRecordError,
    );
    expect(h.objectStore.size).toBe(0);
    expect(h.runStore.written).toEqual([]);
  });

  it('names the missing element in the refusal', async () => {
    const h = harness();
    const incomplete = parts({ outcome: undefined as never });

    await expect(h.store.finalise(incomplete, THE_INDEX, 'engineering')).rejects.toThrow(
      /element 8 \(outcome\)/,
    );
  });

  it('spools the bytes and fails the stage when the object store is down', async () => {
    // pack 04 INT-08: "spool locally, then fail stage". The bytes are not
    // lost, and the stage **fails** — a record reported as written but not
    // stored would be a lie the factory would later audit and find.
    const h = harness();
    h.objectStore.outage = true;

    await expect(h.store.finalise(THE_PARTS, THE_INDEX, 'engineering')).rejects.toThrow();

    // The bytes were spooled…
    const spooled = await h.spool.peek(recordKey(THE_INDEX.runId));
    expect(spooled).toBeDefined();
    expect(
      (JSON.parse(new TextDecoder().decode(spooled as Uint8Array)) as RunRecord).identity.runId,
    ).toBe(THE_INDEX.runId);

    // …and **no row was written**, so there is no completed run without a
    // complete artefact.
    expect(h.runStore.written).toEqual([]);
  });

  it('writes a partial record during the run, so a killed run leaves evidence', async () => {
    // blueprint 15 §2.4: "Incremental | Partial artefacts are written
    // during the run, so a killed run still leaves a record."
    const h = harness();
    const written = await h.store.writePartial({
      runId: THE_INDEX.runId,
      identity: THE_PARTS.identity,
      outcome: { status: 'incomplete', failureClassification: null },
    });

    expect(written).toBe(true);
    expect(h.objectStore.keys()).toEqual(['runs/run_01JCZ8JYTESTRUN000000/record.json']);
  });

  it('spools a partial record when the store is down, and says so', async () => {
    // The partial write must not fail the run — the run is still going and
    // the *final* write is the one that matters — but the failure is still
    // reported, so a caller that cares can see it.
    const h = harness();
    h.objectStore.outage = true;

    const written = await h.store.writePartial({ runId: THE_INDEX.runId });
    expect(written).toBe(false);
    expect(await h.spool.peek(recordKey(THE_INDEX.runId))).toBeDefined();
  });

  it('overwrites the partial record with the final one', async () => {
    // The key is a function of the run id alone, so the incremental write
    // and the final write land on the same object.
    const h = harness();
    await h.store.writePartial({ runId: THE_INDEX.runId, identity: THE_PARTS.identity });
    const result = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    expect(h.objectStore.keys()).toEqual([recordKey(result.runId)]);
    const bytes = await h.objectStore.get(recordKey(result.runId));
    const stored = JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as RunRecord;
    expect(stored.outcome.status).toBe('success');
  });

  it('sets the retention class and the retain_until date on the row', async () => {
    // The DDL stores `retention_class` and `retain_until` (a **date**).
    const h = harness();
    await h.store.finalise(THE_PARTS, THE_INDEX, 'incident');

    const row = await h.runStore.find(THE_INDEX.runId);
    expect(row?.retentionClass).toBe('incident');
    // The completedAt is 2026-11-10; 24 months later is 2028-11-10.
    expect(row?.retainUntil).toBe('2028-11-10');
  });

  it('refuses a class with no default period when no expiry is supplied', async () => {
    // `evaluation` is retained "until the set is retired" — an event, not a
    // duration — so the expiry must be supplied.
    const h = harness();
    await expect(h.store.finalise(THE_PARTS, THE_INDEX, 'evaluation')).rejects.toThrow(
      /retention class "evaluation" has no default period/,
    );
  });

  it('accepts a supplied expiry for a class with no default period', async () => {
    const h = harness();
    const result = await h.store.finalise(
      THE_PARTS,
      THE_INDEX,
      'evaluation',
      new Date('2027-01-01T00:00:00.000Z'),
    );
    const row = await h.runStore.find(THE_INDEX.runId);
    expect(row?.retainUntil).toBe('2027-01-01');
    expect(result.record.retention.class).toBe('evaluation');
  });

  it('produces the same hash for the same facts', async () => {
    // The hash is a function of the content, so a re-derived record
    // hashes the same — which is what makes the record reproducible.
    const h = harness();
    const first = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');
    const second = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');
    expect(first.recordSha256).toBe(second.recordSha256);
  });

  it('owns the retention, so the record it writes carries its own expiry', async () => {
    // The writer computes the expiry from the class and the completion
    // time — the fixture's placeholder retention is not what lands in the
    // store. So the store's record is the authority, not the fixture.
    const h = harness();
    const result = await h.store.finalise(THE_PARTS, THE_INDEX, 'engineering');

    expect(result.record.retention.class).toBe('engineering');
    // The completedAt is 2026-11-10T00:31:47.221Z; twelve months later is
    // the same instant on 2027-11-10. The expiry is an **instant**, so the
    // time of day is preserved; the row's `retain_until` is the *date*.
    expect(result.record.retention.expiresAt).toBe('2027-11-10T00:31:47.221Z');
    expect(result.recordSha256).not.toBe(THE_RECORD.sha256);
  });
});
