import type {
  CommandMessage,
  IMessageExecuteCommandRequest,
  IMessageListCommandsRequest,
  IMessageListCommandsResponse,
  IMessageRegisterCommandRequest,
} from '../../registry/command-messages-types'
import { MessageType } from '../../registry/command-messages-types'
import type {
  ChannelCloseListener,
  ChannelEventListeners,
  ChannelMessageListener,
  ICommandChannel,
} from '../command-channel-interface'

/**
 * Configuration options for HTTPChannel
 */
export interface HTTPChannelConfig {
  /**
   * Unique identifier for this channel
   */
  id: string

  /**
   * Base URL for client mode (e.g., 'https://api.example.com')
   * If not provided, channel operates in server mode
   */
  baseUrl?: string

  /**
   * Prefix to add to remote command IDs when registering
   * e.g., prefix: 'cloud' registers 'user.create' as 'cloud.user.create'
   */
  commandPrefix?: string

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number
}

/**
 * HTTPChannel: Implements ICommandChannel using HTTP for communication.
 *
 * Supports two modes:
 * - **Client mode** (with baseUrl): Sends HTTP POST requests to a remote server.
 *   `start()` fetches the remote command list and emits `register.command.request`
 *   for each command. `sendMessage()` sends POST requests and emits responses.
 *
 * - **Server mode** (without baseUrl): Receives HTTP requests from clients.
 *   `handleMessage()` triggers on('message') and waits for sendMessage() to resolve.
 *   Used with any HTTP framework (Express, Cloudflare Workers, etc.)
 *
 * @example
 * // Client mode - Connect to a remote server
 * import { CommandRegistry, HTTPChannel } from 'cmd-ipc'
 *
 * const registry = new CommandRegistry()
 * const channel = new HTTPChannel({
 *   id: 'cloud-api',
 *   baseUrl: 'https://api.example.com',
 *   commandPrefix: 'cloud',  // Remote 'user.create' becomes 'cloud.user.create'
 *   timeout: 30000,
 * })
 *
 * await registry.registerChannel(channel)
 *
 * // Execute remote commands (automatically prefixed)
 * const user = await registry.execute('cloud.user.create', { name: 'John' })
 *
 * @example
 * // Server mode - Express.js
 * import express from 'express'
 * import { CommandRegistry, HTTPChannel } from 'cmd-ipc'
 *
 * const app = express()
 * const registry = new CommandRegistry()
 * const channel = new HTTPChannel({ id: 'http-server' })
 *
 * registry.register({ id: 'user.create', handler: (args) => ({ id: 1, ...args }) })
 * await registry.registerChannel(channel)
 *
 * app.post('/cmd', express.json(), async (req, res) => {
 *   const response = await channel.handleMessage(req.body)
 *   res.json(response)
 * })
 *
 * app.listen(3000)
 *
 * @example
 * // Server mode - Cloudflare Workers
 * import { CommandRegistry, HTTPChannel } from 'cmd-ipc'
 *
 * const registry = new CommandRegistry()
 * const channel = new HTTPChannel({ id: 'cf-worker' })
 *
 * registry.register({ id: 'hello', handler: (args) => `Hello, ${args.name}!` })
 * await registry.registerChannel(channel)
 *
 * export default {
 *   async fetch(request: Request): Promise<Response> {
 *     if (request.method === 'POST' && new URL(request.url).pathname === '/cmd') {
 *       const body = await request.json()
 *       const response = await channel.handleMessage(body)
 *       return new Response(JSON.stringify(response), {
 *         headers: { 'Content-Type': 'application/json' },
 *       })
 *     }
 *     return new Response('Not Found', { status: 404 })
 *   },
 * }
 *
 * @example
 * // Server mode - Node.js HTTP
 * import { createServer } from 'node:http'
 * import { CommandRegistry, HTTPChannel } from 'cmd-ipc'
 *
 * const registry = new CommandRegistry()
 * const channel = new HTTPChannel({ id: 'node-server' })
 *
 * registry.register({ id: 'ping', handler: () => 'pong' })
 * await registry.registerChannel(channel)
 *
 * createServer(async (req, res) => {
 *   if (req.method === 'POST' && req.url === '/cmd') {
 *     const chunks: Buffer[] = []
 *     for await (const chunk of req) chunks.push(chunk)
 *     const body = JSON.parse(Buffer.concat(chunks).toString())
 *
 *     const response = await channel.handleMessage(body)
 *
 *     res.writeHead(200, { 'Content-Type': 'application/json' })
 *     res.end(JSON.stringify(response))
 *   } else {
 *     res.writeHead(404).end()
 *   }
 * }).listen(3000)
 */
export class HTTPChannel implements ICommandChannel {
  /**
   * Unique identifier for this channel
   */
  public readonly id: string

