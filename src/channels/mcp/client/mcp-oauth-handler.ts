/**
 * MCPOAuthHandler - Handles OAuth 2.1 authentication for MCP servers
 *
 * Implements the full OAuth flow as per MCP Protocol specification:
 * 1. Detect 401 with WWW-Authenticate header
 * 2. Fetch Protected Resource Metadata (RFC 9728)
 * 3. Fetch Authorization Server Metadata (RFC 8414)
 * 4. Dynamic Client Registration (RFC 7591) if supported
 * 5. Authorization Code flow with PKCE (OAuth 2.1)
 * 6. Token management and refresh
 *
 * @packageDocumentation
 */

/* eslint-disable no-console */
// Console logging is intentionally used for OAuth error reporting and debugging

import type {
  OAuthAuthorizationServerMetadata,
  OAuthBrowserCallback,
  OAuthClientRegistration,
  OAuthProtectedResourceMetadata,
  OAuthTokens,
  OAuthTokenStorage,
  OAuthUrlTransformer,
} from './mcp-oauth-types'

/**
 * Default redirect URI path for OAuth callbacks
 */
const DEFAULT_REDIRECT_PATH = '/oauth/callback'

/**
 * Buffer time before token expiry to trigger refresh (5 minutes)
 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * MCPOAuthHandler manages OAuth 2.1 authentication for a single MCP server.
 *
 * This handler is designed to be transparent - it automatically handles
 * 401 responses by initiating the OAuth flow, and manages token refresh.
 */
export class MCPOAuthHandler {
  private _resourceMetadata?: OAuthProtectedResourceMetadata
  private _authServerMetadata?: OAuthAuthorizationServerMetadata
  private _clientRegistration?: OAuthClientRegistration
  private _tokens?: OAuthTokens
  private _tokenExpiresAt?: number

  // PKCE state for current authorization flow
  private _codeVerifier?: string
  private _state?: string

  // Redirect URI for OAuth callback
  private readonly _redirectUri: string

  /**
   * Create a new OAuth handler for an MCP server
   *
   * @param serverUrl - The MCP server base URL
   * @param openBrowser - Callback to open browser for user authorization
   * @param tokenStorage - Optional persistent token storage
   * @param clientName - Client name for dynamic registration
   * @param redirectUri - Optional custom redirect URI (defaults to current origin + /oauth/callback)
   * @param urlTransformer - Optional URL transformer for CORS proxy support
   */
  constructor(
    private readonly _serverUrl: string,
    private readonly _openBrowser: OAuthBrowserCallback,
    private readonly _tokenStorage?: OAuthTokenStorage,
    private readonly _clientName: string = 'cmd-ipc',
    redirectUri?: string,
    private readonly _urlTransformer?: OAuthUrlTransformer,
  ) {
    // Determine redirect URI
    if (redirectUri) {
      this._redirectUri = redirectUri
    } else if (typeof window !== 'undefined') {
      this._redirectUri = `${window.location.origin}${DEFAULT_REDIRECT_PATH}`
    } else {
      // Node.js environment - use localhost
      this._redirectUri = `http://localhost:3000${DEFAULT_REDIRECT_PATH}`
    }

    // Try to load tokens from storage
    this._loadTokensFromStorage()
  }

  /**
   * Transform a URL using the configured transformer (for CORS proxy support)
   */
  private _transformUrl(url: string): string {
    return this._urlTransformer ? this._urlTransformer(url) : url
  }

  /**
   * Check if we have valid (non-expired) tokens
   */
  public hasValidTokens(): boolean {
    if (!this._tokens?.access_token) {
      return false
    }

    // Check if token is expired (with buffer for refresh)
    if (this._tokenExpiresAt) {
      const now = Date.now()
      if (now >= this._tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
        return false
      }
    }

    return true
  }

  /**
   * Get Authorization header value, or undefined if no valid token
   */
  public getAuthorizationHeader(): string | undefined {
    if (!this._tokens?.access_token) {
      return undefined
    }
    return `Bearer ${this._tokens.access_token}`
  }

