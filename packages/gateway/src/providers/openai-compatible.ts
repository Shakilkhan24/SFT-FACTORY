/**
 * `gateway` — the OpenAI-compatible provider adapter.
 *
 * ## The wire facts
 *
 * pack 04 §6: *"**Secondary adapter:** OpenAI-compatible `POST
 * /v1/chat/completions` with a forced function call for structured
 * output; `GET /v1/models` `[VERIFY]`."*
 *
 * The `[VERIFY]` is on the models endpoint. So, as with the Anthropic
 * adapter, the endpoint paths, the base URL and the key are
 * **injected** — the caller passes the documented ones — and the
 * adapter owns only the **translation**.
 *
 * ## What is different from the Anthropic adapter
 *
 * The two providers speak different dialects:
 *
 * | | Anthropic | OpenAI-compatible |
 * |---|---|---|
 * | system prompt | a `system` array of blocks | a `system`-role message |
 * | tool definition | `input_schema` | `function.parameters` |
 * | forced call | `tool_choice: {type, name}` | `tool_choice: {type, function: {name}}` |
 * | the answer | a `tool_use` content block | a `tool_calls` array on the message |
 * | usage | `input_tokens` / `output_tokens` | `prompt_tokens` / `completion_tokens` |
 *
 * The gateway does not know any of this — it only sees the factory's
 * neutral shapes. That is the whole point of the adapter boundary.
 */

import type {
  ProviderRequest,
  ProviderResponse,
  ToolUse,
  Usage,
} from '@factory/contracts';

import { FORCED_TOOL_NAME } from '../structured.js';

import { asRecord, numberOr, stringOr, type HttpTransport } from './anthropic.js';

/**
 * The options for an {@link OpenAiCompatibleProvider}.
 */
export interface OpenAiCompatibleProviderOptions {
  /** The provider's id — its name in the routing policy. */
  readonly id: string;
  /** The base URL the requests go to. */
  readonly baseUrl: string;
  /** The endpoint path for a completion. */
  readonly endpoint: string;
  /** The endpoint path for the models list. */
  readonly modelsEndpoint: string;
  /** The key, sent as a bearer token. */
  readonly apiKey: string;
  /** The transport. */
  readonly transport: HttpTransport;
  /** The maximum output tokens a request may ask for. */
  readonly maxTokens?: number;
}

/**
 * The OpenAI-compatible provider adapter.
 */
export class OpenAiCompatibleProvider {
  readonly id: string;

  readonly #options: OpenAiCompatibleProviderOptions;

  constructor(options: OpenAiCompatibleProviderOptions) {
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

  /** The adapter does not price — the pricing table does. */
  public estimateCostMicros(): number {
    return 0;
  }

  /**
   * Estimate the tokens a request will consume.
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
    const response = await this.#options.transport(
      `${this.#options.baseUrl}${this.#options.endpoint}`,
      {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(this.#bodyFor(request)),
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
    return {
      authorization: `Bearer ${this.#options.apiKey}`,
      'content-type': 'application/json',
    };
  }

  /**
   * The provider's request body.
   */
  #bodyFor(request: ProviderRequest): unknown {
    const tools = request.tools ?? [];

    const messages: { role: string; content: string }[] = [];

    // The system prompt is a `system`-role **message** in this
    // dialect, not a separate array.
    for (const block of request.system ?? []) {
      messages.push({ role: 'system', content: block.body });
    }

    for (const message of request.messages) {
      messages.push({ role: message.role, content: message.content });
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? this.#options.maxTokens ?? 4096,
    };

    if (tools.length > 0) {
      body['tools'] = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    }

    // The **forced function call** — pack 04 §6: "with a forced function
    // call for structured output".
    const forced = tools.find((tool) => tool.name === FORCED_TOOL_NAME);
    if (forced !== undefined) {
      body['tool_choice'] = {
        type: 'function',
        function: { name: FORCED_TOOL_NAME },
      };
    }

    return body;
  }

  /**
   * The provider's response, normalised.
   */
  #responseFrom(json: unknown, model: string): ProviderResponse {
    const record = asRecord(json);

    const choices = Array.isArray(record['choices']) ? record['choices'] : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first['message']);

    const content = typeof message['content'] === 'string' ? message['content'] : '';

    const rawCalls = Array.isArray(message['tool_calls']) ? message['tool_calls'] : [];

    const toolCalls: ToolUse[] = rawCalls.map((call, index) => {
      const entry = asRecord(call);
      const fn = asRecord(entry['function']);
      const rawArguments = fn['arguments'];
      return {
        id: stringOr(entry['id'], `call_${String(index)}`),
        name: stringOr(fn['name'], ''),
        input: parseArguments(rawArguments),
      };
    });

    const rawUsage = asRecord(record['usage']);

    const usage: Usage = {
      tokensIn: numberOr(rawUsage['prompt_tokens'], 0),
      tokensOut: numberOr(rawUsage['completion_tokens'], 0),
      cacheRead: numberOr(rawUsage['prompt_tokens_details'] === undefined
        ? undefined
        : asRecord(asRecord(rawUsage['prompt_tokens_details'])['cached_tokens']), 0),
      cacheWrite: 0,
      costUsdMicros: 0,
    };

    return {
      content,
      usage,
      model: stringOr(record['model'], model),
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
    };
  }
}

/**
 * Read the model ids out of a models-list response.
 *
 * The shape is the same as the Anthropic adapter's reader — a bare
 * array or an object with a `data` array — because the OpenAI-compatible
 * dialect is the one that shape comes from.
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
 * Parse a function call's arguments.
 *
 * The arguments arrive as a **JSON string** in this dialect. A string
 * that does not parse is not an error — it is an argument value the
 * structured-output revalidation will reject, which is the right place
 * for it to fail.
 */
export const parseArguments = (raw: unknown): unknown => {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};
