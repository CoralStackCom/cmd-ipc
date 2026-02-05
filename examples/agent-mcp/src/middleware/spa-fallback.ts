/**
 * SPA Fallback Middleware
 *
 * Handles SPA routing by serving index.html for non-file routes.
 * This ensures OAuth callbacks (e.g., /oauth/callback?code=...) work properly.
 * Preserves query strings so the React app can read the OAuth code.
 *
 * @packageDocumentation
 */

import type { Connect } from 'vite'

/**
 * Create SPA fallback middleware for Vite dev server.
 *
 * Rewrites non-file routes to `/` so Vite serves index.html.
 * Preserves query strings for OAuth callbacks and other client-side routing.
 */
export function spaFallbackMiddleware(): Connect.NextHandleFunction {
  return (req, _res, next) => {
    if (!req.url) {
      next()
      return
    }

    // Parse URL to separate path from query string
    const [pathname, queryString] = req.url.split('?')

    // Skip API routes and static files
    if (
      pathname.startsWith('/mcp-proxy/') ||
      pathname.startsWith('/@') ||
      pathname.startsWith('/node_modules/') ||
      pathname.startsWith('/src/') ||
      pathname.includes('.')
    ) {
      next()
      return
    }

    // For SPA routes like /oauth/callback, rewrite path to / but keep query string
    // Vite will serve index.html and React reads the query params
    if (pathname !== '/') {
      const newUrl = queryString ? `/?${queryString}` : '/'
      // eslint-disable-next-line no-console
      console.log('[SPA Fallback] Rewriting', req.url, '->', newUrl)
      req.url = newUrl
    }
    next()
  }
}
