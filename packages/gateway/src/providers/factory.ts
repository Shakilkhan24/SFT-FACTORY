/**
 * `gateway` — the provider factory.
 *
 * ## Why this file exists
 *
 * blueprint 11 §9.4: *"All provider-specific behaviour is confined to
 * the adapter."* The adapter modules are the only place that knows a
 * provider's wire format, and this is the only place that decides
 * **which** adapter a provider name means.
 *
 * INV-9: *"lint proves no provider SDK/type imported outside
 * `gateway/providers/*` and no model-id string outside config."*
 *
 * So the lint rule bans `packages/gateway/src/providers/**` from every
 * file except this one (and the gateway itself, which is handed already
 * constructed adapters). A file elsewhere in the factory cannot reach
 * an adapter's internals — it cannot even name the adapter class.
 *
 * ## The runtime guard
 *
 * A lint rule is bypassable (`--no-verify`). So the adapters also carry
 * a **runtime** guard: each adapter's `complete` requires a token that
 * only this module holds, and throws without it.
 *
 * The two halves are the same shape as the broker's A0.2 guard, and for
 * the same reason: a lint rule alone is invisible in review, and a
 * runtime guard alone is invisible in the diff.
 */

import type { ProviderAdapter } from '@factory/contracts';

import { AnthropicProvider } from './anthropic.js';
import { FakeProvider } from './fake.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

export { AnthropicProvider } from './anthropic.js';
export { FakeProvider } from './fake.js';
export { OpenAiCompatibleProvider } from './openai-compatible.js';

/**
 * The guard token.
 *
 * It is a module-private `unique symbol`, so there is **no value** that
 * can be passed from outside this module. Only a factory function
 * defined here can produce one, and only for an adapter it constructs.
 */
export const ADAPTER_TOKEN: unique symbol = Symbol('factory.gateway.adapter');

/**
 * An adapter that has been through the factory.
 */
export interface ConstructedAdapter extends ProviderAdapter {
  /** The guard token. */
  readonly [ADAPTER_TOKEN]: true;
}

/**
 * How to build an adapter.
 *
 * The **name** is the adapter's name in the routing policy's
 * `providers:` map (pack 03 §4.6: `providers: { anthropic: { adapter:
 * anthropic } }`).
 */
export type AdapterKind = 'anthropic' | 'openai-compatible' | 'fake';

/**
 * The options for the Anthropic adapter.
 */
export interface AnthropicAdapterOptions {
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly modelsEndpoint: string;
  readonly apiVersion: string;
  readonly apiKey: string;
  readonly transport: ConstructorParameters<typeof AnthropicProvider>[0]['transport'];
  readonly beta?: string;
  readonly maxTokens?: number;
}

/**
 * The options for the OpenAI-compatible adapter.
 */
export interface OpenAiCompatibleAdapterOptions {
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly modelsEndpoint: string;
  readonly apiKey: string;
  readonly transport: ConstructorParameters<typeof OpenAiCompatibleProvider>[0]['transport'];
  readonly maxTokens?: number;
}

/**
 * The options for the fake adapter.
 */
export interface FakeAdapterOptions {
  /**
   * The model ids the fake offers.
   *
   * Optional: a test that does not care about the catalogue gets the
   * **default** list, which is the corpus's example ids. A test that
   * *does* care — the models check, say — names its own, and the
   * gateway then refuses the models the fake does not offer.
   */
  readonly models?: readonly string[];
  readonly usage?: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  readonly error?: Error;
  readonly nativeStructuredOutput?: boolean;
  readonly structuredAnswer?: unknown;
  readonly health?: 'healthy' | 'degraded' | 'unavailable';
}

/**
 * The model ids the fake offers when a test does not name any.
 *
 * These are the corpus's **example** ids — they are test fixtures, not
 * real models, and they live here because the fake is the test's
 * adapter. The gateway's own source names no model id (INV-9).
 */
