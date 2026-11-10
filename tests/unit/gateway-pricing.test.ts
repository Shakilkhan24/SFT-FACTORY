/**
 * T-1.10 — the pricing table and the integer micro-USD cost.
 *
 * pack 04 §6: *"**Pricing** lives in `definition/pricing.yaml` (per-model
 * USD per million tokens, per token class) — **never hard-coded**; …
 * Costs are integer micro-USD."*
 *
 * ## The golden cost tests
 *
 * The ticket's oracle asks for **integer micro-USD golden cost tests**.
 *
 * "Golden" means the expected number is **written out**, not computed
 * by the same formula the code uses. A test that recomputes the cost
 * with the production arithmetic proves only that the arithmetic is
 * self-consistent; a golden number proves it is *right*.
 *
 * ## Why integer
 *
 * A float cost accumulates error, and the error lands on the **budget
 * check**: a request that costs 1499999.9999 micro-USD instead of
 * 1500000 either slips past a ceiling that should have stopped it, or
 * stops a request that should have been allowed. A budget check on a
 * float is a coin flip near the limit.
 */

import { describe, expect, it } from 'vitest';

import {
  costOfCall,
  costOfTokens,
  parsePricingTable,
  priceCall,
  projectCost,
  readPricingTable,
  readRoutingPolicy,
  type PriceEntry,
} from '../../packages/gateway/src/index.ts';

import { THE_PRICING } from '../helpers/gateway.ts';

const SMALL: PriceEntry = THE_PRICING['test-model-small'] as PriceEntry;

