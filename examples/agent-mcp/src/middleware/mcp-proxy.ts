/**
 * MCP Proxy Middleware
 *
 * Proxies requests from /mcp-proxy/{protocol}/{host}/{path} to the actual MCP server.
 * This avoids CORS issues when connecting to remote MCP servers from the browser.
 *
 * @example
 * /mcp-proxy/https/mcp.stripe.com/mcp -> https://mcp.stripe.com/mcp
 *
 * @packageDocumentation
 */

import type { Connect } from 'vite'

/**
 * Collect request body from a Node.js IncomingMessage
 */
async function collectRequestBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Create MCP proxy middleware for Vite dev server.
 *
 * Routes requests from `/mcp-proxy/{protocol}/{host}/{path}` to the actual MCP server.
 * Handles CORS preflight requests and adds appropriate headers.
 */
export function mcpProxyMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    // Only handle /mcp-proxy/* requests
    if (!req.url?.startsWith('/mcp-proxy/')) {
      next()
      return
    }

    // eslint-disable-next-line no-console
    console.log('[MCP Proxy] Handling request:', req.method, req.url)

    // Parse the URL: /mcp-proxy/{protocol}/{host}/{path...}
    // Path is optional - some MCP servers use root path (e.g., https://mcp.stripe.com)
    const match = req.url.match(/^\/mcp-proxy\/(https?)\/([\w.:-]+)(\/.*)?$/)
    if (!match) {
      // eslint-disable-next-line no-console
      console.log('[MCP Proxy] URL did not match pattern:', req.url)
      res.statusCode = 400
      res.end(
        JSON.stringify({
          error: 'Invalid proxy URL format. Use: /mcp-proxy/{protocol}/{host}/{path}',
        }),
      )
      return
    }

    const [, protocol, host, path = ''] = match
    const targetUrl = `${protocol}://${host}${path}`

    // eslint-disable-next-line no-console
    console.log('[MCP Proxy] Forwarding to:', targetUrl)

    // Handle the proxy request asynchronously using void to suppress promise warning
    void (async () => {
      try {
        // Collect request body
        const body = await collectRequestBody(req)

        // Forward headers, excluding host-specific ones
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
          if (
            value &&
            ![
              'host',
              'connection',
              'content-length',
              'accept-encoding',
              'if-none-match',
              'if-modified-since',
            ].includes(key.toLowerCase())
          ) {
            headers[key] = Array.isArray(value) ? value.join(', ') : value
          }
        }
        // Set the correct host header for the target
        headers['host'] = host

        // Handle preflight OPTIONS requests immediately with CORS headers
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', '*')
          res.setHeader('Access-Control-Expose-Headers', '*')
          res.setHeader('Access-Control-Max-Age', '86400')
          res.end()
          return
        }

        // Make the proxied request
        const response = await fetch(targetUrl, {
          method: req.method || 'GET',
          headers,
          body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : new Uint8Array(body),
        })

        // eslint-disable-next-line no-console
        console.log('[MCP Proxy] Response status:', response.status)

        // Copy response headers, adding CORS headers
        res.statusCode = response.status
        response.headers.forEach((value, key) => {
          // Skip headers that might conflict or cause size mismatch
          // content-length is excluded because fetch() decompresses the body,
          // so the original content-length (compressed size) would truncate the response
          if (
            !['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(
              key.toLowerCase(),
            )
          ) {
            res.setHeader(key, value)
          }
        })

        // Add CORS headers to allow browser access
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', '*')
        res.setHeader('Access-Control-Expose-Headers', '*')

        // Stream response body
        const responseBody = await response.arrayBuffer()
        res.end(Buffer.from(responseBody))
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[MCP Proxy] Error:', error)
        if (!res.headersSent) {
          res.statusCode = 502
          res.end(
            JSON.stringify({
              error: 'Proxy error',
              message: error instanceof Error ? error.message : String(error),
            }),
          )
        }
      }
    })()

    // Don't call next() - we're handling this request
  }
}
