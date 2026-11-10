/**
 * The MCP adapter.
 *
 * A capability implemented by an MCP server.
 *
 * ## The registry is the gate, not the server
 *
 * The adapter does **not** decide whether a tool may be called — the
 * registry does, before the adapter is reached (blueprint 11 §3.2). The
 * adapter's job is to translate: a capability id to an MCP tool name, the
 * arguments to MCP's `tools/call` parameters, and MCP's result back to a
 * value.
 *
 * The adapter *does* carry the mapping, because the names differ: the
 * registry's capability ids are the factory's vocabulary, and an MCP
 * server's tool names are the server's.
 *
 * ## The result
 *
 * MCP returns a list of content blocks and, optionally, structured
 * content. The factory's capabilities return a value, so the adapter
 * prefers the structured content and falls back to the single text block.
 * A result with no usable content is an **error**, not an empty value: a
 * capability that returned nothing has not returned a fact.
 */

import { assertGuardToken } from './factory.js';
import type { McpClient } from '../mcp/client.js';
import type { AdapterCapability, ToolAdapterLike } from './types.js';

/**
 * How an MCP capability maps onto an MCP tool.
 */
export interface McpCapability extends AdapterCapability {
  /** The MCP tool's name on the server. */
  readonly toolName: string;
}

/**
 * The MCP adapter.
 */
export class McpAdapter implements ToolAdapterLike {
  readonly #capabilities: readonly McpCapability[];
  readonly #client: McpClient;

  constructor(capabilities: readonly McpCapability[], client: McpClient) {
    this.#capabilities = capabilities;
    this.#client = client;
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
    _credential: unknown,
    _signal: AbortSignal,
    token: symbol,
  ): Promise<unknown> {
    assertGuardToken(token);

    const capability = this.#capabilities.find((entry) => entry.id === capabilityId);
    if (capability === undefined) {
      throw new Error(`the MCP adapter does not serve ${capabilityId}`);
    }

    const result = await this.#client.callTool(capability.toolName, args);

    if (result.isError === true) {
      throw new Error(`the MCP tool ${capability.toolName} reported an error`);
    }

    if (result.structuredContent !== undefined) {
      return result.structuredContent;
    }

    const text = (result.content ?? []).find(
      (block): block is { readonly type: 'text'; readonly text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { readonly type?: unknown }).type === 'text',
    );

    if (text === undefined) {
      throw new Error(`the MCP tool ${capability.toolName} returned no usable content`);
    }

    try {
      return JSON.parse(text.text) as unknown;
    } catch {
      return text.text;
    }
  }

  public async health(): Promise<'healthy' | 'degraded' | 'unavailable' | 'unknown'> {
    try {
      await this.#client.initialize();
      return 'healthy';
    } catch {
      return 'unavailable';
    }
  }

  public async close(): Promise<void> {
    await this.#client.close();
  }
}
