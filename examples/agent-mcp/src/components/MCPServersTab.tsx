/**
 * MCP Servers Tab Component
 *
 * Displays connected MCP servers and allows adding/removing servers dynamically.
 */

import { useEffect, useState } from 'react'

import {
  MCPServerManager,
  type MCPServerConnection,
  type MCPToolInfo,
} from '../mcp/mcp-server-manager'

/**
 * Server item component with expandable tools list
 */
function ServerItem({
  server,
  onRemove,
}: {
  server: MCPServerConnection
  onRemove: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const statusColors: Record<MCPServerConnection['status'], string> = {
    connecting: '#f59e0b',
    authenticating: '#3b82f6', // Blue - waiting for OAuth
    connected: '#22c55e',
    error: '#ef4444',
    disconnected: '#6b7280',
  }

  return (
    <div className="mcp-server-item">
      <div className="mcp-server-header" onClick={() => setExpanded(!expanded)}>
        <div className="mcp-server-info">
          <div className="mcp-server-status">
            <span
              className="mcp-status-dot"
              style={{ backgroundColor: statusColors[server.status] }}
            />
            <span className="mcp-server-name">
              {server.name}
              {server.version && <span className="mcp-server-version">v{server.version}</span>}
            </span>
          </div>
          <div className="mcp-server-url">{server.url}</div>
          {server.error && <div className="mcp-server-error">{server.error}</div>}
        </div>
        <div className="mcp-server-actions">
          <span className="mcp-tools-count">
            {server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}
          </span>
          <button
            className="mcp-expand-button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? '▼' : '▶'}
          </button>
          <button
            className="mcp-remove-button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(server.id)
            }}
            title="Disconnect server"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && server.tools.length > 0 && (
        <div className="mcp-tools-list">
          {server.tools.map((tool) => (
            <ToolItem key={tool.commandId} tool={tool} />
          ))}
        </div>
      )}

      {expanded && server.tools.length === 0 && server.status === 'connected' && (
        <div className="mcp-no-tools">No tools available from this server</div>
      )}
    </div>
  )
}

/**
 * Individual tool item display
 */
function ToolItem({ tool }: { tool: MCPToolInfo }) {
  return (
    <div className="mcp-tool-item">
      <div className="mcp-tool-name">{tool.name}</div>
      {tool.description && <div className="mcp-tool-description">{tool.description}</div>}
      <div className="mcp-tool-command-id">Command ID: {tool.commandId}</div>
    </div>
  )
}

/**
 * Add server form component
 */
function AddServerForm({ onAdd }: { onAdd: (name: string, url: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return

    setIsAdding(true)
    setError(null)

    try {
      await onAdd(name.trim(), url.trim())
      setName('')
      setUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <form className="mcp-add-server-form" onSubmit={handleSubmit}>
      <div className="mcp-form-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name (e.g., cloudflare-docs)"
          disabled={isAdding}
          className="mcp-name-input"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp-server.example.com"
          disabled={isAdding}
          className="mcp-url-input"
        />
        <button
          type="submit"
          disabled={isAdding || !name.trim() || !url.trim()}
          className="mcp-add-button"
        >
          {isAdding ? 'Connecting...' : 'Add Server'}
        </button>
      </div>
      <div className="mcp-form-hint">
        Name must start with a letter, containing only letters, numbers, dashes, dots, or
        underscores
      </div>
      {error && <div className="mcp-form-error">{error}</div>}
    </form>
  )
}

/**
 * Main MCP Servers Tab component
 */
export function MCPServersTab({ onToolsChanged }: { onToolsChanged?: () => void }) {
  // Initialize with current servers
  const [servers, setServers] = useState<MCPServerConnection[]>(() => MCPServerManager.getServers())

  // Subscribe to server changes
  useEffect(() => {
    // Subscribe to updates
    const unsubscribe = MCPServerManager.subscribe((updatedServers) => {
      setServers(updatedServers)
      onToolsChanged?.()
    })

    return unsubscribe
  }, [onToolsChanged])

  const handleAddServer = async (name: string, url: string) => {
    await MCPServerManager.addServer(name, url)
  }

  const handleRemoveServer = async (serverId: string) => {
    await MCPServerManager.removeServer(serverId)
  }

  const totalTools = servers.reduce(
    (count, server) => count + (server.status === 'connected' ? server.tools.length : 0),
    0,
  )

  return (
    <div className="mcp-servers-tab">
      <div className="mcp-tab-header">
        <h2>MCP Servers</h2>
        <p className="mcp-tab-description">
          Connect to MCP servers to add their tools to the AI agent. Tools from connected servers
          will be available in the chat interface.
        </p>
      </div>

      <AddServerForm onAdd={handleAddServer} />

      <div className="mcp-servers-summary">
        <span>
          {servers.length} server{servers.length !== 1 ? 's' : ''} connected
        </span>
        <span className="mcp-summary-divider">|</span>
        <span>
          {totalTools} tool{totalTools !== 1 ? 's' : ''} available
        </span>
      </div>

      <div className="mcp-servers-list">
        {servers.length === 0 ? (
          <div className="mcp-empty-state">
            <p>No MCP servers connected</p>
            <p className="mcp-empty-hint">Add an MCP server URL above to get started</p>
          </div>
        ) : (
          servers.map((server) => (
            <ServerItem key={server.id} server={server} onRemove={handleRemoveServer} />
          ))
        )}
      </div>
    </div>
  )
}
