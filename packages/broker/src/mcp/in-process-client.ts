/**
 * The in-process MCP client.
 *
 * It drives a {@link FixtureMcpServer} over the same JSON-RPC envelope a
 * socket client would use — the request goes in as a JSON-RPC message and
 * the response comes out as one — so the client's logic (id management,
 * error handling, result unwrapping) is genuinely exercised.
 *
 * ## Why the client is separate from the fixture
 *
 * The **client** is the thing the MCP adapter depends on. The **fixture
** is the thing the client is tested against. Keeping them apart means the
 * official SDK client can be dropped in beside this one without touching
 * the adapter.
 */

import type { McpClient } from './client.js';
import type { FixtureMcpServer } from './fixture-server.js';
import {
  JSONRPC_VERSION,
  McpError,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolListResult,
} from './protocol.js';

/**
 * A client that talks to an in-process fixture server.
 */
export class InProcessMcpClient implements McpClient {
  readonly #server: FixtureMcpServer;

  constructor(server: FixtureMcpServer) {
    this.#server = server;
  }

  public async initialize(): Promise<McpInitializeResult> {
    const result = await this.#request('initialize', {});
    return result as McpInitializeResult;
  }

  public async listTools(): Promise<McpToolListResult> {
    const result = await this.#request('tools/list', {});
    return result as McpToolListResult;
  }

  public async callTool(name: string, args: unknown): Promise<McpToolCallResult> {
    const result = await this.#request('tools/call', { name, arguments: args });
    return result as McpToolCallResult;
  }

  public async close(): Promise<void> {
    // The fixture server holds no session state to release.
  }

  /**
   * Make one request and unwrap the result.
   *
   * @throws {McpError} when the server answered with a JSON-RPC error.
   */
  async #request(method: string, params: unknown): Promise<unknown> {
    const request: JsonRpcRequest = {
      jsonrpc: JSONRPC_VERSION,
      id: this.#server.nextId(),
      method,
      params,
    };

    const response: JsonRpcResponse = await this.#server.handle(request);

    if (response.error !== undefined) {
      throw new McpError(response.error.code, response.error.message);
    }

    return response.result;
  }
}
