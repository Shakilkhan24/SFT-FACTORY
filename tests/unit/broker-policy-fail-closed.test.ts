/**
 * T-1.08 — the broker's **fail-closed** behaviour.
 *
 * blueprint 13 SG-12: *"The failure mode of the policy engine is deny."*
 *
 * The same holds for the broker: any error that is not a recognised
 * execution failure is a **denial**, and a policy engine that *throws* is
 * a denial.
 *
 * ## Why the throwing-engine case matters
 *
 * The policy engine is pure and total (pack 02 §4.4), so it should never
 * throw. But "should never" is not "cannot" — a future change, a
 * malformed bundle, or a bug could make it throw. If the broker let an
 * exception *propagate*, the call would be neither allowed nor denied; it
 * would be an unhandled error, and whatever called the broker might treat
 * that as "not blocked".
 *
 * So the broker wraps the evaluation and converts any throw into a DENY.
 * The test below proves it by supplying an engine that throws.
 *
 * ## The same rule, elsewhere
 *
 * The rule is not only about the policy engine. The **registry lookup**
 * fails closed too: a capability the registry does not list does not
 * exist, even if a transport advertises it (blueprint 11 §3.2).
 */

import { describe, expect, it } from 'vitest';

import {
  aCapability,
  aRequest,
  anEntry,
  buildBroker,
} from '../helpers/broker.ts';

describe('T-1.08 — the broker fails closed', () => {
  describe('a policy engine that throws', () => {
    it('the call is denied, not errored', async () => {
      const { broker } = buildBroker({
        evaluatePolicy: () => {
          throw new Error('the policy engine exploded');
        },
      });

      const outcome = await broker.invoke(aRequest());

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.failedAt).toBe('policy');
      expect(outcome.ok === false && outcome.failureClass).toBe('policy.denied');
    });

    it('the reason says the engine failed, not that the call was permitted', async () => {
      const { broker } = buildBroker({
        evaluatePolicy: () => {
          throw new Error('the policy engine exploded');
        },
      });

      const outcome = await broker.invoke(aRequest());

      expect(outcome.ok === false && outcome.reason).toContain('policy');
    });

    it('the adapter never runs', async () => {
      const { broker, invoked } = buildBroker({
        evaluatePolicy: () => {
          throw new Error('the policy engine exploded');
        },
      });

      await broker.invoke(aRequest());

      expect(invoked).toEqual([]);
    });

    it('the credential is never acquired', async () => {
      // The credential comes *after* the policy, so a call that never
      // reached a decision never consumes one.
      const { broker, credentials } = buildBroker({
        evaluatePolicy: () => {
          throw new Error('the policy engine exploded');
        },
      });

      await broker.invoke(aRequest());

      expect(credentials.calls).toEqual([]);
    });

    it('the failure is recorded as denied', async () => {
      const { broker, store } = buildBroker({
        evaluatePolicy: () => {
          throw new Error('the policy engine exploded');
        },
      });

      await broker.invoke(aRequest());

      expect(store.size()).toBe(1);
      expect(store.records()[0]?.status).toBe('denied');
      expect(store.events()[0]?.eventType).toBe('tool.denied');
    });
  });

  describe('an escalation', () => {
    it('is a refusal, and the call is not executed', async () => {
      // pack 02 §4.4 step 2b: an escalation flags the task to a human and
      // the second attempt is **not** executed.
      const { broker, invoked } = buildBroker({
        evaluatePolicy: () =>
          ({
            outcome: 'ESCALATE',
            ruleIds: ['effect/E3'],
            reason: 'the effect class requires a human',
            bundleSha256: 'abc',
          }) as never,
      });

      const outcome = await broker.invoke(aRequest());

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.failedAt).toBe('policy');
      expect(outcome.ok === false && outcome.failureClass).toBe('policy.denied');
      expect(invoked).toEqual([]);
    });
  });

  describe('a capability the registry does not list', () => {
    it('does not exist — the call is refused at step 1', async () => {
      const { broker, invoked } = buildBroker();

      const outcome = await broker.invoke(
        aRequest({ capabilityId: 'not.registered' }),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.failedAt).toBe('validate-args');
      expect(outcome.ok === false && outcome.reason).toContain('does not exist');
      expect(invoked).toEqual([]);
    });

    it('a usage error — not a tool failure', async () => {
      // blueprint 11 §6.3: a schema failure is counted separately, so a
      // call for something that does not exist emits **no** `tool.*` event
      // and cannot be mistaken for a capability that was unavailable.
      const { broker, store } = buildBroker();

      await broker.invoke(aRequest({ capabilityId: 'not.registered' }));

      expect(store.size()).toBe(0);
      expect(store.events()).toEqual([]);
    });

    it('an unavailable capability does not exist either', async () => {
      const { broker } = buildBroker({
        entries: [
          {
            ...anEntry(aCapability()),
            availability: 'unavailable',
          },
        ],
      });

      const outcome = await broker.invoke(aRequest());

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.reason).toContain('does not exist');
    });
  });
});
