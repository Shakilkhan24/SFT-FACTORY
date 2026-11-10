/**
 * T-1.10 — the startup models check (ADR-0023).
 *
 * pack 02 §4.7: *"**Startup check:** call the provider's models list and
 * refuse routes naming unknown models `[VERIFY]`."*
 *
 * ADR-0023: *"The gateway **refuses unknown models**. It does not fall
 * back to a default."* And: *"a configuration file naming a model the
 * gateway does not know must fail closed, not silently fall back."*
 *
 * ## What these tests hold
 *
 * 1. **An unknown model is refused** — the request fails and the
 *    provider is never called.
 * 2. **The refusal does NOT fall over.** A default model is not a
 *    fallback; ADR-0023 forbids it.
 * 3. **The refusal names the model and the provider.**
 * 4. **A provider whose catalogue cannot be read fails CLOSED** — its
 *    models are unavailable, not "assumed present".
 * 5. **A placeholder is a distinct kind of gap** — *unconfigured*,
 *    not *unknown*.
 * 6. **The startup check reports every gap at once.**
 * 7. **A known model is not refused.**
 */

import { describe, expect, it } from 'vitest';

import {
  checkModel,
  checkPolicyModels,
  isPlaceholder,
  readCatalog,
  type CatalogState,
} from '../../packages/gateway/src/index.ts';

import { aRequest, buildGateway, THE_POLICY } from '../helpers/gateway.ts';

