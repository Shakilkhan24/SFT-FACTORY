/**
 * T-1.10 — the budget check (**A0.8**).
 *
 * blueprint 11 §9.5:
 *
 * | Rule | Detail |
 * |---|---|
 * | Enforcement | A request whose projected cost exceeds the remaining budget is **refused before the call**, and the task halts with `budget.exhausted`. |
 *
 * blueprint 15 §4.5: *"Before a request, the gateway projects its cost from the token
 * estimate; a request that would breach the budget is refused **before** it is made."*
 *
 * ## What these tests hold
 *
 * 1. **The refusal happens BEFORE the call.** The provider is never
 *    asked. That is the whole point — a budget checked after the call
 *    is a report, not a control.
 * 2. **The refusal is `budget.exhausted`**, with the scope, the limit
 *    and the spend.
 * 3. **A `budget.exhausted` event is emitted**, with exactly the
 *    registered payload shape.
 * 4. **The check is against the REMAINING budget**, not the limit.
 * 5. **The tightest scope wins.**
 * 6. **Budget exhaustion NEVER fails over** — pack 02 §4.7: *"Budget
 *    exhaustion never fails over — it halts with `budget.exhausted`."*
 */

import { describe, expect, it } from 'vitest';

import { checkBudget, remainingOf } from '../../packages/gateway/src/index.ts';

import { aRequest, buildGateway } from '../helpers/gateway.ts';

