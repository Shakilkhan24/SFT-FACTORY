/**
 * `gateway` — the model gateway (checklist 03, T-1.10).
 *
 * pack 02 §4.7 [BP: 11 §9, ADR-0012]:
 *
 * * `complete(request)`: resolve route from `routing-policy.yaml` (role
 *   → model, fallbacks) → **budget check before the call** (request /
 *   task / workflow / day) → idempotency lookup
 *   `(taskId,nodeId,attempt,promptSha256,modelVersion)` → provider call
 *   with a timeout and bounded retry → usage + cost into `model_calls`
 *   and the `model.requested|failed|failedOver` events → return
 *   `{content, toolCalls, usage, model, routingDecision, cached}`.
 * * **Structured output:** `responseFormat: json-schema` is implemented
 *   portably (forced single tool call whose input schema is the JSON
 *   schema); the result is always re-validated with Zod; one repair
 *   attempt counts as a retry.
 * * **Failover** triggers: provider error, rate-limited, repeated schema
 *   failure. **Budget exhaustion never fails over** — it halts with
 *   `budget.exhausted`.
 * * **Prompt caching:** cache breakpoints at the end of the stable prefix
 *   only; the untrusted envelope and task come after.
 * * **Startup check:** call the provider's models list and refuse routes
 *   naming unknown models.
 *
 * The package has these parts:
 *
 * * `types.ts` — the gateway's own vocabulary.
 * * `routing.ts` — the routing decision (pure).
 * * `pricing.ts` — the pricing table and the integer micro-USD cost
 *   computation (pure).
 * * `budget.ts` — the budget check (pure).
 * * `structured.ts` — the portable structured output (pure).
 * * `caching.ts` — the cache breakpoints (pure).
 * * `idempotency.ts` — the idempotency key (pure).
 * * `gateway.ts` — the pipeline that ties them together.
 * * `providers/` — the adapters, and the only place provider-specific
 *   behaviour lives.
 * * `definition.ts` — the loaders for `routing-policy.yaml` and
 *   `pricing.yaml`.
 * * `postgres/` — the `model_calls` writer.
 * * `fakes/` — the doubles the oracle lives in.
 */

export {
  BUDGET_EXHAUSTED_TRIGGER,
  BUDGET_SCOPES,
  FAILOVER_TRIGGERS,
  MODEL_CALL_STATUSES,
  type BudgetScope,
  type FailoverTrigger,
  type GatewayEvent,
  type ModelCallRecord,
  type ModelCallStatus,
  type PriceEntry,
  type PricingTable,
  type Route,
  type RouteCandidate,
  type TokenCounts,
} from './types.js';

export {
  resolveRoute,
  validateRoutingPolicy,
  type RouteResolution,
  type RoutingInput,
  type RoutingPolicyProblem,
} from './routing.js';

export {
  costOfCall,
  costOfTokens,
  priceCall,
  projectCost,
  type PricingResult,
} from './pricing.js';

export {
  checkModel,
  checkPolicyModels,
  isPlaceholder,
  readCatalog,
  type CatalogState,
  type ModelCheck,
} from './catalog.js';

export {
  checkBudget,
  remainingOf,
  type BudgetAmount,
  type BudgetCheck,
  type BudgetState,
  type Remaining,
} from './budget.js';

export {
  extractStructured,
  forcedToolFor,
  FORCED_TOOL_DESCRIPTION,
  FORCED_TOOL_NAME,
  revalidate,
  repairInstruction,
  SCHEMA_INVALID_TRIGGER,
  STRUCTURED_ATTEMPTS,
  STRUCTURED_FAILURE_CLASS,
  toolsFor,
  type StructuredValidation,
} from './structured.js';

export {
  blocksWithBreakpoint,
  cacheKeyFor,
  stablePrefixOf,
  STABLE_PREFIX_BLOCK_IDS,
  type StablePrefix,
} from './caching.js';

export {
  idempotencyKey,
  promptDigest,
  type IdempotencyParts,
} from './idempotency.js';

export {
  type BudgetLedger,
  type GatewayEventSink,
  type ModelCallStore,
  type ModelCatalog,
  type ProviderAdapter,
} from './ports.js';

export {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  ModelGatewayImpl,
  type ModelGatewayOptions,
} from './gateway.js';

export {
  DEFINITION_ROOT,
  parsePricingTable,
  parseRoutingPolicy,
  PRICING_KIND,
  readPricingTable,
  readRoutingPolicy,
} from './definition.js';

export { InMemoryModelCallStore } from './fakes/in-memory-model-call-store.js';

export {
  FakeBudgetLedger,
  type FakeBudgetLedgerOptions,
} from './fakes/fake-budget-ledger.js';

export {
  PostgresModelCallStore,
  type PostgresModelCallStoreOptions,
} from './postgres/model-call-store.js';

export {
  ADAPTER_TOKEN,
  createAdapter,
  guard,
  isConstructed,
  type AdapterKind,
  type AdapterOptions,
  type AnthropicAdapterOptions,
  type ConstructedAdapter,
  type FakeAdapterOptions,
  type OpenAiCompatibleAdapterOptions,
} from './providers/factory.js';

// The fake provider is re-exported so a test can inspect what it was
// asked. It is the **only** adapter a consumer may hold directly — the
// real ones are constructed by the factory and handed to the gateway.
export {
  FakeProvider,
  type FakeCall,
  type FakeProviderOptions,
} from './providers/fake.js';

export const packageName = 'gateway';
