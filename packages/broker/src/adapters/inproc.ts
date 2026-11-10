/**
 * The in-process adapter.
 *
 * The simplest transport: the capability's implementation is a function in
 * this process. It is the transport most of the factory's own capabilities
 * use, because they do the work in the orchestrator's process.
 *
 * ## The guard
 *
 * The adapter requires the factory's token to invoke. A direct call — from
 * a test, from a stray module — throws {@link AdapterGuardError}.
 */

import { assertGuardToken } from './factory.js';
import type { AdapterCapability, ToolAdapterLike } from './types.js';

/**
 * The handler for one in-process capability.
 */
export type InprocHandler = (
  args: unknown,
  credential: unknown,
  signal: AbortSignal,
) => Promise<unknown>;

/**
 * The in-process adapter.
 */
export class InprocAdapter implements ToolAdapterLike {
  readonly #capabilities: readonly AdapterCapability[];
  readonly #handlers: ReadonlyMap<string, InprocHandler>;

  constructor(
    capabilities: readonly AdapterCapability[],
    handlers: ReadonlyMap<string, InprocHandler>,
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
      throw new Error(`the in-process adapter does not serve ${capabilityId}`);
    }

    return handler(args, credential, signal);
  }

  public health(): Promise<'healthy' | 'degraded' | 'unavailable' | 'unknown'> {
    return Promise.resolve('healthy');
  }

  public close(): Promise<void> {
    // Nothing to release.
    return Promise.resolve();
  }
}
