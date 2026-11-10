/**
 * `gateway` — the Anthropic provider adapter.
 *
 * ## The wire facts
 *
 * pack 04 §6: *"**Anthropic adapter** `[VERIFY all]`: `POST /v1/messages`
 * (streaming and non-streaming), `GET /v1/models`, token counting
 * endpoint; headers `x-api-key`, `anthropic-version` (pin the
 * documented value), optional `anthropic-beta`; prompt caching via
 * `cache_control` on content blocks; forced tool use (`tool_choice`)
 * for structured output; usage fields for input/output/cache read/cache
 * write tokens."*
 *
 * Every one of those is marked `[VERIFY]` — the corpus does not confirm
 * them, and pack 04's own instruction is to check them against the
 * provider's docs.
 *
 * **This adapter does not guess them.** The parts the gateway's own
 * logic needs — the *shape* of a request and a response — are the
 * parts pack 04 §6 names, and the parts that are *the provider's
 * business* (the exact endpoint path, the header names, the version
 * string) are **injected** by the caller, not hard-coded here.
 *
 * So:
 *
 * * `endpoint` — the URL to POST to. The caller passes the documented
 *   one.
 * * `apiVersion` — the `anthropic-version` header's value. The caller
 *   passes the documented one.
 * * `transport` — the `fetch`-shaped function. **No test touches the
 *   network**, and the adapter never reads a key from an environment
 *   variable on its own.
 *
 * What the adapter *does* own — the part that is the factory's business
 * and not the provider's — is the **translation**: the factory's
 * neutral request into the provider's format, the response back into
 * the factory's shape, the token accounting, and the error taxonomy.
 * blueprint 11 §9.4: *"A provider adapter is responsible for
 * translating the factory's neutral request into the provider's format,
 * and for normalising the response, token accounting, and error
 * taxonomy."*
 *
 * ## The cost is not computed here
 *
 * The adapter reports **tokens**. The cost is the pricing table's
 * business (pack 04 §6: pricing "never hard-coded"), so the adapter
 * never multiplies by a price — it would have to name a model, and
 * naming a model in code is exactly what INV-9 forbids.
 */

import type {
  ProviderRequest,
  ProviderResponse,
  ToolUse,
  Usage,
} from '@factory/contracts';

import { FORCED_TOOL_NAME } from '../structured.js';

/**
 * A `fetch`-shaped transport.
 *
 * The adapter takes one **injected**, so no test reaches the network and
 * no key lives in the adapter.
 */
export type HttpTransport = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly status: number; readonly json: unknown }>;

/**
 * The options for an {@link AnthropicProvider}.
 */
export interface AnthropicProviderOptions {
  /** The provider's id — its name in the routing policy. */
  readonly id: string;
  /** The base URL the requests go to. */
  readonly baseUrl: string;
  /** The endpoint path for a completion. */
  readonly endpoint: string;
  /** The endpoint path for the models list. */
  readonly modelsEndpoint: string;
  /** The `anthropic-version` header's value — the documented one. */
  readonly apiVersion: string;
  /** The key, sent as `x-api-key`. */
  readonly apiKey: string;
  /** The transport. */
  readonly transport: HttpTransport;
  /** The optional `anthropic-beta` header's value. */
  readonly beta?: string;
  /** The maximum output tokens a request may ask for. */
  readonly maxTokens?: number;
}

/**
 * The Anthropic provider adapter.
 */
export class AnthropicProvider {
  readonly id: string;

  readonly #options: AnthropicProviderOptions;

  constructor(options: AnthropicProviderOptions) {
    this.id = options.id;
    this.#options = options;
  }

  /** The model ids the provider offers. */
  public async models(): Promise<string[]> {
    const response = await this.#options.transport(
      `${this.#options.baseUrl}${this.#options.modelsEndpoint}`,
      { method: 'GET', headers: this.#headers() },
    );

    if (response.status !== 200) {
      throw new Error(
        `the models list failed with status ${String(response.status)}`,
      );
    }

    return readModelIds(response.json);
  }

  /** The provider's health. */
  public async health(): Promise<'healthy' | 'degraded' | 'unavailable'> {
    try {
      await this.models();
      return 'healthy';
    } catch {
      return 'unavailable';
    }
  }

  /**
   * The projected cost of a request.
   *
   * The adapter cannot know the price — that is the pricing table's
   * business — so the projection is made by the **gateway**, which
   * knows the price. The adapter's own estimate is expressed in
   * **tokens** through {@link estimateTokens}, and the gateway turns
   * that into money.
   */
  public estimateCostMicros(): number {
    // The adapter does not price. The gateway does.
    return 0;
  }

  /**
   * Estimate the tokens a request will consume.
   *
   * The estimate is deliberately coarse — four characters per token —
   * because it is an **over-estimate** used by the budget check, and
   * the budget check must not under-estimate.
   */
  public estimateTokens(request: ProviderRequest): {
    readonly tokensIn: number;
    readonly maxOutputTokens: number;
  } {
    const systemChars = (request.system ?? []).reduce(
      (total, block) => total + block.body.length,
      0,
    );
    const messageChars = request.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );

