/**
 * The gateway's test fixtures.
 *
 * ## What the helpers are for
 *
 * The gateway's rules are proved by **what they observe**: which
 * provider was called, what was recorded, which events were emitted.
 * So the helpers here are all **recording doubles** — they remember
 * what they were asked to do.
 *
 * The **fake provider** is the most important of them. It is not a
 * stub: it is an adapter with the same shape as a real one, plus the
 * two controls a test needs — an injected error, and a record of every
 * call. INV-9's failover oracle needs exactly that: *"Fake provider A
 * errors ⇒ routed to B with `model.failedOver`."*
 */

import type { ModelRequest, RoutingPolicy } from '../../packages/contracts/src/index.ts';
import {
  FakeBudgetLedger,
  InMemoryModelCallStore,
  ModelGatewayImpl,
  createAdapter,
  type FakeAdapterOptions,
  type FakeProvider,
  type ModelGatewayOptions,
  type PricingTable,
} from '../../packages/gateway/src/index.ts';

/**
 * The clock the gateway's tests run on.
 *
 * AGENTS.md §4: "Time via injected `Clock`." The gateway's own clock
 * is a plain object with `now()` and `nowIso()` — the smallest thing
 * that satisfies it.
 */
export const THE_CLOCK = {
  now: (): Date => new Date('2026-11-10T00:00:00.000Z'),
  nowIso: (): string => '2026-11-10T00:00:00.000Z',
};

/**
 * The pricing table the gateway's tests use.
 *
 * The prices are **deliberately round**, so a golden cost test can
 * assert an exact integer without the arithmetic being the thing
 * under test.
 *
 * The model ids are the corpus's example ids — they live in the
 * *test*, which is where a test may name them; INV-9's rule is that
 * they may not appear in the gateway's **source**.
 */
export const THE_PRICING: PricingTable = {
  'test-model-small': {
    inputPerMillionUsdMicros: 100_000,
    outputPerMillionUsdMicros: 500_000,
    cacheReadPerMillionUsdMicros: 10_000,
    cacheWritePerMillionUsdMicros: 125_000,
  },
  'test-model-large': {
    inputPerMillionUsdMicros: 1_500_000,
    outputPerMillionUsdMicros: 7_500_000,
    cacheReadPerMillionUsdMicros: 150_000,
    cacheWritePerMillionUsdMicros: 1_875_000,
  },
};

/**
 * A routing policy with two providers and two classes.
 *
 * The primary provider is `alpha`; the fallback is `beta`. The policy
 * declares both, so the failover path is exercisable.
 */
export const THE_POLICY: RoutingPolicy = {
  apiVersion: 'factory/v1',
  kind: 'RoutingPolicy',
  metadata: { name: 'test' },
  spec: {
    providers: {
      alpha: { adapter: 'fake' },
      beta: { adapter: 'fake' },
    },
    classes: {
      cheap: {
        primary: { provider: 'alpha', model: 'test-model-small' },
        fallbacks: [{ provider: 'beta', model: 'test-model-small' }],
      },
      strong: {
        primary: { provider: 'alpha', model: 'test-model-large' },
        fallbacks: [{ provider: 'beta', model: 'test-model-large' }],
      },
    },
    rules: [
      { match: { role: 'worker' }, use: 'cheap' },
      { match: { role: 'planner' }, use: 'strong' },
    ],
    budgets: {
      perRequestUsdMicros: 1_500_000,
      perTaskUsdMicros: 5_000_000,
      perWorkflowDayUsdMicros: 50_000_000,
    },
    failover: {
      on: ['provider-error', 'rate-limited', 'schema-invalid-twice'],
      neverOn: ['budget-exhausted'],
    },
    caching: { prefix: true },
  },
};

/**
 * A model request.
 *
 * The defaults are the smallest request that still routes: the `worker`
 * role, one user message, one attempt.
 */
export const aRequest = (
  overrides: Partial<ModelRequest> = {},
): ModelRequest => ({
  role: 'worker',
  taskId: 'task_1',
  nodeId: 'node_1',
  attempt: 1,
  messages: [{ role: 'user', content: 'hello' }],
  ...overrides,
});

/**
 * The gateway's fixtures.
 */