describe('T-1.10 — the startup models check (ADR-0023)', () => {
  describe('the catalogue', () => {
    it('is READ from the provider’s own models list', async () => {
      const { alpha } = buildGateway();

      const catalog = await readCatalog(alpha);

      expect(catalog.kind).toBe('known');
      expect(catalog.kind === 'known' && catalog.models).toContain(
        'test-model-small',
      );
    });

    it('is UNAVAILABLE when the provider cannot list its models', async () => {
      // A provider whose list is unreachable is not a provider whose
      // list is empty. The two must not collapse into one.
      const { gateway, alpha } = buildGateway();
      alpha.failModelsWith(new Error('the models endpoint is down'));

      const catalog = await readCatalog(alpha);

      expect(catalog.kind).toBe('unavailable');
      expect(catalog.kind === 'unavailable' && catalog.reason).toContain(
        'the models endpoint is down',
      );
      // The gateway is untouched by the failure — the catalogue is a
      // read, not a call.
      expect(alpha.callCount).toBe(0);
      expect(gateway).toBeDefined();
    });
  });

  describe('checking one model', () => {
    const known: CatalogState = { kind: 'known', models: ['a-model'] };

    it('PASSES a model the provider offers', () => {
      expect(checkModel('a-provider', 'a-model', known).ok).toBe(true);
    });

    it('REFUSES a model the provider does not offer', () => {
      const check = checkModel('a-provider', 'another-model', known);

      expect(check.ok).toBe(false);
      expect(check.ok === false && check.kind).toBe('unknown');
    });

    it('REFUSES every model when the catalogue is UNAVAILABLE', () => {
      // Fail **closed**: "the list was unreachable" is not "the model
      // is fine".
      const check = checkModel('a-provider', 'a-model', {
        kind: 'unavailable',
        reason: 'the models endpoint is down',
      });

      expect(check.ok).toBe(false);
      expect(check.ok === false && check.kind).toBe('unavailable');
    });

    it('reports a PLACEHOLDER as unconfigured, not unknown', () => {
      // The corpus's own routing policy carries "<configured>" for a
      // model the operator has not named. That is a different problem
      // from a typo, and the operator's first act is different.
      const check = checkModel('a-provider', '<configured>', known);

      expect(check.ok).toBe(false);
      expect(check.ok === false && check.kind).toBe('unconfigured');
    });

    it('reports a PLACEHOLDER even when the catalogue is unavailable', () => {
      const check = checkModel('a-provider', '<configured>', {
        kind: 'unavailable',
        reason: 'down',
      });

      expect(check.ok === false && check.kind).toBe('unconfigured');
    });

    it('knows a placeholder by its brackets', () => {
      expect(isPlaceholder('<configured>')).toBe(true);
      expect(isPlaceholder('a-real-model')).toBe(false);
    });
  });

  describe('an unknown model', () => {
    it('is REFUSED', async () => {
      const { gateway } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe(
        'model.capability',
      );
    });

    it('is refused BEFORE the provider is called', async () => {
      const { gateway, alpha, beta } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      await gateway.complete(aRequest());

      expect(alpha.callCount).toBe(0);
      expect(beta.callCount).toBe(0);
    });

    it('does NOT fall over to the fallback', async () => {
      // ADR-0023: "It does not fall back to a default." A fallback is
      // not a default — but the point is that the request is refused
      // rather than routed to a model the operator did not choose for
      // this route.
      const { gateway, beta } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(beta.callCount).toBe(0);
    });

    it('names the model and the provider', async () => {
      const { gateway } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok === false && result.error.message).toContain(
        'test-model-small',
      );
      expect(result.ok === false && result.error.message).toContain('alpha');
    });

    it('carries the kind of gap in the error detail', async () => {
      const { gateway } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok === false && result.error.detail?.['kind']).toBe(
        'unknown',
      );
    });

    it('emits NO model.failedOver event', async () => {
      const { gateway, events } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      await gateway.complete(aRequest());

      expect(
        events.filter((event) => event.eventType === 'model.failedOver'),
      ).toHaveLength(0);
    });

    it('records NO model call', async () => {
      const { gateway, calls } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      await gateway.complete(aRequest());

      expect(calls.records).toHaveLength(0);
    });
  });

  describe('a provider whose catalogue cannot be read', () => {
    it('fails CLOSED — the model is unavailable', async () => {
      const { gateway, alpha } = buildGateway();

      // The provider's models list fails, but the provider can still
      // answer. The gateway must not treat "the list was unreachable"
      // as "the model is fine".
      alpha.failModelsWith(new Error('the models endpoint is down'));

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.detail?.['kind']).toBe(
        'unavailable',
      );
    });
  });

  describe('a known model', () => {
    it('is NOT refused', async () => {
      const { gateway, alpha } = buildGateway();

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(true);
      expect(alpha.callCount).toBe(1);
    });
  });

  describe('the startup check', () => {
    it('reports NO problem for a usable policy', async () => {
      const { gateway } = buildGateway();

      const problems = await gateway.startupCheck();

      expect(problems).toHaveLength(0);
    });

    it('reports EVERY gap at once', async () => {
      // An operator needs the whole list, not the first problem.
      const { gateway } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      const problems = await gateway.startupCheck();

      expect(problems.length).toBeGreaterThan(0);
      expect(
        problems.every((problem) => problem.ok === false),
      ).toBe(true);
    });

    it('reports a model the provider does not offer as UNKNOWN', async () => {
      const { gateway } = buildGateway({
        alpha: { models: ['a-different-model'] },
      });

      const problems = await gateway.startupCheck();

      expect(
        problems.some(
          (problem) => problem.ok === false && problem.kind === 'unknown',
        ),
      ).toBe(true);
    });

    it('reports a provider that cannot be listed as UNAVAILABLE', async () => {
      const { gateway, alpha } = buildGateway();
      alpha.failModelsWith(new Error('the models endpoint is down'));

      const problems = await gateway.startupCheck();

      expect(
        problems.some(
          (problem) =>
            problem.ok === false && problem.kind === 'unavailable',
        ),
      ).toBe(true);
    });
  });

  describe('checking the whole policy', () => {
    it('reports a gap in a FALLBACK too', () => {
      // A fallback naming a model the provider does not offer is a
      // gap: the failover would have nowhere to go.
      const catalogs: Record<string, CatalogState> = {
        alpha: { kind: 'known', models: ['test-model-small'] },
        beta: { kind: 'known', models: ['not-the-fallback-model'] },
      };

      const problems = checkPolicyModels(THE_POLICY, catalogs);

      expect(
        problems.some(
          (problem) =>
            problem.ok === false &&
            problem.provider === 'beta' &&
            problem.kind === 'unknown',
        ),
      ).toBe(true);
    });

    it('reports NO problem when every model is known', () => {
      const catalogs: Record<string, CatalogState> = {
        alpha: {
          kind: 'known',
          models: ['test-model-small', 'test-model-large'],
        },
        beta: {
          kind: 'known',
          models: ['test-model-small', 'test-model-large'],
        },
      };

      expect(checkPolicyModels(THE_POLICY, catalogs)).toHaveLength(0);
    });
  });
});
