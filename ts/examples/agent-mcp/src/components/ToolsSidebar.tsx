/**
 * Tools Sidebar Component
 *
 * Displays all available tools grouped by channel (local vs MCP servers).
 * Shows tool names, descriptions, and request/response schemas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { IListCommandDefinition } from '@coralstack/cmd-ipc'

import { CommandRegistry } from '../commands/command-registry'

/**
 * Extended tool info with channel grouping
 */
interface ToolWithChannel {
  id: string
  name: string
  description?: string
  channelId: string
  channelName: string
  isLocal: boolean
  schema?: {
    request?: unknown
    response?: unknown
  }
}

/**
 * Group tools by channel
 */
interface ChannelGroup {
  channelId: string
  channelName: string
  isLocal: boolean
  tools: ToolWithChannel[]
}

/**
 * Individual tool item with expandable schema details
 */
function ToolItem({ tool }: { tool: ToolWithChannel }) {
  const [expanded, setExpanded] = useState(false)

  const hasSchema = Boolean(tool.schema?.request || tool.schema?.response)
  const hasRequestSchema = Boolean(tool.schema?.request)
  const hasResponseSchema = Boolean(tool.schema?.response)

  return (
    <div className="sidebar-tool-item">
      <div
        className={`sidebar-tool-header ${hasSchema ? 'clickable' : ''}`}
        onClick={() => hasSchema && setExpanded(!expanded)}
      >
        <div className="sidebar-tool-info">
          <div className="sidebar-tool-name">{tool.name}</div>
          {tool.description && <div className="sidebar-tool-description">{tool.description}</div>}
        </div>
        {hasSchema && <span className="sidebar-tool-expand">{expanded ? '▼' : '▶'}</span>}
      </div>

      {expanded && hasSchema && (
        <div className="sidebar-tool-schemas">
          {hasRequestSchema && (
            <div className="sidebar-schema-section">
              <div className="sidebar-schema-label">Request</div>
              <pre className="sidebar-schema-content">
                {JSON.stringify(tool.schema?.request as object, null, 2)}
              </pre>
            </div>
          )}
          {hasResponseSchema && (
            <div className="sidebar-schema-section">
              <div className="sidebar-schema-label">Response</div>
              <pre className="sidebar-schema-content">
                {JSON.stringify(tool.schema?.response as object, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Channel group with collapsible tool list
 */
function ChannelGroupComponent({ group }: { group: ChannelGroup }) {
  // All tool groups collapsed by default
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="sidebar-channel-group">
      <div className="sidebar-channel-header" onClick={() => setExpanded(!expanded)}>
        <span className="sidebar-channel-expand">{expanded ? '▼' : '▶'}</span>
        <span className="sidebar-channel-name">{group.channelName}</span>
        <span className="sidebar-channel-count">{group.tools.length}</span>
      </div>

      {expanded && (
        <div className="sidebar-channel-tools">
          {group.tools.map((tool) => (
            <ToolItem key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}

// Sidebar width constraints
const MIN_WIDTH = 280
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 320

/**
 * Main Tools Sidebar component
 */
export function ToolsSidebar({ toolsVersion }: { toolsVersion: number }) {
  // Sidebar width state for resizing
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Handle mouse move during resize
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return

      // Calculate new width based on mouse position from right edge
      const newWidth = window.innerWidth - e.clientX
      // Clamp to min/max bounds
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)))
    },
    [isResizing],
  )

  // Handle mouse up to stop resizing
  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  // Add/remove event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      // Prevent text selection while resizing
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  // Start resizing on mouse down
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  // Get all commands and group by channel
  const channelGroups = useMemo(() => {
    const commands = CommandRegistry.listCommands()

    // Group commands by channel
    const groupMap = new Map<string, ChannelGroup>()

    for (const cmd of commands) {
      const command = cmd as IListCommandDefinition & {
        isLocal?: boolean
        channelId?: string
        isPrivate?: boolean
      }

      // Skip private commands
      if (command.isPrivate) continue

      let channelId: string
      let channelName: string
      let isLocal: boolean

      if (command.isLocal) {
        channelId = 'local'
        channelName = 'Local Tools'
        isLocal = true
      } else {
        channelId = command.channelId || 'unknown'
        // Channel ID is now the domain with dashes (e.g., "docs-mcp-cloudflare-com")
        // Display it as-is since it's already readable
        channelName = channelId
        isLocal = false
      }

      if (!groupMap.has(channelId)) {
        groupMap.set(channelId, {
          channelId,
          channelName,
          isLocal,
          tools: [],
        })
      }

      // Extract tool name (remove channel prefix for MCP tools)
      let toolName = command.id
      if (!isLocal && channelId !== 'unknown' && command.id.startsWith(`${channelId}.`)) {
        toolName = command.id.slice(channelId.length + 1)
      }

      groupMap.get(channelId)!.tools.push({
        id: command.id,
        name: toolName,
        description: command.description,
        channelId,
        channelName,
        isLocal,
        schema: command.schema,
      })
    }

    // Sort: local first, then alphabetically by channel name
    const groups = Array.from(groupMap.values())
    groups.sort((a, b) => {
      if (a.isLocal && !b.isLocal) return -1
      if (!a.isLocal && b.isLocal) return 1
      return a.channelName.localeCompare(b.channelName)
    })

    // Sort tools within each group alphabetically
    for (const group of groups) {
      group.tools.sort((a, b) => a.name.localeCompare(b.name))
    }

    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsVersion])

  const totalTools = channelGroups.reduce((sum, group) => sum + group.tools.length, 0)

  return (
    <div
      ref={sidebarRef}
      className={`tools-sidebar ${isResizing ? 'resizing' : ''}`}
      style={{ width: `${width}px`, minWidth: `${width}px` }}
    >
      {/* Resize handle */}
      <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />

      <div className="sidebar-header">
        <h3>Available Tools</h3>
        <span className="sidebar-tool-count">{totalTools}</span>
      </div>

      <div className="sidebar-content">
        {channelGroups.length === 0 ? (
          <div className="sidebar-empty">
            <p>No tools available</p>
            <p className="sidebar-empty-hint">Add an MCP server to get started</p>
          </div>
        ) : (
          channelGroups.map((group) => (
            <ChannelGroupComponent key={group.channelId} group={group} />
          ))
        )}
      </div>
    </div>
  )
}
