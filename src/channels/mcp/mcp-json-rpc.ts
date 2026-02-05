/**
 * MCP JSON-RPC Utilities - Message builders and validation helpers
 *
 * @packageDocumentation
 */

import type {
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from './mcp-types'

// ============================================================================
// JSON-RPC Error Codes
// ============================================================================

/**
 * Standard JSON-RPC 2.0 error codes
 */
export const JSONRPC_ERRORS = {
  /** Invalid JSON was received */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid request */
  INVALID_REQUEST: -32600,
  /** The method does not exist */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameters */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error */
  INTERNAL_ERROR: -32603,
} as const

// ============================================================================
// Message Builders
// ============================================================================

/**
 * Create a JSON-RPC request message
 */
export function createRequest(
  id: string | number,
  method: string,
  params?: Record<string, unknown>,
): JSONRPCRequest {
  const request: JSONRPCRequest = {
    jsonrpc: '2.0',
    id,
    method,
  }
  if (params !== undefined) {
    request.params = params
  }
  return request
}

/**
 * Create a JSON-RPC response message with a result
 */
export function createResponse(id: string | number, result: unknown): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

/**
 * Create a JSON-RPC error response message
 */
export function createErrorResponse(id: string | number, error: JSONRPCError): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    error,
  }
}

/**
 * Create a JSON-RPC notification (no id, no response expected)
 */
export function createNotification(
  method: string,
  params?: Record<string, unknown>,
): JSONRPCNotification {
  const notification: JSONRPCNotification = {
    jsonrpc: '2.0',
    method,
  }
  if (params !== undefined) {
    notification.params = params
  }
  return notification
}

/**
 * Create a JSON-RPC error object
 */
export function createError(code: number, message: string, data?: unknown): JSONRPCError {
  const error: JSONRPCError = {
    code,
    message,
  }
  if (data !== undefined) {
    error.data = data
  }
  return error
}

// ============================================================================
// Type Guards / Validation
// ============================================================================

/**
 * Check if a value is a valid JSON-RPC message (any type)
 */
export function isJSONRPCMessage(msg: unknown): msg is JSONRPCMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false
  }
  const obj = msg as Record<string, unknown>
  return obj.jsonrpc === '2.0'
}

/**
 * Check if a message is a JSON-RPC request (has id and method)
 */
export function isRequest(msg: unknown): msg is JSONRPCRequest {
  if (!isJSONRPCMessage(msg)) {
    return false
  }
  const obj = msg as unknown as Record<string, unknown>
  return (
    'id' in obj &&
    (typeof obj.id === 'string' || typeof obj.id === 'number') &&
    'method' in obj &&
    typeof obj.method === 'string'
  )
}

/**
 * Check if a message is a JSON-RPC response (has id and result or error)
 */
export function isResponse(msg: unknown): msg is JSONRPCResponse {
  if (!isJSONRPCMessage(msg)) {
    return false
  }
  const obj = msg as unknown as Record<string, unknown>
  return (
    'id' in obj &&
    (typeof obj.id === 'string' || typeof obj.id === 'number') &&
    ('result' in obj || 'error' in obj)
  )
}

/**
 * Check if a message is a JSON-RPC notification (has method but no id)
 */
export function isNotification(msg: unknown): msg is JSONRPCNotification {
  if (!isJSONRPCMessage(msg)) {
    return false
  }
  const obj = msg as unknown as Record<string, unknown>
  return !('id' in obj) && 'method' in obj && typeof obj.method === 'string'
}

/**
 * Check if a response is an error response
 */
export function isErrorResponse(msg: JSONRPCResponse): boolean {
  return 'error' in msg && msg.error !== undefined
}

/**
 * Validate a JSON-RPC message and throw if invalid
 */
export function validateJSONRPCMessage(msg: unknown): asserts msg is JSONRPCMessage {
  if (!isJSONRPCMessage(msg)) {
    throw new Error('Invalid JSON-RPC message: missing jsonrpc: "2.0"')
  }

  const obj = msg as unknown as Record<string, unknown>

  // Check for valid message type
  if (!isRequest(msg) && !isResponse(msg) && !isNotification(msg)) {
    throw new Error('Invalid JSON-RPC message: must be request, response, or notification')
  }

  // Validate params if present
  if ('params' in obj && obj.params !== undefined) {
    if (typeof obj.params !== 'object' || obj.params === null || Array.isArray(obj.params)) {
      throw new Error('Invalid JSON-RPC message: params must be an object')
    }
  }

  // Validate error if present
  if ('error' in obj && obj.error !== undefined) {
    const error = obj.error as Record<string, unknown>
    if (typeof error.code !== 'number' || typeof error.message !== 'string') {
      throw new Error('Invalid JSON-RPC error: must have numeric code and string message')
    }
  }
}

// ============================================================================
// MCP-specific Helpers
// ============================================================================

/**
 * Generate a unique request ID
 */
let requestIdCounter = 0
export function generateRequestId(): number {
  return ++requestIdCounter
}

/**
 * Reset the request ID counter (useful for tests)
 */
export function resetRequestIdCounter(): void {
  requestIdCounter = 0
}
