/**
 * The broker's vocabulary (pack 02 §4.5, blueprint 11 §6).
 *
 * ## What is here
 *
 * The ten steps, named and numbered; the request the broker is given; the
 * outcome it returns; and the shapes the registry, the idempotency ledger
 * and the reconciliation report use.
 *
 * ## What is not here
 *
 * The rules. The pipeline itself is in `broker.ts`; the ports it talks to
 * are in `ports.ts`. This file is the vocabulary those two share, and it
 * imports nothing but the contracts — so both the rules and their tests can
 * name the same things.
 */

import type {
  Actor,
  EffectClass,
  FailureClass,
  InvocationContext,
  ToolCapability,
} from '@factory/contracts';

/**
 * The ten steps of the broker's pipeline (blueprint 11 §6.2).
 *
 * ## The order is fixed, and it is the specification
 *
 * blueprint 11 §6.2: *"The order is fixed, and each step's failure is
 * terminal for that step."* The order is not an implementation detail — it
 * is what makes the pipeline safe:
 *
 * 1. **Schema validation** — *before anything else*. A malformed call
 *    never reaches policy, an adapter, or a credential. Validating later
 *    would mean a malformed call had already consumed a credential.
 * 2. **Deny-list** — before the grant, because a deny is terminal
 *    regardless of what any grant says.
 * 3. **Grant** — is the capability in the effective grant?
 * 4. **Resource-scope** — does the resource pattern match? A grant can
 *    permit a capability and still be scoped to a repository.
 * 5. **Policy evaluation** — the deterministic decision (ADR-0004).
 * 6. **Approval** — only if the policy demanded one.
 * 7. **Credential** — acquired and injected here, and *only* here.
 * 8. **Execution** — through the adapter, with a timeout.
 * 9. **Result validation** — and the trust tag.
 * 10. **Invocation record** — the row and the event.
 *
 * The numbering is used in the `tool.denied` payload's `step` field, so
 * the event log says *which* gate refused.
 */
export const BROKER_STEPS = [
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
] as const;

/**
 * The name of one of the ten steps.
 */
export type BrokerStep = (typeof BROKER_STEPS)[number];

/**
 * The step's **position**, counting from one.
 *
 * The `tool.denied` payload's `step` field carries this number, so an
 * auditor can see not just that a call was refused but *at which gate*.
 */
export type BrokerStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * The step's number, by name.
 *
 * An unknown name is a **programming error**, not a runtime condition, so
 * this throws rather than returning a fallback: a silently wrong step
 * number would be recorded in the event log as a fact.
 *
 * @throws {Error} when the name is not one of the ten steps.
 */
export const stepNumberOf = (step: BrokerStep): BrokerStepNumber => {
  const index = BROKER_STEPS.indexOf(step);
  if (index < 0) {
    throw new Error(`not a broker step: ${String(step)}`);
  }
  return (index + 1) as BrokerStepNumber;
};

/**
 * A capability's resource — the concrete target of a call.
 *
 * blueprint 11 §6.1's invocation contract carries a `resource` string. It
 * is modelled here as the pieces the scopes need, because a resource
 * *pattern* (`repo:{repo}`) is matched against a concrete value.
 */
export interface InvocationResource {
  /** The repository the call targets, when it targets one. */
  readonly repo?: string;
  /** The paths the call would touch, when it touches any. */
  readonly paths?: readonly string[];
  /** The host the call would reach, when it reaches one. */
  readonly host?: string;
}

/**
 * A request to invoke a capability.
 *
 * This is the broker's own request type, richer than the contracts'
 * `ToolCall`: the contract carries the call and the context, and the broker
 * adds the two things the *gates* need — the resource and the grant under
 * which the call is made.
 */
export interface InvocationRequest {
  /** The capability to invoke. */
  readonly capabilityId: string;
  /** The arguments, validated against the capability's `inputSchema`. */
  readonly args: unknown;
  /** Who is calling, and for which task and node. */
  readonly context: InvocationContext;
  /** The concrete target, for the resource-scope check. */
  readonly resource?: InvocationResource;
  /**
   * The grant the call is made under.
   *
   * blueprint 11 §6.1: `grantId`. The broker never *widens* a grant — it
   * only reads the one it is given, so a caller cannot hand the broker a
   * broader scope than its own.
   */
  readonly grant: BrokerGrant;
  /**
   * The idempotency key's extra component, for a call that is not keyed
   * by its arguments.
   *
   * blueprint 11 §6.4: an *external side effect* is keyed
   * `(taskId, nodeId, attempt, externalOperation)` — the operation's
   * identity, not its arguments' hash.
   */
  readonly externalOperation?: string;
}

