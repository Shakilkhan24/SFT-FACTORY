/**
 * T-1.10 — the failover (**INV-9**).
 *
 * INV-9: *"Fake provider A errors ⇒ routed to B with `model.failedOver`;
 * lint proves no provider SDK/type imported outside `gateway/providers/*`
 * and no model-id string outside config."*
 *
 * blueprint 11 §9.6:
 *
 * | Trigger | Meaning | Action |
 * |---|---|---|
 * | `provider-error` | Transport or provider failure. | Try the next fallback. |
 * | `rate-limited` | Provider throttling. | Back off and retry; then fall back. |
 * | `schema-invalid-twice` | Repeated schema failure. | Try the next fallback. |
 *
 * *"Failover records the reason in the event log (`model.failedOver`)."*
 *
 * ## What these tests hold
 *
 * 1. **A failing primary routes to the fallback**, and the fallback's
 *    answer is what the caller gets.
 * 2. **A `model.failedOver` event is emitted**, with the from, the to
 *    and the trigger.
 * 3. **The trigger the policy does not list does NOT fail over.**
 * 4. **A trigger the policy lists in `neverOn` does NOT fail over.**
 * 5. **With no fallback left, the failure is the request's** — a
 *    `model.failed` event and the error.
 * 6. **`fallbackUsed` is true** when the answer came from a fallback.
 */

import { describe, expect, it } from 'vitest';

import type { RoutingPolicy } from '../../packages/contracts/src/index.ts';

import { aRequest, buildGateway, THE_POLICY } from '../helpers/gateway.ts';

