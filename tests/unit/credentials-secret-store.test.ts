/**
 * T-1.09 — the **secret store**.
 *
 * pack 04 §10: *"Secrets are loaded once via `SecretStore`, never
 * logged, never stored in DB/events/artefacts, and **never present in
 * any T2 container environment**."*
 *
 * ## What these tests hold
 *
 * 1. **Loading is once and permissive.** A secret that is not set is
 *    simply absent; a process does not hold every secret in the
 *    inventory.
 * 2. **Use is strict.** `get` throws for a secret this process does not
 *    hold — a silent `undefined` would let a caller proceed with an
 *    empty credential.
 * 3. **The values are unreachable by enumeration.** `names()` returns the
 *    keys and never the values, and the store offers no `toString`, no
 *    `toJSON` and no `inspect`.
 * 4. **The inventory distinguishes a secret from a configuration
 *    value.** `GITHUB_APP_ID` is not a secret; `GITHUB_APP_PRIVATE_KEY`
 *    is, and only the second may not be printed.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalNameOf,
  loadSecretStore,
  MissingSecretError,
  readSecret,
  SECRET_INVENTORY,
  secretStoreFromEnvironment,
  secretStoreOf,
} from '../../packages/credentials/src/index.ts';

describe('T-1.09 — the secret store', () => {
  describe('the inventory', () => {
    it('names the pack’s secrets', () => {
      const envVars = SECRET_INVENTORY.map((descriptor) => descriptor.envVar);

      expect(envVars).toContain('GITHUB_APP_PRIVATE_KEY');
      expect(envVars).toContain('GITHUB_WEBHOOK_SECRET');
      expect(envVars).toContain('ANTHROPIC_API_KEY');
      expect(envVars).toContain('SESSION_SECRET');
      expect(envVars).toContain('DATABASE_URL_APP');
    });

    it('marks the SECRET material as secret', () => {
      const secret = SECRET_INVENTORY.find(
        (descriptor) => descriptor.envVar === 'GITHUB_APP_PRIVATE_KEY',
      );
      expect(secret?.secret).toBe(true);

      // A non-secret configuration value is printable.
      const notSecret = SECRET_INVENTORY.find(
        (descriptor) => descriptor.envVar === 'GITHUB_APP_ID',
      );
      expect(notSecret?.secret).toBe(false);
    });

    it('gives every descriptor a holder and a rotation note', () => {
      for (const descriptor of SECRET_INVENTORY) {
        expect(descriptor.holder.length).toBeGreaterThan(0);
        expect(descriptor.rotation.length).toBeGreaterThan(0);
      }
    });
  });

  describe('the store', () => {
    it('reads a secret it holds', () => {
      const store = secretStoreOf({ GITHUB_APP_ID: '12345' });

      expect(store.get('GITHUB_APP_ID')).toBe('12345');
      expect(store.has('GITHUB_APP_ID')).toBe(true);
    });

    it('THROWS for a secret it does not hold', () => {
      const store = secretStoreOf({});

      expect(() => store.get('ANTHROPIC_API_KEY')).toThrow(MissingSecretError);
    });

    it('names the missing secret — and only the name', () => {
      const store = secretStoreOf({});

      try {
        store.get('ANTHROPIC_API_KEY');
        expect.unreachable('the store should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MissingSecretError);
        expect((error as MissingSecretError).secretName).toBe(
          'ANTHROPIC_API_KEY',
        );
        // The message names the secret; a secret's *value* does not
        // exist, so there is nothing to leak.
        expect((error as Error).message).toContain('ANTHROPIC_API_KEY');
      }
    });

    it('reports absence with `has` rather than by throwing', () => {
      const store = secretStoreOf({ GITHUB_APP_ID: '12345' });

      expect(store.has('GITHUB_APP_ID')).toBe(true);
      expect(store.has('ANTHROPIC_API_KEY')).toBe(false);
    });

    it('copies the map on the way in', () => {
      const values: Record<string, string> = { GITHUB_APP_ID: '12345' };
      const store = secretStoreOf(values);

      // The caller mutates its own object after the store was built.
      values['GITHUB_APP_ID'] = 'MUTATED';

      expect(store.get('GITHUB_APP_ID')).toBe('12345');
    });

    it('does NOT see a secret ADDED to the caller’s object afterwards', () => {
      const values: Record<string, string> = {};
      const store = secretStoreOf(values);

      values['ANTHROPIC_API_KEY'] = 'sk-ant-added-later';

      // The store is a snapshot, not a view.
      expect(store.has('ANTHROPIC_API_KEY')).toBe(false);
      expect(store.names()).toEqual([]);
    });

    it('enumerates the NAMES and never the values', () => {
      const store = secretStoreOf({
        GITHUB_APP_ID: '12345',
        ANTHROPIC_API_KEY: 'sk-ant-value',
      });

      expect(store.names()).toEqual(['ANTHROPIC_API_KEY', 'GITHUB_APP_ID']);
      // The values are not reachable through the enumeration.
      expect(JSON.stringify(store.names())).not.toContain('sk-ant-value');
    });

    it('offers no way to serialise the values', () => {
      const store = secretStoreOf({ ANTHROPIC_API_KEY: 'sk-ant-value' });

      // A `JSON.stringify` of the store must not carry the material —
      // this is the path a secret store takes into a log line through a
      // `JSON.stringify` of some larger structure.
      expect(JSON.stringify(store)).not.toContain('sk-ant-value');

      // The store has no `toString`, so its string form is the default
      // one — and the default one carries no value either.
      const asText: string = Object.prototype.toString.call(store);
      expect(asText).not.toContain('sk-ant-value');
    });

    it('knows whether a name is a secret', () => {
      const store = secretStoreOf({
        GITHUB_APP_ID: '12345',
        GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
      });

      expect(store.isSecret('GITHUB_APP_PRIVATE_KEY')).toBe(true);
      expect(store.isSecret('GITHUB_APP_ID')).toBe(false);
      // A name outside the inventory is not secret.
      expect(store.isSecret('SOMETHING_ELSE')).toBe(false);
    });
  });

  describe('the environment loader', () => {
    it('loads only the secrets that are PRESENT', () => {
      const store = secretStoreFromEnvironment({
        GITHUB_APP_ID: '12345',
        ANTHROPIC_API_KEY: '',
      });

      expect(store.has('GITHUB_APP_ID')).toBe(true);
      // An empty value is not a value.
      expect(store.has('ANTHROPIC_API_KEY')).toBe(false);
    });

    it('registers a secret under its ENV VAR and its CANONICAL name', () => {
      const store = secretStoreFromEnvironment({
        GITHUB_APP_PRIVATE_KEY: 'key-material',
      });

      expect(store.get('GITHUB_APP_PRIVATE_KEY')).toBe('key-material');
      expect(store.get('github.app.private.key')).toBe('key-material');
    });

    it('computes the canonical name by lowering and dotting', () => {
      expect(canonicalNameOf('GITHUB_APP_ID')).toBe('github.app.id');
      expect(canonicalNameOf('ANTHROPIC_API_KEY')).toBe('anthropic.api.key');
      expect(canonicalNameOf('DATABASE_URL_APP')).toBe('database.url.app');
    });

    it('loads nothing when the environment is empty', () => {
      const store = secretStoreFromEnvironment({});

      expect(store.names()).toEqual([]);
    });
  });

  describe('the loader’s result', () => {
    it('reports success even when secrets are absent', () => {
      // Which secrets a process must hold is a per-component fact
      // (pack 04 §10's `holder` column). Enforcing it here would need
      // that per-component list, which this ticket does not build.
      const result = loadSecretStore({});

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.names()).toEqual([]);
    });
  });

  describe('reading a secret', () => {
    it('returns the value', () => {
      const store = secretStoreOf({ GITHUB_APP_ID: '12345' });

      const result = readSecret(store, 'GITHUB_APP_ID');

      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toBe('12345');
    });

    it('returns an environment.failure for a missing secret', () => {
      const store = secretStoreOf({});

      const result = readSecret(store, 'ANTHROPIC_API_KEY');

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe(
        'environment.failure',
      );
    });

    it('does not leak the value into the failure detail', () => {
      const store = secretStoreOf({ ANTHROPIC_API_KEY: 'sk-ant-value' });

      const result = readSecret(store, 'MISSING_SECRET');

      expect(result.ok).toBe(false);
      expect(result.ok === false && JSON.stringify(result.error)).not.toContain(
        'sk-ant-value',
      );
    });
  });
});
