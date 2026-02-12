/**
 * OAuth Popup Utility
 *
 * Handles opening OAuth authorization in a popup window and
 * waiting for the callback with the authorization code.
 * Provides a BrowserOAuthProvider that implements the SDK's OAuthClientProvider
 * interface for browser-based OAuth flows.
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

/**
 * LocalStorage key for OAuth callback communication.
 * Used as a fallback when window.opener is not available
 * (e.g., due to cross-origin redirects breaking the reference).
 */
const OAUTH_CALLBACK_KEY = 'mcp-oauth-callback'

/**
 * Open OAuth authorization in a popup window and wait for callback.
 *
 * This function:
 * 1. Opens the authorization URL in a popup window
 * 2. Listens for a postMessage from the callback page (primary method)
 * 3. Falls back to localStorage polling if postMessage doesn't work
 *    (handles cases where window.opener is lost due to cross-origin redirects)
 * 4. Returns the authorization code when received
 *
 * @param authUrl - The full OAuth authorization URL
 * @returns Promise resolving to the authorization code
 * @throws Error if popup is blocked, closed, or authorization fails
 */
export function openOAuthPopup(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Clear any stale callback data
    localStorage.removeItem(OAUTH_CALLBACK_KEY)

    // Calculate popup position (centered)
    const width = 600
    const height = 700
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2

    // Open popup window
    const popup = window.open(
      authUrl,
      'mcp-oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=1,resizable=1,scrollbars=1`,
    )

    if (!popup) {
      reject(new Error('Failed to open OAuth popup - please check your popup blocker settings'))
      return
    }

    // Focus the popup
    popup.focus()

    let resolved = false

    // Store interval IDs for cleanup
    const intervals: {
      timeout?: ReturnType<typeof setInterval>
      localStorage?: ReturnType<typeof setInterval>
    } = {}

    const cleanup = () => {
      resolved = true
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('storage', handleStorage)
      if (intervals.timeout) clearInterval(intervals.timeout)
      if (intervals.localStorage) clearInterval(intervals.localStorage)
      localStorage.removeItem(OAUTH_CALLBACK_KEY)
    }

    const handleResult = (data: { code?: string; error?: string }) => {
      if (resolved) return
      cleanup()
      try {
        popup.close()
      } catch {
        // Ignore close errors
      }

      if (data.code) {
        resolve(data.code)
      } else if (data.error) {
        reject(new Error(`OAuth authorization failed: ${data.error}`))
      } else {
        reject(new Error('OAuth authorization failed: no code received'))
      }
    }

    // Method 1: Handle message from callback page (when window.opener works)
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'mcp-oauth-callback') return
      handleResult(event.data)
    }

    // Method 2: Handle storage event (cross-tab communication fallback)
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== OAUTH_CALLBACK_KEY || !event.newValue) return
      try {
        const data = JSON.parse(event.newValue)
        handleResult(data)
      } catch {
        // Ignore parse errors
      }
    }

    // Method 3: Poll localStorage (fallback for same-tab scenarios)
    intervals.localStorage = setInterval(() => {
      if (resolved) return
      const stored = localStorage.getItem(OAUTH_CALLBACK_KEY)
      if (stored) {
        try {
          const data = JSON.parse(stored)
          handleResult(data)
        } catch {
          // Ignore parse errors
        }
      }
    }, 200)

    // Track how long we've been waiting
    let waitTimeMs = 0
    const maxWaitTimeMs = 300000 // Max 5 minutes total timeout

    // IMPORTANT: We do NOT rely on popup.closed to detect if the user closed the popup.
    // When a popup navigates to a cross-origin URL (like Stripe's OAuth page),
    // popup.closed can incorrectly return true even though the popup is still open.
    // Instead, we just wait for the callback via localStorage/postMessage and only
    // timeout after a long period.
    intervals.timeout = setInterval(() => {
      if (resolved) return

      waitTimeMs += 1000

      // Timeout after max wait time
      if (waitTimeMs >= maxWaitTimeMs) {
        cleanup()
        try {
          popup.close()
        } catch {
          // Ignore
        }
        reject(new Error('OAuth flow timed out after 5 minutes'))
      }
    }, 1000)

    // Listen for callback via postMessage
    window.addEventListener('message', handleMessage)
    // Listen for callback via storage event (cross-tab)
    window.addEventListener('storage', handleStorage)
  })
}

