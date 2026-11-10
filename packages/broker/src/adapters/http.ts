/**
 * The HTTP adapter.
 *
 * A capability implemented by an HTTP service.
 *
 * ## The transport is injected
 *
 * The adapter takes a **fetch function**, not a global. So no test touches
 * the network: the test supplies a function that returns a canned
 * response, and the adapter's logic — the method, the headers, the body,
 * the status handling — is still exercised.
 *
 * ## The credential goes in the header, never in the body
 *
 * A credential in a request body would be in the arguments, and the
 * arguments are summarised into the invocation record. A credential in a
 * header is not.
 */

import { assertGuardToken } from './factory.js';
import type { AdapterCapability, ToolAdapterLike } from './types.js';

/**
 * The fetch function the adapter uses.
 *
 * It is injected. Its signature is deliberately narrow — a URL, an init,
 * and a response with a status and a text body — so the adapter cannot be
 * coaxed into reading a file path or a `file:` URL.
 */
export type FetchFunction = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal: AbortSignal;
  },
) => Promise<{ readonly status: number; readonly text: string }>;

/**
 * How an HTTP capability is reached.
 */
export interface HttpCapability extends AdapterCapability {
  /** The URL, or a URL template with `{arg}` placeholders. */
  readonly url: string;
  /** The HTTP method. Defaults to `POST`. */
  readonly method?: string;
  /** The header the credential is passed in, when the capability needs one. */
  readonly credentialHeader?: string;
}

/**
 * The HTTP adapter.
 */
export class HttpAdapter implements ToolAdapterLike {
  readonly #capabilities: readonly HttpCapability[];
  readonly #fetch: FetchFunction;

  constructor(capabilities: readonly HttpCapability[], fetchFn: FetchFunction) {
    this.#capabilities = capabilities;
    this.#fetch = fetchFn;
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

    const capability = this.#capabilities.find((entry) => entry.id === capabilityId);
    if (capability === undefined) {
      throw new Error(`the HTTP adapter does not serve ${capabilityId}`);
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    if (credential !== undefined && capability.credentialHeader !== undefined) {
      const secret = secretOf(credential);
      if (secret !== undefined) {
        headers[capability.credentialHeader] = secret;
      }
    }

    const response = await this.#fetch(substituteUrl(capability.url, args), {
      method: capability.method ?? 'POST',
      headers,
      body: JSON.stringify(args ?? null),
      signal,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `the capability's service answered with status ${response.status}`,
      );
    }

    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      return response.text;
    }
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
 * Substitute `{arg}` placeholders in a URL.
 *
 * The substituted value is **URL-encoded**, so a value containing `?` or
 * `#` cannot change the URL's structure.
 */
export const substituteUrl = (url: string, args: unknown): string => {
  const record =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  return url.replace(/\{([A-Za-z0-9_.]+)\}/g, (_match, name: string) => {
    if (!(name in record)) {
      throw new Error(`the argument ${name} is required by the capability but was not supplied`);
    }
    const value = record[name];
    return encodeURIComponent(String(value));
  });
};

/**
 * The secret, from a credential.
 */
const secretOf = (credential: unknown): string | undefined => {
  if (typeof credential === 'object' && credential !== null) {
    const secret = (credential as { readonly secret?: unknown }).secret;
    if (typeof secret === 'string') {
      return secret;
    }
  }
  return undefined;
};
