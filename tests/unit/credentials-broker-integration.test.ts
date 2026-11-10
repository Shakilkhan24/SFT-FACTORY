/**
 * T-1.09 — the **tool broker's** credential provider.
 *
 * ## Why this file exists
 *
 * T-1.08 built the tool broker with a **recording** credential provider — a
 * double that hands out a fixed secret. That proves the broker's *step 7*
 * places the credential where it belongs, but it does not prove that the
 * factory's **real** credential machinery can fill that slot.
 *
 * So this file wires the **real** `CredentialBroker` into the tool broker's
 * `CredentialProvider` port and runs a full invocation through it.
 *
 * ## What it holds
 *
 * 1. the real broker **satisfies** the tool broker's port — the two
 *    packages meet without either depending on the other's internals;
 * 2. the credential the adapter receives is **narrowed** to what the grant
 *    allowed, not to what the capability asked for;
 * 3. the material reaches the adapter and **nowhere else** — not the
 *    record, not the event, not the lease;
 * 4. a capability that needs no credential is not given one.
 */

import { describe, expect, it } from 'vitest';

import {
  brokerCredentialProvider,
  CredentialBroker,
  InMemoryCredentialLeaseStore,
  RedactionRegistry,
} from '../../packages/credentials/src/index.ts';
import {
  InMemoryCapabilityRegistry,
  InMemoryInvocationStore,
  ToolBroker,
  type BrokerClock,
  type BrokerIdSource,
} from '../../packages/broker/src/index.ts';
import {
  aCapability,
  aContext,
  anEntry,
  FixedBrokerClock,
} from '../helpers/broker.ts';
import { THE_CLOCK } from '../helpers/credentials.ts';

/**
 * A clock that does not move.
 */
const clockOf = (): BrokerClock => new FixedBrokerClock();

/**
 * An id source that counts.
 */
const idsOf = (): BrokerIdSource => ({ next: () => 'inv_test_0001' });

/**
 * The credential material the fake provider mints.
 *
 * The fake's material is deterministic, so a test can name the secret it
 * expects to be absent.
 */
const MINTED = 'ghs_fake0001crd000001';

/**
 * Build the tool broker with the **real** credential broker behind it.
 */
const buildTheRealThing = (
  options: {
    readonly effectiveScopes?: readonly string[];
    readonly repositories?: readonly string[];
    readonly capabilityScopes?: string[];
  } = {},
) => {
  const leases = new InMemoryCredentialLeaseStore();
  const redaction = new RedactionRegistry('task_1');

  let counter = 0;
  const credentialBroker = new CredentialBroker({
    leases,
    provider: {
      name: 'github',
      mint: (request) =>
        Promise.resolve({
          secret: MINTED,
          expiresAt: new Date(
            THE_CLOCK.now().getTime() + request.scope.ttlSeconds * 1000,
          ).toISOString(),
        }),
      revoke: () => Promise.resolve(undefined),
    },
    clock: THE_CLOCK,
    nextId: () => {
      counter += 1;
      return `crd_${String(counter).padStart(6, '0')}`;
    },
    redaction,
  });

  const provider = brokerCredentialProvider({
    broker: credentialBroker,
    effectiveScopesFor: () => options.effectiveScopes ?? ['repo:write:pr'],
    repositoriesFor: () => options.repositories ?? ['org/repo'],
  });

  const store = new InMemoryInvocationStore();

  const capability = aCapability({
    id: 'github.pr.create',
    kind: 'mutation',
    scope: {
      required: options.capabilityScopes ?? ['repo:write:pr'],
      resourcePattern: 'repo:{owner}/{name}',
      environment: 'orchestrator',
    },
    credentials: {
      provider: 'github',
      permissions: { pull_requests: 'write' },
      ttlSeconds: 3600,
    },
  });

  const invoked: { readonly credential: unknown }[] = [];

  const broker = new ToolBroker({
    registry: new InMemoryCapabilityRegistry([anEntry(capability)]),
    policy: {
      evaluate: () =>
        ({
          decision: 'ALLOW',
          reason: 'within the grant',
          ruleIds: [],
        }) as never,
    },
    policyBundle: {
      spec: {
        denyRules: [],
        protectedPaths: [],
        effectRules: {
          E0: 'allow',
          E1: 'allow',
          E2: 'allowIfResourceScoped',
          E3: 'requireApproval',
          E4: 'requireApproval',
        },
        tierRules: {},
        default: 'deny',
      },
    } as never,
    adapters: {
      adapterFor: () =>
        Promise.resolve({
          describe: () => [],
          invoke: (
            _id: string,
            _args: unknown,
            credential: unknown,
            _signal: AbortSignal,
          ) => {
            invoked.push({ credential });
            return Promise.resolve({ ok: true });
          },
          health: () => Promise.resolve('healthy' as const),
          close: () => Promise.resolve(undefined),
        }),
      guardToken: () => Symbol('test-token'),
    },
    approvals: {
      hasApproval: () => Promise.resolve(true),
      approvalId: () => Promise.resolve('apr_test'),
    },
    credentials: provider,
    store,
    clock: clockOf(),
    ids: idsOf(),
  });

  return { broker, store, leases, invoked, credentialBroker, redaction };
};

