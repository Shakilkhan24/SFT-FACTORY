/**
 * T-1.08 — the **approval** gate.
 *
 * blueprint 11 §6.2 step 6: the approval is *"bound to the arguments'
 * hash"*.
 *
 * pack 02 §4.4 step 5: a capability whose effect class demands one
 * produces `REQUIRE_APPROVAL`, and the call proceeds only if an approval
 * exists.
 *
 * ## Why the binding to `argsSha256` is the whole point
 *
 * If the approval were not bound to the arguments, an agent could obtain
 * an approval for one call and then change the arguments — the approval
 * would still be there, and it would mean nothing. The binding makes the
 * approval a statement about **these exact arguments**.
 *
 * So the test asserts three things:
 *
 * 1. an E2 capability with no approval is **refused** at step 6;
 * 2. an E2 capability with an approval proceeds, and the approval's id is
 *    recorded; and
 * 3. the approval is looked up with the **arguments' digest** — so a
 *    different set of arguments asks the checker about a different thing.
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
 * An E2 capability — one whose effect class demands an approval.
 */
const anE2Capability = () =>
  aCapability({
    kind: 'mutation',
    effect: { class: 'E2', reversible: false, external: true },
    scope: {
      required: ['git.write.pr'],
      resourcePattern: 'repo:{owner}/{name}',
      environment: 'orchestrator',
    },
  });

/**
 * A policy bundle that requires an approval for E2.
 */
const anApprovalRequiringBundle = () =>
  ({
    spec: {
      denyRules: [],
      protectedPaths: [],
      effectRules: {
        E0: 'allow',
        E1: 'allow',
        E2: 'requireApproval',
        E3: 'requireApproval',
        E4: 'requireApproval',
      },
      tierRules: {},
      default: 'deny',
    },
  }) as never;

const buildBroker = (
  options: Omit<BrokerHarnessOptions, 'entries'> & {
    readonly entries?: BrokerHarnessOptions['entries'];
  } = {},
) =>
  buildTheBroker({
    policyBundle: anApprovalRequiringBundle(),
    ...options,
    entries: options.entries ?? [anEntry(anE2Capability())],
  });

/**
 * A request.
 */
const aRequest = (overrides: Partial<InvocationRequest> = {}): InvocationRequest => ({
  capabilityId: 'test.capability',
  args: { title: 'a pull request' },
  context: aContext(),
  grant: aGrant({ scopes: ['git.write.pr'] }),
  ...overrides,
});

describe('T-1.08 — the approval gate', () => {
  it('an E2 capability with no approval is REFUSED at step 6', async () => {
    const { broker } = buildBroker({ approved: false });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('approval');
    expect(outcome.ok === false && outcome.stepNumber).toBe(6);
    expect(outcome.ok === false && outcome.failureClass).toBe('policy.denied');
  });

  it('the refusal says an approval is required', async () => {
    const { broker } = buildBroker({ approved: false });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok === false && outcome.reason).toContain('approval');
  });

  it('the credential is NEVER acquired for a call that stopped at step 6', async () => {
    // The credential comes *after* the approval. A call that never got
    // its approval never consumed a credential.
    const { broker, credentials } = buildBroker({ approved: false });

    await broker.invoke(aRequest());

    expect(credentials.calls).toEqual([]);
  });

  it('the refusal is recorded as denied', async () => {
    const { broker, store } = buildBroker({ approved: false });

    await broker.invoke(aRequest());

    expect(store.records()[0]?.status).toBe('denied');
    expect(store.events()[0]?.eventType).toBe('tool.denied');
  });

  it('an E2 capability WITH an approval proceeds', async () => {
    const { broker } = buildBroker({ approved: true });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
  });

  it('the approval’s id is recorded on the invocation', async () => {
    const { broker, store } = buildBroker({ approved: true, approvalId: 'apr_123' });

    await broker.invoke(aRequest());

    expect(store.records()[0]?.approvalId).toBe('apr_123');
  });

  it('the approval is looked up with the arguments’ digest', async () => {
    const { broker, approvals } = buildBroker({ approved: true });

    await broker.invoke(aRequest({ args: { title: 'a pull request' } }));

    expect(approvals.calls).toHaveLength(1);
    expect(approvals.calls[0]?.capabilityId).toBe('test.capability');
    // The digest is a SHA-256 hex string — 64 characters.
    expect(approvals.calls[0]?.argsSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('DIFFERENT arguments produce a DIFFERENT digest', async () => {
    // This is the binding the rule depends on: an approval for one set of
    // arguments is not an approval for another.
    const { broker, approvals } = buildBroker({ approved: true });

    await broker.invoke(aRequest({ args: { title: 'one' } }));
    await broker.invoke(aRequest({ args: { title: 'two' } }));

    expect(approvals.calls[0]?.argsSha256).not.toBe(approvals.calls[1]?.argsSha256);
  });

  it('the SAME arguments produce the SAME digest', async () => {
    // The two calls are on **different tasks**, so neither is a replay of
    // the other — a replay short-circuits before the approval gate, and
    // the checker would be asked only once.
    const { broker, approvals } = buildBroker({ approved: true });

    await broker.invoke(
      aRequest({ args: { title: 'one' }, context: aContext({ taskId: 'task_1' }) }),
    );
    await broker.invoke(
      aRequest({ args: { title: 'one' }, context: aContext({ taskId: 'task_2' }) }),
    );

    expect(approvals.calls).toHaveLength(2);
    expect(approvals.calls[0]?.argsSha256).toBe(approvals.calls[1]?.argsSha256);
  });

  it('the checker is asked about the capability being invoked', async () => {
    const { broker, approvals } = buildBroker({ approved: true });

    await broker.invoke(aRequest());

    expect(approvals.calls[0]?.capabilityId).toBe('test.capability');
  });

  it('an E0 capability does NOT reach step 6’s approval check', async () => {
    // An E0 read never needs an approval, so the checker must not be
    // asked. If it were asked, the check would be vacuous.
    const { broker, approvals } = buildBroker({
      approved: false,
      entries: [anEntry(aCapability())],
    });

    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ scopes: ['repo:read'] }) }),
    );

    expect(outcome.ok).toBe(true);
    expect(approvals.calls).toEqual([]);
  });
});
