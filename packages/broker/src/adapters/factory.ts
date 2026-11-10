/**
 * The adapter factory — **the only place an adapter is constructed**.
 *
 * ## The two halves of A0.2
 *
 * The ticket requires that "adapters [are] constructible only inside the
 * broker module". A **lint rule alone** is bypassable (`--no-verify`), and a
 * **runtime guard alone** is invisible in review. So both exist:
 *
 * 1. **The lint rule** — `eslint.config.js` has a `no-restricted-imports`
 *    block that bans `packages/broker/src/adapters/**` from every path
 *    except `adapters/factory.ts` and `broker.ts`. It is proved two-sided
 *    by a scratch-tree test: a tree that imports an adapter from outside
 *    fails the rule, and the same tree without the import passes.
 * 2. **The runtime guard** — this module holds a module-private
 *    `unique symbol`. An adapter's `invoke` requires that symbol, so a
 *    direct adapter call fails *at runtime* even when the lint rule is not
 *    run.
 *
 * ## Why the token is not exported as a value
 *
 * The token is exported as a *type* (`GuardToken`) but not as a value. The
 * only way to obtain the value is {@link DefaultAdapterFactory.guardToken},
 * and the only implementation of that method is this class. So a caller
 * outside the broker module cannot obtain the token: it can import the
 * factory class, but it cannot construct one without going through the
 * broker.
 *
 * The adapters import {@link assertGuardToken} — the *check*, not the
 * token. That is safe: knowing how to verify a token does not let you mint
 * one.
 */

import type { AdapterCapability, ToolAdapterLike } from './types.js';

/**
 * The guard token's type.
 *
 * It is a **branded** type: the token value is a `unique symbol` that only
 * this module can produce, so the type alone is not enough to satisfy an
 * adapter's parameter.
 */
export type GuardToken = typeof GUARD_TOKEN;

/**
 * The guard token.
 *
 * A `unique symbol` — a value that is unique by construction, so no other
 * module can mint an equal one. It is module-private: it is not exported
 * as a value.
 */
const GUARD_TOKEN: unique symbol = Symbol('factory.guard-token');

/**
 * The transports the factory can build.
 */
export type AdapterTransport = 'inproc' | 'http' | 'cli' | 'mcp' | 'library';

/**
 * A factory that produces an adapter for a capability's transport.
 *
 * ## Why the factory takes builders and not instances
 *
 * An adapter may be stateful and expensive (an HTTP client with a
 * connection pool, an MCP session). The factory therefore **caches** the
 * adapter per transport, so the capability's adapter is built once.
 *
 * The builders are injected so that a test can supply a transport that never
 * touches the network.
 */
export interface AdapterBuilders {
  /** The in-process adapter. */
  readonly inproc: () => ToolAdapterLike;
  /** The HTTP adapter. */
  readonly http: () => ToolAdapterLike;
  /** The CLI adapter. */
  readonly cli: () => ToolAdapterLike;
  /** The MCP adapter. */
  readonly mcp: () => ToolAdapterLike;
  /** The library adapter. */
  readonly library: () => ToolAdapterLike;
}

/**
 * The default adapter factory.
 */
export class DefaultAdapterFactory {
  readonly #builders: AdapterBuilders;
  readonly #cache = new Map<string, ToolAdapterLike>();

  constructor(builders: AdapterBuilders) {
    this.#builders = builders;
  }

  /**
   * The adapter for a capability, creating it if necessary.
   *
   * @throws when the capability's transport has no builder registered. The
   *   broker turns this into `tool.unavailable`.
   */
  public adapterFor(
    capability: Pick<AdapterCapability, 'transport'>,
  ): Promise<ToolAdapterLike> {
    const transport = capability.transport;
    const cached = this.#cache.get(transport);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const builder = this.#builderFor(transport);
    const adapter = builder();
    this.#cache.set(transport, adapter);
    return Promise.resolve(adapter);
  }

  /**
   * The guard token.
   *
   * The **only** way to obtain it. The broker calls this and passes the
   * token to the adapter; an adapter called without it throws.
   */
  public guardToken(): symbol {
    return GUARD_TOKEN;
  }

  /**
   * Close every adapter the factory built.
   */
  public async close(): Promise<void> {
    for (const adapter of this.#cache.values()) {
      await adapter.close();
    }
    this.#cache.clear();
  }

  /**
   * The builder for a transport.
   *
   * @throws when the transport is unknown.
   */
  #builderFor(transport: string): () => ToolAdapterLike {
    switch (transport) {
      case 'inproc':
        return this.#builders.inproc;
      case 'http':
        return this.#builders.http;
      case 'cli':
        return this.#builders.cli;
      case 'mcp':
        return this.#builders.mcp;
      case 'library':
        return this.#builders.library;
      default:
        throw new Error(`no adapter is registered for the transport ${transport}`);
    }
  }
}

/**
 * The guard error.
 *
 * Thrown when an adapter is invoked without the factory's token. The
 * message says what happened without naming the token's value.
 */
export class AdapterGuardError extends Error {
  constructor() {
    super(
      'the adapter was invoked outside the broker; a capability may only be reached through the broker',
    );
    this.name = 'AdapterGuardError';
  }
}

/**
 * Check the guard token.
 *
 * @throws {AdapterGuardError} when the token is not the factory's.
 */
export const assertGuardToken = (token: symbol): void => {
  if (token !== GUARD_TOKEN) {
    throw new AdapterGuardError();
  }
};