/**
 * The grant a call is made under.
 *
 * ## Why the broker has its own grant type
 *
 * Two shapes of "grant" exist in the factory and they are not the same
 * thing:
 *
 * * The **definition's** `CapabilityGrant` document — what the workflow
 *   declares (pack 03 §4.5).
 * * The **policy engine's** `EffectiveGrant` — what the policy engine
 *   evaluates against (`@factory/policy`).
 *
 * The broker needs both: the definition's grant says *which capabilities*
 * and *which scopes*; the policy's grant says *what is allowed and what is
 * forbidden*. `grants.ts` maps one to the other.
 */
export interface BrokerGrant {
  /** The identifier of the grant, recorded in the invocation record. */
  readonly id: string;
  /** The capability ids the grant names. */
  readonly capabilities: readonly string[];
  /** The scopes the grant allows. */
  readonly scopes: readonly string[];
  /** The scopes or capability ids the grant forbids. */
  readonly deny: readonly string[];
  /** The repository the grant is scoped to, when it is scoped to one. */
  readonly repo?: string;
  /** The paths the grant allows writing to. */
  readonly writeGlobs?: readonly string[];
  /** The paths the grant forbids writing to. */
  readonly denyGlobs?: readonly string[];
}

/**
 * A capability as the registry holds it.
 *
 * The registry's entry is the contracts' `ToolCapability` plus the
 * *resolved* schemas. The definition's form carries `{$ref: 'schemas/…'}`
 * for its schemas; the registry resolves those refs so the broker never
 * has to know where a schema came from.
 */
export interface RegistryEntry {
  /** The capability, exactly as the contracts describe it. */
  readonly capability: ToolCapability;
  /**
   * The resolved `inputSchema`, when the capability declares one.
   *
   * A capability with **no** `inputSchema` accepts any arguments. That is
   * the definition's own choice, and it is recorded as such: the broker
   * does not invent a schema the capability did not declare.
   */
  readonly inputSchema?: unknown;
  /** The resolved `outputSchema`, when the capability declares one. */
  readonly outputSchema?: unknown;
  /**
   * Whether the capability is available.
   *
   * blueprint 11 §3.2: a registered capability an MCP server no longer
   * advertises is marked `unavailable`.
   */
  readonly availability: 'available' | 'unavailable';
}

/**
 * How a reconciliation went.
 *
 * blueprint 11 §3.2: *"The registry's capability records are
 * authoritative."* The reconciliation compares what a transport advertises
 * with what the registry holds, and reports both directions.
 */
export interface ReconciliationFinding {
  /** The capability id the finding is about. */
  readonly capabilityId: string;
  /**
   * What kind of discrepancy this is.
   *
   * * `advertised-but-unregistered` — the transport offers it, the registry
   *   does not list it. It **does not exist**: not offered, not callable.
   * * `registered-but-not-advertised` — the registry lists it, the
   *   transport does not offer it. The capability is marked `unavailable`.
   */
  readonly kind: 'advertised-but-unregistered' | 'registered-but-not-advertised';
  /** The transport that advertised it, for the first kind. */
  readonly transport?: string;
}

/**
 * The result of reconciling one transport against the registry.
 */
export interface ReconciliationReport {
  /** The transport that was reconciled, e.g. `mcp`. */
  readonly transport: string;
  /** The capability ids the transport advertised. */
  readonly advertised: readonly string[];
  /** The discrepancies found. */
  readonly findings: readonly ReconciliationFinding[];
}

/**
 * The outcome of an invocation.
 *
 * ## Why the broker returns its own shape
 *
 * The contracts' `ToolResult` is what an *agent* receives: the value, the
 * trust tag, whether it was replayed. The broker needs more than that to
 * be useful to a caller — which step refused, what the policy decided,
 * whether a credential was involved. That is here, and `ToolResult` is
 * *derived* from it.
 */
