/**
 * OAuth Popup Utility
 *
 * Handles opening OAuth authorization in a popup window and
 * waiting for the callback with the authorization code.
 */

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
 * LocalStorage-based token storage implementation.
 *
 * Stores OAuth tokens in localStorage for persistence across sessions.
 * Tokens are stored with a prefix to avoid collisions.
 */
export const localStorageTokenStorage = {
  /**
   * Get stored tokens for a server
   */
  async get(serverUrl: string): Promise<{
    access_token: string
    token_type: string
    expires_in?: number
    refresh_token?: string
    scope?: string
  } | null> {
    const key = `mcp-oauth-tokens:${serverUrl}`
    const stored = localStorage.getItem(key)
    if (!stored) {
      return null
    }
    try {
      return JSON.parse(stored)
    } catch {
      return null
    }
  },

  /**
   * Store tokens for a server
   */
  async set(
    serverUrl: string,
    tokens: {
      access_token: string
      token_type: string
      expires_in?: number
      refresh_token?: string
      scope?: string
    },
  ): Promise<void> {
    const key = `mcp-oauth-tokens:${serverUrl}`
    localStorage.setItem(key, JSON.stringify(tokens))
  },

  /**
   * Clear stored tokens for a server
   */
  async clear(serverUrl: string): Promise<void> {
    const key = `mcp-oauth-tokens:${serverUrl}`
    localStorage.removeItem(key)
  },
}
