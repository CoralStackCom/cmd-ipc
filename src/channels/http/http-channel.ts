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
 * HTTPChannel: Implements ICommandChannel using HTTP streaming for communication.
 *
 * All communication uses newline-delimited JSON (NDJSON) streaming format.
 *
 * Supports two modes:
 * - **Client mode** (with baseUrl): Sends HTTP POST requests to a remote server
 *   with `Accept: application/x-ndjson` header. Reads streaming NDJSON responses.
 *   `start()` fetches the remote command list and emits `register.command.request`
 *   for each command. `sendMessage()` sends POST requests and emits responses.
 *
 * - **Server mode** (without baseUrl): Receives HTTP requests from clients.
 *   `handleRequest()` returns a ReadableStream for the HTTP response body.
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
   * - Client mode: Fetches commands from remote server using streaming,
   *   applies prefix, emits register.command.request for each command
   * - Server mode: Resolves immediately
   */
  public async start(): Promise<void> {
    if (this._started || this._closed) {
      return
    }

    if (this.mode === 'CLIENT') {
      // Fetch commands from remote server using streaming
      const response = (await this._postStreaming({
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
   * - Client mode: Sends HTTP POST to /cmd with streaming, response triggers on('message').
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

      // Client mode: send POST with streaming, emit response
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

      this._postStreaming(outgoingMessage)
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
   * Returns a ReadableStream that can be used as the HTTP response body.
   * Uses newline-delimited JSON (NDJSON) format - each chunk is a JSON object
   * followed by a newline character.
   *
   * @param message - The HTTP request body (parsed JSON)
   * @returns ReadableStream to use as the HTTP response body
   * @throws Error if called in client mode or if channel is closed or if message is invalid
   *
   * @example
   * ```typescript
   * // In your HTTP handler (e.g., Cloudflare Worker)
   * const stream = channel.handleRequest(body)
   *
   * return new Response(stream, {
   *   headers: {
   *     'Content-Type': 'application/x-ndjson',
   *     'Transfer-Encoding': 'chunked'
   *   }
   * })
   * ```
   */
  public handleRequest(message: unknown): ReadableStream<Uint8Array> {
    if (this.mode === 'CLIENT') {
      throw new Error('handleRequest() can only be used in server mode')
    }

    if (this._closed) {
      throw new Error('Channel is closed')
    }

    // Validate message schema
    validateMessage(message)
    const cmdMessage = message as CommandMessage

    // Check message type is allowed
    if (!ALLOWED_MESSAGE_TYPES.has(cmdMessage.type)) {
      throw new Error(`Message type ${cmdMessage.type} is not allowed`)
    }

    // Create a ReadableStream for streaming responses
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    let isClosed = false
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        streamController = controller
      },
      cancel: () => {
        isClosed = true
      },
    })

    const writeChunk = (chunk: unknown) => {
      if (isClosed || !streamController) return
      // Write as NDJSON (newline-delimited JSON)
      const data = JSON.stringify(chunk) + '\n'
      streamController.enqueue(encoder.encode(data))
    }

    const closeStream = () => {
      if (isClosed || !streamController) return
      isClosed = true
      streamController.close()
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      this._pendingRequests.delete(cmdMessage.id)
      if (!isClosed) {
        writeChunk({
          id: crypto.randomUUID(),
          type: MessageType.EXECUTE_COMMAND_RESPONSE,
          thid: cmdMessage.id,
          response: {
            ok: false,
            error: {
              code: 'timeout',
              message: `Request ${cmdMessage.id} timed out after ${this._timeout}ms`,
            },
          },
        })
        closeStream()
      }
    }, this._timeout)

    // Register the pending request to write response and close stream
    this._pendingRequests.set(cmdMessage.id, (response) => {
      clearTimeout(timeoutId)
      writeChunk(response)
      closeStream()
    })

    // Emit the message to trigger command execution
    this._emitMessage(cmdMessage)

    return stream
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
   * Post a command message to the remote server using streaming (client mode only).
   *
   * Sends the request with `Accept: application/x-ndjson` header and reads
   * the streaming NDJSON response.
   *
   * @param message - The command message to send
   * @returns Promise that resolves with the first response message from the stream
   */
  private async _postStreaming(message: CommandMessage): Promise<CommandMessage> {
    if (this.mode === 'SERVER') {
      throw new Error('Cannot send HTTP request in server mode')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this._timeout)

    // Create middleware context
    const ctx: HTTPMiddlewareContext = {
      url: `${this._baseUrl}/cmd`,
      headers: new Headers({
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      }),
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

        // Read the NDJSON stream and return the first complete message
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('Response body is not readable')
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { value, done } = await reader.read()

          if (done) {
            // Stream ended, try to parse any remaining buffer
            if (buffer.trim()) {
              const msg = JSON.parse(buffer.trim())
              validateMessage(msg)
              return msg
            }
            throw new Error('Stream ended without a complete message')
          }

          buffer += decoder.decode(value, { stream: true })

          // Check for complete NDJSON lines
          const lines = buffer.split('\n')
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim()
            if (line) {
              // We have a complete JSON line - parse and return it
              const msg = JSON.parse(line)
              validateMessage(msg)
              // Cancel the reader since we got our response
              await reader.cancel()
              return msg
            }
          }
          // Keep the incomplete last line in the buffer
          buffer = lines[lines.length - 1]
        }
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