describe('T-1.10 — the pricing', () => {
  describe('the cost of a token count', () => {
    it('is the tokens times the price, per million', () => {
      // 1 000 000 tokens at 100 000 micro-USD per million is
      // 100 000 micro-USD exactly.
      expect(costOfTokens(1_000_000, 100_000)).toBe(100_000);
    });

    it('is a GOLDEN integer for a partial million', () => {
      // 500 000 tokens at 100 000 per million is 50 000 micro-USD.
      expect(costOfTokens(500_000, 100_000)).toBe(50_000);
    });

    it('rounds ONCE, at the end', () => {
      // 3 tokens at 100 000 per million is 0.3 micro-USD, which rounds
      // to 0. The alternative — rounding per token and summing — would
      // give a different answer for larger counts.
      expect(costOfTokens(3, 100_000)).toBe(0);
      // 7 tokens at 500 000 per million is 3.5 micro-USD → 4.
      expect(costOfTokens(7, 500_000)).toBe(4);
    });

    it('is an INTEGER for every count', () => {
      for (const tokens of [1, 3, 7, 13, 999, 100_001]) {
        const cost = costOfTokens(tokens, 333_333);
        expect(Number.isInteger(cost)).toBe(true);
      }
    });

    it('is ZERO for no tokens', () => {
      expect(costOfTokens(0, 100_000)).toBe(0);
    });

    it('REFUSES a negative token count', () => {
      expect(() => costOfTokens(-1, 100_000)).toThrow(RangeError);
    });

    it('REFUSES a negative price', () => {
      expect(() => costOfTokens(100, -1)).toThrow(RangeError);
    });
  });

  describe('the cost of a call', () => {
    it('sums the four token classes', () => {
      // 1000 in @ 100 000/M  = 100
      // 1000 out @ 500 000/M = 500
      // 1000 read @ 10 000/M = 10
      // 1000 write @ 125 000/M = 125
      const cost = costOfCall(
        { tokensIn: 1000, tokensOut: 1000, cacheRead: 1000, cacheWrite: 1000 },
        SMALL,
      );

      expect(cost).toBe(735);
    });

    it('charges the CACHE classes separately', () => {
      // A cache read is cheaper than an input token. If the classes
      // were collapsed, the cache would be charged at the input price
      // — which would overstate the cost of every cached call.
      const withCache = costOfCall(
        { tokensIn: 0, tokensOut: 0, cacheRead: 1_000_000, cacheWrite: 0 },
        SMALL,
      );
      const asInput = costOfCall(
        { tokensIn: 1_000_000, tokensOut: 0, cacheRead: 0, cacheWrite: 0 },
        SMALL,
      );

      expect(withCache).toBe(10_000);
      expect(asInput).toBe(100_000);
    });

    it('is ZERO for a call that used nothing', () => {
      const cost = costOfCall(
        { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 },
        SMALL,
      );

      expect(cost).toBe(0);
    });
  });

  describe('pricing a call', () => {
    it('prices against the table', () => {
      const priced = priceCall(
        THE_PRICING,
        'test-model-small',
        { tokensIn: 1_000_000, tokensOut: 0, cacheRead: 0, cacheWrite: 0 },
      );

      expect(priced.ok).toBe(true);
      expect(priced.ok && priced.costUsdMicros).toBe(100_000);
    });

    it('REFUSES a model with no price', () => {
      // An unpriced model is a configuration gap. Treating it as free
      // would make the budget check a no-op for that model.
      const priced = priceCall(
        THE_PRICING,
        'an-unpriced-model',
        { tokensIn: 1000, tokensOut: 0, cacheRead: 0, cacheWrite: 0 },
      );

      expect(priced.ok).toBe(false);
      expect(priced.ok === false && priced.reason).toContain('no price');
    });

    it('does NOT treat an unpriced model as free', () => {
      const priced = priceCall(
        THE_PRICING,
        'an-unpriced-model',
        { tokensIn: 1_000_000_000, tokensOut: 0, cacheRead: 0, cacheWrite: 0 },
      );

      expect(priced.ok).toBe(false);
    });
  });

  describe('the projection', () => {
    it('is the input tokens plus the OUTPUT allowance', () => {
      // The output count is not known before the call, so the estimate
      // takes the maximum the request could produce.
      const projected = projectCost(SMALL, 1_000_000, 1_000_000);

      expect(projected).toBe(100_000 + 500_000);
    });

    it('is an OVER-estimate of the output', () => {
      // The projection must not under-estimate: a budget check that
      // under-estimates lets the request through and overruns the
      // ceiling.
      const projected = projectCost(SMALL, 0, 1_000_000);
      const actual = costOfTokens(1, 500_000);

      expect(projected).toBeGreaterThan(actual);
    });
  });

  describe('the pricing document', () => {
    it('reads a pricing table', () => {
      const table = parsePricingTable(`
apiVersion: factory/v1
kind: PricingTable
spec:
  models:
    a-model:
      inputPerMillionUsdMicros: 100000
      outputPerMillionUsdMicros: 500000
      cacheReadPerMillionUsdMicros: 10000
      cacheWritePerMillionUsdMicros: 125000
`);

      expect(table['a-model']?.inputPerMillionUsdMicros).toBe(100_000);
    });

    it('REFUSES a document that is not a pricing table', () => {
      expect(() =>
        parsePricingTable(`
apiVersion: factory/v1
kind: SomethingElse
spec:
  models: {}
`),
      ).toThrow(/must declare the kind "PricingTable"/);
    });

    it('REFUSES a price that is not an integer', () => {
      // A float price would make the whole cost computation a float
      // computation — which is what the integer rule exists to prevent.
      expect(() =>
        parsePricingTable(`
apiVersion: factory/v1
kind: PricingTable
spec:
  models:
    a-model:
      inputPerMillionUsdMicros: 100000.5
      outputPerMillionUsdMicros: 500000
      cacheReadPerMillionUsdMicros: 10000
      cacheWritePerMillionUsdMicros: 125000
`),
      ).toThrow(/not a non-negative integer/);
    });

    it('REFUSES a NEGATIVE price', () => {
      // A negative price would make a cost negative — which would
      // *increase* the remaining budget.
      expect(() =>
        parsePricingTable(`
apiVersion: factory/v1
kind: PricingTable
spec:
  models:
    a-model:
      inputPerMillionUsdMicros: -1
      outputPerMillionUsdMicros: 500000
      cacheReadPerMillionUsdMicros: 10000
      cacheWritePerMillionUsdMicros: 125000
`),
      ).toThrow(/not a non-negative integer/);
    });
  });

  describe('the repository’s own definition files', () => {
    it('the routing policy loads', async () => {
      const policy = await readRoutingPolicy();

      expect(policy.kind).toBe('RoutingPolicy');
      expect(Object.keys(policy.spec.classes).length).toBeGreaterThan(0);
    });

    it('the routing policy has NO same-provider fallback', async () => {
      // blueprint 11 §9.3: "A fallback to the same provider under the
      // same failure mode is not a fallback."
      const policy = await readRoutingPolicy();

      for (const routeClass of Object.values(policy.spec.classes)) {
        for (const fallback of routeClass.fallbacks) {
          expect(fallback.provider).not.toBe(routeClass.primary.provider);
        }
      }
    });

    it('the routing policy declares budget exhaustion as NEVER failing over', async () => {
      // pack 02 §4.7 / pack 03 §4.6.
      const policy = await readRoutingPolicy();

      expect(policy.spec.failover?.neverOn).toContain('budget-exhausted');
    });

    it('the pricing table loads and every price is an integer', async () => {
      const table = await readPricingTable();

      expect(Object.keys(table).length).toBeGreaterThan(0);
      for (const price of Object.values(table)) {
        for (const value of Object.values(price)) {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    });

    it('the pricing table covers every model the routing policy names', async () => {
      // A model the policy routes to but the table does not price is a
      // route the gateway would refuse — a gap that must not ship.
      const policy = await readRoutingPolicy();
      const table = await readPricingTable();

      for (const routeClass of Object.values(policy.spec.classes)) {
        const named = [routeClass.primary.model, ...routeClass.fallbacks.map((f) => f.model)];
        for (const model of named) {
          if (model.startsWith('<')) {
            // A placeholder the operator has not filled in yet.
            continue;
          }
          expect(table[model], `the model "${model}" has no price`).toBeDefined();
        }
      }
    });
  });
});
