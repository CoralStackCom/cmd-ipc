/**
 * MCPServerChannel - Expose cmd-ipc commands as MCP tools via Streamable HTTP
 *
 * This channel receives MCP requests from clients and translates them to cmd-ipc
 * command executions. It exposes all registered commands as MCP tools.
 *
 * @packageDocumentation
 */

import type {
  CommandMessage,
  IMessageExecuteCommandRequest,
  IMessageExecuteCommandResponse,
  IMessageListCommandsRequest,
  IMessageListCommandsResponse,
} from '../../registry/command-message-schemas'
import { MessageType } from '../../registry/command-message-schemas'
import type {
  ChannelCloseListener,
  ChannelEventListeners,
  ChannelMessageListener,
  ICommandChannel,
} from '../command-channel-interface'

import {
  createError,
  createErrorResponse,
  createResponse,
  isNotification,
  isRequest,
  JSONRPC_ERRORS,
} from './mcp-json-rpc'
import { createSSEStream, prefersSSE, SSE_CONTENT_TYPE } from './mcp-sse'
import type {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  MCPHttpResponse,
  MCPInfo,
  MCPInitializeParams,
  MCPJSONSchema,
  MCPServerCapabilities,
  MCPServerChannelConfig,
  MCPSession,
  MCPTool,
  MCPToolsCallParams,
} from './mcp-types'

/**
 * Default timeout for pending requests (in milliseconds)
 */
const DEFAULT_TIMEOUT = 30000 // 30 seconds

/**
 * Default protocol version
 */
const DEFAULT_PROTOCOL_VERSION = '2025-11-25'

/**
 * Default server info
 */
const DEFAULT_SERVER_INFO: MCPInfo = {
  name: 'cmd-ipc',
  version: '1.0.0',
}

/**
 * MCPServerChannel exposes cmd-ipc commands as MCP tools via Streamable HTTP.
 *
 * Use `handleRequest()` in your HTTP handler to process incoming MCP requests.
 * The method returns an `MCPHttpResponse` that can be used to construct the HTTP response.
 *
 * Supported MCP methods:
 * - `initialize` - Establish session and exchange capabilities
 * - `initialized` - Notification that client is ready
 * - `tools/list` - List available tools (commands)
 * - `tools/call` - Execute a tool (command)
 *
 * Supported HTTP methods:
 * - `POST` - Send JSON-RPC requests/notifications
 * - `GET` - Open SSE stream for server-initiated messages (optional)
 * - `DELETE` - Terminate session
 *
 * {@link https://coralstack.com/cmd-ipc/getting-started/channels/mcp-channel}
 */
export class MCPServerChannel implements ICommandChannel {
  /**
   * Unique identifier for this channel
   */
  public readonly id: string

  // Configuration
  private readonly _serverInfo: MCPInfo
  private readonly _capabilities: MCPServerCapabilities
  private readonly _protocolVersion: string
  private readonly _enableSessions: boolean
  private readonly _instructions?: string
  private readonly _timeout: number

  // Lifecycle state
  private _started = false
  private _closed = false

  // Listeners
  private readonly _messageListeners = new Set<ChannelMessageListener>()
  private readonly _closeListeners = new Set<ChannelCloseListener>()

  // Session management
  private readonly _sessions = new Map<string, MCPSession>()

  // Pending tool calls waiting for response
  private readonly _pendingToolCalls = new Map<
    string,
    {
      resolve: (response: JSONRPCResponse) => void
      timeoutId: ReturnType<typeof setTimeout>
      requestId: string | number
    }
  >()

  /**
   * Constructor for MCPServerChannel
   *
   * @param config - Configuration options for the channel
   */
  public constructor(config: MCPServerChannelConfig) {
    this.id = config.id
    this._serverInfo = config.serverInfo ?? DEFAULT_SERVER_INFO
    this._capabilities = config.capabilities ?? { tools: {} }
    this._protocolVersion = config.protocolVersion ?? DEFAULT_PROTOCOL_VERSION
    this._enableSessions = config.enableSessions ?? true
    this._instructions = config.instructions
    this._timeout = config.timeout ?? DEFAULT_TIMEOUT
  }

  /**
   * Start the channel. For server mode, this marks the channel as ready.
   */
  public async start(): Promise<void> {
    if (this._started || this._closed) {
      return
    }
    this._started = true
  }

  /**
   * Close the channel and cleanup resources.
   */
  public async close(): Promise<void> {
    if (this._closed) {
      return
    }

    this._closed = true

    // Reject all pending tool calls
    for (const [thid, pending] of this._pendingToolCalls) {
      clearTimeout(pending.timeoutId)
      pending.resolve(
        createErrorResponse(
          pending.requestId,
          createError(JSONRPC_ERRORS.INTERNAL_ERROR, 'Channel closed'),
        ),
      )
      this._pendingToolCalls.delete(thid)
    }

    // Clear sessions
    this._sessions.clear()

    // Notify close listeners
    for (const listener of this._closeListeners) {
      listener()
    }
  }

