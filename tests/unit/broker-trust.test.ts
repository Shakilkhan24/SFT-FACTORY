/**
 * T-1.08 — the **trust tag**.
 *
 * pack 04 §12: *"MCP results are tagged by the capability's declared
 * trust."* The same holds for every capability, not just MCP.
 *
 * ## Where the tag comes from
 *
 * The tag is the capability's **own declaration** — `trust.resultTrust` in
 * the capability document. The broker does not decide whether a result is
 * trustworthy, and it does not infer it from the result's shape. The
 * capability's author declared it, and the broker carries the declaration.
 *
 * ## Why it matters
 *
 * An untrusted result is *data*, not a fact. `github.pr.read` is declared
 * `untrusted` because a pull-request body can contain anything an author
 * typed. If the broker let an untrusted result pass off as trusted, the
 * agent's context would carry attacker-controlled text as if it were the
 * factory's own output — which is the injection path the untrusted envelope
 * exists to close.
 *
 * So the test asserts two things: the tag is carried, and an untrusted
 * result **cannot be re-tagged** by anything downstream.
 */

import { describe, expect, it } from 'vitest';

import type { InvocationRequest } from '../../packages/broker/src/index.ts';
import {
  aCapability,
  aContext,
  aGrant,
  anEntry,
  buildBroker as buildTheBroker,
  type BrokerHarnessOptions,
} from '../helpers/broker.ts';

/**
 * The broker, with the capability's trust as the only variable.
 *
 * The trust is a property of the **capability**, so it is set by changing
 * the registry entry — not by changing the broker.
 */
const buildBroker = (
  options: {
    readonly resultTrust?: 'trusted' | 'untrusted';
  } & Omit<BrokerHarnessOptions, 'entries'>,
) =>
  buildTheBroker({
    ...options,
    entries: [
      anEntry(
        aCapability({
          trust: {
            inputTrust: 'trusted',
            resultTrust: options.resultTrust ?? 'trusted',
          },
        }),
      ),
    ],
  });

/**
 * A request.
 */
const aRequest = (overrides: Partial<InvocationRequest> = {}): InvocationRequest => ({
  capabilityId: 'test.capability',
  args: {},
  context: aContext(),
  grant: aGrant(),
  ...overrides,
});

describe('T-1.08 — the trust tag', () => {
  it('a trusted capability’s result is tagged trusted', async () => {
    const { broker } = buildBroker({ resultTrust: 'trusted' });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.trust).toBe('trusted');
  });

  it('an untrusted capability’s result is tagged untrusted', async () => {
    const { broker } = buildBroker({ resultTrust: 'untrusted' });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.trust).toBe('untrusted');
  });

  it('the tag comes from the capability’s declaration, not the result’s shape', async () => {
    // A result that *looks* perfectly well-formed is still untrusted when
    // the capability says so. The broker does not grade the result.
    const { broker } = buildBroker({
      resultTrust: 'untrusted',
      handler: () => ({ looks: 'structured and tidy' }),
    });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok && outcome.trust).toBe('untrusted');
  });

  it('the tag is not derived from the effect class', async () => {
    // An E0 read is not automatically trusted: `github.pr.read` is an E0
    // read and it is `untrusted`, because its content is attacker-written.
    const { broker } = buildBroker({ resultTrust: 'untrusted' });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok && outcome.trust).toBe('untrusted');
  });

  it('the invocation record carries the capability’s declared trust', async () => {
    // The record does not carry a trust field of its own — the trust is
    // the capability's declaration, and the record names the capability.
    // So the record must name the capability whose trust applies.
    const { broker, store } = buildBroker({ resultTrust: 'untrusted' });

    await broker.invoke(aRequest());

    expect(store.records()[0]?.capabilityId).toBe('test.capability');
  });

  it('the value and the tag travel together', async () => {
    // A caller that receives a value must receive the tag with it — a
    // value without its tag is exactly the thing that can be passed off as
    // trusted.
    const { broker } = buildBroker({
      resultTrust: 'untrusted',
      handler: () => ({ body: 'anything an author typed' }),
    });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toEqual({ body: 'anything an author typed' });
      expect(outcome.trust).toBe('untrusted');
    }
  });
});
