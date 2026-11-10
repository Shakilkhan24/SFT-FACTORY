/**
 * Shared fixtures for the credential broker's tests.
 *
 * The broker is built once here, so that every test file agrees on what
 * "a credential broker" is — and so that the oracle cannot be satisfied
 * by a file that happens to construct its own, subtly different, broker.
 */

import { fixedClock, type Clock } from '@factory/core';

import {
  CredentialBroker,
  FakeCredentialProvider,
  InMemoryCredentialLeaseStore,
  RedactionRegistry,
  type CredentialBrokerOptions,
} from '../../packages/credentials/src/index.ts';

/**
 * A clock frozen at a known instant.
 *
 * The instant is arbitrary but fixed, so the expiry arithmetic in the
 * tests is exact rather than approximate.
 */
export const THE_CLOCK: Clock = fixedClock(new Date('2026-11-10T00:00:00.000Z'));

/**
 * The options a test may override.
 */
export interface CredentialHarnessOptions {
  /** The clock. */
  readonly clock?: Clock;
  /** The provider, for the failure cases. */
  readonly provider?: FakeCredentialProvider;
  /** The redaction registry, for the tests that need one. */
  readonly redaction?: RedactionRegistry;
  /** The id source. */
  readonly nextId?: () => string;
  /** The lease store. */
  readonly leases?: InMemoryCredentialLeaseStore;
}

/**
 * The broker, and the doubles it was built with.
 */
export interface CredentialHarness {
  readonly broker: CredentialBroker;
  readonly provider: FakeCredentialProvider;
  readonly leases: InMemoryCredentialLeaseStore;
  readonly redaction: RedactionRegistry;
  readonly clock: Clock;
}

/**
 * Build a credential broker.
 */
export const buildCredentialBroker = (
  options: CredentialHarnessOptions = {},
): CredentialHarness => {
  const clock = options.clock ?? THE_CLOCK;
  const provider = options.provider ?? new FakeCredentialProvider({ clock });
  const leases = options.leases ?? new InMemoryCredentialLeaseStore();
  const redaction = options.redaction ?? new RedactionRegistry('task_1');

  let counter = 0;
  const nextId = options.nextId ?? (() => {
    counter += 1;
    return `crd_${String(counter).padStart(6, '0')}`;
  });

  const brokerOptions: CredentialBrokerOptions = {
    leases,
    provider,
    clock,
    nextId,
    redaction,
  };

  return {
    broker: new CredentialBroker(brokerOptions),
    provider,
    leases,
    redaction,
    clock,
  };
};

/**
 * A capability that needs a credential.
 *
 * The capability's `scope.required` and `credentials.permissions` are
 * what the scope computation reads, so a test that changes them changes
 * the credential's scope.
 */
export const aCredentialCapability = (
  overrides: {
    readonly id?: string;
    readonly required?: readonly string[];
    readonly permissions?: Readonly<Record<string, 'read' | 'write'>>;
    readonly provider?: string;
    readonly ttlSeconds?: number;
  } = {},
) => ({
  id: overrides.id ?? 'github.pr.create',
  version: '1.0.0',
  owner: 'factory-platform',
  kind: 'mutation' as const,
  transport: 'http' as const,
  effect: { class: 'E2' as const, reversible: false, external: true },
  scope: {
    required: [...(overrides.required ?? ['repo:write:pr'])],
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
  },
  credentials: {
    provider: overrides.provider ?? 'github',
    permissions: { ...(overrides.permissions ?? { pull_requests: 'write' }) },
    ttlSeconds: overrides.ttlSeconds ?? 3600,
  },
  trust: { inputTrust: 'trusted' as const, resultTrust: 'trusted' as const },
  health: { check: 'the GitHub API is reachable', timeoutMs: 30000, degraded: 'degraded' },
  observability: { redactArguments: [] },
  cost: { unit: 'call', usdMicros: 0 },
});

/**
 * An invocation context.
 */
export const anInvocationContext = (
  overrides: { readonly taskId?: string } = {},
) => ({
  taskId: overrides.taskId ?? 'task_1',
  nodeId: 'node_1' as const,
  attempt: 1,
  runId: 'run_1',
  actor: { kind: 'agent' as const, id: 'agent_1' },
  workflow: 'wf_test',
  stage: 'pr',
  autonomy: 2 as const,
});
