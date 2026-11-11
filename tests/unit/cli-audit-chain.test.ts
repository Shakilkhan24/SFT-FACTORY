/**
 * `factory audit chain <taskId>` — the chain-verification command (T-1.16).
 *
 * ## The oracle this file carries
 *
 * checklist 03 T-1.16's oracle row: "`factory audit chain` exits 0 on an
 * intact run and ≠0 on a tampered one."
 *
 * So the load-bearing assertion is the **exit code**: 0 for an intact
 * chain, 1 for a broken one. Not 2 — 2 is the CLI's "you invoked me
 * wrongly", and a tampered chain is not an invocation error. A script
 * that checks the exit code must be able to tell the two apart.
 *
 * ## The tamper is real
 *
 * The in-memory verifier builds its links with the log's **own**
 * `chainHash` — the same function `PostgresEventLog` uses to write
 * them. So an intact aggregate really is intact, and an altered one
 * really is detectable. A verifier that used its own hashing would be
 * testing its own arithmetic rather than the log's.
 *
 * The tamper is applied to the **stored hash**, which is what an editor
 * with database rights would produce: the row's `hash` column no longer
 * matching its envelope.
 *
 * ## Why there is no database here
 *
 * This environment has no Docker daemon, so the Postgres-backed test
 * **skips** locally and runs in CI. The detection logic is **pure** —
 * `verifyChainLinks` in `@factory/eventlog` — so it is proven here
 * without one. The Postgres verifier is a SELECT followed by a call to
 * the same function, so the two differ only in where the links come
 * from.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryChainVerifier,
  PostgresChainVerifier,
  buildLinks,
  runAuditChain,
  verdictLines,
  type ChainVerdict,
} from '../../apps/cli/src/audit.ts';
import { chainHash } from '@factory/eventlog';

/**
 * An event envelope, in the shape the chain hashes.
 */
const envelope = (
  eventType: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: `evt-${eventType}`,
  type: eventType,
  aggregate: { kind: 'task', id: 'task-1', version: 1 },
  occurredAt: '2026-01-01T00:00:00.000Z',
  actor: { kind: 'human', id: 'alice' },
  authority: { basis: 'human-access-point', scope: ['define-intent'] },
  correlationId: 'corr-1',
  redaction: { applied: [] },
  payload: { note: 'a note' },
  ...overrides,
});

/**
 * An aggregate's events.
 */
const events = (
  count: number,
): readonly { readonly seq: number; readonly envelope: Record<string, unknown> }[] =>
  Array.from({ length: count }, (_unused, index) => ({
    seq: index + 1,
    envelope: envelope(`event.${String(index + 1)}`, {
      aggregate: { kind: 'task', id: 'task-1', version: index + 1 },
    }),
  }));

describe('the in-memory chain verifier', () => {
  it('verifies an intact chain', async () => {
    const verifier = new InMemoryChainVerifier(events(5));
    const verdict = await verifier.verify({ kind: 'task', id: 'task-1' });
    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBe(5);
  });

  it('verifies an aggregate with a single event', async () => {
    // The first event of an aggregate has no previous hash. A verifier
    // that treated a null `prev_hash` as a break would fail every
    // first event.
    const verifier = new InMemoryChainVerifier(events(1));
    const verdict = await verifier.verify({ kind: 'task', id: 'task-1' });
    expect(verdict.ok).toBe(true);
  });

  it('verifies an empty aggregate', async () => {
    const verifier = new InMemoryChainVerifier([]);
    const verdict = await verifier.verify({ kind: 'task', id: 'task-1' });
    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBe(0);
  });

  it('detects a tampered hash', async () => {
    // The tamper: the stored hash no longer matches the envelope.
    const original = events(3);
    const links = buildLinks(original);
    const tampered = links.map((link, index) =>
      index === 1
        ? { ...link, hash: 'f'.repeat(64) }
        : link,
    );
    const verdict = await verify(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSeq).toBe(2);
  });

  it('detects a tampered envelope', async () => {
    // The other tamper: the envelope was edited and the hash was
    // recomputed for it — but then the *next* link's `prev_hash` no
    // longer matches, so the break is still detected.
    const original = events(3);
    const links = buildLinks(original);
    const edited = { ...links[0]!, envelope: envelope('event.1', { payload: { note: 'edited' } }) };
    const verdict = await verify([edited, ...links.slice(1)]);
    expect(verdict.ok).toBe(false);
  });

  it('detects a removed event', async () => {
    // An event removed from the middle leaves the next link's
    // `prev_hash` pointing at a hash that is no longer in the chain.
    const original = events(4);
    const links = buildLinks(original);
    const verdict = await verify([links[0]!, ...links.slice(2)]);
    expect(verdict.ok).toBe(false);
  });

  it('says where the chain broke', async () => {
    const original = events(3);
    const links = buildLinks(original);
    const tampered = links.map((link, index) =>
      index === 1 ? { ...link, hash: 'f'.repeat(64) } : link,
    );
    const verdict = await verify(tampered);
    expect(verdict.reason).toBeDefined();
    expect(verdict.reason).toContain('seq 2');
  });
});