  /**
   * Handle 401 Unauthorized response - initiates full OAuth flow
   *
   * @param response - The 401 response from the server
   * @returns true if authentication succeeded, false otherwise
   */
  public async handleUnauthorized(response: Response): Promise<boolean> {
    try {
      // Step 1: Parse WWW-Authenticate header to get resource metadata URL
      const wwwAuth = response.headers.get('WWW-Authenticate')
      const resourceMetadataUrl = this._parseResourceMetadataUrl(wwwAuth)

      if (!resourceMetadataUrl) {
        console.error('[OAuth] No resource_metadata URL in WWW-Authenticate header')
        return false
      }

      // Step 2: Fetch Protected Resource Metadata
      this._resourceMetadata = await this._fetchResourceMetadata(resourceMetadataUrl)

      if (!this._resourceMetadata.authorization_servers?.length) {
        console.error('[OAuth] No authorization servers in resource metadata')
        return false
      }

      // Step 3: Fetch Authorization Server Metadata
      const authServerUrl = this._resourceMetadata.authorization_servers[0]
      this._authServerMetadata = await this._fetchAuthServerMetadata(authServerUrl)

      // Step 4: Dynamic Client Registration (if endpoint available and we don't have registration)
      if (this._authServerMetadata.registration_endpoint && !this._clientRegistration) {
        try {
          this._clientRegistration = await this._registerClient()
        } catch (error) {
          console.warn('[OAuth] Dynamic client registration failed, will try without:', error)
        }
      }

      // Step 5: Build authorization URL with PKCE and open browser
      const authUrl = await this._buildAuthorizationUrl()

      // Step 6: Open browser and wait for authorization code
      const authCode = await this._openBrowser(authUrl)

      if (!authCode) {
        console.error('[OAuth] No authorization code received')
        return false
      }

      // Step 7: Exchange code for tokens
      this._tokens = await this._exchangeCodeForTokens(authCode)
      this._updateTokenExpiry()

      // Save tokens to storage
      await this._saveTokensToStorage()

      return true
    } catch (error) {
      console.error('[OAuth] Authentication failed:', error)
      return false
    }
  }

  /**
   * Attempt to refresh tokens using the refresh_token
   *
   * @returns true if refresh succeeded, false otherwise
   */
  public async refreshTokens(): Promise<boolean> {
    if (!this._tokens?.refresh_token || !this._authServerMetadata?.token_endpoint) {
      return false
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this._tokens.refresh_token,
      })

      // Add client credentials if we have them
      if (this._clientRegistration?.client_id) {
        params.set('client_id', this._clientRegistration.client_id)
      }
      if (this._clientRegistration?.client_secret) {
        params.set('client_secret', this._clientRegistration.client_secret)
      }

      const response = await fetch(this._transformUrl(this._authServerMetadata.token_endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      if (!response.ok) {
        console.error('[OAuth] Token refresh failed:', response.status)
        return false
      }

      this._tokens = (await response.json()) as OAuthTokens
      this._updateTokenExpiry()

      // Save refreshed tokens to storage
      await this._saveTokensToStorage()

      return true
    } catch (error) {
      console.error('[OAuth] Token refresh error:', error)
      return false
    }
  }

  /**
   * Clear stored tokens (logout)
   */
  public async clearTokens(): Promise<void> {
    this._tokens = undefined
    this._tokenExpiresAt = undefined

    if (this._tokenStorage) {
      await this._tokenStorage.clear(this._serverUrl)
    }
  }

  /**
   * Parse the resource_metadata URL from WWW-Authenticate header
   *
   * Expected formats:
   * WWW-Authenticate: Bearer realm="mcp", resource_metadata="https://server/.well-known/oauth-protected-resource"
   * WWW-Authenticate: Bearer resource_metadata=https://server/.well-known/oauth-protected-resource
   */
  private _parseResourceMetadataUrl(wwwAuth: string | null): string | null {
    if (!wwwAuth) {
      return null
    }

    // Look for resource_metadata="..." (with quotes) in the header
    const quotedMatch = wwwAuth.match(/resource_metadata="([^"]+)"/)
    if (quotedMatch?.[1]) {
      return quotedMatch[1]
    }

