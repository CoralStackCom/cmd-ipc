/**
 * MCP Types - Shared types for MCP Streamable HTTP channels
 *
 * @packageDocumentation
 */

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

/**
 * JSON-RPC request message
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

/**
 * JSON-RPC response message
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: JSONRPCError
}

/**
 * JSON-RPC notification message (request without id)
 */
export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

/**
 * JSON-RPC error object
 */
export interface JSONRPCError {
  code: number
  message: string
  data?: unknown
}

/**
 * Any JSON-RPC message type
 */
export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification

// ============================================================================
// MCP Protocol Types
// ============================================================================

/**
 * MCP client/server info
 */
export interface MCPInfo {
  name: string
  version: string
}

/**
 * MCP client capabilities
 */
export interface MCPClientCapabilities {
  roots?: { listChanged?: boolean }
  sampling?: object
  experimental?: Record<string, object>
}

/**
 * MCP server capabilities
 */
export interface MCPServerCapabilities {
  prompts?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  tools?: { listChanged?: boolean }
  logging?: object
  completions?: object
  experimental?: Record<string, object>
}

/**
 * MCP tool definition (from tools/list response)
 */
export interface MCPTool {
  name: string
  description?: string
  inputSchema?: MCPJSONSchema
}

/**
 * JSON Schema type used by MCP for tool input/output schemas
 */
export interface MCPJSONSchema {
  type?: string
  properties?: Record<string, MCPJSONSchema>
  required?: string[]
  items?: MCPJSONSchema
  description?: string
  enum?: unknown[]
  default?: unknown
  additionalProperties?: boolean | MCPJSONSchema
  [key: string]: unknown
}

/**
 * MCP tool content types
 */
export interface MCPTextContent {
  type: 'text'
  text: string
}

export interface MCPImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface MCPResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    text?: string
    blob?: string
  }
}

export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent

/**
 * MCP tool call result
 */
export interface MCPToolResult {
  content: MCPContent[]
  isError?: boolean
}

// ============================================================================
// MCP Initialize Types
// ============================================================================

/**
 * Initialize request params
 */
export interface MCPInitializeParams {
  protocolVersion: string
  capabilities: MCPClientCapabilities
  clientInfo: MCPInfo
}

/**
 * Initialize response result
 */
export interface MCPInitializeResult {
  protocolVersion: string
  capabilities: MCPServerCapabilities
  serverInfo: MCPInfo
  instructions?: string
}

// ============================================================================
// MCP Tools Types
// ============================================================================

/**
 * tools/list response
 */
export interface MCPToolsListResult {
  tools: MCPTool[]
}

/**
 * tools/call params
 */
export interface MCPToolsCallParams {
  name: string
  arguments?: Record<string, unknown>
}

// ============================================================================
// SSE Types
// ============================================================================

/**
 * Server-Sent Event
 */
export interface SSEEvent {
  id?: string
  event?: string
  data: string
  retry?: number
}
