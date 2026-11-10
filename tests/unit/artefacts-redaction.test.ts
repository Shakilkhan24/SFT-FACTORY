/**
 * **Redaction at capture**.
 *
 * blueprint 15 §2.4: "Redacted at capture | Secrets are redacted **at
 * capture time**, not at query time. A stored artefact never held secret
 * material."
 *
 * The rule is about the **stored bytes**, not about what a reader sees.
 * So the test's subject is the record *as written* — the thing that goes
 * into the object store — and not a masked view of it.
 *
 * pack 02 §4.11 names the three layers:
 *
 * 1. exact-match scrub of the task's minted secrets;
 * 2. pattern scrub (token formats, private keys, JWTs, high-entropy
 *    strings near `key|token|secret|password`);
 * 3. deny-listed env names.
 *
 * And blueprint 15 §2.5: "The redaction is itself recorded —
 * `redaction.applied` and `redaction.policyRef` — so a reader knows that
 * something was removed rather than assuming it was never there."
 */

import { describe, expect, it } from 'vitest';

import { RedactionRegistry } from '../../packages/credentials/src/index.ts';

import {
  STRUCTURAL_RULE,
  capturePolicy,
  emptyReceipt,
  redactAtCapture,
} from '../../packages/artefacts/src/index.ts';

import { THE_PARTS, THE_SEEDED_SECRET, registryWith } from '../helpers/artefacts.ts';

/**
 * A GitHub token — caught by the pattern layer, not by exact match.
 */
const THE_TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

/**
 * A private key block — caught by the pattern layer.
 */
const THE_PRIVATE_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAx7Vv3Q8mN2pL5rT9wYbC1dF4gH6jK8lM0nP2qR4sU6vW8xY',
  'zA0bC1dE2fG3hI4jK5lM6nO7pQ8rS9tU0vW1xY2zA3bC4dE5fG6hI7jK8lM9',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

