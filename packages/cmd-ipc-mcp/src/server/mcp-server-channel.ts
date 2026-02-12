/**
 * MCPServerChannel - Expose cmd-ipc commands as MCP tools via the official SDK
 *
 * This channel receives MCP requests from clients and translates them to cmd-ipc
 * command executions. It uses the official @modelcontextprotocol/sdk McpServer under
 * the hood, delegating all protocol handling to the McpServer.
 *
 * @packageDocumentation
 */

import {
  MessageType,
  type ChannelCloseListener,
  type ChannelEventListeners,
  type ChannelMessageListener,
  type CommandMessage,
  type ICommandChannel,
  type IMessageExecuteCommandRequest,
  type IMessageExecuteCommandResponse,
  type IMessageListCommandsRequest,
  type IMessageListCommandsResponse,
} from '@coralstack/cmd-ipc'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Implementation,
  type ServerCapabilities,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import type { MCPServerChannelConfig } from './mcp-server-types'

/**
 * Default timeout for pending requests (in milliseconds)
 */
const DEFAULT_TIMEOUT = 30000 // 30 seconds

/**
 * Default server info
 */
const DEFAULT_SERVER_INFO: Implementation = {
  name: 'cmd-ipc',
  version: '1.0.0',
}

/**
 * MCPServerChannel exposes cmd-ipc commands as MCP tools via the official MCP SDK.
 *
 * Use `connectTransport(transport)` to connect to an MCP client via any SDK transport.
 *
 * The channel:
 * 1. Creates an SDK `McpServer` and registers handlers for `tools/list` and `tools/call`
 * 2. For `tools/list`: emits a LIST_COMMANDS_REQUEST, waits for LIST_COMMANDS_RESPONSE,
 *    and converts commands to MCP Tool format
 * 3. For `tools/call`: emits an EXECUTE_COMMAND_REQUEST, waits for EXECUTE_COMMAND_RESPONSE,
 *    and converts the result to MCP CallToolResult format
 *
 * {@link https://coralstack.com/cmd-ipc/getting-started/channels/mcp-channel}
 */
export class MCPServerChannel implements ICommandChannel {
  /**
   * Unique identifier for this channel
   */
  public readonly id: string

  // Configuration
  private readonly _serverInfo: Implementation
  private readonly _instructions?: string
  private readonly _timeout: number

  // SDK Server
  private _server: McpServer

  // Lifecycle state
  private _started = false
  private _closed = false

  // Listeners
  private readonly _messageListeners = new Set<ChannelMessageListener>()
  private readonly _closeListeners = new Set<ChannelCloseListener>()

  // Pending tool calls waiting for response
  private readonly _pendingToolCalls = new Map<
    string,
    {
      resolve: (result: CallToolResult) => void
      reject: (error: Error) => void
      timeoutId: ReturnType<typeof setTimeout>
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
    this._instructions = config.instructions
    this._timeout = config.timeout ?? DEFAULT_TIMEOUT

    // Create SDK Server with tools capability
    const capabilities: ServerCapabilities = { tools: {} }

    this._server = new McpServer(this._serverInfo, {
      capabilities,
      instructions: this._instructions,
    })

    // Register tools/list handler via low-level server (dynamic routing through cmd-ipc)
    this._server.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return this._handleToolsList()
    })

    // Register tools/call handler via low-level server (dynamic routing through cmd-ipc)
    this._server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this._handleToolsCall(request.params.name, request.params.arguments)
    })
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
   * Connect the server to an MCP transport.
   *
   * Call this to connect the SDK Server to any transport (e.g., from
   * `@modelcontextprotocol/express` or a custom transport).
   *
   * @param transport - The SDK Transport instance to connect
   */
  public async connectTransport(transport: Transport): Promise<void> {
    await this._server.connect(transport)
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
      pending.reject(new Error('Channel closed'))
      this._pendingToolCalls.delete(thid)
    }

    // Close SDK server
    try {
      await this._server.close()
    } catch {
      // Ignore errors during close
    }

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
          pending.resolve({
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result),
              },
            ],
          })
        } else {
          pending.resolve({
            content: [{ type: 'text', text: response.response.error.message }],
            isError: true,
          })
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
   * Get the underlying SDK Server for advanced usage
   */
  public get server(): McpServer {
    return this._server
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
   * Handle tools/list request by querying cmd-ipc registry
   */
  private _handleToolsList(): Promise<{ tools: Tool[] }> {
    const listRequestId = crypto.randomUUID()

    return new Promise<{ tools: Tool[] }>((resolve, reject) => {
      // Set up listener for list response
      const handleMessage = (msg: CommandMessage) => {
        if (
          msg.type === MessageType.LIST_COMMANDS_RESPONSE &&
          'thid' in msg &&
          msg.thid === listRequestId
        ) {
          const listResponse = msg as IMessageListCommandsResponse

          // Convert commands to MCP tools
          const tools: Tool[] = listResponse.commands
            .filter((cmd) => !cmd.id.startsWith('_')) // Filter private commands
            .map((cmd) => ({
              name: cmd.id,
              description: cmd.description,
              inputSchema: (cmd.schema?.request as Tool['inputSchema']) ?? {
                type: 'object' as const,
              },
            }))

          resolve({ tools })

          // Remove listener
          this._messageListeners.delete(handleMessage)
        }
      }

      this._messageListeners.add(handleMessage)

      // Set timeout
      const timeoutId = setTimeout(() => {
        this._messageListeners.delete(handleMessage)
        reject(new Error('Timeout listing tools'))
      }, this._timeout)

      // Emit list request
      this._emitMessage({
        id: listRequestId,
        type: MessageType.LIST_COMMANDS_REQUEST,
      } satisfies IMessageListCommandsRequest)

      // Clear timeout on resolve
      const origResolve = resolve
      resolve = (value) => {
        clearTimeout(timeoutId)
        origResolve(value)
      }
    })
  }

  /**
   * Handle tools/call request by executing cmd-ipc command
   */
  private _handleToolsCall(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    const thid = crypto.randomUUID()

    return new Promise<CallToolResult>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this._pendingToolCalls.delete(thid)
        reject(new Error('Tool call timeout'))
      }, this._timeout)

      // Register pending call
      this._pendingToolCalls.set(thid, {
        resolve,
        reject,
        timeoutId,
      })

      // Emit execute command request
      this._emitMessage({
        id: thid,
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        commandId: name,
        request: args ?? {},
      } satisfies IMessageExecuteCommandRequest)
    })
  }
}
