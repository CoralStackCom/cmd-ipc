/**
 * MCP Server Manager
 *
 * Manages dynamic MCP server connections using MCPClientChannel.
 * Provides a central place to add/remove MCP servers and track their tools.
 * Automatically handles OAuth authentication for servers that require it.
 */

import { MCPClientChannel } from '@coralstack/cmd-ipc'

import { CommandRegistry } from '../commands/command-registry'
import { localStorageTokenStorage, openOAuthPopup } from '../utils/oauth-popup'

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

      // Determine endpoint: if user provided a path, use it as endpoint; otherwise use empty string
      // This handles servers like https://mcp.stripe.com (no path) vs https://example.com/mcp (has path)
      const parsedUrl = new URL(normalizedUrl)
      const endpoint = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname

      // Create MCPClientChannel with OAuth support
      const channel = new MCPClientChannel({
        id: serverId,
        baseUrl: proxyUrl,
        endpoint, // Use the path from URL as endpoint, or empty if no path
        commandPrefix: serverId, // Use server ID as prefix to avoid collisions
        timeout: 30000,
        clientInfo: {
          name: 'cmd-ipc-agent-mcp',
          version: '1.0.0',
        },
        // Enable OAuth - automatically handles 401 responses
        openAuthBrowser: async (authUrl: string) => {
          // Update status to show we're authenticating
          server.status = 'authenticating'
          this._servers.set(serverId, server)
          this._notifyListeners()

          // Open OAuth popup and wait for authorization code
          return openOAuthPopup(authUrl)
        },
        // Persist tokens in localStorage
        tokenStorage: localStorageTokenStorage,
        // Transform OAuth URLs through the CORS proxy
        oauthUrlTransformer: (url: string) => this._toProxyUrl(url),
      })

      // Register with CommandRegistry
      await CommandRegistry.registerChannel(channel)

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