/**
 * Write OAuth callback data to localStorage.
 * Called by the callback page when window.opener is not available.
 */
export function writeOAuthCallback(data: { code?: string; error?: string; state?: string }): void {
  localStorage.setItem(OAUTH_CALLBACK_KEY, JSON.stringify(data))
}

/**
 * Browser-based OAuthClientProvider for the MCP SDK.
 *
 * Implements the SDK's OAuthClientProvider interface for browser-based OAuth flows.
 * Uses popup windows for authorization and localStorage for token/state persistence.
 *
 * Flow:
 * 1. SDK detects auth is required (401 from MCP server)
 * 2. SDK calls `redirectToAuthorization()` which opens an OAuth popup
 * 3. SDK throws `UnauthorizedError`
 * 4. Application catches the error and calls `waitForAuthorizationCode()`
 * 5. User completes auth in popup, code is returned via postMessage/localStorage
 * 6. Application calls `transport.finishAuth(code)` to exchange code for tokens
 * 7. Connection is retried with the new tokens
 */
export class BrowserOAuthProvider implements OAuthClientProvider {
  private _serverUrl: string
  private _authCodePromise?: Promise<string>

  constructor(serverUrl: string) {
    this._serverUrl = serverUrl
  }

  get redirectUrl(): string {
    return `${window.location.origin}/oauth/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: 'CMD-IPC Agent MCP Example',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const key = `mcp-oauth-client:${this._serverUrl}`
    const stored = localStorage.getItem(key)
    if (!stored) return undefined
    try {
      return JSON.parse(stored)
    } catch {
      return undefined
    }
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const key = `mcp-oauth-client:${this._serverUrl}`
    localStorage.setItem(key, JSON.stringify(info))
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const key = `mcp-oauth-tokens:${this._serverUrl}`
    const stored = localStorage.getItem(key)
    if (!stored) return undefined
    try {
      return JSON.parse(stored)
    } catch {
      return undefined
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const key = `mcp-oauth-tokens:${this._serverUrl}`
    localStorage.setItem(key, JSON.stringify(tokens))
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Open the OAuth popup - store the promise so we can await the code later
    this._authCodePromise = openOAuthPopup(authorizationUrl.toString())
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const key = `mcp-oauth-verifier:${this._serverUrl}`
    localStorage.setItem(key, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const key = `mcp-oauth-verifier:${this._serverUrl}`
    return localStorage.getItem(key) ?? ''
  }

  /**
   * Override resource URL validation for proxied connections.
   *
   * The SDK compares the transport URL (our proxy URL like http://localhost:5173/mcp-proxy/...)
   * against the resource URL from the server's protected resource metadata (the real URL like
   * https://api.githubcopilot.com/mcp). Since we're proxying, these won't match.
   *
   * We validate by checking that the resource URL matches the real server URL we're connecting to,
   * and return the resource URL from the metadata so the OAuth token is scoped correctly.
   */
  async validateResourceURL(_serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
    if (!resource) {
      return undefined
    }

    // Validate that the resource matches our actual server URL (or its origin)
    const resourceUrl = new URL(resource)
    const actualUrl = new URL(this._serverUrl)

    if (resourceUrl.origin !== actualUrl.origin) {
      throw new Error(
        `Protected resource ${resource} does not match expected server ${this._serverUrl}`,
      )
    }

    // Return the real resource URL (not the proxy URL)
    return resourceUrl
  }

  /**
   * Wait for the user to complete the OAuth flow in the popup.
   * Returns the authorization code from the popup callback.
   *
   * This is NOT part of the OAuthClientProvider interface - it's called
   * by the MCPServerManager after catching UnauthorizedError.
   */
  async waitForAuthorizationCode(): Promise<string> {
    if (!this._authCodePromise) {
      throw new Error('No OAuth authorization in progress')
    }
    return this._authCodePromise
  }

  /**
   * Invalidate stored credentials when the server rejects them.
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    if (scope === 'all' || scope === 'tokens') {
      localStorage.removeItem(`mcp-oauth-tokens:${this._serverUrl}`)
    }
    if (scope === 'all' || scope === 'client') {
      localStorage.removeItem(`mcp-oauth-client:${this._serverUrl}`)
    }
    if (scope === 'all' || scope === 'verifier') {
      localStorage.removeItem(`mcp-oauth-verifier:${this._serverUrl}`)
    }
  }
}