export interface GatewayFixture {
  /** The gateway under test. */
  readonly gateway: ModelGatewayImpl;
  /** The primary provider. */
  readonly alpha: FakeProvider;
  /** The fallback provider. */
  readonly beta: FakeProvider;
  /** The call store. */
  readonly calls: InMemoryModelCallStore;
  /** The budget ledger. */
  readonly ledger: FakeBudgetLedger;
  /** The events the gateway emitted. */
  readonly events: readonly {
    readonly eventType: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }[];
}

/**
 * The options for {@link buildGateway}.
 */
export interface BuildGatewayOptions {
  /** The routing policy. Defaults to {@link THE_POLICY}. */
  readonly policy?: RoutingPolicy;
  /** The pricing table. Defaults to {@link THE_PRICING}. */
  readonly pricing?: PricingTable;
  /** The primary provider's options. */
  readonly alpha?: FakeAdapterOptions;
  /** The fallback provider's options. */
  readonly beta?: FakeAdapterOptions;
  /** The per-task budget, in micro-USD. */
  readonly perTaskUsdMicros?: number;
  /** The per-request budget, in micro-USD. */
  readonly perRequestUsdMicros?: number;
  /** The per-workflow-day budget, in micro-USD. */
  readonly perWorkflowDayUsdMicros?: number;
  /** The Zod schema for a structured answer. */
  readonly structuredSchema?: ModelGatewayOptions['structuredSchema'];
  /** The maximum output tokens a request may ask for. */
  readonly maxOutputTokens?: number;
  /** The model version. */
  readonly modelVersion?: string;
}

/**
 * Build a gateway with two fake providers.
 *
 * The providers are built through the **factory** — the same path a
 * real adapter takes — so the runtime guard is exercised by every
 * test that uses this helper. A provider constructed outside the
 * factory would be refused by the gateway, which is the point of the
 * guard.
 */
export const buildGateway = (
  options: BuildGatewayOptions = {},
): GatewayFixture => {
  const alphaOptions: FakeAdapterOptions = {
    models: ['test-model-small', 'test-model-large'],
    ...options.alpha,
  };

  const betaOptions: FakeAdapterOptions = {
    models: ['test-model-small', 'test-model-large'],
    ...options.beta,
  };

  // The providers are constructed by the **factory** — the same path a
  // real adapter takes — so the runtime guard is exercised by every
  // test that uses this helper.
  //
  // The factory returns the adapter the gateway holds, so the test's
  // handle and the gateway's adapter are the **same object**: a test
  // can then assert on what the provider was asked.
  const alphaAdapter = createAdapter('fake', 'alpha', alphaOptions);
  const betaAdapter = createAdapter('fake', 'beta', betaOptions);

  const alpha = alphaAdapter as unknown as FakeProvider;
  const beta = betaAdapter as unknown as FakeProvider;

  const calls = new InMemoryModelCallStore();

  const ledger = new FakeBudgetLedger({
    calls,
    ...(options.perTaskUsdMicros === undefined
      ? {}
      : { perTaskUsdMicros: options.perTaskUsdMicros }),
    ...(options.perRequestUsdMicros === undefined
      ? {}
      : { perRequestUsdMicros: options.perRequestUsdMicros }),
    ...(options.perWorkflowDayUsdMicros === undefined
      ? {}
      : { perWorkflowDayUsdMicros: options.perWorkflowDayUsdMicros }),
  });

  const events: {
    eventType: string;
    payload: Readonly<Record<string, unknown>>;
  }[] = [];

  let counter = 0;

  const gateway = new ModelGatewayImpl({
    policy: options.policy ?? THE_POLICY,
    pricing: options.pricing ?? THE_PRICING,
    providers: {
      alpha: alphaAdapter,
      beta: betaAdapter,
    },
    ledger,
    calls,
    events: {
      append: (event): Promise<void> => {
        events.push({ eventType: event.eventType, payload: event.payload });
        return Promise.resolve();
      },
    },
    clock: THE_CLOCK,
    nextId: () => {
      counter += 1;
      return `mcl_${String(counter).padStart(6, '0')}`;
    },
    ...(options.structuredSchema === undefined
      ? {}
      : { structuredSchema: options.structuredSchema }),
    ...(options.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: options.maxOutputTokens }),
    ...(options.modelVersion === undefined
      ? {}
      : { modelVersion: options.modelVersion }),
  });

  return { gateway, alpha, beta, calls, ledger, events };
};