  private readonly _baseUrl?: string
  private readonly _commandPrefix?: string
  private readonly _timeout: number
  private readonly _messageListeners = new Set<ChannelMessageListener>()
  private readonly _closeListeners = new Set<ChannelCloseListener>()
  private readonly _pendingRequests = new Map<string, (response: unknown) => void>()
  private _started = false
  private _closed = false

  constructor(config: HTTPChannelConfig) {
    this.id = config.id
    this._baseUrl = config.baseUrl
    this._commandPrefix = config.commandPrefix
    this._timeout = config.timeout ?? 30000
  }

  private _isClientMode(): boolean {
    return !!this._baseUrl
  }

  private _emitMessage(message: unknown): void {
    for (const listener of this._messageListeners) {
      listener(message)
    }
  }

  private async _post(body: unknown): Promise<unknown> {
    if (!this._baseUrl) {
      throw new Error('Cannot send HTTP request in server mode')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this._timeout)

    try {
      const response = await fetch(`${this._baseUrl}/cmd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Start the channel.
   *
   * - Client mode: Fetches commands from remote server, applies prefix,
   *   emits register.command.request for each command
   * - Server mode: Resolves immediately
   */
  public async start(): Promise<void> {
    if (this._started || this._closed) {
      return
    }

    if (this._isClientMode()) {
      // Fetch commands from remote server
      const response = (await this._post({
        id: crypto.randomUUID(),
        type: MessageType.LIST_COMMANDS_REQUEST,
      } satisfies IMessageListCommandsRequest)) as IMessageListCommandsResponse

      // Emit register.command.request for each command
      if (response.commands) {
        for (const cmd of response.commands) {
          // Apply prefix to command ID if configured
          const commandId = this._commandPrefix ? `${this._commandPrefix}.${cmd.id}` : cmd.id

          this._emitMessage({
            id: crypto.randomUUID(),
            type: MessageType.REGISTER_COMMAND_REQUEST,
            command: {
              id: commandId,
              description: cmd.description,
              schema: cmd.schema,
            },
          } as IMessageRegisterCommandRequest)
        }
      }
    }

    this._started = true
  }

  /**
   * Close the channel.
   */
  public async close(): Promise<void> {
    if (this._closed) {
      return
    }

    this._closed = true
    this._pendingRequests.clear()

    for (const listener of this._closeListeners) {
      listener()
    }
  }

  /**
   * Send a message to the channel.
   *
   * - Client mode: Sends HTTP POST to /cmd, response triggers on('message').
   *   If commandPrefix is configured, strips prefix from commandId before sending.
   * - Server mode: Resolves pending HTTP request with this message
   */
  public sendMessage(message: CommandMessage): void {
    if (this._closed) {
      return
    }

    if (this._isClientMode()) {
      // Do not send register command requests or events from client
      if (
        message.type === MessageType.REGISTER_COMMAND_REQUEST ||
        message.type === MessageType.REGISTER_COMMAND_RESPONSE ||
        message.type === MessageType.EVENT
      ) {
        return
      }

      // Client mode: send POST, emit response
      let outgoingMessage = message

      // Strip prefix from commandId before sending to remote server
      if (this._commandPrefix && message.type === MessageType.EXECUTE_COMMAND_REQUEST) {
        if (message.commandId?.startsWith(`${this._commandPrefix}.`)) {
          outgoingMessage = {
            ...message,
            commandId: message.commandId.slice(this._commandPrefix.length + 1),
          } as IMessageExecuteCommandRequest
        }
      }

      this._post(outgoingMessage)
        .then((response) => this._emitMessage(response))
        .catch(() => {
          // Silently ignore errors - registry will handle via timeout
        })
    } else if ('thid' in message && message.thid) {
      // Server mode: resolve pending request
      const resolver = this._pendingRequests.get(message.thid)
      if (resolver) {
        this._pendingRequests.delete(message.thid)
        resolver(message)
      }
    } else {
      // In server mode, only responses to requests with thid are valid
      return
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
   * Server mode only: Handle an incoming HTTP request.
   *
   * Triggers on('message') with the request body, waits for sendMessage() to be
   * called with the response, then returns that response.
   *
   * @param body - The HTTP request body
   * @returns Promise that resolves with the response to send back
   */
  public async handleMessage(body: unknown): Promise<unknown> {
    if (this._isClientMode()) {
      throw new Error('handleMessage() can only be used in server mode')
    }

    if (this._closed) {
      throw new Error('Channel is closed')
    }

    const request = body as { id?: string }
    const requestId = request.id ?? crypto.randomUUID()

    return new Promise<unknown>((resolve) => {
      this._pendingRequests.set(requestId, resolve)
      this._emitMessage(body)
    })
  }
}
