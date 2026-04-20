/**
 * MCP Server Manager
 *
 * Manages dynamic MCP server connections using MCPClientChannel.
 * Provides a central place to add/remove MCP servers and track their tools.
 * Uses the official @modelcontextprotocol/sdk for transport and authentication.
 * Automatically detects when OAuth authorization is required and launches
 * the OAuth flow in a popup window.
 */

import { MCPClientChannel } from '@coralstack/cmd-ipc-mcp'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { CommandRegistry } from '../commands/command-registry'
import { BrowserOAuthProvider } from '../utils/oauth-popup'

/**
 * Represents a connected MCP server with its tools
 */
export interface MCPServerConnection {
  id: string
  url: string
  name: string
  version: string
  status: 'connecting' | 'authenticating' | 'connected' | 'error' | 'disconnected'
  error?: string
  tools: MCPToolInfo[]
  channel?: MCPClientChannel
}

/**
 * Tool information from an MCP server
 */
export interface MCPToolInfo {
  name: string
  description?: string
  commandId: string // The command ID registered in the CommandRegistry (with prefix)
}

/**
 * Listener type for server connection changes
 */
export type MCPServerChangeListener = (servers: MCPServerConnection[]) => void

/**
 * Create a fetch function that routes external requests through the CORS proxy.
 *
 * The SDK's auth flow makes fetch calls to external servers (OAuth discovery,
 * token exchange, dynamic client registration). In the browser, these would
 * fail due to CORS. This custom fetch routes them through our Vite proxy.
 *
 * It also handles a special case: the SDK constructs `.well-known` discovery URLs
 * from the transport URL (our proxy URL), producing paths like:
 *   /.well-known/oauth-protected-resource/mcp-proxy/https/api.example.com/path
 * These same-origin URLs contain the real server info embedded in the path.
 * We detect the `/mcp-proxy/` pattern, reconstruct the real external URL, and
 * route it through the proxy.
 */
function createProxiedFetch(): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    let url =
      typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)

    if (url.origin === window.location.origin) {
      // Check if this is a same-origin URL with an embedded proxy path.
      // The SDK constructs discovery URLs like:
      //   http://localhost:5173/.well-known/oauth-protected-resource/mcp-proxy/https/host/path
      // We need to extract the real server and rewrite to:
      //   https://host/.well-known/oauth-protected-resource/path
      const proxyMatch = url.pathname.match(/^(.+)\/mcp-proxy\/(https?)\/([\w.:-]+)(\/.*)?$/)
      if (proxyMatch) {
        const [, prefix, protocol, host, path = ''] = proxyMatch
        // Reconstruct the real external URL
        url = new URL(`${protocol}://${host}${prefix}${path}`)
        // Fall through to proxy the external URL below
      } else {
        // Regular same-origin request, pass through to native fetch
        return fetch(input, init)
      }
    }

    // Route external requests through the CORS proxy
    const proxyPath = `/mcp-proxy/${url.protocol.replace(':', '')}/${url.host}${url.pathname}${url.search}`
    const proxyUrl = new URL(proxyPath, window.location.origin)

    if (typeof input === 'string' || input instanceof URL) {
      return fetch(proxyUrl, init)
    }

    // For Request objects, create a new request with the proxied URL
    return fetch(new Request(proxyUrl, input), init)
  }
}

/**
 * MCP Server Manager - singleton that manages MCP server connections
 */
class MCPServerManagerClass {
  private _servers: Map<string, MCPServerConnection> = new Map()
  private _listeners: Set<MCPServerChangeListener> = new Set()

  /**
   * Get all connected servers
   */
  public getServers(): MCPServerConnection[] {
    return Array.from(this._servers.values())
  }

  /**
   * Subscribe to server changes
   */
  public subscribe(listener: MCPServerChangeListener): () => void {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  /**
   * Notify all listeners of changes
   */
  private _notifyListeners(): void {
    const servers = this.getServers()
    for (const listener of this._listeners) {
      listener(servers)
    }
  }

  /**
   * Convert a remote URL to use the local CORS proxy.
   *
   * Converts: https://mcp.stripe.com/mcp
   * To:       /mcp-proxy/https/mcp.stripe.com/mcp
   *
   * This allows browser-based MCP connections to avoid CORS issues.
   */
  private _toProxyUrl(url: string): string {
    try {
      const parsed = new URL(url)
      // Only proxy external URLs, not localhost
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return url
      }
      // Convert to proxy URL: /mcp-proxy/{protocol}/{host}{path}
      // Only include pathname if it's not just "/" (root path)
      const pathPart = parsed.pathname === '/' ? '' : parsed.pathname
      return `/mcp-proxy/${parsed.protocol.replace(':', '')}/${parsed.host}${pathPart}${parsed.search}`
    } catch {
      // If URL parsing fails, return as-is
      return url
    }
  }

