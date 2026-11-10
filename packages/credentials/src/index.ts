/**
 * `credentials` — the credential broker and the secret store.
 *
 * checklist 03, T-1.09. blueprint 11 §7; pack 04 §2.2 + §10; pack 02 §4.6.
 *
 * ## What this package is for
 *
 * The factory's credentials are the highest-value secret in the system.
 * This package holds the machinery that keeps them that way:
 *
 * * the **secret store** — the process's control-plane secrets, loaded
 *   once, never written anywhere;
 * * the **scope computation** — the intersection of what a capability
 *   needs, what a grant allows, and what the resource is;
 * * the **credential broker** — mint, resolve, revoke;
 * * the **redaction registry** — the exact strings and the patterns that
 *   must never appear in an artefact, an event or a log;
 * * the **lease store** — the durable record of a credential, carrying
 *   its reference and never its material.
 *
 * ## The three rules this package holds
 *
 * 1. **The material is never written.** Not to the lease, not to an
 *    event, not to a log, not to an artefact.
 * 2. **The material is injected only at the invocation boundary** —
 *    broker step 7, and nowhere else.
 * 3. **The credential dies with the task** — revoked in a `finally` at
 *    every terminal state, and reaped when the process dies first.
 */

export const packageName = 'credentials';

export {
  canonicalNameOf,
  loadSecretStore,
  MissingSecretError,
  readSecret,
  SECRET_INVENTORY,
  secretStoreFromEnvironment,
  secretStoreOf,
  type ControlPlaneSecretStore,
  type SecretDescriptor,
} from './secret-store.js';

export {
  computeEffectiveScope,
  effectiveTtlSeconds,
  FACTORY_SCOPES,
  GITHUB_PERMISSIONS,
  MAX_CREDENTIAL_TTL_SECONDS,
  narrowPermissionsToGrant,
  toCredentialScope,
  type EffectiveScope,
  type FactoryScope,
  type GithubPermission,
  type PermissionLevel,
  type ScopeInputs,
} from './scope.js';

export {
  CredentialBroker,
  type CredentialBrokerOptions,
  type CredentialLease,
  type CredentialLeaseStore,
  type CredentialMintProvider,
  type MintedCredential,
  type MintRequest,
  type MintResult,
  type MintTaskRequest,
} from './broker.js';

export {
  BrokerCredentialProviderAdapter,
  brokerCredentialProvider,
  CredentialUnavailableError,
  resolveCredential,
  type BrokerCredentialProvider,
  type CredentialProviderOptions,
} from './broker-provider.js';

export {
  REDACTION_PLACEHOLDER,
  RedactionRegistry,
  SECRET_WORDS,
  type Redaction,
  type RedactionResult,
  type RedactionRule,
} from './redaction.js';

export {
  FakeCredentialProvider,
  type FakeCredentialProviderOptions,
} from './fakes/fake-credential-provider.js';

export { InMemoryCredentialLeaseStore } from './fakes/in-memory-lease-store.js';

export { PostgresCredentialLeaseStore } from './postgres/lease-store.js';