describe('T-1.10 — the budget check (A0.8)', () => {
  describe('refusing before the call', () => {
    it('REFUSES a request whose projection exceeds the budget', async () => {
      // The projection is the input tokens at the model's input price
      // plus the output allowance at the output price. With a 1-micro-USD
      // task budget, anything real exceeds it.
      const { gateway } = buildGateway({
        perTaskUsdMicros: 1,
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('budget.exhausted');
    });

    it('does NOT call the provider when the budget refuses', async () => {
      // **The load-bearing assertion.** If the provider were called, the
      // budget would be a report and not a control.
      const { gateway, alpha, beta } = buildGateway({
        perTaskUsdMicros: 1,
      });

      await gateway.complete(aRequest());

      expect(alpha.callCount).toBe(0);
      expect(beta.callCount).toBe(0);
    });

    it('does NOT fail over on a budget exhaustion', async () => {
      // pack 02 §4.7: "**Budget exhaustion never fails over** — it
      // halts with `budget.exhausted` and outcome `incomplete`."
      //
      // The fallback provider must not be called. If it were, the
      // budget would be evaded by spending a *different* model's money.
      const { gateway, alpha, beta } = buildGateway({
        perTaskUsdMicros: 1,
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(false);
      expect(alpha.callCount).toBe(0);
      expect(beta.callCount).toBe(0);
    });

    it('emits a budget.exhausted EVENT', async () => {
      const { gateway, events } = buildGateway({ perTaskUsdMicros: 1 });

      await gateway.complete(aRequest());

      const exhausted = events.filter(
        (event) => event.eventType === 'budget.exhausted',
      );
      expect(exhausted).toHaveLength(1);
    });

    it('the budget.exhausted event carries the REGISTERED payload shape', async () => {
      // pack 03 §5: `budget.exhausted {scope, limitUsdMicros, spentUsdMicros}`.
      const { gateway, events } = buildGateway({ perTaskUsdMicros: 1 });

      await gateway.complete(aRequest());

      const event = events.find(
        (candidate) => candidate.eventType === 'budget.exhausted',
      );

      expect(event?.payload['scope']).toBe('task');
      expect(event?.payload['limitUsdMicros']).toBe(1);
      expect(event?.payload['spentUsdMicros']).toBe(0);
    });

    it('does NOT emit a model.failedOver event', async () => {
      const { gateway, events } = buildGateway({ perTaskUsdMicros: 1 });

      await gateway.complete(aRequest());

      expect(
        events.filter((event) => event.eventType === 'model.failedOver'),
      ).toHaveLength(0);
    });

    it('records NO model call when the budget refuses', async () => {
      const { gateway, calls } = buildGateway({ perTaskUsdMicros: 1 });

      await gateway.complete(aRequest());

      // Nothing was spent, so nothing is in the ledger.
      expect(calls.records).toHaveLength(0);
    });
  });

  describe('the request budget', () => {
    it('refuses when the REQUEST budget is the tightest', async () => {
      const { gateway } = buildGateway({
        perTaskUsdMicros: 50_000_000,
        perRequestUsdMicros: 1,
      });

      const result = await gateway.complete(
        aRequest({ budget: { maxUsdMicros: 1 } }),
      );

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.class).toBe('budget.exhausted');
    });
  });

  describe('the check itself', () => {
    it('allows a projection that fits', () => {
      const check = checkBudget(
        {
          request: { limitUsdMicros: 1000, spentUsdMicros: 0 },
          task: undefined,
          workflowDay: undefined,
        },
        999,
      );

      expect(check.ok).toBe(true);
    });

    it('refuses a projection that does NOT fit', () => {
      const check = checkBudget(
        {
          request: { limitUsdMicros: 1000, spentUsdMicros: 0 },
          task: undefined,
          workflowDay: undefined,
        },
        1001,
      );

      expect(check.ok).toBe(false);
    });

    it('compares against the REMAINING budget, not the limit', () => {
      // The task has spent 900 of 1000. A 200-micro-USD request does
      // not fit in the remaining 100 — even though it fits in the
      // limit of 1000.
      const check = checkBudget(
        {
          request: undefined,
          task: { limitUsdMicros: 1000, spentUsdMicros: 900 },
          workflowDay: undefined,
        },
        200,
      );

      expect(check.ok).toBe(false);
      expect(check.ok === false && check.scope).toBe('task');
    });

    it('allows a request that fits in what is LEFT', () => {
      const check = checkBudget(
        {
          request: undefined,
          task: { limitUsdMicros: 1000, spentUsdMicros: 900 },
          workflowDay: undefined,
        },
        100,
      );

      expect(check.ok).toBe(true);
    });

    it('the TIGHTEST scope wins', () => {
      // The request budget is huge, the task budget is tiny. The task's
      // is the one that refuses, and it is the one reported — the
      // operator learns which limit to raise.
      const check = checkBudget(
        {
          request: { limitUsdMicros: 1_000_000, spentUsdMicros: 0 },
          task: { limitUsdMicros: 100, spentUsdMicros: 0 },
          workflowDay: { limitUsdMicros: 1_000_000, spentUsdMicros: 0 },
        },
        500,
      );

      expect(check.ok).toBe(false);
      expect(check.ok === false && check.scope).toBe('task');
    });

    it('the workflow-day scope refuses when the others do not', () => {
      const check = checkBudget(
        {
          request: undefined,
          task: undefined,
          workflowDay: { limitUsdMicros: 100, spentUsdMicros: 0 },
        },
        500,
      );

      expect(check.ok).toBe(false);
      expect(check.ok === false && check.scope).toBe('workflow-day');
    });

    it('an UNLIMITED scope does not refuse', () => {
      // "No limit at this scope" is not "a limit of zero". A policy
      // that declares no per-task budget has said nothing about the
      // task — it has not capped it.
      const check = checkBudget(
        {
          request: undefined,
          task: undefined,
          workflowDay: undefined,
        },
        1_000_000_000,
      );

      expect(check.ok).toBe(true);
    });

    it('a task that has OVERRUN its budget has none left', () => {
      const check = checkBudget(
        {
          request: undefined,
          task: { limitUsdMicros: 100, spentUsdMicros: 150 },
          workflowDay: undefined,
        },
        1,
      );

      expect(check.ok).toBe(false);
    });

    it('reports the limit and the spend on the refusal', () => {
      const check = checkBudget(
        {
          request: undefined,
          task: { limitUsdMicros: 1000, spentUsdMicros: 900 },
          workflowDay: undefined,
        },
        200,
      );

      expect(check.ok === false && check.limitUsdMicros).toBe(1000);
      expect(check.ok === false && check.spentUsdMicros).toBe(900);
    });

    it('the error carries the scope in its DETAIL', () => {
      const check = checkBudget(
        {
          request: undefined,
          task: { limitUsdMicros: 100, spentUsdMicros: 0 },
          workflowDay: undefined,
        },
        500,
      );

      expect(check.ok === false && check.error.detail?.['scope']).toBe('task');
    });
  });

  describe('the remaining amount', () => {
    it('is the limit minus the spend', () => {
      expect(
        remainingOf({ limitUsdMicros: 1000, spentUsdMicros: 400 }),
      ).toBe(600);
    });

    it('is ZERO when the budget is already spent', () => {
      expect(
        remainingOf({ limitUsdMicros: 1000, spentUsdMicros: 1000 }),
      ).toBe(0);
    });

    it('is ZERO — not negative — when the budget is overrun', () => {
      expect(
        remainingOf({ limitUsdMicros: 1000, spentUsdMicros: 1500 }),
      ).toBe(0);
    });

    it('is UNLIMITED when there is no limit', () => {
      expect(remainingOf(undefined)).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
