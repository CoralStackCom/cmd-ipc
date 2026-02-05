// Client channel and OAuth
export { MCPClientChannel } from './client/mcp-client-channel'
export { MCPOAuthHandler } from './client/mcp-oauth-handler'

// Server channel
export { MCPServerChannel } from './server/mcp-server-channel'

// JSON-RPC utilities (shared)
export {
  JSONRPC_ERRORS,
  createError,
  createErrorResponse,
  createNotification,
  createRequest,
  createResponse,
  generateRequestId,
  isErrorResponse,
  isJSONRPCMessage,
  isNotification,
  isRequest,
  isResponse,
  validateJSONRPCMessage,
} from './mcp-json-rpc'

// SSE utilities (shared)
export { SSE_CONTENT_TYPE, createSSEStream, parseSSEStream, prefersSSE } from './mcp-sse'
export type { SSEWriter } from './mcp-sse'

// Shared types
export type {
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  MCPClientCapabilities,
  MCPContent,
  MCPImageContent,
  MCPInfo,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPJSONSchema,
  MCPResourceContent,
  MCPServerCapabilities,
  MCPTextContent,
  MCPTool,
  MCPToolResult,
  MCPToolsCallParams,
  MCPToolsListResult,
  SSEEvent,
} from './mcp-types'

// Client types
export type { MCPClientChannelConfig } from './client/mcp-client-types'

// Server types
export type { MCPHttpResponse, MCPServerChannelConfig, MCPSession } from './server/mcp-server-types'

// OAuth types (client)
export type {
  OAuthAuthorizationServerMetadata,
  OAuthBrowserCallback,
  OAuthClientRegistration,
  OAuthClientRegistrationRequest,
  OAuthProtectedResourceMetadata,
  OAuthTokenStorage,
  OAuthTokens,
  OAuthUrlTransformer,
} from './client/mcp-oauth-types'
