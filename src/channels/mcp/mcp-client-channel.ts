/**
 * MCPClientChannel - Connect to remote MCP servers using Streamable HTTP transport
 *
 * This channel connects to a remote MCP server and exposes its tools as cmd-ipc commands.
 * Supports the MCP Streamable HTTP protocol with JSON and SSE response formats.
 *
 * @packageDocumentation
 */

import { ExecuteCommandResponseErrorCode } from '../../registry/command-errors'
import type {
  CommandMessage,
  IMessageExecuteCommandRequest,
  IMessageRegisterCommandRequest,
} from '../../registry/command-message-schemas'
import { MessageType } from '../../registry/command-message-schemas'
import type {
  ChannelCloseListener,
  ChannelEventListeners,
  ChannelMessageListener,
  ICommandChannel,
} from '../command-channel-interface'

import { createNotification, createRequest, generateRequestId } from './mcp-json-rpc'
import { parseSSEStream, SSE_CONTENT_TYPE } from './mcp-sse'
import type {
  JSONRPCResponse,
  MCPClientCapabilities,
  MCPClientChannelConfig,
  MCPInfo,
  MCPInitializeResult,
  MCPJSONSchema,
  MCPServerCapabilities,
  MCPTool,
  MCPToolResult,
  MCPToolsListResult,
} from './mcp-types'

/**
 * Default timeout for MCP requests (in milliseconds)
 */
const DEFAULT_TIMEOUT = 30000 // 30 seconds

/**
 * Default MCP endpoint path
 */
const DEFAULT_ENDPOINT = '/mcp'

/**
 * Default protocol version
 */
const DEFAULT_PROTOCOL_VERSION = '2025-11-25'

/**
 * Default client info
 */
const DEFAULT_CLIENT_INFO: MCPInfo = {
  name: 'cmd-ipc',
  version: '1.0.0',
}

/**
 * MCPClientChannel connects to remote MCP servers using Streamable HTTP transport.
 *
 * During `start()`:
 * 1. Sends `initialize` request to establish session
 * 2. Sends `initialized` notification
 * 3. Calls `tools/list` to discover available tools
 * 4. Emits `register.command.request` for each tool (with optional prefix)
 *
 * When `sendMessage()` receives an EXECUTE_COMMAND_REQUEST:
 * 1. Strips the command prefix if configured
 * 2. Converts to MCP `tools/call` request
 * 3. Sends to server and waits for response
 * 4. Converts response to EXECUTE_COMMAND_RESPONSE and emits
 *
 * {@link https://coralstack.com/cmd-ipc/getting-started/channels/mcp-channel}
 */
export class MCPClientChannel implements ICommandChannel {
  /**
   * Unique identifier for this channel
   */
  public readonly id: string

  // Configuration
  private readonly _baseUrl: string
  private readonly _endpoint: string
  private readonly _commandPrefix?: string
  private readonly _timeout: number
  private readonly _clientInfo: MCPInfo
  private readonly _capabilities: MCPClientCapabilities
  private readonly _protocolVersion: string

  // Session state (from server)
  private _sessionId?: string
  private _negotiatedVersion?: string
  private _serverCapabilities?: MCPServerCapabilities
  private _serverInfo?: MCPInfo

  // Lifecycle state
  private _started = false
  private _closed = false

  // Listeners
  private readonly _messageListeners = new Set<ChannelMessageListener>()
  private readonly _closeListeners = new Set<ChannelCloseListener>()

  // Tool mapping: commandId (with prefix) -> MCP tool definition
  private readonly _toolsMap = new Map<string, MCPTool>()

  /**
   * Constructor for MCPClientChannel
   *
   * @param config - Configuration options for the channel
   */
  public constructor(config: MCPClientChannelConfig) {
    this.id = config.id
    this._baseUrl = config.baseUrl.replace(/\/$/, '') // Remove trailing slash
    this._endpoint = config.endpoint ?? DEFAULT_ENDPOINT
    this._commandPrefix = config.commandPrefix
    this._timeout = config.timeout ?? DEFAULT_TIMEOUT
    this._clientInfo = config.clientInfo ?? DEFAULT_CLIENT_INFO
    this._capabilities = config.capabilities ?? {}
    this._protocolVersion = config.protocolVersion ?? DEFAULT_PROTOCOL_VERSION
  }

