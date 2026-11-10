/**
 * The library adapter.
 *
 * A capability implemented by a library that is called **in this process**,
 * with no protocol between the factory and the capability.
 *
 * ## Why it differs from the in-process adapter
 *
 * The distinction is the *boundary*, not the location. The **in-process**
 * adapter is the factory's own internal capability surface — the handler is
 * a plain function the broker owns. The **library** adapter is a
 * third-party library called in-process, and the difference that matters is
 * the **credential**: a library capability typically needs the credential
 * *inside* the call's arguments (a GitHub client constructed with a token),
 * not as a separate parameter.
 *
 * So the library adapter injects the credential into the arguments under a
 * reserved key, and the handler reads it from there.
 *
 * ## The credential never comes back
 *
 * The injected credential is removed from the arguments **before** the
 * handler's result is returned, and it is never written into the
 * invocation record. blueprint 11 §6.5: "the credential's reference and
 * scopes are recorded but its material never is."
 */

import { assertGuardToken } from './factory.js';
import type { AdapterCapability, ToolAdapterLike } from './types.js';

/**
 * The key the credential is injected under.
 *
 * It is namespaced with a character that cannot appear in a JSON Schema
 * property name by accident, so an injected credential cannot be confused
 * with a caller-supplied argument.
 */
export const CREDENTIAL_ARGUMENT_KEY = '__factory.credential';

/**
 * A library handler.
 *
 * The handler receives the arguments with the credential already injected.
 */
export type LibraryHandler = (
  args: unknown,
  signal: AbortSignal,
) => Promise<unknown>;

/**
 * The library adapter.
 */
export class LibraryAdapter implements ToolAdapterLike {
  readonly #capabilities: readonly AdapterCapability[];
  readonly #handlers: ReadonlyMap<string, LibraryHandler>;

  constructor(
    capabilities: readonly AdapterCapability[],
    handlers: ReadonlyMap<string, LibraryHandler>,
  ) {
    this.#capabilities = capabilities;
    this.#handlers = handlers;
  }

  public describe(): readonly AdapterCapability[] {
    return this.#capabilities;
  }

  /**
   * Invoke a capability.
   *
   * @throws {AdapterGuardError} when the guard token is not the factory's.
   */
  public async invoke(
    capabilityId: string,
    args: unknown,
    credential: unknown,
    signal: AbortSignal,
    token: symbol,
  ): Promise<unknown> {
    assertGuardToken(token);

    const handler = this.#handlers.get(capabilityId);
    if (handler === undefined) {
      throw new Error(`the library adapter does not serve ${capabilityId}`);
    }

    const injected =
      credential === undefined ? args : injectCredential(args, credential);

    const result = await handler(injected, signal);

    // The credential must not travel back out with the result. If the
    // handler echoed the injected arguments, the secret would be in the
    // value the broker validates and records.
    return credential === undefined ? result : stripCredential(result);
  }

  public health(): Promise<'healthy' | 'degraded' | 'unavailable' | 'unknown'> {
    return Promise.resolve('healthy');
  }

  public close(): Promise<void> {
    // Nothing to release.
    return Promise.resolve();
  }
}

/**
 * Inject the credential into the arguments.
 */
const injectCredential = (args: unknown, credential: unknown): unknown => {
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return { ...(args as Record<string, unknown>), [CREDENTIAL_ARGUMENT_KEY]: credential };
  }
  return { args, [CREDENTIAL_ARGUMENT_KEY]: credential };
};

/**
 * Remove the credential from a result.
 *
 * A result that carries the injected key has the key removed. The result's
 * *content* is the capability's business — the broker validates it against
 * the capability's `outputSchema`, and a schema that does not mention the
 * key will refuse a result that still carries it.
 */
const stripCredential = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripCredential(item));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      if (key === CREDENTIAL_ARGUMENT_KEY) {
        continue;
      }
      out[key] = stripCredential(member);
    }
    return out;
  }
  return value;
};
