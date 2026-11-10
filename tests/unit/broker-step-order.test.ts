/**
 * T-1.08 — the broker's **step order**.
 *
 * blueprint 11 §6.2: *"The order is fixed, and each step's failure is
 * terminal for that step."*
 *
 * This is the ticket's headline oracle, and the test is the
 * **step-order spy**: a recording port proves that the ten steps run in
 * exactly the specified order, and that a failure at step *n* stops the
 * pipeline at step *n*.
 *
 * ## Why the order is worth a whole file
 *
 * The order is not an implementation detail — it is what makes the
 * pipeline safe. Three orderings are load-bearing:
 *
 * * **Validation before everything.** A malformed call never reaches
 *   policy, an adapter, or — the one that really matters — a credential.
 * * **Deny before grant.** A deny is terminal regardless of what any grant
 *   says.
 * * **Credential after approval.** The credential is acquired only once
 *   the policy has allowed the call and any required approval exists.
 *
 * So the tests here assert not just *that* the steps ran, but that a
 * failure at each one **stops** the pipeline there — and, for the early
 * steps, that the later ones never ran at all.
 */

import { describe, expect, it } from 'vitest';

import {
  BROKER_STEPS,
  type BrokerStep,
  type InvocationOutcome,
} from '../../packages/broker/src/index.ts';
import {
  aCapability,
  aGrant,
  aRequest,
  anEntry,
  buildBroker,
} from '../helpers/broker.ts';

/**
 * The steps a successful call ran.
 */
const stepsOf = (outcome: InvocationOutcome): readonly BrokerStep[] =>
  outcome.ok ? outcome.steps : outcome.steps;

