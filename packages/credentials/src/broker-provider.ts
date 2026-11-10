/**
 * `credentials` — the **broker's** credential provider.
 *
 * ## Why this file exists
 *
 * The tool broker (`packages/broker`) has a narrow port for step 7:
 *
 * ```ts
 * export interface CredentialProvider {
 *   resolve(
 *     capability: ToolCapability,
 *     context: InvocationContext,
 *   ): Promise<ResolvedCredential | undefined>;
 * }
 * ```
 *
 * and the credential broker (`packages/credentials`) has the machinery that
 * actually mints. The two meet **here** — in a file that belongs to neither
 * package's internals and imports neither package's internals.
 *
 * The tool broker does **not** depend on `packages/credentials`, and this
 * package does **not** depend on `packages/broker`. The port is small enough
 * that each side can hold it without coupling, and the wiring is a
 * one-line construction at the composition root.
 *
 * ## What the adapter does **not** do
 *
 * It does not decide the scope. The scope was already computed by the tool
 * broker's step 3 (the grant) and step 4 (the resource scope), and those
 * steps have already refused anything outside the grant. This adapter
 * receives the **surviving** scopes and mints for exactly those — so a
 * credential can never be broader than what the grant permitted.
 *
 * ## Why the repository list is a parameter and not a constant
 *
 * The repository comes from the task, which the orchestrator (T-1.13) knows.
 * Hard-coding one here would make the factory's least-privilege rule a
 * constant rather than a computation, and HR-10 forbids a hard-coded name.
 */

import type {
  InvocationContext,
  ResolvedCredential,
  ToolCapability,
} from '@factory/contracts';
import { factoryError, type FactoryError, type Result } from '@factory/core';

import type { CredentialBroker } from './broker.js';

/**
 * The port the tool broker holds.
 *
 * It is **declared here** rather than imported from `packages/broker`, so
 * that this package does not depend on the broker's internals. The two
 * declarations are structurally identical, so a `CredentialProvider` from
 * either side satisfies the other.
 */
export interface BrokerCredentialProvider {
  resolve(
    capability: ToolCapability,
    context: InvocationContext,
  ): Promise<ResolvedCredential | undefined>;
}

/**
 * The options for the adapter.
 */
export interface CredentialProviderOptions {
  /** The credential broker — the machinery that mints. */
  readonly broker: CredentialBroker;
  /**
   * The repositories in scope for a task.
   *
   * The **resource** half of the intersection. The task's repository,
   * intersected with the repositories the grant names — the tool broker
   * has already applied the grant, so what arrives here is the surviving
   * set.
   */
  readonly repositoriesFor: (
    taskId: string,
  ) => readonly string[] | Promise<readonly string[]>;
  /**
   * The scopes that survived the grant, for a task.
   *
   * The tool broker computed these at step 3 and step 4.
   */
  readonly effectiveScopesFor: (
    taskId: string,
  ) => readonly string[] | Promise<readonly string[]>;
}

/**
 * The credential provider the tool broker holds.
 *
 * ## The `provider: "none"` sentinel
 *
 * A capability whose `credentials.provider` is `none` needs no credential,
 * and the broker must not ask for one — asking would mint a credential for
 * a capability that does not use it, which is both a wasted round trip and
 * a credential that outlives its usefulness.
 */
export class BrokerCredentialProviderAdapter
  implements BrokerCredentialProvider
{
  readonly #options: CredentialProviderOptions;

  public constructor(options: CredentialProviderOptions) {
    this.#options = options;
  }

  /**
   * Resolve the credential for a capability at a context — **broker step 7**.
   */
  public async resolve(
    capability: ToolCapability,
    context: InvocationContext,
  ): Promise<ResolvedCredential | undefined> {
    if (capability.credentials.provider === 'none') {
      return undefined;
    }

    const [effectiveScopes, repositories] = await Promise.all([
      this.#options.effectiveScopesFor(context.taskId),
      this.#options.repositoriesFor(context.taskId),
    ]);

    const resolved = await this.#options.broker.resolve(
      capability,
      context,
      effectiveScopes,
      repositories,
    );

    if (!resolved.ok) {
      // The credential broker refused. The tool broker's step 7 treats
      // a refusal here as `tool.unavailable` — the capability could not
      // be given what it needs.
      throw new CredentialUnavailableError(resolved.error);
    }

    return resolved.value;
  }
}

/**
 * The credential could not be provided.
 *
 * The **reason** is carried, and the reason never carries the material —
 * the credential broker's refusals are scope refusals, not token
 * failures.
 */
export class CredentialUnavailableError extends Error {
  public override readonly name = 'CredentialUnavailableError';

  public override readonly cause: FactoryError;

  public constructor(cause: FactoryError) {
    super(`the credential could not be provided: ${cause.message}`);
    this.cause = cause;
  }
}

/**
 * Build the provider the tool broker holds.
 *
 * A one-line construction, so the composition root reads as what it is:
 * the broker's port and the credential broker's machinery, joined here.
 */
export const brokerCredentialProvider = (
  options: CredentialProviderOptions,
): BrokerCredentialProvider => new BrokerCredentialProviderAdapter(options);

/**
 * The result-shaped variant — for a caller that prefers a `Result` to an
 * exception.
 *
 * The tool broker's step 7 calls `resolve` inside a `try`, so an exception
 * is the broker's expected shape; this is for the callers that are not the
 * tool broker.
 */
export const resolveCredential = async (
  provider: BrokerCredentialProvider,
  capability: ToolCapability,
  context: InvocationContext,
): Promise<Result<ResolvedCredential | undefined, FactoryError>> => {
  try {
    return { ok: true, value: await provider.resolve(capability, context) };
  } catch (error) {
    if (error instanceof CredentialUnavailableError) {
      return { ok: false, error: error.cause };
    }
    return {
      ok: false,
      error: factoryError(
        'tool.unavailable',
        `the credential could not be provided: ${error instanceof Error ? error.message : String(error)}`,
        true,
        {},
      ),
    };
  }
};