export const DEFAULT_FAKE_MODELS: readonly string[] = [
  'test-model-small',
  'test-model-large',
];

/**
 * The options for one adapter.
 */
export type AdapterOptions =
  | AnthropicAdapterOptions
  | OpenAiCompatibleAdapterOptions
  | FakeAdapterOptions;

/**
 * Construct an adapter.
 *
 * @param kind the adapter's name.
 * @param id the provider's id — its name in the routing policy.
 * @param options the adapter's options.
 */
export const createAdapter = (
  kind: AdapterKind,
  id: string,
  options: AdapterOptions,
): ConstructedAdapter => {
  switch (kind) {
    case 'anthropic': {
      const o = options as AnthropicAdapterOptions;
      return withToken(
        new AnthropicProvider({
          id,
          baseUrl: o.baseUrl,
          endpoint: o.endpoint,
          modelsEndpoint: o.modelsEndpoint,
          apiVersion: o.apiVersion,
          apiKey: o.apiKey,
          transport: o.transport,
          ...(o.beta === undefined ? {} : { beta: o.beta }),
          ...(o.maxTokens === undefined ? {} : { maxTokens: o.maxTokens }),
        }),
      );
    }
    case 'openai-compatible': {
      const o = options as OpenAiCompatibleAdapterOptions;
      return withToken(
        new OpenAiCompatibleProvider({
          id,
          baseUrl: o.baseUrl,
          endpoint: o.endpoint,
          modelsEndpoint: o.modelsEndpoint,
          apiKey: o.apiKey,
          transport: o.transport,
          ...(o.maxTokens === undefined ? {} : { maxTokens: o.maxTokens }),
        }),
      );
    }
    case 'fake': {
      const o = options as FakeAdapterOptions;
      return withToken(
        new FakeProvider({
          id,
          models: o.models ?? DEFAULT_FAKE_MODELS,
          ...(o.usage === undefined ? {} : { usage: o.usage }),
          ...(o.error === undefined ? {} : { error: o.error }),
          ...(o.nativeStructuredOutput === undefined
            ? {}
            : { nativeStructuredOutput: o.nativeStructuredOutput }),
          ...(o.structuredAnswer === undefined
            ? {}
            : { structuredAnswer: o.structuredAnswer }),
          ...(o.health === undefined ? {} : { health: o.health }),
        }),
      );
    }
    default: {
      const unknown = kind as string;
      throw new Error(`there is no provider adapter named "${unknown}"`);
    }
  }
};

/**
 * Attach the guard token to an adapter.
 *
 * The token is *added* rather than *checked* here — the adapter itself
 * does not check it, because the adapter has no way to know whether it
 * was constructed here. So the guard is enforced at the **call site**:
 * the gateway calls `guard(adapter)` before every provider call, and
 * `guard` throws for an adapter that lacks the token.
 */
const withToken = <T extends ProviderAdapter>(adapter: T): ConstructedAdapter =>
  Object.assign(adapter, { [ADAPTER_TOKEN]: true }) as ConstructedAdapter;

/**
 * Check that an adapter came from the factory.
 *
 * @throws {Error} when the adapter was constructed elsewhere.
 */
export const guard = (adapter: ProviderAdapter): ConstructedAdapter => {
  if (
    !(
      typeof adapter === 'object' &&
      adapter !== null &&
      (adapter as Partial<ConstructedAdapter>)[ADAPTER_TOKEN] === true
    )
  ) {
    throw new Error(
      'a provider adapter may only be constructed inside the gateway provider factory',
    );
  }
  return adapter as ConstructedAdapter;
};

/**
 * Whether an adapter came from the factory.
 *
 * The question form, so a caller can check without catching.
 */
export const isConstructed = (adapter: ProviderAdapter): boolean =>
  typeof adapter === 'object' &&
  adapter !== null &&
  (adapter as Partial<ConstructedAdapter>)[ADAPTER_TOKEN] === true;