  /**
   * Start the channel by initializing the MCP session and discovering tools.
   *
   * 1. Send `initialize` request to server
   * 2. Capture session ID from MCP-Session-Id header
   * 3. Send `initialized` notification
   * 4. Call `tools/list` to get available tools
   * 5. Emit `register.command.request` for each tool
   */
  public async start(): Promise<void> {
    if (this._started || this._closed) {
      return
    }

    // Step 1: Initialize
    const initResult = await this._sendRequest<MCPInitializeResult>('initialize', {
      protocolVersion: this._protocolVersion,
      capabilities: this._capabilities,
      clientInfo: this._clientInfo,
    })

    this._negotiatedVersion = initResult.protocolVersion
    this._serverCapabilities = initResult.capabilities
    this._serverInfo = initResult.serverInfo

    // Step 2: Send initialized notification
    await this._sendNotification('notifications/initialized')

    // Step 3: List tools
    const toolsResult = await this._sendRequest<MCPToolsListResult>('tools/list')

    // Step 4: Register each tool as a command
    for (const tool of toolsResult.tools) {
      const commandId = this._commandPrefix ? `${this._commandPrefix}.${tool.name}` : tool.name

      this._toolsMap.set(commandId, tool)

      this._emitMessage({
        id: crypto.randomUUID(),
        type: MessageType.REGISTER_COMMAND_REQUEST,
        command: {
          id: commandId,
          description: tool.description,
          schema: tool.inputSchema ? { request: tool.inputSchema as MCPJSONSchema } : undefined,
        },
      } satisfies IMessageRegisterCommandRequest)
    }

    this._started = true
  }

  /**
   * Close the channel and terminate the MCP session.
   */
  public async close(): Promise<void> {
    if (this._closed) {
      return
    }

    // Attempt to terminate session via DELETE (if session exists)
    if (this._sessionId) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout for close

        await fetch(`${this._baseUrl}${this._endpoint}`, {
          method: 'DELETE',
          headers: this._getHeaders(),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
      } catch {
        // Ignore errors during close
      }
    }

    this._closed = true
    this._toolsMap.clear()

    for (const listener of this._closeListeners) {
      listener()
    }
  }

  /**
   * Send a message to the channel.
   *
   * For EXECUTE_COMMAND_REQUEST messages:
   * 1. Look up tool in _toolsMap
   * 2. Strip commandPrefix, convert to tools/call
   * 3. POST to /mcp, parse response
   * 4. Convert to EXECUTE_COMMAND_RESPONSE
   * 5. Emit via message listeners
   */
  public sendMessage(message: CommandMessage): void {
    if (this._closed) {
      return
    }

    // Only handle execute command requests
    if (message.type !== MessageType.EXECUTE_COMMAND_REQUEST) {
      return
    }

    const execRequest = message as IMessageExecuteCommandRequest
    const commandId = execRequest.commandId

    // Check if this is a tool we know about
    const tool = this._toolsMap.get(commandId)
    if (!tool) {
      // Unknown command - emit error response
      this._emitMessage({
        id: crypto.randomUUID(),
        type: MessageType.EXECUTE_COMMAND_RESPONSE,
        thid: execRequest.id,
        response: {
          ok: false,
          error: {
            code: ExecuteCommandResponseErrorCode.NOT_FOUND,
            message: `Unknown command: ${commandId}`,
          },
        },
      })
      return
    }

    // Execute the tool call
    this._executeToolCall(execRequest, tool).catch(() => {
      // Error already handled in _executeToolCall
    })
  }

  /**
   * Register an event listener.
   */
  public on(event: 'close', listener: ChannelCloseListener): void
  public on(event: 'message', listener: ChannelMessageListener): void
  public on(event: 'close' | 'message', listener: ChannelEventListeners): void {
    if (event === 'message') {
      this._messageListeners.add(listener as ChannelMessageListener)
    } else if (event === 'close') {
      this._closeListeners.add(listener as ChannelCloseListener)
    }
  }

  /**
   * Get the server's negotiated capabilities
   */
  public get serverCapabilities(): MCPServerCapabilities | undefined {
    return this._serverCapabilities
  }

  /**
   * Get the server's info
   */
  public get serverInfo(): MCPInfo | undefined {
    return this._serverInfo
  }

  /**
   * Get the current session ID
   */
  public get sessionId(): string | undefined {
    return this._sessionId
  }

