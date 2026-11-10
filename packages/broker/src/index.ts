/**
 * `broker` — the capability registry and the ToolBroker (checklist 03,
 * T-1.08).
 *
 * blueprint 11 §1: *"Without a registry and a broker, an agent reaches a
 * tool directly and nothing checks whether it may."* This package is the
 * factory's **only** path to a capability.
 *
 * **What is here.**
 *
 * * `types.ts` — the vocabulary: the ten steps, the request, the outcome,
 *   the invocation record.
 * * `ports.ts` — the interfaces the broker talks to.
 * * `broker.ts` — **the ten-step pipeline**, in the fixed order.
 * * `registry.ts` — the registry model and the reconciliation rule.
 * * `grants.ts` — the `CapabilityGrant` → `EffectiveGrant` mapper.
 * * `idempotency.ts` — the two key shapes.
 * * `schema/json-schema.ts` — the subset validator, which **fails closed**
 *   on an unknown keyword.
 * * `adapters/` — the five transports, and the factory that is the only
 *   place an adapter is constructed.
 * * `mcp/` — the MCP client port, the protocol shapes, and the in-process
 *   fixture server.
 * * `postgres/` and `fakes/` — the two invocation stores.
 *
 * **What is not here.** Loading the definition's YAML (that is the
 * definition package's job), and the real credential broker (T-1.09).
 */

export const packageName = 'broker';

export {
  BROKER_FAILURE_CLASSES,
  BROKER_STEPS,
  stepNumberOf,
  type BrokerFailureClass,
  type BrokerStep,
  type BrokerStepNumber,
  type BrokerGrant,
  type InvocationOutcome,
  type InvocationRecord,
  type InvocationRequest,
  type InvocationResource,
  type ReconciliationFinding,
  type ReconciliationReport,
  type RegistryEntry,
} from './types.js';

export {
  type AdapterFactory,
  type ApprovalChecker,
  type BrokerClock,
  type BrokerEvent,
  type BrokerIdSource,
  type CapabilityRegistry,
  type CredentialProvider,
  type CredentialReference,
  type InvocationStore,
  type PolicyEvaluator,
  type ToolAdapter,
} from './ports.js';

export { ToolBroker, type ToolBrokerOptions } from './broker.js';

export {
  InMemoryCapabilityRegistry,
  reconcileAgainst,
} from './registry.js';

export {
  effectiveGrantOf,
  policyGrantOf,
  requiredScopeOf,
} from './grants.js';

export {
  argsDigest,
  externalIdempotencyKey,
  idempotencyKeyFor,
  toolIdempotencyKey,
} from './idempotency.js';

export { validate, type ValidationResult } from './schema/json-schema.js';

export {
  AdapterGuardError,
  DefaultAdapterFactory,
  assertGuardToken,
  type AdapterBuilders,
  type AdapterTransport,
  type GuardToken,
} from './adapters/factory.js';

export {
  InprocAdapter,
  type InprocHandler,
} from './adapters/inproc.js';

export {
  CREDENTIAL_ARGUMENT_KEY,
  LibraryAdapter,
  type LibraryHandler,
} from './adapters/library.js';

export {
  CliAdapter,
  substituteTokens,
  type CliCapability,
  type SpawnFunction,
} from './adapters/cli.js';

export {
  HttpAdapter,
  substituteUrl,
  type FetchFunction,
  type HttpCapability,
} from './adapters/http.js';

export {
  McpAdapter,
  type McpCapability,
} from './adapters/mcp.js';

export type { AdapterCapability, ToolAdapterLike } from './adapters/types.js';

export type { McpClient } from './mcp/client.js';

export {
  FixtureMcpServer,
  type FixtureTool,
} from './mcp/fixture-server.js';

export { InProcessMcpClient } from './mcp/in-process-client.js';

export {
  JSONRPC_VERSION,
  MCP_PROTOCOL_VERSION,
  McpError,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpContentBlock,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolDescriptor,
  type McpToolListResult,
} from './mcp/protocol.js';

export {
  InMemoryInvocationStore,
  type StoredInvocation,
} from './fakes/in-memory-invocation-store.js';

export {
  PostgresInvocationStore,
  type PostgresInvocationStoreOptions,
} from './postgres/invocation-store.js';
