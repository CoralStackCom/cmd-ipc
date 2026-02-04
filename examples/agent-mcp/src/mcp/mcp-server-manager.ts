/**
 * MCP Server Manager
 *
 * Manages dynamic MCP server connections using MCPClientChannel.
 * Provides a central place to add/remove MCP servers and track their tools.
 */

import { MCPClientChannel } from '@coralstack/cmd-ipc'

import { CommandRegistry } from '../commands/command-registry'

/**
 * Represents a connected MCP server with its tools
 */
export interface MCPServerConnection {
  id: string
  url: string
  name: string
  version: string
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
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
   * Generate a server ID from the URL domain
   * e.g., https://docs.mcp.cloudflare.com -> docs-mcp-cloudflare-com
   */
  private _generateServerIdFromUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      // Convert hostname to ID: replace dots with dashes
      return urlObj.hostname.replace(/\./g, '-')
    } catch {
      // Fallback if URL parsing fails
      return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    }
  }

  /**
   * Add a new MCP server connection
   *
   * @param url - The base URL of the MCP server (e.g., https://mcp.example.com)
   * @returns The server connection object
   */
  public async addServer(url: string): Promise<MCPServerConnection> {
    // Normalize URL
    const normalizedUrl = url.replace(/\/$/, '')

    // Check if already connected by URL
    const existingServerByUrl = Array.from(this._servers.values()).find(
      (s) => s.url === normalizedUrl,
    )
    if (existingServerByUrl) {
      throw new Error(`This MCP server is already connected: ${normalizedUrl}`)
    }

    // Generate server ID from URL domain (e.g., docs-mcp-cloudflare-com)
    const serverId = this._generateServerIdFromUrl(normalizedUrl)

    // Check if already connected by server ID (same domain)
    const existingServerById = this._servers.get(serverId)
    if (existingServerById) {
      throw new Error(
        `An MCP server with the same domain is already connected: ${existingServerById.url}`,
      )
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
      // Create MCPClientChannel
      const channel = new MCPClientChannel({
        id: serverId,
        baseUrl: normalizedUrl,
        commandPrefix: serverId, // Use server ID as prefix to avoid collisions
        timeout: 30000,
        clientInfo: {
          name: 'cmd-ipc-agent-mcp',
          version: '1.0.0',
        },
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