  /**
   * Get the negotiated protocol version
   */
  public get protocolVersion(): string | undefined {
    return this._negotiatedVersion
  }

  /**
   * Send a message to all registered listeners
   */
  private _emitMessage(message: CommandMessage): void {
    for (const listener of this._messageListeners) {
      listener(message)
    }
  }

  /**
   * Get standard headers for MCP requests
   */
  private _getHeaders(): Headers {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: `application/json, ${SSE_CONTENT_TYPE}`,
      'MCP-Protocol-Version': this._negotiatedVersion ?? this._protocolVersion,
    })

    if (this._sessionId) {
      headers.set('MCP-Session-Id', this._sessionId)
    }

    return headers
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  private async _sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = generateRequestId()
    const request = createRequest(id, method, params)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this._timeout)

    try {
      const response = await fetch(`${this._baseUrl}${this._endpoint}`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Capture session ID from response header
      const sessionId = response.headers.get('MCP-Session-Id')
      if (sessionId) {
        this._sessionId = sessionId
      }

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.status} ${response.statusText}`)
      }

      // Parse response based on content type
      const contentType = response.headers.get('Content-Type') || ''

      if (contentType.includes('text/event-stream')) {
        // SSE response - parse stream and get first message
        if (!response.body) {
          throw new Error('SSE response body is empty')
        }

        for await (const event of parseSSEStream(response.body)) {
          const jsonRpcResponse = JSON.parse(event.data) as JSONRPCResponse
          if (jsonRpcResponse.id === id) {
            if (jsonRpcResponse.error) {
              throw new Error(`MCP error: ${jsonRpcResponse.error.message}`)
            }
            return jsonRpcResponse.result as T
          }
        }

        throw new Error('No matching response in SSE stream')
      } else {
        // JSON response
        const jsonRpcResponse = (await response.json()) as JSONRPCResponse
        if (jsonRpcResponse.error) {
          throw new Error(`MCP error: ${jsonRpcResponse.error.message}`)
        }
        return jsonRpcResponse.result as T
      }
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private async _sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const notification = createNotification(method, params)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this._timeout)

    try {
      const response = await fetch(`${this._baseUrl}${this._endpoint}`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify(notification),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Capture session ID from response header
      const sessionId = response.headers.get('MCP-Session-Id')
      if (sessionId) {
        this._sessionId = sessionId
      }

      // Notifications should return 202 Accepted or 200 OK
      if (!response.ok) {
        throw new Error(`MCP notification failed: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Execute a tool call and emit the response
   */
  private async _executeToolCall(
    execRequest: IMessageExecuteCommandRequest,
    tool: MCPTool,
  ): Promise<void> {
    try {
      const result = await this._sendRequest<MCPToolResult>('tools/call', {
        name: tool.name,
        arguments: execRequest.request ?? {},
      })

      // Convert MCP result to cmd-ipc response
      // Extract text content if available
      let resultData: unknown = result
      if (result.content && result.content.length > 0) {
        // Try to parse first text content as JSON, otherwise return as string
        const textContent = result.content.find((c) => c.type === 'text')
        if (textContent && textContent.type === 'text') {
          try {
            resultData = JSON.parse(textContent.text)
          } catch {
            resultData = textContent.text
          }
        }
      }

      if (result.isError) {
        this._emitMessage({
          id: crypto.randomUUID(),
          type: MessageType.EXECUTE_COMMAND_RESPONSE,
          thid: execRequest.id,
          response: {
            ok: false,
            error: {
              code: ExecuteCommandResponseErrorCode.INTERNAL_ERROR,
              message: typeof resultData === 'string' ? resultData : JSON.stringify(resultData),
            },
          },
        })
      } else {
        this._emitMessage({
          id: crypto.randomUUID(),
          type: MessageType.EXECUTE_COMMAND_RESPONSE,
          thid: execRequest.id,
          response: {
            ok: true,
            result: resultData,
          },
        })
      }
    } catch (error) {
      this._emitMessage({
        id: crypto.randomUUID(),
        type: MessageType.EXECUTE_COMMAND_RESPONSE,
        thid: execRequest.id,
        response: {
          ok: false,
          error: {
            code: ExecuteCommandResponseErrorCode.INTERNAL_ERROR,
            message: error instanceof Error ? error.message : String(error),
          },
        },
      })
    }
  }
}
