/**
 * MCP Server Types - Types specific to MCPServerChannel
 *
 * @packageDocumentation
 */

import type { Implementation } from '@modelcontextprotocol/sdk/types.js'

/**
 * MCPServerChannel configuration
 */
export interface MCPServerChannelConfig {
  /** Unique channel identifier */
  id: string

  /** Server info sent during initialization */
  serverInfo?: Implementation

  /** Instructions to send to clients */
  instructions?: string

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}
