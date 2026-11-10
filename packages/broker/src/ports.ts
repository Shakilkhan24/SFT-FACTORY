/**
 * The ports the broker talks to.
 *
 * ## Why the broker owns its own ports
 *
 * pack 03 §3 names a `ToolBroker` and a `ToolAdapter`, and the contracts
 * already declare both. The broker still declares **narrow** ports of its
 * own for the five collaborators the ten-step pipeline needs, because:
 *
 * * the contracts' `ToolAdapter.invoke` has no notion of the runtime guard
 *   token (see `adapters/factory.ts`), so the contract's shape cannot be the
 *   one the adapters implement;
 * * the contracts' `CredentialBroker` is not built yet (T-1.09), and
 *   depending on it would mean depending on a speculative API;
 * * the contracts' `EventLog` is a full read/write log, while the broker
 *   only ever *appends* and needs the append to share a transaction with the
 *   invocation row.
 *
 * Every port here is narrow on purpose: the broker must be provable without
 * a database, a network, or a clock it does not control.
 */

import type {
  Decision,
  InvocationContext,
  PolicyBundle,
  PolicyInput,
  ResolvedCredential,
  ToolCapability,
} from '@factory/contracts';

import type {
  InvocationRecord,
  RegistryEntry,
  ReconciliationReport,
} from './types.js';

/**
 * The registry of capabilities (blueprint 11 §3.2).
 *
 * ## The rule this port exists to enforce
 *
 * blueprint 11 §3.2: *"The registry's capability records are authoritative.
 * A tool the registry does not list does not exist, even if an MCP server
 * advertises it."*
 *
 * So `lookup` returning `undefined` is not an error to be recovered from — it
 * is the answer. The broker must not ask a transport what it can do; it asks
 * the registry.
 */
export interface CapabilityRegistry {
  /**
   * The registry's entry for a capability.
   *
   * `undefined` means the capability **does not exist** — whether it was
   * never registered or was marked unavailable by a reconciliation.
   */
  lookup(capabilityId: string): RegistryEntry | undefined;

  /**
   * Every registered capability.
   *
   * Used by the reconciliation to find the capabilities a transport no
   * longer advertises.
   */
  list(): readonly RegistryEntry[];

  /**
   * Reconcile one transport's advertised capabilities against the registry.
   */
  reconcile(transport: string, advertised: readonly string[]): ReconciliationReport;
}

/**
 * The approval checker — broker step 6.
 *
 * ## Why the approval is bound to the arguments' digest
 *
 * blueprint 11 §6.2 step 6: the approval is *"bound to the arguments' hash"*.
 * An approval for one set of arguments is not an approval for another: if
 * the agent can change the arguments after the approval was granted, the
 * approval means nothing. The binding is therefore enforced here, by the
 * checker, and the broker passes the digest.
 */
export interface ApprovalChecker {
  /**
   * Whether an approval exists for this capability and these arguments.
   *
   * @param argsSha256 the digest of the *validated* arguments.
   */
  hasApproval(
    capabilityId: string,
    argsSha256: string,
    context: InvocationContext,
  ): Promise<boolean>;

  /**
   * The id of the approval that permitted the call, for the invocation
   * record. `undefined` when the checker has no approval to name.
   */
  approvalId?(
    capabilityId: string,
    argsSha256: string,
    context: InvocationContext,
  ): Promise<string | undefined>;
}

/**
 * The credential provider — broker step 7.
 *
 * pack 03 §3: the credential broker's `resolve` is *"INTERNAL: callable only
 * from broker step 7"*. This port is that seam. It returns the contracts'
 * `ResolvedCredential`, whose `secret` is held for the duration of **one**
 * invocation and never written anywhere.
 */
export interface CredentialProvider {
  /**
   * Resolve the credential for a capability, if it needs one.
   *
   * A capability whose `credentials.provider` is empty needs no credential,
   * and the broker must not ask for one — asking would mint a credential for
   * a capability that does not use it.
   */
  resolve(
    capability: ToolCapability,
    context: InvocationContext,
  ): Promise<ResolvedCredential | undefined>;
}

/**
 * The store for invocation records — broker step 10.
 *
 * The store writes **one** row and **one** event, in **one** transaction.
 * The interface takes a single record so that the atomicity is the store's
 * business rather than the broker's: the broker cannot half-write.
 */
export interface InvocationStore {
  /**
   * Write the invocation record and its event, atomically.
   */
  record(
    record: InvocationRecord,
    event: BrokerEvent,
  ): Promise<void>;

  /**
   * The record for an idempotency key, if the key has been used.
   *
   * blueprint 11 §6.4: *"a replayed key returns the **recorded** result."*
   * So the broker asks the store what a key produced last time, and returns
   * **that** — not a re-execution. A re-execution would perform the side
   * effect twice, which is the exact thing the idempotency key exists to
   * prevent.
   *
   * `undefined` means the key has not been used, so the call proceeds.
   */
  findByKey?(idempotencyKey: string): Promise<InvocationRecord | undefined>;
}

