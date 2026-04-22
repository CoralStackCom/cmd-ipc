/**
 * MCP Client Types - Types specific to MCPClientChannel
 *
 * @packageDocumentation
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Implementation } from '@modelcontextprotocol/sdk/types.js'

/**
 * MCPClientChannel configuration
 */
export interface MCPClientChannelConfig {
  /** Unique channel identifier */
  id: string

  /** SDK Transport instance (e.g., StreamableHTTPClientTransport, StdioClientTransport) */
  transport: Transport

  /** Command prefix for registered tools (e.g., 'mcp.cloudflare') */
  commandPrefix?: string

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number

  /** Client info sent during initialization */
  clientInfo?: Implementation
}
