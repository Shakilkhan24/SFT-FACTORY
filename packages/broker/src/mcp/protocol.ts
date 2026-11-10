/**
 * The MCP protocol shapes the broker uses.
 *
 * ## Why these are hand-written rather than imported
 *
 * HR-11: "`[VERIFY]` facts about external systems are sourced, not
 * invented." The official MCP SDK is not a dependency of this workspace, and
 * adding it is out of scope for this ticket. So the shapes here are
 * **narrow** — the subset the factory actually exchanges — and the
 * implementation is against an `McpClient` **port**, so the official SDK
 * can become a second implementation later without touching the broker.
 *
 * The shapes are the JSON-RPC 2.0 envelope plus MCP's `initialize`,
 * `tools/list` and `tools/call` methods. Those three are the whole of what
 * the broker needs: reconcile the advertised tools, and call one.
 */

/**
 * The JSON-RPC version the factory speaks.
 */
export const JSONRPC_VERSION = '2.0';

/**
 * A JSON-RPC request.
 */
export interface JsonRpcRequest {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

/**
 * A JSON-RPC response.
 */
export interface JsonRpcResponse {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/**
 * The MCP protocol version the factory asks for.
 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * The `initialize` result.
 */
export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly capabilities?: Readonly<Record<string, unknown>>;
}

/**
 * The `tools/list` result.
 *
 * A tool's `inputSchema` is a JSON Schema document, carried as-is.
 */
export interface McpToolListResult {
  readonly tools: readonly McpToolDescriptor[];
}

/**
 * One advertised tool.
 */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

/**
 * The `tools/call` result.
 *
 * MCP's content model is a list of content blocks; the factory's tools
 * return structured content, so both are carried.
 */
export interface McpToolCallResult {
  readonly content: readonly McpContentBlock[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

/**
 * One content block.
 */
export type McpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string }
  | { readonly type: 'resource'; readonly resource: unknown };

/**
 * The MCP client's error.
 *
 * A JSON-RPC error is not an exception the adapter invents; it is a
 * protocol-level failure, and the adapter turns it into a thrown error so
 * the broker classifies it as `tool.unavailable`.
 */
export class McpError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'McpError';
    this.code = code;
  }
}