describe('T-1.10 — the failover (INV-9)', () => {
  it('routes to the FALLBACK when the primary errors', async () => {
    const { gateway, alpha, beta } = buildGateway({
      alpha: { error: new Error('the provider is down') },
    });

    const result = await gateway.complete(aRequest());

    expect(result.ok).toBe(true);
    expect(alpha.callCount).toBe(1);
    expect(beta.callCount).toBe(1);
  });

  it('emits a model.failedOver event', async () => {
    const { gateway, events } = buildGateway({
      alpha: { error: new Error('the provider is down') },
    });

    await gateway.complete(aRequest());

    const failedOver = events.filter(
      (event) => event.eventType === 'model.failedOver',
    );
    expect(failedOver).toHaveLength(1);
  });

  it('the model.failedOver event carries the REGISTERED payload shape', async () => {
    // pack 03 §5: `model.failedOver {from, to, trigger}`.
    const { gateway, events } = buildGateway({
      alpha: { error: new Error('the provider is down') },
    });

    await gateway.complete(aRequest());

    const event = events.find(
      (candidate) => candidate.eventType === 'model.failedOver',
    );

    expect(event?.payload['from']).toContain('alpha');
    expect(event?.payload['to']).toContain('beta');
    expect(event?.payload['trigger']).toBe('provider-error');
  });

  it('marks the routing decision as having USED a fallback', async () => {
    const { gateway } = buildGateway({
      alpha: { error: new Error('the provider is down') },
    });

    const result = await gateway.complete(aRequest());

    expect(result.ok && result.value.routingDecision.fallbackUsed).toBe(true);
  });

  it('does NOT mark a fallback when the primary answered', async () => {
    const { gateway } = buildGateway();

    const result = await gateway.complete(aRequest());

    expect(result.ok && result.value.routingDecision.fallbackUsed).toBe(false);
  });

  it('names the fallback provider in the response', async () => {
    const { gateway } = buildGateway({
      alpha: { error: new Error('the provider is down') },
    });

    const result = await gateway.complete(aRequest());

    expect(result.ok && result.value.provider).toBe('beta');
  });

  it('records the call against the provider that ANSWERED', async () => {
    const { gateway, calls } = buildGateway({
      alpha: { error: new Error('the provider is down') },
    });

    await gateway.complete(aRequest());

    expect(calls.records).toHaveLength(1);
    expect(calls.records[0]?.provider).toBe('beta');
  });

  describe('a trigger the policy does not list', () => {
    it('does NOT fail over', async () => {
      const policy: RoutingPolicy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          failover: { on: [], neverOn: ['budget-exhausted'] },
        },
      };

      const { gateway, alpha, beta } = buildGateway({
        policy,
        alpha: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(alpha.callCount).toBe(1);
      expect(beta.callCount).toBe(0);
    });
  });

  describe('a trigger the policy lists in neverOn', () => {
    it('does NOT fail over', async () => {
      // The policy lists `provider-error` in **both** `on` and
      // `neverOn`. The `neverOn` wins — the trigger is declared as one
      // that must never fail over, whatever else the policy says.
      const policy: RoutingPolicy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          failover: {
            on: ['provider-error'],
            neverOn: ['provider-error'],
          },
        },
      };

      const { gateway, beta } = buildGateway({
        policy,
        alpha: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(beta.callCount).toBe(0);
    });

    it('the neverOn list WINS over the on list', async () => {
      // The corpus's own example is `neverOn: [budget-exhausted]` — a
      // trigger the policy also lists in `on`. The refusal of the
      // failover is what the corpus means.
      const policy: RoutingPolicy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          failover: {
            on: ['provider-error', 'budget-exhausted'],
            neverOn: ['budget-exhausted'],
          },
        },
      };

      const { gateway, beta } = buildGateway({
        policy,
        alpha: { error: new Error('the provider is down') },
      });

      await gateway.complete(aRequest());

      // `provider-error` is still allowed to fail over.
      expect(beta.callCount).toBe(1);
    });
  });

  describe('with no fallback left', () => {
    it('the failure is the REQUEST’s', async () => {
      const policy: RoutingPolicy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          classes: {
            cheap: {
              primary: { provider: 'alpha', model: 'test-model-small' },
              fallbacks: [],
            },
          },
          rules: [{ match: { role: 'worker' }, use: 'cheap' }],
        },
      };

      const { gateway, alpha } = buildGateway({
        policy,
        alpha: { error: new Error('the provider is down') },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.message).toContain(
        'the provider is down',
      );
      expect(alpha.callCount).toBe(1);
    });

    it('emits a model.failed event', async () => {
      const policy: RoutingPolicy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          classes: {
            cheap: {
              primary: { provider: 'alpha', model: 'test-model-small' },
              fallbacks: [],
            },
          },
          rules: [{ match: { role: 'worker' }, use: 'cheap' }],
        },
      };

      const { gateway, events } = buildGateway({
        policy,
        alpha: { error: new Error('the provider is down') },
      });

      await gateway.complete(aRequest());

      const failed = events.filter((event) => event.eventType === 'model.failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload['provider']).toBe('alpha');
      expect(failed[0]?.payload['trigger']).toBe('provider-error');
    });

    it('emits NO model.failedOver when there was nowhere to go', async () => {
      const policy: RoutingPolicy = {
        ...THE_POLICY,
        spec: {
          ...THE_POLICY.spec,
          classes: {
            cheap: {
              primary: { provider: 'alpha', model: 'test-model-small' },
              fallbacks: [],
            },
          },
          rules: [{ match: { role: 'worker' }, use: 'cheap' }],
        },
      };

      const { gateway, events } = buildGateway({
        policy,
        alpha: { error: new Error('the provider is down') },
      });

      await gateway.complete(aRequest());

      expect(
        events.filter((event) => event.eventType === 'model.failedOver'),
      ).toHaveLength(0);
    });
  });

  describe('the rate-limited trigger', () => {
    it('is distinguished from a plain provider error', async () => {
      const { gateway, events } = buildGateway({
        alpha: { error: new Error('rate limit exceeded, slow down') },
      });

      await gateway.complete(aRequest());

      const event = events.find(
        (candidate) => candidate.eventType === 'model.failedOver',
      );

      expect(event?.payload['trigger']).toBe('rate-limited');
    });
  });

  describe('the bounded retry', () => {
    it('retries a RETRIABLE failure within the bound', async () => {
      // A rate-limited failure is retriable — blueprint 11 §9.6:
      // "Back off and retry; then fall back."
      const { gateway, alpha } = buildGateway({
        alpha: { error: new Error('rate limit exceeded') },
      });

      await gateway.complete(aRequest());

      // The bound is two attempts, so the primary is asked twice before
      // the gateway falls back.
      expect(alpha.callCount).toBe(2);
    });

    it('does NOT retry a failure that is not retriable', async () => {
      const { gateway, alpha } = buildGateway({
        alpha: { error: new Error('the provider is down') },
      });

      await gateway.complete(aRequest());

      expect(alpha.callCount).toBe(1);
    });
  });
});