/**
 * The event the broker appends alongside the invocation record.
 *
 * The broker does not build an `EventEnvelope` — the log owns the identity,
 * the sequence number and the hash chain. It builds the *payload*, and the
 * store's writer assembles the envelope inside the transaction.
 */
export interface BrokerEvent {
  /** The event type, e.g. `tool.invoked`. */
  readonly eventType: string;
  /** The aggregate the event belongs to. */
  readonly aggregate: {
    readonly kind: 'task' | 'node' | 'run' | 'system';
    readonly id: string;
    readonly version: number;
  };
  /** The correlation id — the run the invocation belongs to. */
  readonly correlationId: string;
  /** Who made the call. */
  readonly actor: InvocationContext['actor'];
  /**
   * The authority under which the call was made.
   *
   * The contracts' `Authority` names the *basis* of the authority: a policy
   * decision, an approval, a human at an access point, or a system rule.
   * For an invocation the basis is the **policy decision** — that is what
   * permitted the call — and the approval id is carried when one was
   * required.
   */
  readonly authority: {
    readonly basis: 'human-access-point' | 'policy-decision' | 'approval' | 'system-rule';
    readonly policyDecisionId?: string;
    readonly approvalId?: string;
    readonly autonomyLevel?: 0 | 1 | 2 | 3 | 4;
    readonly violation?: boolean;
  };
  /** The payload. */
  readonly payload: unknown;
  /** The subject the event is about. */
  readonly subject?: Readonly<Record<string, string>>;
}

/**
 * The policy evaluation seam — broker step 5.
 *
 * The broker does not own the policy engine; the engine is pure and lives in
 * `@factory/policy`. But the broker must be able to **fail closed** if the
 * engine misbehaves, so the seam is a narrow interface rather than a direct
 * call: a test can supply an engine that throws, and the broker must deny.
 */
export interface PolicyEvaluator {
  /**
   * Evaluate the action.
   *
   * The broker wraps this in a try/catch and denies on any throw, so an
   * implementation that throws is safe. But the *policy* decision must also
   * be total: the engine itself never throws (pack 02 §4.4).
   */
  evaluate(input: PolicyInput, bundle: PolicyBundle): Decision;
}

/**
 * The adapter seam — broker step 8.
 *
 * ## Why the factory holds the token
 *
 * The ticket's A0.2 requires that adapters be constructible **only** inside
 * the broker module. A lint rule alone is bypassable (`--no-verify`); a
 * runtime guard alone is invisible in review. So both exist:
 *
 * * `adapters/factory.ts` holds a module-private `unique symbol` and is the
 *   only module that constructs an adapter;
 * * an adapter's `invoke` **requires** that token, so a direct adapter call
 *   fails even if the lint rule is not run.
 *
 * This port is what the broker holds: the broker receives a *ready* adapter
 * for a capability, and passes the token when it invokes it.
 */
export interface ToolAdapter {
  /** The capabilities this adapter serves. */
  describe(): readonly ToolCapability[];

  /**
   * Invoke a capability.
   *
   * @param token the runtime guard's private token. Only `adapters/factory.ts`
   *   can produce it.
   */
  invoke(
    capabilityId: string,
    args: unknown,
    credential: ResolvedCredential | undefined,
    signal: AbortSignal,
    token: symbol,
  ): Promise<unknown>;

  /** The adapter's health. */
  health(): Promise<'healthy' | 'degraded' | 'unavailable' | 'unknown'>;

  /** Release the adapter's resources. */
  close(): Promise<void>;
}

/**
 * The factory that produces an adapter for a capability.
 *
 * The broker asks the factory *by capability*, and the factory is the only
 * thing that knows about transports. The factory is also the only thing that
 * holds the guard token.
 */
export interface AdapterFactory {
  /**
   * The adapter for a capability, creating it if necessary.
   *
   * @throws when the capability's transport has no adapter registered. The
   *   broker turns this into `tool.unavailable`.
   */
  adapterFor(capability: ToolCapability): Promise<ToolAdapter>;

  /**
   * Invoke the guard's token.
   *
   * This is the *only* way to obtain the token, and it exists so the broker
   * — which lives in a different module from the factory — can pass it.
   */
  guardToken(): symbol;
}

/**
 * The clock seam.
 *
 * The broker records durations and expiries, so it needs the time. Injecting
 * it keeps the broker deterministic in tests.
 */
export interface BrokerClock {
  /** The current time. */
  now(): Date;
}

/**
 * The id seam.
 *
 * The broker mints invocation ids. Injecting the source keeps the broker
 * deterministic in tests and keeps the `inv` prefix in one place.
 *
 * It is the contracts' own `IdSource` shape, re-declared structurally so
 * that the broker does not depend on `@factory/core` for a one-method
 * interface.
 */
export interface BrokerIdSource {
  /** A new id. */
  next(): string;
}

/**
 * The credential's *reference* — what the invocation record carries.
 *
 * blueprint 11 §6.5: *"the credential's reference and scopes are recorded
 * but its material never is."* This type is the boundary: the broker's
 * record carries a `CredentialReference`, never a `ResolvedCredential`.
 */
export interface CredentialReference {
  readonly credId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}
