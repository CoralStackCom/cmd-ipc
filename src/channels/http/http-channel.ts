import type {
  CommandMessage,
  IMessageExecuteCommandRequest,
  IMessageListCommandsRequest,
  IMessageListCommandsResponse,
  IMessageRegisterCommandRequest,
} from '../../registry/command-message-schemas'
import { MessageType, validateMessage } from '../../registry/command-message-schemas'
import type {
  ChannelCloseListener,
  ChannelEventListeners,
  ChannelMessageListener,
  ICommandChannel,
} from '../command-channel-interface'
import type {
  HTTPChannelConfig,
  HTTPChannelMode,
  HTTPMiddleware,
  HTTPMiddlewareContext,
} from './http-channel-interface'

/**
 * Default timeout for HTTP requests (in milliseconds)
 */
const DEFAULT_TIMEOUT = 30000 // 30 seconds
/**
 * Message types that are allowed to be sent by the client
 * or processed by the server. Other message types are blocked
 * to prevent unauthorized command registrations or events.
 */
const ALLOWED_MESSAGE_TYPES = new Set<string>([
  MessageType.LIST_COMMANDS_REQUEST,
  MessageType.LIST_COMMANDS_RESPONSE,
  MessageType.EXECUTE_COMMAND_REQUEST,
  MessageType.EXECUTE_COMMAND_RESPONSE,
])

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
 * Middleware can be added in client mode to modify requests (e.g., add auth headers).
 * In server mode, only responses to requests with `thid` are valid.
 *
 * {@link https://coralstack.com/cmd-ipc/getting-started/channels/http-channel}
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
  private readonly _middleware: HTTPMiddleware[] = []
  private _started = false
  private _closed = false

  /**
   * Constructor for HTTPChannel
   *
   * @param config - Configuration options for the channel
   */
  public constructor(config: HTTPChannelConfig) {
    this.id = config.id
    this._baseUrl = config.baseUrl
    this._commandPrefix = config.commandPrefix
    this._timeout = config.timeout ?? DEFAULT_TIMEOUT
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

    if (this.mode === 'CLIENT') {
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

    if (this.mode === 'CLIENT') {
      // Check message type is allowed
      if (message.type && !ALLOWED_MESSAGE_TYPES.has(message.type)) {
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
   * @param message - The HTTP request body
   * @returns Promise that resolves with the response to send back
   * @throws Error if called in client mode or if channel is closed or if message is invalid
   */
  public async handleMessage(message: unknown): Promise<unknown> {
    if (this.mode === 'CLIENT') {
      throw new Error('handleMessage() can only be used in server mode')
    }

    if (this._closed) {
      throw new Error('Channel is closed')
    }

    // Validate messaage schema
    validateMessage(message)
    // Cast to CommandMessage
    const cmdMessage = message as CommandMessage

    // Check message type is allowed
    if (!ALLOWED_MESSAGE_TYPES.has(cmdMessage.type)) {
      return
    }

    return new Promise<unknown>((resolve, reject) => {
      // Add timeout for pending requests to prevent memory leaks
      const timeoutId = setTimeout(() => {
        this._pendingRequests.delete(cmdMessage.id)
        reject(new Error(`Request ${cmdMessage.id} timed out after ${this._timeout}ms`))
      }, this._timeout)

      this._pendingRequests.set(cmdMessage.id, (response) => {
        clearTimeout(timeoutId)
        resolve(response)
      })

      this._emitMessage(cmdMessage)
    })
  }

  /**
   * Add middleware to the request chain (client mode only).
   *
   * Middleware functions are executed in the order they are added.
   * Each middleware receives a context object and a `next` function.
   * Call `next()` to continue to the next middleware or the actual fetch.
   *
   * @param middleware - Middleware function to add
   * @returns this (for chaining)
   */
  public use(middleware: HTTPMiddleware): this {
    this._middleware.push(middleware)
    return this
  }

  /**
   * The current mode of the channel: 'CLIENT' or 'SERVER'.
   *
   * @type {('CLIENT' | 'SERVER')}
   */
  public get mode(): HTTPChannelMode {
    return !!this._baseUrl ? 'CLIENT' : 'SERVER'
  }

  /**
   * Send a message to all registered listeners
   *
   * @param message - The message to send
   */
  private _emitMessage(message: CommandMessage): void {
    for (const listener of this._messageListeners) {
      listener(message)
    }
  }

  /**
   * Post a command message to the remote server (client mode only).
   *
   * @param message - The command message to send
   * @returns Promise that resolves with the response message
   */
  private async _post(message: CommandMessage): Promise<CommandMessage> {
    if (this.mode === 'SERVER') {
      throw new Error('Cannot send HTTP request in server mode')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this._timeout)

    // Create middleware context
    const ctx: HTTPMiddlewareContext = {
      url: `${this._baseUrl}/cmd`,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      message,
      abortController: controller,
    }

    // Build the middleware chain
    const executeRequest = async (): Promise<CommandMessage> => {
      try {
        const response = await fetch(ctx.url, {
          method: 'POST',
          headers: ctx.headers,
          body: JSON.stringify(ctx.message),
          signal: ctx.abortController.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const msg = await response.json()
        validateMessage(msg)
        return msg
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    }

    // Execute middleware chain
    if (this._middleware.length === 0) {
      return executeRequest()
    }

    // Build the chain from right to left
    let chain = executeRequest
    for (let i = this._middleware.length - 1; i >= 0; i--) {
      const middleware = this._middleware[i]
      const next = chain
      chain = () => middleware(ctx, next)
    }

    return chain()
  }
}
