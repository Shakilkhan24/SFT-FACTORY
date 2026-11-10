/**
 * The broker's test fixtures.
 *
 * ## Why the helpers exist
 *
 * The broker's ten steps are proved by *what they observe*: which steps
 * ran, in what order, and what was called. So the helpers here are all
 * **recording doubles** — they remember what they were asked to do.
 *
 * ## The step recorder
 *
 * The recorder is the ticket's headline oracle's instrument. It records
 * every step the broker runs, so a test can assert the **exact** order of
 * the ten steps and that a failure at step *n* stops the pipeline at step
 * *n*.
 *
 * It is a **recording** double rather than a spy on the internals: the
 * broker pushes onto it as it goes, so the order it records *is* the
 * order the broker ran.
 */

import type {
  InvocationContext,
  PolicyBundle,
  ResolvedCredential,
  ToolCapability,
} from '../../packages/contracts/src/index.ts';
import { evaluate } from '../../packages/policy/src/index.ts';
import {
  InMemoryCapabilityRegistry,
  InMemoryInvocationStore,
  ToolBroker,
  type BrokerClock,
  type BrokerEvent,
  type BrokerIdSource,
  type InvocationRequest,
  type RegistryEntry,
} from '../../packages/broker/src/index.ts';

/**
 * The steps the broker reports, in the order it ran them.
 */
export class StepRecorder {
  readonly steps: string[] = [];

  /** Record a step. */
  public record(step: string): void {
    this.steps.push(step);
  }

  /** The steps, as a frozen copy. */
  public snapshot(): readonly string[] {
    return [...this.steps];
  }
}

/**
 * A recording approval checker.
 */
export class RecordingApprovalChecker {
  /** The calls the checker received. */
  readonly calls: {
    readonly capabilityId: string;
    readonly argsSha256: string;
  }[] = [];

  /** Whether an approval exists. */
  approved: boolean;

  /** The id the checker names, when there is one. */
  readonly id: string | undefined;

  constructor(options: { readonly approved?: boolean; readonly approvalId?: string } = {}) {
    this.approved = options.approved ?? true;
    this.id = options.approvalId ?? 'apr_test';
  }

  public hasApproval(
    capabilityId: string,
    argsSha256: string,
  ): Promise<boolean> {
    this.calls.push({ capabilityId, argsSha256 });
    return Promise.resolve(this.approved);
  }

  public approvalId(): Promise<string | undefined> {
    return Promise.resolve(this.id);
  }
}

/**
 * A recording credential provider.
 *
 * It records what it was asked for, so a test can prove that a credential
 * was **not** acquired for a call that failed earlier — which is the point
 * of step 1 running first.
 */
export class RecordingCredentialProvider {
  readonly calls: {
    readonly capabilityId: string;
  }[] = [];

  /** The credential, when one is returned. */
  readonly credential: ResolvedCredential | undefined;

  constructor(options: { readonly secret?: string } = {}) {
    this.credential =
      options.secret === undefined
        ? undefined
        : {
            credId: 'cred_test',
            provider: 'github',
            scope: { repository: 'org/repo' },
            expiresAt: '2026-11-10T00:00:00.000Z',
            secret: options.secret,
          };
  }

  public resolve(
    capability: ToolCapability,
  ): Promise<ResolvedCredential | undefined> {
    this.calls.push({ capabilityId: capability.id });
    return Promise.resolve(this.credential);
  }
}

/**
 * A clock that does not move unless a test moves it.
 */
export class FixedBrokerClock implements BrokerClock {
  #at: number;

  constructor(at = 0) {
    this.#at = at;
  }

  public now(): Date {
    return new Date(this.#at);
  }

  /** Move the clock forward. */
  public advance(ms: number): void {
    this.#at += ms;
  }
}

/**
 * An id source that counts.
 */
export class CountingIdSource implements BrokerIdSource {
  #next = 1;