    // Look for resource_metadata=... (without quotes) in the header
    // Match until whitespace, comma, or end of string
    const unquotedMatch = wwwAuth.match(/resource_metadata=([^\s,]+)/)
    if (unquotedMatch?.[1]) {
      return unquotedMatch[1]
    }

    // Fallback: construct default well-known URL from server
    return `${this._serverUrl}/.well-known/oauth-protected-resource`
  }

  /**
   * Fetch Protected Resource Metadata (RFC 9728)
   */
  private async _fetchResourceMetadata(url: string): Promise<OAuthProtectedResourceMetadata> {
    const response = await fetch(this._transformUrl(url))

    if (!response.ok) {
      throw new Error(`Failed to fetch resource metadata: ${response.status}`)
    }

    return (await response.json()) as OAuthProtectedResourceMetadata
  }

  /**
   * Build discovery URLs for authorization server metadata.
   * Follows the official MCP TypeScript SDK pattern.
   *
   * For root paths (/), tries:
   * - /.well-known/oauth-authorization-server
   * - /.well-known/openid-configuration
   *
   * For non-root paths (e.g., /mcp), tries:
   * - /.well-known/oauth-authorization-server/mcp
   * - /.well-known/openid-configuration/mcp
   * - /mcp/.well-known/openid-configuration
   */
  private _buildDiscoveryUrls(authServerUrl: string): { url: string; type: 'oauth' | 'oidc' }[] {
    const parsed = new URL(authServerUrl)
    const origin = parsed.origin
    const hasPath = parsed.pathname !== '/'

    if (!hasPath) {
      return [
        { url: `${origin}/.well-known/oauth-authorization-server`, type: 'oauth' },
        { url: `${origin}/.well-known/openid-configuration`, type: 'oidc' },
      ]
    }

    // Normalize pathname (remove trailing slash)
    let pathname = parsed.pathname
    if (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1)
    }

    return [
      { url: `${origin}/.well-known/oauth-authorization-server${pathname}`, type: 'oauth' },
      { url: `${origin}/.well-known/openid-configuration${pathname}`, type: 'oidc' },
      { url: `${origin}${pathname}/.well-known/openid-configuration`, type: 'oidc' },
    ]
  }

  /**
   * Fetch Authorization Server Metadata (RFC 8414)
   *
   * Follows the official MCP TypeScript SDK pattern:
   * 1. Tries discovery URLs in order (oauth-authorization-server, then openid-configuration)
   * 2. If all discovery attempts fail, falls back to default endpoint paths:
   *    - Authorization: {authServerUrl}/authorize
   *    - Token: {authServerUrl}/token
   *    - Registration: {authServerUrl}/register
   */
  private async _fetchAuthServerMetadata(
    authServerUrl: string,
  ): Promise<OAuthAuthorizationServerMetadata> {
    const parsed = new URL(authServerUrl)
    const origin = parsed.origin

    // Normalize the auth server URL (remove trailing slash)
    const normalizedAuthServerUrl = authServerUrl.replace(/\/$/, '')

    // Build discovery URLs following official SDK pattern
    const discoveryUrls = this._buildDiscoveryUrls(authServerUrl)

    // Try each discovery URL in order
    for (const { url } of discoveryUrls) {
      try {
        const response = await fetch(this._transformUrl(url))
        if (response.ok) {
          return (await response.json()) as OAuthAuthorizationServerMetadata
        }
        // Consume the response body to avoid connection issues
        await response.text().catch(() => {})
      } catch {
        // CORS or network error, continue to next URL
        continue
      }
    }

    // If all discovery attempts fail, fall back to default endpoints per MCP spec
    // https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization
    console.warn(
      `[OAuth] Metadata discovery failed, using default endpoints relative to ${normalizedAuthServerUrl}`,
    )
    return {
      issuer: origin,
      authorization_endpoint: `${normalizedAuthServerUrl}/authorize`,
      token_endpoint: `${normalizedAuthServerUrl}/token`,
      registration_endpoint: `${normalizedAuthServerUrl}/register`,
    }
  }

  /**
   * Register client dynamically (RFC 7591)
   */
  private async _registerClient(): Promise<OAuthClientRegistration> {
    if (!this._authServerMetadata?.registration_endpoint) {
      throw new Error('No registration endpoint available')
    }

    const registrationRequest = {
      client_name: this._clientName,
      redirect_uris: [this._redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
    }

    const response = await fetch(
      this._transformUrl(this._authServerMetadata.registration_endpoint),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registrationRequest),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Client registration failed: ${response.status} - ${errorText}`)
    }

    return (await response.json()) as OAuthClientRegistration
  }

  /**
   * Generate PKCE code verifier and challenge
   *
   * Uses crypto.getRandomValues for secure random generation
   * and SHA-256 for the challenge
   */
  private async _generatePKCE(): Promise<{ verifier: string; challenge: string }> {
    // Generate random code verifier (43-128 characters)
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const verifier = this._base64UrlEncode(array)

    // Generate code challenge using SHA-256
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const challenge = this._base64UrlEncode(new Uint8Array(hashBuffer))

    return { verifier, challenge }
  }

  /**
   * Base64 URL encode (RFC 4648)
   */
  private _base64UrlEncode(buffer: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...buffer))
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  /**
   * Generate random state parameter for CSRF protection
   */
  private _generateState(): string {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return this._base64UrlEncode(array)
  }

  /**
   * Build the authorization URL with PKCE (S256 method as required by OAuth 2.1)
   */
  private async _buildAuthorizationUrl(): Promise<string> {
    if (!this._authServerMetadata?.authorization_endpoint) {
      throw new Error('No authorization endpoint available')
    }

    // Generate PKCE parameters with S256 (required by OAuth 2.1)
    const { verifier, challenge } = await this._generatePKCE()
    this._codeVerifier = verifier

    // Generate state for CSRF protection
    this._state = this._generateState()

    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: this._redirectUri,
      state: this._state,
      code_challenge: challenge,
      code_challenge_method: 'S256', // Required by OAuth 2.1/MCP spec
    })

    // Add client_id if we have one
    if (this._clientRegistration?.client_id) {
      params.set('client_id', this._clientRegistration.client_id)
    }

    // Add scopes from resource metadata
    if (this._resourceMetadata?.scopes_supported?.length) {
      params.set('scope', this._resourceMetadata.scopes_supported.join(' '))
    }

    // Add resource indicator
    if (this._resourceMetadata?.resource) {
      params.set('resource', this._resourceMetadata.resource)
    }

    return `${this._authServerMetadata.authorization_endpoint}?${params.toString()}`
  }

  /**
   * Exchange authorization code for tokens
   */
  private async _exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    if (!this._authServerMetadata?.token_endpoint) {
      throw new Error('No token endpoint available')
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this._redirectUri,
      code_verifier: this._codeVerifier!,
    })

    // Add client credentials if we have them
    if (this._clientRegistration?.client_id) {
      params.set('client_id', this._clientRegistration.client_id)
    }
    if (this._clientRegistration?.client_secret) {
      params.set('client_secret', this._clientRegistration.client_secret)
    }

    const response = await fetch(this._transformUrl(this._authServerMetadata.token_endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`)
    }

    return (await response.json()) as OAuthTokens
  }

  /**
   * Update token expiry timestamp
   */
  private _updateTokenExpiry(): void {
    if (this._tokens?.expires_in) {
      this._tokenExpiresAt = Date.now() + this._tokens.expires_in * 1000
    } else {
      // Default to 1 hour if not specified
      this._tokenExpiresAt = Date.now() + 3600 * 1000
    }
  }

  /**
   * Load tokens from persistent storage
   */
  private async _loadTokensFromStorage(): Promise<void> {
    if (!this._tokenStorage) {
      return
    }

    try {
      const tokens = await this._tokenStorage.get(this._serverUrl)
      if (tokens) {
        this._tokens = tokens
        this._updateTokenExpiry()
      }
    } catch (error) {
      console.warn('[OAuth] Failed to load tokens from storage:', error)
    }
  }

  /**
   * Save tokens to persistent storage
   */
  private async _saveTokensToStorage(): Promise<void> {
    if (!this._tokenStorage || !this._tokens) {
      return
    }

    try {
      await this._tokenStorage.set(this._serverUrl, this._tokens)
    } catch (error) {
      console.warn('[OAuth] Failed to save tokens to storage:', error)
    }
  }
}
