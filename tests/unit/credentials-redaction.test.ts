/**
 * T-1.09 — the **redaction set**.
 *
 * pack 02 §4.11 names the pipeline:
 *
 * 1. **exact-match** scrub of the task's minted secrets;
 * 2. **pattern** scrub (token formats, private keys, JWTs, high-entropy
 *    strings near `key|token|secret|password`);
 * 3. **deny-listed** env names.
 *
 * pack 02 §4.6: *"adds the token string to the task's redaction set
 * (exact-match scrubbing in artefacts, events, logs)."*
 *
 * ## What these tests hold
 *
 * * every layer fires, and fires on the shape it is named for;
 * * the layers run in order — an exact match is not re-examined by the
 *   pattern rules;
> * what was redacted is **reported** (rule + digest), so an auditor can
 *   tell a clean artefact from a scrubbed one;
 * * the report never carries the **value**;
> * a bare high-entropy string is **not** redacted — a git SHA or a ULID
 *   is not a credential, and redacting those would destroy the artefact.
 */

import { describe, expect, it } from 'vitest';

import {
  REDACTION_PLACEHOLDER,
  RedactionRegistry,
  SECRET_WORDS,
} from '../../packages/credentials/src/index.ts';

describe('T-1.09 — the redaction set', () => {
  describe('the exact-match layer', () => {
    it('removes a minted token', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('ghs_exactmintedvalue0001');

      const result = registry.scrub(
        'the token is ghs_exactmintedvalue0001 here',
      );

      expect(result.value).toBe(
        `the token is ${REDACTION_PLACEHOLDER} here`,
      );
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]?.rule).toBe('exact.minted');
    });

    it('removes a token that appears SEVERAL times', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('ghs_repeated0001');

      const result = registry.scrub('a ghs_repeated0001 b ghs_repeated0001');

      expect(result.value).not.toContain('ghs_repeated0001');
      expect(result.value).toBe(
        `a ${REDACTION_PLACEHOLDER} b ${REDACTION_PLACEHOLDER}`,
      );
    });

    it('removes a control-plane secret', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addControlPlane('the-webhook-secret-value');

      const result = registry.scrub('webhook secret: the-webhook-secret-value');

      expect(result.value).not.toContain('the-webhook-secret-value');
      expect(result.applied[0]?.rule).toBe('exact.control-plane');
    });

    it('refuses an EMPTY needle', () => {
      // An empty needle would match at every position and turn the
      // scrub into a no-op that reports a redaction everywhere.
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('');

      const result = registry.scrub('some text');

      expect(result.value).toBe('some text');
      expect(result.applied).toEqual([]);
      expect(registry.size).toBe(0);
    });

    it('leaves text it does not know alone', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('ghs_exactmintedvalue0001');

      const result = registry.scrub('nothing secret here');

      expect(result.value).toBe('nothing secret here');
      expect(result.applied).toEqual([]);
    });
  });

  describe('the pattern layer', () => {
    it('removes a GitHub token it never minted', () => {
      // A **foreign** token — one from another task, or one a human
      // pasted into a comment — is not known in advance. Its *shape* is.
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrub(
        'the token is ghp_abcdefghijklmnopqrstuvwxyz0123',
      );

      expect(result.value).not.toContain('ghp_');
      expect(result.applied[0]?.rule).toBe('pattern.token');
    });

    it('removes the newer github_pat form', () => {
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrub(
        'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
      );

      expect(result.value).not.toContain('github_pat_');
      expect(result.applied[0]?.rule).toBe('pattern.token');
    });

    it('removes a PRIVATE KEY block', () => {
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrub(
        [
          '-----BEGIN RSA PRIVATE KEY-----',
          'MIIEowIBAAKCAQEA',
          '-----END RSA PRIVATE KEY-----',
        ].join('\n'),
      );

      expect(result.value).not.toContain('BEGIN RSA PRIVATE KEY');
      expect(result.applied[0]?.rule).toBe('pattern.private-key');
    });

    it('removes a JWT', () => {
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrub(
        'auth: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
      );

      expect(result.value).not.toContain('eyJ');
      expect(result.applied[0]?.rule).toBe('pattern.jwt');
    });

    it('removes a high-entropy string next to a secret word', () => {
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrub(
        'token="Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg"',
      );

      expect(result.value).not.toContain('Zm9vYmFy');
      expect(result.applied[0]?.rule).toBe('pattern.high-entropy');
    });

    it('LEAVES a bare high-entropy string alone', () => {
      // A git SHA, a content digest or a ULID is not a credential, and
      // redacting those would destroy the artefact.
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrub(
        'commit 4f9a2b1c8d3e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f',
      );

      expect(result.value).toContain('4f9a2b1c8d3e');
      expect(result.applied).toEqual([]);
    });

    it('names the secret words it looks for', () => {
      expect(SECRET_WORDS).toContain('token');
      expect(SECRET_WORDS).toContain('secret');
      expect(SECRET_WORDS).toContain('password');
    });
  });

  describe('the deny-listed env names', () => {
    it('removes a deny-listed NAME', () => {
      // The name alone tells a reader that a secret of that kind was
      // present here, which is itself a leak.
      const registry = new RedactionRegistry('task_1');
      registry.addDeniedEnvName('GITHUB_APP_PRIVATE_KEY');

      const result = registry.scrub(
        'GITHUB_APP_PRIVATE_KEY was set for this run',
      );

      expect(result.value).not.toContain('GITHUB_APP_PRIVATE_KEY');
      expect(result.applied[0]?.rule).toBe('deny.env-name');
    });

    it('lists the deny-listed names', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addDeniedEnvName('SESSION_SECRET');
      registry.addDeniedEnvName('GITHUB_WEBHOOK_SECRET');

      expect(registry.deniedEnvNames()).toEqual([
        'GITHUB_WEBHOOK_SECRET',
        'SESSION_SECRET',
      ]);
      expect(registry.deniesEnvName('SESSION_SECRET')).toBe(true);
      expect(registry.deniesEnvName('NOT_DENIED')).toBe(false);
    });
  });

  describe('the report', () => {
    it('reports a DIGEST and never the value', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('ghs_reportneverleak0001');

      const result = registry.scrub('ghs_reportneverleak0001');

      expect(result.applied[0]?.digest).not.toContain(
        'ghs_reportneverleak0001',
      );
      expect(result.applied[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('gives the same digest for the same value', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('ghs_samedigest00001');

      const first = registry.scrub('ghs_samedigest00001');
      const second = registry.scrub('ghs_samedigest00001');

      expect(first.applied[0]?.digest).toBe(second.applied[0]?.digest);
    });

    it('reports EVERY layer it applied', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('ghs_minted0001');
      registry.addDeniedEnvName('SESSION_SECRET');

      const result = registry.scrub(
        'ghs_minted0001 ghp_abcdefghijklmnopqrstuvwxyz0123 SESSION_SECRET',
      );

      const rules = result.applied.map((entry) => entry.rule);
      expect(rules).toContain('exact.minted');
      expect(rules).toContain('pattern.token');
      expect(rules).toContain('deny.env-name');
    });
  });

  describe('the JSON scrub', () => {
    it('scrubs a nested structure', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('ghs_nested00000001');

      const result = registry.scrubJson({
        step: {
          args: {
            token: 'ghs_nested00000001',
            note: 'nothing here',
          },
        },
        steps: ['ghs_nested00000001', 'plain'],
      });

      const serialised = JSON.stringify(result.value);
      expect(serialised).not.toContain('ghs_nested00000001');
      expect(serialised).toContain(REDACTION_PLACEHOLDER);
      expect(result.applied.length).toBeGreaterThan(0);
    });

    it('leaves a structure with nothing secret untouched', () => {
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrubJson({ a: 1, b: ['two', 'three'] });

      expect(result.value).toEqual({ a: 1, b: ['two', 'three'] });
      expect(result.applied).toEqual([]);
    });

    it('leaves the non-string leaves alone', () => {
      const registry = new RedactionRegistry('task_1');

      const result = registry.scrubJson({ n: 42, b: true, z: null });

      expect(result.value).toEqual({ n: 42, b: true, z: null });
    });
  });

  describe('the per-task set', () => {
    it('is scoped to its task', () => {
      const one = new RedactionRegistry('task_1');
      const two = new RedactionRegistry('task_2');

      one.addMinted('ghs_taskone000000001');

      // Task 2's set does not know task 1's token — but the pattern
      // layer still catches it, because the *shape* is known.
      const result = two.scrub('ghs_taskone000000001');

      expect(result.value).not.toContain('ghs_taskone000000001');
      expect(result.applied[0]?.rule).toBe('pattern.token');
    });

    it('counts the exact strings it holds', () => {
      const registry = new RedactionRegistry('task_1');
      registry.addMinted('a');
      registry.addControlPlane('b');

      expect(registry.size).toBe(2);
    });
  });
});