describe('T-1.08 · the broker step order', () => {
  it('runs all ten steps, in the specified order, on a successful call', async () => {
    const { broker } = buildBroker({ secret: 'shh' });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
    expect(stepsOf(outcome)).toEqual([
      'validate-args',
      'deny-list',
      'grant',
      'resource-scope',
      'policy',
      'approval',
      'credential',
      'execute',
      'validate-result',
      'record',
    ]);
  });

  it('publishes exactly the ten steps, in order', () => {
    // The published order *is* the specification. If this list changes,
    // the pipeline changes with it.
    expect([...BROKER_STEPS]).toEqual([
      'validate-args',
      'deny-list',
      'grant',
      'resource-scope',
      'policy',
      'approval',
      'credential',
      'execute',
      'validate-result',
      'record',
    ]);
  });

  it('invokes the adapter with the factory’s guard token', async () => {
    // A0.2's runtime guard: the adapter's `invoke` requires the token the
    // **factory** holds, and the broker is the only thing that can ask
    // for it. So the broker must pass that exact token — a forged one, or
    // one of its own making, would be refused by the adapter.
    //
    // This is the assertion that the broker does not forge a token. The
    // mutation harness breaks it by replacing the token with a fresh
    // symbol.
    const { broker, guardToken, tokens } = buildBroker({ secret: 'shh' });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toBe(guardToken);
  });

  it('stops at step 1 when the arguments do not match the schema', async () => {
    const { broker, credentials, approvals } = buildBroker({
      entries: [
        anEntry(
          aCapability(),
          {
            inputSchema: {
              type: 'object',
              properties: { repo: { type: 'string' } },
              required: ['repo'],
              additionalProperties: false,
            },
          },
        ),
      ],
    });

    const outcome = await broker.invoke(aRequest({ args: { wrong: 'shape' } }));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('validate-args');
    expect(outcome.ok === false && outcome.stepNumber).toBe(1);
    expect(stepsOf(outcome)).toEqual(['validate-args']);

    // **The credential was never acquired.** A malformed call must not
    // consume a credential — that is the whole reason step 1 runs first.
    expect(credentials.calls).toEqual([]);
    expect(approvals.calls).toEqual([]);
  });

  it('stops at step 2 when the capability is on the deny list', async () => {
    const { broker, credentials } = buildBroker({ secret: 'shh' });

    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ deny: ['test.capability'] }) }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('deny-list');
    expect(outcome.ok === false && outcome.stepNumber).toBe(2);
    expect(stepsOf(outcome)).toEqual(['validate-args', 'deny-list']);
    expect(credentials.calls).toEqual([]);
  });

  it('stops at step 3 when the grant does not name the capability', async () => {
    const { broker, credentials } = buildBroker({ secret: 'shh' });

    const outcome = await broker.invoke(
      aRequest({ grant: aGrant({ capabilities: ['other.capability'] }) }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('grant');
    expect(outcome.ok === false && outcome.stepNumber).toBe(3);
    expect(stepsOf(outcome)).toEqual(['validate-args', 'deny-list', 'grant']);
    expect(credentials.calls).toEqual([]);
  });

  it('stops at step 4 when the resource is outside the grant scope', async () => {
    const { broker, credentials } = buildBroker({ secret: 'shh' });

    const outcome = await broker.invoke(
      aRequest({
        resource: { repo: 'org/other-repo' },
        grant: aGrant({ repo: 'org/repo' }),
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('resource-scope');
    expect(outcome.ok === false && outcome.stepNumber).toBe(4);
    expect(stepsOf(outcome)).toEqual([
      'validate-args',
      'deny-list',
      'grant',
      'resource-scope',
    ]);
    expect(credentials.calls).toEqual([]);
  });

  it('stops at step 5 when the policy denies', async () => {
    const { broker, credentials } = buildBroker({
      policyBundle: {
        spec: {
          denyRules: [],
          protectedPaths: [],
          effectRules: { E0: 'deny', E1: 'deny', E2: 'deny', E3: 'deny', E4: 'deny' },
          tierRules: {},
          default: 'deny',
        },
      } as never,
      secret: 'shh',
    });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('policy');
    expect(outcome.ok === false && outcome.stepNumber).toBe(5);
    expect(stepsOf(outcome)).toEqual([
      'validate-args',
      'deny-list',
      'grant',
      'resource-scope',
      'policy',
    ]);
    expect(credentials.calls).toEqual([]);
  });

  it('stops at step 6 when the policy requires an approval and none exists', async () => {
    // The approval is demanded by the **effect class**: E2 ⇒
    // `REQUIRE_APPROVAL` (pack 02 §4.4 step 5). So the capability here is
    // an E2 one — an E0 read never needs an approval, so the test would
    // not reach step 6 at all.
    const { broker, credentials } = buildBroker({
      entries: [
        anEntry(
          aCapability({
            kind: 'mutation',
            effect: { class: 'E2', reversible: false, external: true },
            scope: {
              required: ['git.write.pr'],
              resourcePattern: 'repo:{owner}/{name}',
              environment: 'orchestrator',
            },
          }),
        ),
      ],
      policyBundle: {
        spec: {
          denyRules: [],
          protectedPaths: [],
          effectRules: { E0: 'allow', E1: 'allow', E2: 'requireApproval', E3: 'requireApproval', E4: 'requireApproval' },
          tierRules: {},
          default: 'deny',
        },
      } as never,
      approved: false,
      secret: 'shh',
    });

    const outcome = await broker.invoke(
      aRequest({
        grant: aGrant({ scopes: ['git.write.pr'] }),
        resource: { paths: ['src/index.ts'] },
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('approval');
    expect(outcome.ok === false && outcome.stepNumber).toBe(6);
    expect(stepsOf(outcome)).toEqual([
      'validate-args',
      'deny-list',
      'grant',
      'resource-scope',
      'policy',
      'approval',
    ]);

    // The credential is acquired **after** the approval, so a call that
    // stops at step 6 never reaches step 7.
    expect(credentials.calls).toEqual([]);
  });

  it('stops at step 8 when the capability cannot be executed', async () => {
    const { broker } = buildBroker({
      secret: 'shh',
      handler: () => {
        throw new Error('the adapter exploded');
      },
    });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('execute');
    expect(outcome.ok === false && outcome.stepNumber).toBe(8);
    expect(stepsOf(outcome)).toEqual([
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

  it('stops at step 9 when the result does not match the output schema', async () => {
    const { broker } = buildBroker({
      entries: [
        anEntry(
          aCapability(),
          {
            outputSchema: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false,
            },
          },
        ),
      ],
      handler: () => ({ value: 42 }),
    });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failedAt).toBe('validate-result');
    expect(outcome.ok === false && outcome.stepNumber).toBe(9);
  });

  it('runs step 10 on a successful call and records the invocation', async () => {
    const { broker, store } = buildBroker({ secret: 'shh' });

    const outcome = await broker.invoke(aRequest());

    expect(outcome.ok).toBe(true);
    expect(store.size()).toBe(1);
    expect(store.records()[0]?.capabilityId).toBe('test.capability');
    expect(store.events()[0]?.eventType).toBe('tool.invoked');
  });

  it('records a failed execution as attempted', async () => {
    // A call that was attempted and failed is evidence. An unrecorded
    // attempt is invisible, and the reaper's "first committed result
    // wins" rule needs to know the attempt happened.
    const { broker, store } = buildBroker({
      secret: 'shh',
      handler: () => {
        throw new Error('the adapter exploded');
      },
    });

    await broker.invoke(aRequest());

    expect(store.size()).toBe(1);
    expect(store.records()[0]?.status).toBe('failed');
    expect(store.events()[0]?.eventType).toBe('tool.failed');
  });

  it('does not record a call that failed before the execution', async () => {
    // A usage error is **not** a tool failure: it emits no `tool.*` event
    // and it is counted by the absence of a tool failure, so it cannot be
    // mistaken for a capability that was unavailable.
    const { broker, store } = buildBroker({
      entries: [
        anEntry(
          aCapability(),
          {
            inputSchema: {
              type: 'object',
              properties: { repo: { type: 'string' } },
              required: ['repo'],
              additionalProperties: false,
            },
          },
        ),
      ],
    });

    await broker.invoke(aRequest({ args: { wrong: 'shape' } }));

    expect(store.size()).toBe(0);
    expect(store.events()).toEqual([]);
  });
});
