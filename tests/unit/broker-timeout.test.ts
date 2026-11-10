/**
 * T-1.08 — the execution **timeout**.
 *
 * blueprint 11 §6.2 step 8: the execution is *"with a timeout"*, and its
 * failure class is `tool.unavailable`.
 *
 * ## Why a timeout is terminal
 *
 * A capability that has not answered in time cannot be shown to have
 * worked, and it may still be running. The broker must not wait forever —
 * an unbounded wait would hold a lease open indefinitely, and a lease that
 * never expires is a lease that never gets reclaimed.
 *
 * So the timeout **aborts** the call: the adapter's `AbortSignal` fires,
 * the broker stops waiting, and the call fails as `tool.unavailable`.
 *
 * ## Why the attempt is recorded
 *
 * A call that was attempted and timed out is **evidence**. An unrecorded
 * attempt is invisible, and the reaper's "first committed result wins"
 * rule needs to know the attempt happened — a timed-out call may well
 * have performed its side effect.
 *
 * So a timeout is recorded as `failed`, with a `tool.failed` event. It is
 * **not** a usage error and **not** a denial: the capability was reachable
 * and did not answer.
 */

import { describe, expect, it } from 'vitest';

import type { InvocationRequest } from '../../packages/broker/src/index.ts';
import {
  aContext,
  aGrant,
  buildBroker as buildTheBroker,
  type BrokerHarnessOptions,
} from '../helpers/broker.ts';

/**
 * The broker, with a handler that never answers.
 */
const buildBroker = (
  options: {
    readonly handler?: (args: unknown, signal: AbortSignal) => unknown;
  } & Omit<BrokerHarnessOptions, 'handler'>,
) =>
  buildTheBroker({
    ...options,
    handler:
      options.handler === undefined
        ? () =>
            new Promise<unknown>(() => {
              /* never settles */
            })
        : (args, _credential, signal) => options.handler?.(args, signal),
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

describe('T-1.08 — the execution timeout', () => {
  it('the call fails as tool.unavailable', async () => {
    const { broker } = buildBroker({ timeoutMs: 20 });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('execute');
    expect(outcome.ok === false && outcome.failureClass).toBe('tool.unavailable');
  });

  it('the failure is at step 8', async () => {
    const { broker } = buildBroker({ timeoutMs: 20 });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok === false && outcome.stepNumber).toBe(8);
  });

  it('the abort signal fires, so the adapter can stop working', async () => {
    const { broker, signals } = buildBroker({ timeoutMs: 20 });

    await broker.invoke(aRequest());

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('the invocation is RECORDED as attempted', async () => {
    // A timed-out call may well have performed its side effect, so the
    // attempt is evidence and must not be invisible.
    const { broker, store } = buildBroker({ timeoutMs: 20 });

    await broker.invoke(aRequest());

    expect(store.size()).toBe(1);
    expect(store.records()[0]?.status).toBe('failed');
    expect(store.events()[0]?.eventType).toBe('tool.failed');
  });

  it('the record names the capability that timed out', async () => {
    const { broker, store } = buildBroker({ timeoutMs: 20 });

    await broker.invoke(aRequest());

    expect(store.records()[0]?.capabilityId).toBe('test.capability');
  });

  it('the steps stop at 8 — the record step never ran', async () => {
    const { broker } = buildBroker({ timeoutMs: 20 });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok === false && outcome.steps).toEqual([
      'validate-args',
      'deny-list',
      'grant',
      'resource-scope',
      'policy',
      'approval',
      'credential',
      'execute',
    ]);
  });

  it('a call that answers in time is not a timeout', async () => {
    const { broker } = buildBroker({
      timeoutMs: 1000,
      handler: () => ({ ok: true }),
    });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
  });

  it('the abort signal does NOT fire when the call answers in time', async () => {
    const { broker, signals } = buildBroker({
      timeoutMs: 1000,
      handler: () => ({ ok: true }),
    });

    await broker.invoke(aRequest());

    expect(signals[0]?.aborted).toBe(false);
  });

  it('a timed-out call is NOT replayed — the retry must try again', async () => {
    // The attempt failed, so it has no result to replay. A retry of the
    // same attempt is allowed to try again.
    let calls = 0;
    const { broker, store } = buildBroker({
      timeoutMs: 20,
      handler: async () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<unknown>(() => {
            /* never settles */
          });
        }
        return { ok: true };
      },
    });

    const first = await broker.invoke(aRequest());
    const second = await broker.invoke(aRequest());

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
    expect(second.ok && second.replayed).toBe(false);
    expect(store.size()).toBe(2);
  });
});