  /**
   * Validate server name format.
   * Must be a valid identifier: alphanumeric, dashes, dots, underscores.
   * Must start with a letter or underscore.
   * No spaces or special characters.
   */
  private _validateServerName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Server name is required')
    }

    // Must start with letter or underscore, then allow letters, numbers, dashes, dots, underscores
    const validNamePattern = /^[a-zA-Z_][a-zA-Z0-9._-]*$/
    if (!validNamePattern.test(name)) {
      throw new Error(
        'Server name must start with a letter or underscore, and contain only letters, numbers, dashes, dots, or underscores (no spaces or special characters)',
      )
    }

    // Reasonable length limit
    if (name.length > 64) {
      throw new Error('Server name must be 64 characters or less')
    }
  }

  /**
   * Add a new MCP server connection
   *
   * @param name - The unique name/identifier for this server (used as command prefix)
   * @param url - The base URL of the MCP server (e.g., https://mcp.example.com)
   * @returns The server connection object
   */
  public async addServer(name: string, url: string): Promise<MCPServerConnection> {
    // Validate server name
    this._validateServerName(name)
    const serverId = name.trim()

    // Normalize URL
    const normalizedUrl = url.replace(/\/$/, '')

    // Check if already connected by server ID/name
    const existingServerById = this._servers.get(serverId)
    if (existingServerById) {
      throw new Error(`A server with the name "${serverId}" is already connected`)
    }

    // Check if already connected by URL
    const existingServerByUrl = Array.from(this._servers.values()).find(
      (s) => s.url === normalizedUrl,
    )
    if (existingServerByUrl) {
      throw new Error(`This MCP server URL is already connected as "${existingServerByUrl.id}"`)
    }

    // Create initial server state
    const server: MCPServerConnection = {
      id: serverId,
      url: normalizedUrl,
      name: 'Connecting...',
      version: '',
      status: 'connecting',
      tools: [],
    }

    this._servers.set(serverId, server)
    this._notifyListeners()

    try {
      // Convert URL to use local CORS proxy for external servers
      const proxyUrl = this._toProxyUrl(normalizedUrl)

      // Create OAuth provider for automatic auth detection
      const authProvider = new BrowserOAuthProvider(normalizedUrl)

      // Helper to create transport and channel
      const transportOpts = {
        authProvider,
        fetch: createProxiedFetch(),
      }
      const channelOpts = {
        id: serverId,
        commandPrefix: serverId, // Use server ID as prefix to avoid collisions
        timeout: 30000,
        clientInfo: {
          name: 'cmd-ipc-agent-mcp' as const,
          version: '1.0.0' as const,
        },
      }

      // Create SDK transport with auth provider and proxied fetch
      let transport = new StreamableHTTPClientTransport(
        new URL(proxyUrl, window.location.origin),
        transportOpts,
      )

      // Create MCPClientChannel with SDK transport
      let channel = new MCPClientChannel({ ...channelOpts, transport })

      // Register with CommandRegistry (sets up message handlers, then calls channel.start())
      // If the server requires OAuth, start() will throw UnauthorizedError after
      // opening the auth popup via the BrowserOAuthProvider
      try {
        await CommandRegistry.registerChannel(channel)
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          // OAuth is required - the popup is already open from redirectToAuthorization()
          server.status = 'authenticating'
          this._notifyListeners()

          // Wait for the user to complete the OAuth flow in the popup
          const code = await authProvider.waitForAuthorizationCode()

          // Exchange the authorization code for tokens via the original transport
          await transport.finishAuth(code)

          // Create a fresh transport and channel - the old transport is in a
          // "started" state and can't be reused. The auth provider now has tokens
          // so the new transport will authenticate successfully.
          transport = new StreamableHTTPClientTransport(
            new URL(proxyUrl, window.location.origin),
            transportOpts,
          )
          channel = new MCPClientChannel({ ...channelOpts, transport })

          // Re-register replaces the old channel (same ID) in the registry
          await CommandRegistry.registerChannel(channel)
        } else {
          throw error
        }
      }

      // Update server info from channel
      const serverInfo = channel.serverInfo
      server.name = serverInfo?.name ?? 'Unknown Server'
      server.version = serverInfo?.version ?? ''
      server.channel = channel
      server.status = 'connected'

      // Get tools from the registered commands
      // Commands registered by this channel will have the serverId prefix
      const allCommands = CommandRegistry.listCommands()
      const serverTools: MCPToolInfo[] = allCommands
        .filter((cmd) => cmd.id.startsWith(`${serverId}.`))
        .map((cmd) => ({
          name: cmd.id.replace(`${serverId}.`, ''),
          description: cmd.description,
          commandId: cmd.id,
        }))

      server.tools = serverTools

      this._servers.set(serverId, server)
      this._notifyListeners()

      return server
    } catch (error) {
      // Update server state with error
      server.status = 'error'
      server.error = error instanceof Error ? error.message : String(error)
      this._servers.set(serverId, server)
      this._notifyListeners()

      throw error
    }
  }

  /**
   * Remove an MCP server connection
   *
   * @param serverId - The ID of the server to remove
   */
  public async removeServer(serverId: string): Promise<void> {
    const server = this._servers.get(serverId)
    if (!server) {
      return
    }

    // Close the channel if it exists
    if (server.channel) {
      try {
        await server.channel.close()
      } catch {
        // Ignore close errors
      }
    }

    // Remove from map
    this._servers.delete(serverId)
    this._notifyListeners()
  }

  /**
   * Get tools from all connected servers
   */
  public getAllTools(): MCPToolInfo[] {
    const tools: MCPToolInfo[] = []
    for (const server of this._servers.values()) {
      if (server.status === 'connected') {
        tools.push(...server.tools)
      }
    }
    return tools
  }
}

// Export singleton instance
export const MCPServerManager = new MCPServerManagerClass()