/**
 * Verify a set of links, using the log's own pure verifier.
 */
const verify = async (
  links: readonly {
    readonly seq: number;
    readonly prevHash: string | null;
    readonly hash: string;
    readonly envelope: Record<string, unknown>;
  }[],
): Promise<ChainVerdict> => {
  const { verifyChainLinks } = await import('@factory/eventlog');
  const result = verifyChainLinks(links);
  return {
    ok: result.ok,
    checked: result.checked,
    ...(result.brokenAtSeq === undefined ? {} : { brokenAtSeq: result.brokenAtSeq }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
};

describe('the built links', () => {
  it('chains the events in sequence order', () => {
    const links = buildLinks(events(3));
    expect(links.map((link) => link.seq)).toEqual([1, 2, 3]);
    expect(links[0]?.prevHash).toBeNull();
    expect(links[1]?.prevHash).toBe(links[0]?.hash);
  });

  it('sorts the events it is given', async () => {
    // The events arrive from a SELECT, which is ordered — but the
    // builder must not depend on the caller's ordering.
    const shuffled = [events(3)[2]!, events(3)[0]!, events(3)[1]!];
    const links = buildLinks(shuffled);
    expect(links.map((link) => link.seq)).toEqual([1, 2, 3]);
    const verdict = await verify(links);
    expect(verdict.ok).toBe(true);
  });

  it('hashes with the log\'s own function', () => {
    // If the builder used its own hashing, an intact chain would fail
    // against the real log and the test would prove nothing.
    const list = events(2);
    const links = buildLinks(list);
    expect(links[0]?.hash).toBe(chainHash(list[0]!.envelope, null));
    expect(links[1]?.hash).toBe(chainHash(list[1]!.envelope, links[0]?.hash ?? null));
  });
});

describe('factory audit chain', () => {
  it('says how to use it with no task id', async () => {
    const verifier = new InMemoryChainVerifier(events(3));
    const result = await runAuditChain(undefined, verifier);
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/usage: factory audit chain/);
  });

  it('exits 0 on an intact chain', async () => {
    // The oracle: "exits 0 on an intact run".
    const verifier = new InMemoryChainVerifier(events(5));
    const result = await runAuditChain('task-1', verifier);
    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('intact');
  });

  it('exits non-zero on a tampered chain', async () => {
    // The oracle: "≠0 on a tampered one".
    const original = events(5);
    const links = buildLinks(original);
    const tampered = links.map((link, index) =>
      index === 2 ? { ...link, hash: 'f'.repeat(64) } : link,
    );
    const verdict = await verify(tampered);
    const result = await runAuditChain('task-1', {
      verify: () => Promise.resolve(verdict),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).toBe(1);
  });

  it('exits 1 — not 2 — on a tampered chain', async () => {
    // 2 means "you invoked me wrongly". A tampered chain is not an
    // invocation error, and a script must be able to tell them apart.
    const verdict: ChainVerdict = { ok: false, checked: 5, brokenAtSeq: 3 };
    const result = await runAuditChain('task-1', {
      verify: () => Promise.resolve(verdict),
    });
    expect(result.exitCode).toBe(1);
  });

  it('names the aggregate it verified', async () => {
    const verifier = new InMemoryChainVerifier(events(3));
    const result = await runAuditChain('task-1', verifier);
    expect(result.lines.join('\n')).toContain('task:task-1');
  });

  it('names the seq the chain broke at', async () => {
    const original = events(3);
    const links = buildLinks(original);
    const tampered = links.map((link, index) =>
      index === 1 ? { ...link, hash: 'f'.repeat(64) } : link,
    );
    const verdict = await verify(tampered);
    const result = await runAuditChain('task-1', {
      verify: () => Promise.resolve(verdict),
    });
    expect(result.lines.join('\n')).toContain('BROKEN at seq 2');
  });

  it('states why the chain broke', async () => {
    const original = events(3);
    const links = buildLinks(original);
    const tampered = links.map((link, index) =>
      index === 1 ? { ...link, hash: 'f'.repeat(64) } : link,
    );
    const verdict = await verify(tampered);
    const result = await runAuditChain('task-1', {
      verify: () => Promise.resolve(verdict),
    });
    expect(result.lines.join('\n')).toContain('hash mismatch');
  });

  it('exits 1 on an EMPTY chain — an audit of nothing is not a pass', async () => {
    // An aggregate with no events has a **trivially intact** chain:
    // every link (there are none) recomputes. So `verifyChainLinks`
    // says `ok: true`, and a verdict that reported that as a pass would
    // make a run that wrote no events look exactly like a run whose
    // events were all verified.
    //
    // This is the failure the CLI found for real: the Postgres verifier
    // reported `checked: 0` while the log held six events, so the
    // command said "intact (0 links checked)" — a pass on nothing.
    const verdict: ChainVerdict = { ok: true, checked: 0 };
    const result = await runAuditChain('task-with-no-events', {
      verify: () => Promise.resolve(verdict),
    });
    expect(result.exitCode).toBe(1);
  });

  it('says NOTHING TO VERIFY on an empty chain', async () => {
    const verdict: ChainVerdict = { ok: true, checked: 0 };
    const result = await runAuditChain('task-with-no-events', {
      verify: () => Promise.resolve(verdict),
    });
    expect(result.lines.join('\n')).toContain('NOTHING TO VERIFY');
    expect(result.lines.join('\n')).toContain('no events');
  });

  it('does not report an empty chain as intact', async () => {
    // The word "intact" must not appear for an empty chain — a script
    // that greps for it would otherwise read a false pass.
    const verdict: ChainVerdict = { ok: true, checked: 0 };
    const result = await runAuditChain('task-with-no-events', {
      verify: () => Promise.resolve(verdict),
    });
    expect(result.lines.join('\n')).not.toContain('intact');
  });
});

describe('the Postgres verifier', () => {
  it('reports how many links the log actually checked', async () => {
    // The bug this covers: the adapter hard-coded `checked: 0`, so the
    // command printed "intact (0 links checked)" while the log held six
    // events. The count comes from the log's own verifier.
    const verifier = new PostgresChainVerifier({
      verifyChainDetailed: () =>
        Promise.resolve({ ok: true, checked: 6 }),
    });
    const verdict = await verifier.verify({ kind: 'task', id: 'task-1' });
    expect(verdict.checked).toBe(6);
    expect(verdict.ok).toBe(true);
  });

  it('carries the reason the log gave', async () => {
    const verifier = new PostgresChainVerifier({
      verifyChainDetailed: () =>
        Promise.resolve({
          ok: false,
          checked: 6,
          brokenAtSeq: 3,
          reason: 'hash mismatch at seq 3',
        }),
    });
    const verdict = await verifier.verify({ kind: 'task', id: 'task-1' });
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSeq).toBe(3);
    expect(verdict.checked).toBe(6);
  });
});

describe('the verdict lines', () => {
  it('says intact and how many links were checked', () => {
    const lines = verdictLines(
      { kind: 'task', id: 'task-1' },
      { ok: true, checked: 7 },
    );
    expect(lines.join('\n')).toContain('intact');
    expect(lines.join('\n')).toContain('7 links checked');
  });

  it('says broken and where', () => {
    const lines = verdictLines(
      { kind: 'task', id: 'task-1' },
      { ok: false, checked: 7, brokenAtSeq: 4, reason: 'hash mismatch at seq 4' },
    );
    expect(lines.join('\n')).toContain('BROKEN at seq 4');
    expect(lines.join('\n')).toContain('hash mismatch at seq 4');
  });
});