describe('T-1.09 — the tool broker’s credential provider', () => {
  it('hands the adapter a credential the real broker minted', async () => {
    const { broker, invoked } = buildTheRealThing();

    const outcome = await broker.invoke({
      capabilityId: 'github.pr.create',
      args: { title: 'a change' },
      context: aContext(),
      grant: {
        id: 'grant_1',
        capabilities: ['github.pr.create'],
        scopes: ['repo:write:pr'],
        deny: [],
      },
    });

    expect(outcome.ok).toBe(true);
    expect(invoked).toHaveLength(1);
    const credential = invoked[0]?.credential as
      | { secret?: string; credId?: string }
      | undefined;
    expect(credential?.secret).toBe(MINTED);
    expect(credential?.credId).toBe('crd_000001');
  });

  it('mints for the NARROWED scope, not the capability’s ask', async () => {
    // The capability asks for `repo:write:pr` and `repo:write`; the
    // grant allowed only `repo:write:pr`. The credential must carry the
    // **survivor**.
    const { broker, leases } = buildTheRealThing({
      effectiveScopes: ['repo:write:pr'],
      capabilityScopes: ['repo:write:pr', 'repo:write'],
    });

    await broker.invoke({
      capabilityId: 'github.pr.create',
      args: {},
      context: aContext(),
      grant: {
        id: 'grant_1',
        capabilities: ['github.pr.create'],
        scopes: ['repo:write:pr'],
        deny: [],
      },
    });

    const lease = leases.get('crd_000001');
    expect(lease?.scope.scopes).toEqual(['repo:write:pr']);
    // A PR stage has no business pushing commits.
    expect(lease?.scope.permissions['contents']).toBeUndefined();
    expect(lease?.scope.permissions['pull_requests']).toBe('write');
  });

  it('does NOT put the material in the record, the event or the lease', async () => {
    const { broker, store, leases } = buildTheRealThing();

    await broker.invoke({
      capabilityId: 'github.pr.create',
      args: { title: 'a change' },
      context: aContext(),
      grant: {
        id: 'grant_1',
        capabilities: ['github.pr.create'],
        scopes: ['repo:write:pr'],
        deny: [],
      },
    });

    expect(JSON.stringify(store.records()[0])).not.toContain(MINTED);
    expect(JSON.stringify(store.events()[0])).not.toContain(MINTED);
    expect(JSON.stringify(leases.all())).not.toContain(MINTED);
  });

  it('records the credential’s REFERENCE in the invocation record', async () => {
    const { broker, store } = buildTheRealThing();

    await broker.invoke({
      capabilityId: 'github.pr.create',
      args: {},
      context: aContext(),
      grant: {
        id: 'grant_1',
        capabilities: ['github.pr.create'],
        scopes: ['repo:write:pr'],
        deny: [],
      },
    });

    expect(store.records()[0]?.credential?.credId).toBe('crd_000001');
  });

  it('adds the minted token to the task’s redaction set', async () => {
    const { broker, redaction } = buildTheRealThing();

    await broker.invoke({
      capabilityId: 'github.pr.create',
      args: {},
      context: aContext(),
      grant: {
        id: 'grant_1',
        capabilities: ['github.pr.create'],
        scopes: ['repo:write:pr'],
        deny: [],
      },
    });

    const scrubbed = redaction.scrub(`the token is ${MINTED}`);
    expect(scrubbed.value).not.toContain(MINTED);
    // The **exact** layer must be the one that fired. The pattern layer
    // would also catch a `ghs_` token, so asserting only that the token
    // vanished would not prove the broker registered it — and a token
    // that does not match the pattern would slip through entirely.
    expect(scrubbed.applied[0]?.rule).toBe('exact.minted');
  });

  it('gives NO credential to a capability that needs none', async () => {
    const leases = new InMemoryCredentialLeaseStore();
    let counter = 0;
    const credentialBroker = new CredentialBroker({
      leases,
      provider: {
        name: 'github',
        mint: () =>
          Promise.resolve({ secret: MINTED, expiresAt: '2026-11-10T01:00:00.000Z' }),
        revoke: () => Promise.resolve(undefined),
      },
      clock: THE_CLOCK,
      nextId: () => {
        counter += 1;
        return `crd_${String(counter).padStart(6, '0')}`;
      },
    });

    const provider = brokerCredentialProvider({
      broker: credentialBroker,
      effectiveScopesFor: () => ['repo:read'],
      repositoriesFor: () => ['org/repo'],
    });

    const capability = aCapability({
      id: 'test.readonly',
      credentials: { provider: 'none', permissions: {}, ttlSeconds: 60 },
    });

    const resolved = await provider.resolve(capability, aContext());

    expect(resolved).toBeUndefined();
    expect(leases.all()).toHaveLength(0);
  });
});