  /**
   * Send a message to the channel.
   *
   * For EXECUTE_COMMAND_RESPONSE messages, resolves the pending tool call.
   * For LIST_COMMANDS_RESPONSE messages, used internally for tools/list.
   */
  public sendMessage(message: CommandMessage): void {
    if (this._closed) {
      return
    }

    // Handle execute command responses
    if (message.type === MessageType.EXECUTE_COMMAND_RESPONSE) {
      const response = message as IMessageExecuteCommandResponse
      const pending = this._pendingToolCalls.get(response.thid)

      if (pending) {
        clearTimeout(pending.timeoutId)
        this._pendingToolCalls.delete(response.thid)

        if (response.response.ok) {
          // Convert cmd-ipc result to MCP tool result
          const result = response.response.result
          pending.resolve(
            createResponse(pending.requestId, {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result),
                },
              ],
            }),
          )
        } else {
          pending.resolve(
            createResponse(pending.requestId, {
              content: [{ type: 'text', text: response.response.error.message }],
              isError: true,
            }),
          )
        }
      }
    }

    // Handle list commands responses - emit to internal listeners so tools/list can receive
    if (message.type === MessageType.LIST_COMMANDS_RESPONSE) {
      this._emitMessage(message)
    }
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
   * Handle an incoming HTTP request.
   *
   * @param method - HTTP method (GET, POST, DELETE)
   * @param body - Parsed request body (for POST)
   * @param headers - Request headers
   * @returns MCPHttpResponse or Promise<MCPHttpResponse> depending on operation
   */
  public handleRequest(
    method: 'GET' | 'POST' | 'DELETE',
    body: unknown,
    headers: Headers,
  ): MCPHttpResponse | Promise<MCPHttpResponse> {
    if (this._closed) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Channel is closed' }),
      }
    }

    switch (method) {
      case 'POST':
        return this._handlePost(body as JSONRPCMessage, headers)
      case 'GET':
        return this._handleGet(headers)
      case 'DELETE':
        return this._handleDelete(headers)
      default:
        return {
          status: 405,
          headers: { 'Content-Type': 'application/json', Allow: 'GET, POST, DELETE' },
          body: JSON.stringify({ error: 'Method not allowed' }),
        }
    }
  }

  /**
   * Get the number of active sessions
   */
  public get activeSessions(): number {
    return this._sessions.size
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
   * Handle POST request (JSON-RPC messages)
   */
  private _handlePost(
    message: JSONRPCMessage,
    headers: Headers,
  ): MCPHttpResponse | Promise<MCPHttpResponse> {
    const sessionId = headers.get('MCP-Session-Id')
    const acceptHeader = headers.get('Accept')
    const useSSE = prefersSSE(acceptHeader)

    // Validate message type
    if (isRequest(message)) {
      return this._handleRequest(message, sessionId, useSSE)
    } else if (isNotification(message)) {
      return this._handleNotification(message, sessionId)
    }
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        createErrorResponse(
          0,
          createError(JSONRPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC message'),
        ),
      ),
    }
  }

  /**
   * Handle JSON-RPC request
   */
  private _handleRequest(
    request: JSONRPCRequest,
    sessionId: string | null,
    useSSE: boolean,
  ): MCPHttpResponse | Promise<MCPHttpResponse> {
    const { id, method, params } = request

    // Route based on method
    switch (method) {
      case 'initialize':
        return this._handleInitialize(id, params as unknown as MCPInitializeParams | undefined)

      case 'tools/list':
        return this._handleToolsList(id, sessionId, useSSE)

      case 'tools/call':
        return this._handleToolsCall(
          id,
          params as unknown as MCPToolsCallParams | undefined,
          sessionId,
          useSSE,
        )

      default:
        return this._createJsonResponse(
          createErrorResponse(
            id,
            createError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`),
          ),
        )
    }
  }

  /**
   * Handle JSON-RPC notification
   */
  private _handleNotification(
    notification: { method: string; params?: Record<string, unknown> },
    sessionId: string | null,
  ): MCPHttpResponse {
    const { method } = notification

    switch (method) {
      case 'notifications/initialized':
        // Mark session as initialized
        if (sessionId && this._sessions.has(sessionId)) {
          const session = this._sessions.get(sessionId)!
          session.initialized = true
        }
        return { status: 202, headers: {} }

      case 'notifications/cancelled':
        // Handle cancellation if needed
        return { status: 202, headers: {} }

      default:
        // Unknown notifications are accepted but ignored
        return { status: 202, headers: {} }
    }
  }

  /**
   * Handle GET request (SSE stream)
   */
  private _handleGet(headers: Headers): MCPHttpResponse {
    const sessionId = headers.get('MCP-Session-Id')

    if (this._enableSessions && !sessionId) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Session ID required' }),
      }
    }

    if (sessionId && !this._sessions.has(sessionId)) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Session not found' }),
      }
    }

    // Create SSE stream for server-to-client messages
    const { stream } = createSSEStream()

    return {
      status: 200,
      headers: {
        'Content-Type': SSE_CONTENT_TYPE,
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: stream,
    }
  }

  /**
   * Handle DELETE request (session termination)
   */
  private _handleDelete(headers: Headers): MCPHttpResponse {
    if (!this._enableSessions) {
      return {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Sessions not enabled' }),
      }
    }

    const sessionId = headers.get('MCP-Session-Id')
    if (!sessionId) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Session ID required' }),
      }
    }

    if (!this._sessions.has(sessionId)) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Session not found' }),
      }
    }

    this._sessions.delete(sessionId)
    return { status: 200, headers: {} }
  }

  /**
   * Handle initialize request
   */
  private _handleInitialize(
    id: string | number,
    params: MCPInitializeParams | undefined,
  ): MCPHttpResponse {
    // Create session if sessions are enabled
    let sessionId: string | undefined
    if (this._enableSessions) {
      sessionId = crypto.randomUUID()
      this._sessions.set(sessionId, {
        id: sessionId,
        initialized: false,
        clientInfo: params?.clientInfo,
        clientCapabilities: params?.capabilities,
        createdAt: Date.now(),
      })
    }

    const result = {
      protocolVersion: this._protocolVersion,
      capabilities: this._capabilities,
      serverInfo: this._serverInfo,
      ...(this._instructions && { instructions: this._instructions }),
    }

    const response = createResponse(id, result)
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (sessionId) {
      responseHeaders['MCP-Session-Id'] = sessionId
    }

    return {
      status: 200,
      headers: responseHeaders,
      body: JSON.stringify(response),
    }
  }

  /**
   * Handle tools/list request
   */
  private _handleToolsList(
    id: string | number,
    _sessionId: string | null,
    useSSE: boolean,
  ): Promise<MCPHttpResponse> {
    // Request command list from registry via message
    const listRequestId = crypto.randomUUID()

    return new Promise<MCPHttpResponse>((resolve) => {
      // Set up listener for list response
      const handleMessage = (msg: CommandMessage) => {
        if (
          msg.type === MessageType.LIST_COMMANDS_RESPONSE &&
          'thid' in msg &&
          msg.thid === listRequestId
        ) {
          const listResponse = msg as IMessageListCommandsResponse

          // Convert commands to MCP tools
          const tools: MCPTool[] = listResponse.commands
            .filter((cmd) => !cmd.id.startsWith('_')) // Filter private commands
            .map((cmd) => ({
              name: cmd.id,
              description: cmd.description,
              inputSchema: cmd.schema?.request as MCPJSONSchema | undefined,
            }))

          const response = createResponse(id, { tools })

          if (useSSE) {
            const { stream, writer } = createSSEStream()
            writer.writeMessage(response)
            writer.close()
            resolve({
              status: 200,
              headers: { 'Content-Type': SSE_CONTENT_TYPE },
              body: stream,
            })
          } else {
            resolve(this._createJsonResponse(response))
          }

          // Remove listener
          this._messageListeners.delete(handleMessage)
        }
      }

      this._messageListeners.add(handleMessage)

      // Set timeout
      setTimeout(() => {
        this._messageListeners.delete(handleMessage)
        resolve(
          this._createJsonResponse(
            createErrorResponse(id, createError(JSONRPC_ERRORS.INTERNAL_ERROR, 'Timeout')),
          ),
        )
      }, this._timeout)

      // Emit list request
      this._emitMessage({
        id: listRequestId,
        type: MessageType.LIST_COMMANDS_REQUEST,
      } satisfies IMessageListCommandsRequest)
    })
  }

  /**
   * Handle tools/call request
   */
  private _handleToolsCall(
    id: string | number,
    params: MCPToolsCallParams | undefined,
    _sessionId: string | null,
    useSSE: boolean,
  ): MCPHttpResponse | Promise<MCPHttpResponse> {
    if (!params?.name) {
      return this._createJsonResponse(
        createErrorResponse(
          id,
          createError(JSONRPC_ERRORS.INVALID_PARAMS, 'Tool name is required'),
        ),
      )
    }

    const thid = crypto.randomUUID()

    return new Promise<MCPHttpResponse>((resolve) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this._pendingToolCalls.delete(thid)
        resolve(
          this._createJsonResponse(
            createErrorResponse(
              id,
              createError(JSONRPC_ERRORS.INTERNAL_ERROR, 'Tool call timeout'),
            ),
          ),
        )
      }, this._timeout)

      // Register pending call
      this._pendingToolCalls.set(thid, {
        resolve: (response) => {
          if (useSSE) {
            const { stream, writer } = createSSEStream()
            writer.writeMessage(response)
            writer.close()
            resolve({
              status: 200,
              headers: { 'Content-Type': SSE_CONTENT_TYPE },
              body: stream,
            })
          } else {
            resolve(this._createJsonResponse(response))
          }
        },
        timeoutId,
        requestId: id,
      })

      // Emit execute command request
      this._emitMessage({
        id: thid,
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        commandId: params.name,
        request: params.arguments ?? {},
      } satisfies IMessageExecuteCommandRequest)
    })
  }

  /**
   * Create a JSON response
   */
  private _createJsonResponse(response: JSONRPCResponse): MCPHttpResponse {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    }
  }
}