  public next(): string {
    const id = `inv_test_${String(this.#next).padStart(4, '0')}`;
    this.#next += 1;
    return id;
  }
}

/**
 * A capability, with the fields the broker reads.
 */
export const aCapability = (overrides: Partial<ToolCapability> = {}): ToolCapability => ({
  id: 'test.capability',
  version: '1.0.0',
  owner: 'factory-platform',
  kind: 'read',
  transport: 'inproc',
  effect: {
    class: 'E0',
    reversible: true,
    external: false,
  },
  scope: {
    required: ['repo:read'],
    resourcePattern: 'repo:{owner}/{name}',
    environment: 'orchestrator',
  },
  credentials: {
    provider: '',
    permissions: {},
    ttlSeconds: 60,
  },
  trust: {
    inputTrust: 'trusted',
    resultTrust: 'trusted',
  },
  health: {
    check: 'always healthy',
    timeoutMs: 1000,
    degraded: 'degraded',
  },
  observability: {
    redactArguments: [],
  },
  cost: {
    unit: 'call',
    usdMicros: 0,
  },
  ...overrides,
});

/**
 * A registry entry.
 */
export const anEntry = (
  capability: ToolCapability,
  schemas: {
    readonly inputSchema?: unknown;
    readonly outputSchema?: unknown;
  } = {},
): RegistryEntry => ({
  capability,
  ...(schemas.inputSchema === undefined ? {} : { inputSchema: schemas.inputSchema }),
  ...(schemas.outputSchema === undefined ? {} : { outputSchema: schemas.outputSchema }),
  availability: 'available',
});

/**
 * An invocation context.
 */
export const aContext = (overrides: Partial<InvocationContext> = {}): InvocationContext => ({
  taskId: 'task_1',
  nodeId: 'node_1',
  attempt: 1,
  runId: 'run_1',
  actor: { kind: 'agent', id: 'agent_1' },
  workflow: 'workflow_1',
  stage: 'implement',
  autonomy: 2,
  ...overrides,
});

/**
 * A grant that allows the ordinary capability.
 */
export const aGrant = (overrides: Partial<{
  readonly id: string;
  readonly capabilities: readonly string[];
  readonly scopes: readonly string[];
  readonly deny: readonly string[];
  readonly repo: string;
  readonly writeGlobs: readonly string[];
  readonly denyGlobs: readonly string[];
}> = {}) => ({
  id: 'grant_1',
  capabilities: ['test.capability'],
  scopes: ['repo:read'],
  deny: [],
  ...overrides,
});

/**
 * A policy bundle that allows everything the broker asks about.
 *
 * The broker's tests are about the **broker**, not the policy engine — the
 * engine has its own suite. So the bundle here is the simplest one that
 * produces an `ALLOW` for an E0 read inside a grant.
 */
export const anAllowingBundle = (): PolicyBundle =>
  ({
    spec: {
      denyRules: [],
      protectedPaths: [],
      effectRules: { E0: 'allow', E1: 'allow', E2: 'allowIfResourceScoped', E3: 'requireApproval', E4: 'requireApproval' },
      tierRules: {},
      default: 'deny',
    },
  }) as unknown as PolicyBundle;

/**
 * A policy bundle that requires an approval for every E2 capability.
 */
export const anApprovalRequiringBundle = (): PolicyBundle =>
  ({
    spec: {
      denyRules: [],
      protectedPaths: [],
      effectRules: { E0: 'allow', E1: 'allow', E2: 'requireApproval', E3: 'requireApproval', E4: 'requireApproval' },
      tierRules: {},
      default: 'deny',
    },
  }) as unknown as PolicyBundle;

/**
 * A policy bundle that denies everything.
 */
export const aDenyingBundle = (): PolicyBundle =>
  ({
    spec: {
      denyRules: [],
      protectedPaths: [],
      effectRules: { E0: 'deny', E1: 'deny', E2: 'deny', E3: 'requireApproval', E4: 'requireApproval' },
      tierRules: {},
      default: 'deny',
    },
  }) as unknown as PolicyBundle;

/**
 * The registry the broker tests use.
 */
export const aRegistry = (
  entries: readonly RegistryEntry[] = [anEntry(aCapability())],
): InMemoryCapabilityRegistry => new InMemoryCapabilityRegistry(entries);

/**
 * The invocation store the broker tests use.
 */
export const aStore = (): InMemoryInvocationStore => new InMemoryInvocationStore();

/**
 * The events a store recorded.
 */
export const storedEvents = (store: InMemoryInvocationStore): readonly BrokerEvent[] =>
  store.events();

/**
 * The options for the shared broker builder.
 */
export interface BrokerHarnessOptions {
  /** The capabilities the registry holds. */
  readonly entries?: readonly RegistryEntry[];
  /** The policy bundle the evaluator evaluates against. */
  readonly policyBundle?: PolicyBundle;
  /** Whether the approval checker finds an approval. */
  readonly approved?: boolean;
  /** The approval id the checker names. */
  readonly approvalId?: string;
  /** The secret the credential provider hands out. */
  readonly secret?: string;
  /** The invocation timeout, in milliseconds. */
  readonly timeoutMs?: number;
  /** What the adapter returns. */
  readonly handler?: (
    args: unknown,
    credential: ResolvedCredential | undefined,
    signal: AbortSignal,
  ) => unknown;
  /** A policy evaluator that replaces the real one. */
  readonly evaluatePolicy?: (
    input: Parameters<typeof evaluate>[0],
    bundle: PolicyBundle,
  ) => ReturnType<typeof evaluate>;
}

/**
 * The broker, with every collaborator instrumented.
 *
 * ## Why one builder
 *
 * Eight test files each built the same broker from the same doubles. That
 * duplication is not harmless: it means a change to the broker's wiring has
 * to be made in eight places, and it silently lets two files disagree about
 * what "the broker" is. So the builder lives **here**, next to the doubles
 * it wires together, and each test file overrides only the one thing it is
 * about.
 *
 * The doubles it wires are all **recording** ones, so a test can always ask
 * what happened without a spy on the broker's internals.
 */
export const buildBroker = (
  options: BrokerHarnessOptions = {},
): {
  readonly broker: ToolBroker;
  readonly store: InMemoryInvocationStore;
  readonly approvals: RecordingApprovalChecker;
  readonly credentials: RecordingCredentialProvider;
  /** The arguments the adapter was called with, in order. */
  readonly invoked: {
    readonly args: unknown;
    readonly credential: ResolvedCredential | undefined;
  }[];
  /** The abort signals the adapter was given, in order. */
  readonly signals: AbortSignal[];
  /** The guard token the factory handed out. */
  readonly guardToken: symbol;
  /** The guard tokens the adapter was invoked with, in order. */
  readonly tokens: symbol[];
} => {
  const store = aStore();
  const approvals = new RecordingApprovalChecker({
    ...(options.approved === undefined ? {} : { approved: options.approved }),
    ...(options.approvalId === undefined ? {} : { approvalId: options.approvalId }),
  });
  const credentials = new RecordingCredentialProvider(
    options.secret === undefined ? {} : { secret: options.secret },
  );

  const entries = options.entries ?? [anEntry(aCapability())];

  // The policy engine needs the scope the capability requires — the grant
  // check compares the grant's scopes against it (pack 04 §5).
  const requiredScope = entries[0]?.capability.scope.required[0] ?? 'repo:read';

  const invoked: {
    readonly args: unknown;
    readonly credential: ResolvedCredential | undefined;
  }[] = [];
  const signals: AbortSignal[] = [];
  const tokens: symbol[] = [];

  // The factory's token — the one and only token the broker may pass to
  // an adapter (A0.2). It is created once, so a test can compare the
  // token the adapter received against the token the factory holds.
  const guardToken = Symbol('test-token');

  const broker = new ToolBroker({
    registry: aRegistry(entries),
    policy: {
      evaluate:
        options.evaluatePolicy === undefined
          ? (input, bundle) =>
              evaluate(input, bundle, {
                workflowGrant: { allow: [requiredScope], deny: [] },
                requiredScope,
              })
          : options.evaluatePolicy,
    },
    policyBundle: options.policyBundle ?? anAllowingBundle(),
    adapters: {
      adapterFor: () =>
        Promise.resolve({
          describe: () => [],
          invoke: (
            _id: string,
            args: unknown,
            credential: ResolvedCredential | undefined,
            signal: AbortSignal,
            token: symbol,
          ) => {
            invoked.push({ args, credential });
            signals.push(signal);
            tokens.push(token);
            // The handler is called inside the promise chain, so a
            // synchronous throw becomes a **rejected** promise — the same
            // shape a real adapter's failure has.
            return Promise.resolve()
              .then(() =>
                options.handler === undefined
                  ? { ok: true }
                  : options.handler(args, credential, signal),
              );
          },
          health: () => Promise.resolve('healthy' as const),
          close: () => Promise.resolve(undefined),
        }),
      guardToken: () => guardToken,
    },
    approvals,
    credentials,
    store,
    clock: new FixedBrokerClock(),
    ids: new CountingIdSource(),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  return { broker, store, approvals, credentials, invoked, signals, guardToken, tokens };
};

/**
 * A request to the broker.
 */
export const aRequest = (
  overrides: Partial<InvocationRequest> = {},
): InvocationRequest => ({
  capabilityId: 'test.capability',
  args: {},
  context: aContext(),
  grant: aGrant(),
  ...overrides,
});
