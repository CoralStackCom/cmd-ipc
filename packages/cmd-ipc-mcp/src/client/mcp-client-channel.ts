/**
 * MCPClientChannel - Connect to remote MCP servers using the official SDK
 *
 * This channel connects to a remote MCP server and exposes its tools as cmd-ipc commands.
 * It uses the official @modelcontextprotocol/sdk Client under the hood, delegating all
 * protocol handling (JSON-RPC, SSE, OAuth, session management) to the SDK.
 *
 * @packageDocumentation
 */

import {
  ExecuteCommandResponseErrorCode,
  MessageType,
  type ChannelCloseListener,
  type ChannelEventListeners,
  type ChannelMessageListener,
  type CommandMessage,
  type ICommandChannel,
  type IMessageExecuteCommandRequest,
  type IMessageRegisterCommandRequest,
} from '@coralstack/cmd-ipc'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Implementation, Tool } from '@modelcontextprotocol/sdk/types.js'

import type { MCPClientChannelConfig } from './mcp-client-types'

/**
 * Default timeout for MCP requests (in milliseconds)
 */
const DEFAULT_TIMEOUT = 30000 // 30 seconds

/**
 * Default client info
 */
const DEFAULT_CLIENT_INFO: Implementation = {
  name: 'cmd-ipc',
  version: '1.0.0',
}

/**
 * MCPClientChannel connects to remote MCP servers using the official MCP SDK.
 *
 * During `start()`:
 * 1. Creates an SDK `Client` and connects via the provided transport
 * 2. Calls `client.listTools()` to discover available tools
 * 3. Emits `register.command.request` for each tool (with optional prefix)
 *
 * When `sendMessage()` receives an EXECUTE_COMMAND_REQUEST:
 * 1. Looks up the tool in the internal map
 * 2. Calls `client.callTool()` via the SDK
 * 3. Converts the response to EXECUTE_COMMAND_RESPONSE and emits
 *
 * {@link https://coralstack.com/cmd-ipc/getting-started/channels/mcp-channel}
 */
export class MCPClientChannel implements ICommandChannel {
  /**
   * Unique identifier for this channel
   */
  public readonly id: string

  // Configuration
  private readonly _transport: Transport
  private readonly _commandPrefix?: string
  private readonly _timeout: number
  private readonly _clientInfo: Implementation

  // SDK Client
  private _client?: Client

  // Lifecycle state
  private _started = false
  private _closed = false

  // Listeners
  private readonly _messageListeners = new Set<ChannelMessageListener>()
  private readonly _closeListeners = new Set<ChannelCloseListener>()

  // Tool mapping: commandId (with prefix) -> MCP tool definition
  private readonly _toolsMap = new Map<string, Tool>()

  /**
   * Constructor for MCPClientChannel
   *
   * @param config - Configuration options for the channel
   */
  public constructor(config: MCPClientChannelConfig) {
    this.id = config.id
    this._transport = config.transport
    this._commandPrefix = config.commandPrefix
    this._timeout = config.timeout ?? DEFAULT_TIMEOUT
    this._clientInfo = config.clientInfo ?? DEFAULT_CLIENT_INFO
  }

  /**
   * Start the channel by connecting via the SDK and discovering tools.
   *
   * 1. Create SDK Client and connect via transport
   * 2. Call `client.listTools()` to get available tools
   * 3. Emit `register.command.request` for each tool
   */
  public async start(): Promise<void> {
    if (this._started || this._closed) {
      return
    }

    // Create SDK client
    this._client = new Client(this._clientInfo)

    // Connect via transport (handles initialize + initialized handshake)
    await this._client.connect(this._transport)

    // Discover tools
    const { tools } = await this._client.listTools()

    // Register each tool as a command
    for (const tool of tools) {
      const commandId = this._commandPrefix ? `${this._commandPrefix}.${tool.name}` : tool.name

      this._toolsMap.set(commandId, tool)

      this._emitMessage({
        id: crypto.randomUUID(),
        type: MessageType.REGISTER_COMMAND_REQUEST,
        command: {
          id: commandId,
          description: tool.description,
          schema: tool.inputSchema ? { request: tool.inputSchema } : undefined,
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

    if (this._client) {
      try {
        await this._client.close()
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
   * 2. Call client.callTool() via the SDK
   * 3. Convert to EXECUTE_COMMAND_RESPONSE
   * 4. Emit via message listeners
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
   * Get the underlying SDK Client for advanced usage
   */
  public get client(): Client | undefined {
    return this._client
  }

  /**
   * Get the server's info (from the SDK client after connection)
   */
  public get serverInfo(): Implementation | undefined {
    return this._client?.getServerVersion()
  }

  /**
   * Get the server's capabilities (from the SDK client after connection)
   */
  public get serverCapabilities() {
    return this._client?.getServerCapabilities()
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
   * Execute a tool call via the SDK and emit the response
   */
  private async _executeToolCall(
    execRequest: IMessageExecuteCommandRequest,
    tool: Tool,
  ): Promise<void> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this._timeout)

      let result: Record<string, unknown>
      try {
        result = (await this._client!.callTool(
          {
            name: tool.name,
            arguments: execRequest.request ?? {},
          },
          undefined,
          { signal: controller.signal },
        )) as Record<string, unknown>
      } finally {
        clearTimeout(timeoutId)
      }

      // Convert MCP result to cmd-ipc response
      const content = result.content as Array<{ type: string; text?: string }> | undefined
      let resultData: unknown = result
      if (content && content.length > 0) {
        // Try to parse first text content as JSON, otherwise return as string
        const textContent = content.find((c) => c.type === 'text')
        if (textContent && textContent.text) {
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
