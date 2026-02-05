/**
 * MCP Client Types - Types specific to MCPClientChannel
 *
 * @packageDocumentation
 */

import type { MCPClientCapabilities, MCPInfo } from '../mcp-types'
import type {
  OAuthBrowserCallback,
  OAuthTokenStorage,
  OAuthUrlTransformer,
} from './mcp-oauth-types'

/**
 * MCPClientChannel configuration
 */
export interface MCPClientChannelConfig {
  /** Unique channel identifier */
  id: string

  /** MCP server URL (e.g., 'https://mcp.example.com') */
  baseUrl: string

  /** MCP endpoint path (default: '/mcp') */
  endpoint?: string

  /** Command prefix for registered tools (e.g., 'mcp.cloudflare') */
  commandPrefix?: string

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number

  /** Client info sent during initialization */
  clientInfo?: MCPInfo

  /** Requested capabilities */
  capabilities?: MCPClientCapabilities

  /** Protocol version to use (default: '2025-03-26') */
  protocolVersion?: string

  /**
   * Callback to open browser for OAuth authorization.
   *
   * If provided, enables automatic OAuth handling when the server
   * returns a 401 Unauthorized response.
   *
   * The callback receives the full authorization URL and should:
   * 1. Open the URL in a browser (popup or redirect)
   * 2. Wait for the OAuth callback with the authorization code
   * 3. Return the authorization code
   *
   * @example
   * ```typescript
   * openAuthBrowser: async (authUrl) => {
   *   // Open popup and wait for callback
   *   return await openOAuthPopup(authUrl)
   * }
   * ```
   */
  openAuthBrowser?: OAuthBrowserCallback

  /**
   * Optional token storage for persistence across sessions.
   *
   * If not provided, tokens are stored in memory only and will be
   * lost when the channel is closed or the application restarts.
   */
  tokenStorage?: OAuthTokenStorage

  /**
   * Custom OAuth redirect URI.
   *
   * If not provided, defaults to `${window.location.origin}/oauth/callback`
   * in browser environments or `http://localhost:3000/oauth/callback` in Node.js.
   */
  oauthRedirectUri?: string

  /**
   * Optional URL transformer for OAuth requests.
   *
   * Use this to route OAuth metadata and token requests through a CORS proxy
   * when running in a browser environment.
   *
   * @example
   * ```typescript
   * oauthUrlTransformer: (url) => {
   *   const parsed = new URL(url)
   *   return `/mcp-proxy/${parsed.protocol.replace(':', '')}/${parsed.host}${parsed.pathname}`
   * }
   * ```
   */
  oauthUrlTransformer?: OAuthUrlTransformer
}
