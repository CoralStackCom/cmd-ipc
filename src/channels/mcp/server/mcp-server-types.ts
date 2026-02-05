/**
 * MCP Server Types - Types specific to MCPServerChannel
 *
 * @packageDocumentation
 */

import type { MCPClientCapabilities, MCPInfo, MCPServerCapabilities } from '../mcp-types'

/**
 * MCPServerChannel configuration
 */
export interface MCPServerChannelConfig {
  /** Unique channel identifier */
  id: string

  /** Server info sent during initialization */
  serverInfo?: MCPInfo

  /** Offered capabilities */
  capabilities?: MCPServerCapabilities

  /** Protocol version to use (default: '2025-03-26') */
  protocolVersion?: string

  /** Enable session management (default: true) */
  enableSessions?: boolean

  /** Instructions to send to clients */
  instructions?: string

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Response type from MCPServerChannel.handleRequest()
 */
export interface MCPHttpResponse {
  status: number
  headers: Record<string, string>
  body?: string | ReadableStream<Uint8Array>
}

/**
 * MCP session state (used by server channel)
 */
export interface MCPSession {
  id: string
  initialized: boolean
  clientInfo?: MCPInfo
  clientCapabilities?: MCPClientCapabilities
  createdAt: number
}
