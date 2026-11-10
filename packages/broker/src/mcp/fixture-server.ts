/**
 * The in-process MCP fixture server.
 *
 * ## What it is for
 *
 * The MCP adapter needs a server to talk to, and the tests must not touch
 * the network. So the ticket supplies a **fixture**: a JSON-RPC server that
 * runs in this process and speaks the subset of MCP the broker uses.
 *
 * It advertises **two** tools:
 *
 * * `fixture.echo` — a tool the registry **does** list, so the
 *   reconciliation finds nothing wrong with it;
 * * `fixture.unregistered` — a tool the registry does **not** list, so the
 *   reconciliation reports it as `advertised-but-unregistered` and it is
 *   **not callable**.
 *
 * The second tool is the point of the fixture. A fixture that advertised
 * only registered tools could not demonstrate the rule that matters.
 */

import {
  JSONRPC_VERSION,
  MCP_PROTOCOL_VERSION,
  McpError,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpToolCallResult,
} from './protocol.js';

/**
 * A tool the fixture serves.
 */
export interface FixtureTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  /** The tool's implementation. */
  readonly call: (args: unknown) => unknown;
}

/**
 * The fixture server.
 *
 * It is a **transport-level** server: it takes a JSON-RPC request and
 * returns a JSON-RPC response. That is the shape a real MCP server has
 * over a socket, so the client that drives it is exercised honestly.
 */
export class FixtureMcpServer {
  readonly #tools: ReadonlyMap<string, FixtureTool>;
  #nextId = 1;

  constructor(tools: readonly FixtureTool[]) {
    this.#tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  /**
   * The tools the server advertises.
   */
  public advertised(): readonly string[] {
    return [...this.#tools.keys()];
  }

  /**
   * Handle one JSON-RPC request.
   */
  public handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return Promise.resolve(this.#dispatch(request));
  }

  /**
   * The dispatch proper.
   *
   * The handler is synchronous — the fixture runs in this process — but the
   * *port* is asynchronous, because a real MCP server is reached over a
   * socket. So the response is computed here and handed back as a resolved
   * promise, and the client that drives the fixture cannot tell the
   * difference.
   */
  #dispatch(request: JsonRpcRequest): JsonRpcResponse {
    try {
      switch (request.method) {
        case 'initialize':
          return this.#ok(request, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: { name: 'fixture', version: '0.1.0' },
            capabilities: { tools: {} },
          });
        case 'tools/list':
          return this.#ok(request, {
            tools: [...this.#tools.values()].map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          });
        case 'tools/call': {
          const params = request.params as
            | { readonly name?: unknown; readonly arguments?: unknown }
            | undefined;
          const name = params?.name;
          if (typeof name !== 'string') {
            throw new McpError(-32602, 'the tools/call request names no tool');
          }
          const tool = this.#tools.get(name);
          if (tool === undefined) {
            throw new McpError(-32602, `the server does not serve ${name}`);
          }
          const result: McpToolCallResult = {
            content: [{ type: 'text', text: JSON.stringify(tool.call(params?.arguments)) }],
            structuredContent: tool.call(params?.arguments),
          };
          return this.#ok(request, result);
        }
        default:
          throw new McpError(-32601, `the method ${request.method} is not supported`);
      }
    } catch (error) {
      if (error instanceof McpError) {
        return {
          jsonrpc: JSONRPC_VERSION,
          id: request.id,
          error: { code: error.code, message: error.message },
        };
      }
      return {
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * A success response.
   */
  #ok(request: JsonRpcRequest, result: unknown): JsonRpcResponse {
    return {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      result,
    };
  }

  /**
   * The next request id.
   */
  public nextId(): number {
    const id = this.#nextId;
    this.#nextId += 1;
    return id;
  }
}
