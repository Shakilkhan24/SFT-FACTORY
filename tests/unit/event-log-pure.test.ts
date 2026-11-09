/**
 * T-1.03 — the pure parts of the event log.
 *
 * The hash chain and the redaction hook are pure functions, so they are
 * tested without a database. That matters: a chain bug that only shows up
 * against Postgres would be slow to find and slow to fix.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DENIED_ENV_NAMES,
  DEFAULT_SENSITIVE_KEYS,
  REDACTION_PLACEHOLDER,
  bytesToDigest,
  chainHash,
  decodeNodeAggregateId,
  hexToBytes,
  nodeAggregateId,
  redactorFor,
  verifyChainLinks,
  type ChainLink,
} from '../../packages/eventlog/src/index.ts';

/**
 * Build a chain link from an envelope, chaining it onto `prev`.
 */
const link = (seq: number, envelope: Record<string, unknown>, prev: string | null): ChainLink => ({
  seq,
  prevHash: prev,
  hash: chainHash(envelope, prev),
  envelope,
});

describe('T-1.03 · the hash chain', () => {
  it('A1.18 the first link of a chain has no previous hash', () => {
    const envelope = { eventId: 'e1', seq: 1, payload: {} };
    const first = chainHash(envelope, null);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('A1.18 the hash covers the envelope without its own hash', () => {
    const envelope = { eventId: 'e1', seq: 1, payload: { a: 1 } };
    const withHash = { ...envelope, hash: 'sha256:whatever' };
    // Adding a `hash` member must not change the hash.
    expect(chainHash(withHash, null)).toBe(chainHash(envelope, null));
  });

  it('A1.18 the hash covers the previous hash', () => {
    const envelope = { eventId: 'e1', seq: 1, payload: { a: 1 } };
    const first = chainHash(envelope, null);
    const second = chainHash({ ...envelope, seq: 2 }, first);
    expect(second).not.toBe(first);
  });

  it('A1.18 the hash is over canonical JSON — key order does not matter', () => {
    const a = chainHash({ seq: 1, eventId: 'e1', payload: { x: 1, y: 2 } }, null);
    const b = chainHash({ payload: { y: 2, x: 1 }, eventId: 'e1', seq: 1 }, null);
    expect(a).toBe(b);
  });

  it('A1.18 a digest round-trips through bytes', () => {
    const digest = chainHash({ seq: 1 }, null);
    expect(bytesToDigest(hexToBytes(digest))).toBe(`sha256:${digest}`);
  });

  it('A1.18 verifyChainLinks accepts an intact chain', () => {
    const e1 = { seq: 1, eventId: 'a', payload: {} };
    const e2 = { seq: 2, eventId: 'b', payload: {} };
    const h1 = chainHash(e1, null);
    const result = verifyChainLinks([link(1, e1, null), link(2, e2, h1)]);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.brokenAtSeq).toBeUndefined();
  });

  it('A1.18 verifyChainLinks reports the first broken link', () => {
    const e1 = { seq: 1, eventId: 'a', payload: { v: 1 } };
    const e2 = { seq: 2, eventId: 'b', payload: { v: 2 } };
    const h1 = chainHash(e1, null);
    // Tamper with the first envelope: its stored hash no longer recomputes.
    const tampered: ChainLink = {
      seq: 1,
      prevHash: null,
      hash: h1,
      envelope: { ...e1, payload: { v: 99 } },
    };
    const result = verifyChainLinks([tampered, link(2, e2, h1)]);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it('A1.18 verifyChainLinks reports a removed link', () => {
    // The links are not in chain order — the second link's `prevHash` does
    // not match the first link's hash.
    const e1 = { seq: 1, eventId: 'a', payload: {} };
    const e2 = { seq: 2, eventId: 'b', payload: {} };
    const h1 = chainHash(e1, null);
    const h2 = chainHash(e2, h1);
    const result = verifyChainLinks([
      link(1, e1, null),
      { seq: 2, prevHash: null, hash: h2, envelope: e2 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
    expect(result.reason).toMatch(/prev_hash mismatch/);
  });

  it('A1.18 an empty chain is intact', () => {
    expect(verifyChainLinks([]).ok).toBe(true);
  });
});

describe('T-1.03 · redaction', () => {
  it('A1.20 a sensitive key is redacted and listed', () => {
    const redactor = redactorFor({ policyRef: 'redaction.test' });
    const result = redactor({ password: 'p@ss', keep: 'this' });
    expect(result.value).toEqual({ password: REDACTION_PLACEHOLDER, keep: 'this' });
    expect(result.applied).toEqual(['password']);
  });

  it('A1.20 a minted secret is redacted wherever it appears', () => {
    const redactor = redactorFor({ policyRef: 'redaction.test', secrets: ['hunter2'] });
    const result = redactor({ note: 'the secret is hunter2 here', other: 'clean' });
    expect(result.value).toEqual({ note: REDACTION_PLACEHOLDER, other: 'clean' });
    expect(result.applied).toEqual(['note']);
  });

  it('A1.20 a deny-listed env name is redacted', () => {
    const redactor = redactorFor({ policyRef: 'redaction.test' });
    const result = redactor({ GITHUB_TOKEN: 'ghp_x', PATH: '/usr/bin' });
    expect(result.value).toEqual({ GITHUB_TOKEN: REDACTION_PLACEHOLDER, PATH: '/usr/bin' });
    expect(result.applied).toEqual(['GITHUB_TOKEN']);
  });

  it('A1.20 the redacted paths name the location, not the value', () => {
    const redactor = redactorFor({ policyRef: 'redaction.test', secrets: ['s3cret'] });
    const result = redactor({ args: { token: 's3cret' } });
    expect(result.applied).toEqual(['args.token']);
    // The path must not contain the secret.
    expect(result.applied.join(' ')).not.toContain('s3cret');
  });

  it('A1.20 a clean payload records nothing', () => {
    const redactor = redactorFor({ policyRef: 'redaction.test' });
    const result = redactor({ source: 'manual', repo: 'org/repo' });
    expect(result.applied).toEqual([]);
    expect(result.value).toEqual({ source: 'manual', repo: 'org/repo' });
  });

  it('A1.20 the defaults name the pack’s stems and env names', () => {
    // pack 02 §4.11(2): "high-entropy strings near `key|token|secret|password`".
    expect(DEFAULT_SENSITIVE_KEYS).toContain('key');
    expect(DEFAULT_SENSITIVE_KEYS).toContain('token');
    expect(DEFAULT_SENSITIVE_KEYS).toContain('secret');
    expect(DEFAULT_SENSITIVE_KEYS).toContain('password');
    expect(DEFAULT_DENIED_ENV_NAMES).toContain('GITHUB_TOKEN');
  });
});

describe('T-1.03 · the aggregate registry', () => {
  it('A1.15 a node aggregate id carries its task', () => {
    expect(nodeAggregateId('tsk_1', 'n1-implement')).toBe('tsk_1/n1-implement');
    expect(decodeNodeAggregateId('tsk_1/n1-implement')).toEqual(['tsk_1', 'n1-implement']);
  });

  it('A1.15 a malformed node aggregate id is refused', () => {
    expect(() => decodeNodeAggregateId('no-separator')).toThrow(/task_id/);
  });
});
