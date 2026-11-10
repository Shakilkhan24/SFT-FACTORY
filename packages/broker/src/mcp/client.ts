/**
 * The MCP client port.
 *
 * ## Why a port and not the SDK
 *
 * The broker must be provable **offline**. The official MCP SDK is not a
 * dependency of this workspace, and HR-6 forbids adding one without an ADR.
 *
 * So the broker talks to an `McpClient` — an interface with three methods —
 * and the ticket supplies an **in-process fixture server** as one
 * implementation. The official SDK becomes a second implementation later,
 * and nothing in the broker changes.
 *
 * This is the same ports-and-adapters shape the rest of the factory uses.
 */

import type {
  McpInitializeResult,
  McpToolCallResult,
  McpToolListResult,
} from './protocol.js';

/**
 * An MCP client.
 */
export interface McpClient {
  /**
   * Initialize the session.
   */
  initialize(): Promise<McpInitializeResult>;

  /**
   * The tools the server advertises.
   *
   * The broker reconciles this list against the registry. A tool the
   * registry does not list **does not exist** (blueprint 11 §3.2).
   */
  listTools(): Promise<McpToolListResult>;

  /**
   * Call a tool.
   */
  callTool(name: string, args: unknown): Promise<McpToolCallResult>;

  /**
   * Close the session.
   */
  close(): Promise<void>;
}