describe('redaction at capture', () => {
  it('removes a minted secret from the stored value', () => {
    // The seeded secret is deliberately NOT catchable by the pattern
    // layer, so this proves the **exact-match** layer ran.
    const registry = registryWith(THE_SEEDED_SECRET);
    const result = redactAtCapture(
      { prompt: `the token is ${THE_SEEDED_SECRET} and it must not survive` },
      registry,
    );

    expect(JSON.stringify(result.value)).not.toContain(THE_SEEDED_SECRET);
    expect(result.value).toEqual({
      prompt: 'the token is [REDACTED] and it must not survive',
    });
  });

  it('records what was redacted, without recording what', () => {
    // blueprint 15 §2.5: the redaction is recorded "so a reader knows that
    // something was removed rather than assuming it was never there."
    const registry = registryWith(THE_SEEDED_SECRET);
    const result = redactAtCapture({ prompt: THE_SEEDED_SECRET }, registry);

    expect(result.receipt.applied.length).toBe(1);
    expect(result.receipt.applied[0]?.rule).toBe('exact.minted');
    expect(result.receipt.applied[0]?.path).toBe('prompt');
    // The receipt must not carry the secret — a receipt that named it
    // would be a second copy of the secret beside the record it protects.
    expect(JSON.stringify(result.receipt)).not.toContain(THE_SEEDED_SECRET);
  });

  it('names the policy it ran under', () => {
    const registry = registryWith(THE_SEEDED_SECRET);
    const result = redactAtCapture({ prompt: 'nothing secret here' }, registry);
    expect(result.receipt.policyRef).toBe('redaction.v1');
  });

  it('catches a token pasted into a prompt, by the pattern layer', () => {
    // A prompt is a **string**. The structural redactor walks JSON, so it
    // would redact a prompt only if the prompt sat under a sensitive
    // *key*. The pattern layer is what catches this — and it is the reason
    // both pipelines are needed.
    const registry = new RedactionRegistry('tsk_test');
    const result = redactAtCapture(
      { prompts: [{ kind: 'prompt', role: 'user', text: `use ${THE_TOKEN} to push` }] },
      registry,
      capturePolicy(),
    );

    expect(JSON.stringify(result.value)).not.toContain(THE_TOKEN);
    expect(result.receipt.applied.some((r) => r.rule === 'pattern.token')).toBe(true);
  });

  it('catches a private key in free text, by the pattern layer', () => {
    const registry = new RedactionRegistry('tsk_test');
    const result = redactAtCapture({ note: THE_PRIVATE_KEY }, registry, capturePolicy());

    expect(JSON.stringify(result.value)).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(result.receipt.applied.some((r) => r.rule === 'pattern.private-key')).toBe(true);
  });

  it('catches a deny-listed env name, by the third layer', () => {
    // pack 02 §4.11(3): "deny-listed env names". The *name* is scrubbed
    // too — the name alone tells a reader that a secret of that kind was
    // present here.
    const registry = new RedactionRegistry('tsk_test');
    registry.addDeniedEnvName('GITHUB_APP_PRIVATE_KEY');
    const result = redactAtCapture(
      { note: 'GITHUB_APP_PRIVATE_KEY was set' },
      registry,
      capturePolicy(),
    );

    expect(JSON.stringify(result.value)).not.toContain('GITHUB_APP_PRIVATE_KEY');
    expect(result.receipt.applied.some((r) => r.rule === 'deny.env-name')).toBe(true);
  });

  it('replaces a sensitive key’s value wholesale, by the structural layer', () => {
    // The registry scrubs *strings*; it does not know that a member called
    // `authorization` is secret regardless of its value. The structural
    // pass does — and it reports the **path**.
    const registry = new RedactionRegistry('tsk_test');
    const result = redactAtCapture(
      { payload: { authorization: 'Bearer opaque-value', keep: 'visible' } },
      registry,
      capturePolicy(),
    );

    const value = result.value as { payload: { authorization: string; keep: string } };
    expect(value.payload.authorization).toBe('[REDACTED]');
    // The rest of the structure is untouched.
    expect(value.payload.keep).toBe('visible');
    expect(result.receipt.applied.some((r) => r.rule === STRUCTURAL_RULE)).toBe(true);
    expect(result.receipt.applied.some((r) => r.path === 'payload.authorization')).toBe(true);
  });

  it('scrubs a secret nested inside a structure', () => {
    const registry = registryWith(THE_SEEDED_SECRET);
    const result = redactAtCapture(
      { nodes: [{ toolCalls: [{ argumentsSummary: `token=${THE_SEEDED_SECRET}` }] }] },
      registry,
    );

    expect(JSON.stringify(result.value)).not.toContain(THE_SEEDED_SECRET);
  });

  it('reports each redaction at its own path, with its own rule', () => {
    // Two secrets, in two branches. The registry's report is a flat list
    // and the walk consumes it in order — so the receipt must name the
    // path each secret was found at, and the rule that caught it. A cursor
    // that restarted in every branch would report the *first* rule for
    // both.
    const first = 'first-secret-aaa';
    const second = 'second-secret-bbb';
    const registry = new RedactionRegistry('tsk_test');
    registry.addMinted(first);
    registry.addMinted(second);

    const result = redactAtCapture(
      { alpha: `holds ${first}`, beta: { gamma: `holds ${second}` } },
      registry,
      capturePolicy(),
    );

    expect(result.receipt.applied.length).toBe(2);
    expect(result.receipt.applied[0]?.path).toBe('alpha');
    expect(result.receipt.applied[1]?.path).toBe('beta.gamma');
    // Both were caught by the exact-match layer, and both digests differ
    // because they are digests of different values.
    expect(result.receipt.applied[0]?.rule).toBe('exact.minted');
    expect(result.receipt.applied[1]?.rule).toBe('exact.minted');
    expect(result.receipt.applied[0]?.digest).not.toBe(result.receipt.applied[1]?.digest);
  });

  it('records nothing when there was nothing to redact', () => {
    // An empty receipt is still a receipt — a reader can tell "nothing was
    // redacted" from "redaction was never attempted".
    const registry = new RedactionRegistry('tsk_test');
    const result = redactAtCapture({ note: 'nothing secret here' }, registry, capturePolicy());

    expect(result.receipt.applied).toEqual([]);
    expect(result.receipt.policyRef).toBe('redaction.v1');
  });

  it('writes an empty receipt when no redaction was attempted', () => {
    const receipt = emptyReceipt();
    expect(receipt.applied).toEqual([]);
    expect(receipt.policyRef).toBe('redaction.v1');
  });

  it('leaves a record with no secret untouched', () => {
    // The pass must not corrupt a clean record — a redaction that changes
    // what it did not need to change would make the hash unreproducible.
    const registry = new RedactionRegistry('tsk_test');
    const result = redactAtCapture(THE_PARTS.identity, registry, capturePolicy());
    expect(result.value).toEqual(THE_PARTS.identity);
  });
});
