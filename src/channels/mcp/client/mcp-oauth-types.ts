/**
 * OAuth types for MCP authentication
 *
 * Implements OAuth 2.1 with PKCE as per the MCP Protocol specification.
 * References:
 * - RFC 9728 (Protected Resource Metadata)
 * - RFC 8414 (Authorization Server Metadata)
 * - OAuth 2.1 (Authorization Code + PKCE)
 *
 * @packageDocumentation
 */

/**
 * OAuth Protected Resource Metadata (RFC 9728)
 *
 * Fetched from `/.well-known/oauth-protected-resource` on the MCP server.
 * Tells the client which authorization server(s) to use and what scopes are supported.
 */
export interface OAuthProtectedResourceMetadata {
  /** The resource identifier (typically the MCP server URL) */
  resource: string
  /** List of authorization server URLs that can issue tokens for this resource */
  authorization_servers: string[]
  /** Scopes supported by this resource */
  scopes_supported?: string[]
  /** Bearer token methods supported */
  bearer_methods_supported?: string[]
  /** Documentation URL for this resource */
  resource_documentation?: string
}

/**
 * OAuth Authorization Server Metadata (RFC 8414 / OIDC Discovery)
 *
 * Fetched from `/.well-known/oauth-authorization-server` or
 * `/.well-known/openid-configuration` on the authorization server.
 */
export interface OAuthAuthorizationServerMetadata {
  /** The authorization server's issuer identifier */
  issuer: string
  /** URL of the authorization endpoint */
  authorization_endpoint: string
  /** URL of the token endpoint */
  token_endpoint: string
  /** URL of the dynamic client registration endpoint (optional) */
  registration_endpoint?: string
  /** Scopes supported by this authorization server */
  scopes_supported?: string[]
  /** Response types supported */
  response_types_supported?: string[]
  /** Grant types supported */
  grant_types_supported?: string[]
  /** PKCE code challenge methods supported */
  code_challenge_methods_supported?: string[]
}

/**
 * Dynamic Client Registration request (RFC 7591)
 */
export interface OAuthClientRegistrationRequest {
  /** Human-readable name of the client */
  client_name: string
  /** List of allowed redirect URIs */
  redirect_uris: string[]
  /** Grant types the client will use */
  grant_types: string[]
  /** Response types the client will use */
  response_types: string[]
  /** Token endpoint authentication method */
  token_endpoint_auth_method?: string
}

/**
 * Dynamic Client Registration response (RFC 7591)
 */
export interface OAuthClientRegistration {
  /** The client identifier */
  client_id: string
  /** The client secret (if confidential client) */
  client_secret?: string
  /** Timestamp when client_id was issued */
  client_id_issued_at?: number
  /** Timestamp when client_secret expires (0 = never) */
  client_secret_expires_at?: number
}

/**
 * OAuth Token Response
 */
export interface OAuthTokens {
  /** The access token */
  access_token: string
  /** Token type (typically "Bearer") */
  token_type: string
  /** Token lifetime in seconds */
  expires_in?: number
  /** Refresh token for obtaining new access tokens */
  refresh_token?: string
  /** Space-separated list of granted scopes */
  scope?: string
}

/**
 * Callback function to open browser for OAuth authorization.
 *
 * The callback receives the full authorization URL and should:
 * 1. Open the URL in a browser (popup or redirect)
 * 2. Wait for the OAuth callback with the authorization code
 * 3. Return the authorization code
 *
 * @param authUrl - The full authorization URL to open
 * @returns Promise resolving to the authorization code
 */
export type OAuthBrowserCallback = (authUrl: string) => Promise<string>

/**
 * Optional URL transformer for OAuth fetch requests.
 *
 * Use this to transform URLs before fetching, e.g., to route through a CORS proxy.
 * This is called for all OAuth metadata and token endpoint requests.
 *
 * @param url - The original URL to transform
 * @returns The transformed URL (or the original if no transformation needed)
 */
export type OAuthUrlTransformer = (url: string) => string

/**
 * Interface for persistent token storage.
 *
 * Implement this interface to persist tokens across sessions.
 * If not provided, tokens are stored in memory only.
 */
export interface OAuthTokenStorage {
  /**
   * Get stored tokens for a server
   * @param serverUrl - The MCP server URL
   * @returns The stored tokens, or null if none exist
   */
  get(serverUrl: string): Promise<OAuthTokens | null>

  /**
   * Store tokens for a server
   * @param serverUrl - The MCP server URL
   * @param tokens - The tokens to store
   */
  set(serverUrl: string, tokens: OAuthTokens): Promise<void>

  /**
   * Clear stored tokens for a server
   * @param serverUrl - The MCP server URL
   */
  clear(serverUrl: string): Promise<void>
}