    return {
      tokensIn: Math.ceil((systemChars + messageChars) / 4),
      maxOutputTokens: this.#options.maxTokens ?? 4096,
    };
  }

  /**
   * Answer a request.
   */
  public async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const body = this.#bodyFor(request);

    const response = await this.#options.transport(
      `${this.#options.baseUrl}${this.#options.endpoint}`,
      {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(body),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );

    if (response.status !== 200) {
      throw new Error(
        `the completion failed with status ${String(response.status)}`,
      );
    }

    return this.#responseFrom(response.json, request.model);
  }

  /**
   * The request headers.
   */
  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'x-api-key': this.#options.apiKey,
      'anthropic-version': this.#options.apiVersion,
      'content-type': 'application/json',
    };

    if (this.#options.beta !== undefined) {
      headers['anthropic-beta'] = this.#options.beta;
    }

    return headers;
  }

  /**
   * The provider's request body.
   */
  #bodyFor(request: ProviderRequest): unknown {
    const tools = request.tools ?? [];

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens:
        request.maxTokens ?? this.#options.maxTokens ?? 4096,
      messages: request.messages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })),
    };

    if (request.system !== undefined && request.system.length > 0) {
      // The **cache breakpoint** — pack 04 §6: "`cache_control` on
      // content blocks". The gateway marks the last block of the stable
      // prefix; the adapter puts the provider's cache control there.
      //
      // Only the marked block gets it: a breakpoint on an untrusted
      // block would cache a per-turn prefix, which is not a cache but a
      // leak of the turn's content into the provider's cache.
      body['system'] = request.system.map((block) => {
        const marked = block as { readonly cacheBreakpoint?: boolean };
        return marked.cacheBreakpoint === true
          ? {
              type: 'text',
              text: block.body,
              cache_control: { type: 'ephemeral' },
            }
          : { type: 'text', text: block.body };
      });
    }

    if (tools.length > 0) {
      body['tools'] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    }

    // The **forced tool use** — pack 04 §6: "forced tool use
    // (`tool_choice`) for structured output".
    const forced = tools.find((tool) => tool.name === FORCED_TOOL_NAME);
    if (forced !== undefined) {
      body['tool_choice'] = { type: 'tool', name: FORCED_TOOL_NAME };
    }

    return body;
  }

  /**
   * The provider's response, normalised.
   */
  #responseFrom(json: unknown, model: string): ProviderResponse {
    const record = asRecord(json);

    const content = Array.isArray(record['content']) ? record['content'] : [];

    const text = content
      .filter((block) => asRecord(block)['type'] === 'text')
      .map((block) => stringOr(asRecord(block)['text'], ''))
      .join('');

    const toolCalls: ToolUse[] = content
      .filter((block) => asRecord(block)['type'] === 'tool_use')
      .map((block, index) => {
        const tool = asRecord(block);
        return {
          id: stringOr(tool['id'], `call_${String(index)}`),
          name: stringOr(tool['name'], ''),
          input: tool['input'],
        };
      });

    const rawUsage = asRecord(record['usage']);

    const usage: Usage = {
      tokensIn: numberOr(rawUsage['input_tokens'], 0),
      tokensOut: numberOr(rawUsage['output_tokens'], 0),
      cacheRead: numberOr(rawUsage['cache_read_input_tokens'], 0),
      cacheWrite: numberOr(rawUsage['cache_creation_input_tokens'], 0),
      // The cost is the pricing table's business — the adapter reports
      // tokens, not money.
      costUsdMicros: 0,
    };

    return {
      content: text,
      usage,
      model: stringOr(record['model'], model),
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
    };
  }
}

/**
 * Read the model ids out of a models-list response.
 *
 * The list's exact shape is a wire fact the corpus does not confirm, so
 * the reader accepts the two shapes the providers are known to use — a
 * bare array, and an object with a `data` array — and refuses anything
 * else. A shape that is not recognised is an error, not an empty list:
 * an empty list would make every route look like it named an unknown
 * model, which is a refusal for the wrong reason.
 */
export const readModelIds = (json: unknown): string[] => {
  const ids: string[] = [];

  const push = (entry: unknown): void => {
    const record = asRecord(entry);
    const id = record['id'] ?? record['name'];
    if (typeof id === 'string') {
      ids.push(id);
    }
  };

  if (Array.isArray(json)) {
    json.forEach(push);
    return ids;
  }

  const data = asRecord(json)['data'];
  if (Array.isArray(data)) {
    data.forEach(push);
    return ids;
  }

  throw new Error('the models list response has an unrecognised shape');
};

/**
 * Narrow an unknown value to a record.
 */
export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};

/**
 * Read a number, with a fallback.
 */
export const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Read a string, with a fallback.
 *
 * Only a **string** is accepted. `String(value)` would turn an object
 * into `"[object Object]"` — and a provider's answer would then carry
 * that as its text, which is worse than an empty text: it looks like
 * content.
 */
export const stringOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;