export type InvocationOutcome =
  | {
      /** The call succeeded. */
      readonly ok: true;
      /** The value, validated against the capability's `outputSchema`. */
      readonly value: unknown;
      /** The trust the capability declares for its results. */
      readonly trust: 'trusted' | 'untrusted';
      /** The invocation record's id. */
      readonly invocationId: string;
      /** True when the result came from the idempotency ledger. */
      readonly replayed: boolean;
      /** The steps that ran, in order. */
      readonly steps: readonly BrokerStep[];
    }
  | {
      /** The call failed. */
      readonly ok: false;
      /** The step that refused or failed. */
      readonly failedAt: BrokerStep;
      /** The step's number. */
      readonly stepNumber: BrokerStepNumber;
      /** Why. */
      readonly reason: string;
      /**
       * The failure's class.
       *
       * blueprint 11 §6.3: a schema failure is a **usage** error, not
       * `tool.unavailable`; a scope or policy refusal is `policy.denied`;
       * an adapter, timeout or output-schema failure is `tool.unavailable`.
       */
      readonly failureClass: FailureClass;
      /** The rule ids that produced the refusal, when a policy produced it. */
      readonly ruleIds?: readonly string[];
      /** The steps that ran before the failure, in order. */
      readonly steps: readonly BrokerStep[];
    };

/**
 * The failure classes the broker distinguishes.
 *
 * ## Why there is no `usage` class
 *
 * blueprint 11 §6.3 says a schema failure is *"a validation error; it is
 * retried only within the agent's own turn budget, and counted
 * separately"* — explicitly **not** `tool.unavailable`. The contracts'
 * `FailureClass` set has no usage class, and HR-12 forbids editing the
 * contracts inside this ticket.
 *
 * So a usage error carries `workflow.composition` and — the part that
 * matters — emits **no** `tool.*` event. It is counted by the absence of
 * a tool failure, not by a class of its own, so it cannot be mistaken for
 * a capability that was unavailable.
 */
export const BROKER_FAILURE_CLASSES = {
  /** The arguments did not match the capability's `inputSchema`. */
  usage: 'workflow.composition',
  /** A scope, grant or policy gate refused the call. */
  denied: 'policy.denied',
  /** The capability was unavailable, timed out, or produced a bad result. */
  unavailable: 'tool.unavailable',
} as const satisfies Record<string, FailureClass>;

/**
 * The failure class the broker uses.
 */
export type BrokerFailureClass = FailureClass;

/**
 * The invocation record, as the broker writes it (blueprint 11 §6.5).
 *
 * ## What is deliberately absent
 *
 * The **credential's material**. The record carries the credential's
 * *reference*, its scopes and its expiry — never the secret. blueprint 11
 * §6.5: *"the credential's reference and scopes are recorded but its
 * material never is."*
 *
 * The record also carries *summaries* of the arguments and the result, not
 * the values themselves: the arguments may contain a value the capability's
 * `observability.redactArguments` names, and the result may contain a
 * secret the credential broker added to the task's redaction set.
 */
export interface InvocationRecord {
  /** The record's id. */
  readonly invocationId: string;
  /** The capability that was invoked. */
  readonly capabilityId: string;
  /** The capability's version. */
  readonly capabilityVersion: string;
  /** The transport that carried the call. */
  readonly transport: string;
  /** The run the call belongs to. */
  readonly runId: string;
  /** The task the call belongs to. */
  readonly taskId: string;
  /** The node the call belongs to. */
  readonly nodeId: string;
  /** The attempt the call belongs to. */
  readonly attempt: number;
  /** The grant the call was made under. */
  readonly grantId: string;
  /** The digest of the arguments. */
  readonly argsSha256: string;
  /** A redacted summary of the arguments. */
  readonly argsSummary: unknown;
  /** A redacted summary of the result. */
  readonly resultSummary?: unknown;
  /** The effect class the capability was invoked with. */
  readonly effectClass: EffectClass;
  /** The resource the call targeted. */
  readonly resource?: string;
  /** The policy decision that permitted the call. */
  readonly policyDecision?: {
    readonly outcome: string;
    readonly ruleIds: readonly string[];
    readonly reason: string;
    readonly bundleSha256: string;
  };
  /** The approval that permitted the call, when one was required. */
  readonly approvalId?: string;
  /** The credential's reference, scopes and expiry — **never its material**. */
  readonly credential?: {
    readonly credId: string;
    readonly scopes: readonly string[];
    readonly expiresAt: string;
  };
  /** The call's status. */
  readonly status: 'succeeded' | 'failed' | 'denied';
  /** The idempotency key. */
  readonly idempotencyKey: string;
  /** How long the call took, in milliseconds. */
  readonly durationMs: number;
  /** What the call cost. */
  readonly costUsdMicros: number;
  /** Who made the call. */
  readonly actor: Actor;
}
