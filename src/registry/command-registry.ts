import { toStandardJsonSchema } from '@valibot/to-json-schema'

import type { ICommandChannel } from '../channels/command-channel-interface'
import type { CommandSchemaMap, EventSchemaMap } from '../schemas'
import { TTLMap } from '../utils'
import type { CommandRegistryError } from './command-errors'
import {
  ChannelDisconnectedError,
  CommandNotFoundError,
  CommandRegisterErrorCode,
  DuplicateCommandRegistrationError,
  ExecuteCommandResponseErrorCode,
  InternalCommandError,
  InvalidCommandRequestError,
  TimeoutError,
} from './command-errors'
import type {
  CommandMessage,
  IMessageEvent,
  IMessageExecuteCommandRequest,
  IMessageExecuteCommandResponse,
  IMessageListCommandsRequest,
  IMessageListCommandsResponse,
  IMessageRegisterCommandRequest,
  IMessageRegisterCommandResponse,
} from './command-messages-types'
import { MessageType } from './command-messages-types'
import type {
  ICommandRegistryConfig,
  ICommandRegistrySchemas,
  LogLevel,
} from './command-registry-config-interface'
import { CommandRegistryEventIds } from './command-registry-events'
import type {
  ChannelID,
  CommandID,
  CommandIDType,
  CommandRequestArgs,
  CommandResponseType,
  EventHandler,
  EventID,
  EventIDType,
  EventPayloadArgs,
  EventPayloadType,
  ICommandDefinition,
  ICommandDefinitionBase,
  ICommandRegistry,
  MessageID,
  RegisterCommandHandler,
} from './command-registry-interface'

/**
 * A ResponseHandler is a Promise that can be resolved or rejected by the client
 * when a Command Response or Error is received and processed.
 */
type ResponseHandler = {
  // Resolve promise with value on successful response
  resolve: (value: any) => void
  // Reject promise with reason on error
  reject: (error: CommandRegistryError) => void
}

/**
 * Reply handler entry with target channel for fast-fail on disconnect
 */
type ReplyHandlerEntry = {
  handler: ResponseHandler
  targetChannel: ChannelID
}

/** Default TTL for request handlers (30 seconds) */
const DEFAULT_REQUEST_TTL = 30000

/** Default TTL for event deduplication (5 seconds) */
const DEFAULT_EVENT_TTL = 5000

/**
 * CommandRegistry: Allows a process to register commands and events
 * and handle incoming messages from other processes.
 *
 * Supports a Hybrid Tree-Mesh architecture:
 * - Root Process: No `routerChannel` configured = root with global command registry
 * - Child Processes: Have `routerChannel` pointing to parent, escalate unknown commands upward
 * - Peer Connections: Optional direct connections between children for high-throughput paths
 */
export class CommandRegistry<
  C extends CommandSchemaMap = CommandSchemaMap,
  E extends EventSchemaMap = EventSchemaMap,
> implements ICommandRegistry<C, E>
{
  // Holds the configuration for the registry
  private _config: ICommandRegistryConfig<C, E>
  // Holds the schemas for runtime validation (optional)
  private _schemas?: ICommandRegistrySchemas<C, E>
  // Holds map of all channels connected to the client
  private _channels: Map<ChannelID, ICommandChannel> = new Map()
  // Holds map of all registered commands
  private _commands = new Map<CommandID, ICommandDefinition>()
  // Holds list of unresolved Promises from executeCommand() with TTL-based timeout
  private _replyHandlers: TTLMap<MessageID, ReplyHandlerEntry>
  // Holds list of message IDs and origin channel IDs to route responses back to original channel
  private _routeHandlers: TTLMap<MessageID, ChannelID>
  // Holds set of seen event message IDs for deduplication in mesh topologies
  private _seenEventIds: TTLMap<EventID, true>
  // Holds list of event listeners with callback functions
  private _listeners = new Map<EventID, EventHandler[]>()

  /**
   * Constructor to initialise the registry with configuration
   *
   * @param config  The configuration for the registry:
   *                  - id: Optional ID to identify the channel in logs if running unit tests in single thread (default: undefined)
   *                  - logger: Optional logger to use for logging, if not provided no logs will be output (default: undefined)
   *                  - routerChannel: The channel ID to use for routing commands (default: undefined). If not set,
   *                      this registry acts as the root router.
   *                  - schemas: Optional schema maps for type-safe commands and events
   *                  - requestTTL: TTL for request handlers in ms (default: 30000)
   *                  - eventTTL: TTL for event deduplication in ms (default: 5000)
   */
  public constructor({
    id,
    logger,
    routerChannel,
    schemas,
    requestTTL = DEFAULT_REQUEST_TTL,
    eventTTL = DEFAULT_EVENT_TTL,
  }: ICommandRegistryConfig<C, E> = {}) {
    this._config = { id, logger, routerChannel, schemas, requestTTL, eventTTL }

    // Store schemas for potential runtime validation
    this._schemas = schemas

    // Initialise TTL maps for reply handlers and seen event IDs
    this._replyHandlers = new TTLMap<MessageID, ReplyHandlerEntry>(
      requestTTL,
      (messageId, entry) => {
        this._log('warn', `Request ${messageId} timed out after ${requestTTL}ms`)
        entry.handler.reject(new TimeoutError(`Request ${messageId} timed out`))
      },
    )
    this._routeHandlers = new TTLMap<MessageID, ChannelID>(requestTTL)
    this._seenEventIds = new TTLMap<EventID, true>(eventTTL)

    this._log(
      'info',
      `CommandRegistry initialised in ${this._schemas ? 'STRICT mode' : 'LOOSE mode'} ${this._config.routerChannel ? `with routerChannel "${this._config.routerChannel}"` : '(root)'}`,
    )
  }

  /**
   * Write logs for registry if a logger has been provided in the config
   * otherwise does nothing
   *
   * @param level     The log level to write
   * @param message   The message to log
   * @param args      Any additional arguments to log
   */
  private _log(level: LogLevel, message: string, ...args: any[]) {
    if (this._config.logger) {
      this._config.logger[level](
        this._config.id ? `[${this._config.id}] ${message}` : message,
        ...args,
      )
    }
  }

  /**
   * Register a new channel to the client and setup the message handler
   * to handle incoming messages from the channel.
   *
   * @param channel  The channel to register
   */
  public async registerChannel(channel: ICommandChannel): Promise<void> {
    // Add or replace the channel in the map
    this._log('info', `🎙️ Registering new Channel *${channel.id}*`)
    this._channels.set(channel.id, channel)

    // Create a bound handler to handle onmessage events
    const boundHandler = (message: CommandMessage) => this._handleMessage(channel, message)

    // Setup message handler for the channel
    channel.on('message', boundHandler)

    // Handle channel close event
    channel.on('close', () => {
      this._handleChannelClose(channel)
    })

    // Start the channel - may be async for some channels (e.g., HTTPChannel fetches commands)
    await channel.start()

    // Make request to connected process to get list of commands
    channel.sendMessage({
      id: crypto.randomUUID(),
      type: MessageType.LIST_COMMANDS_REQUEST,
    } satisfies IMessageListCommandsRequest)

    // Emit event to notify local process about new channel
    this._emitEvent(CommandRegistryEventIds._NEW_CHANNEL_REGISTERED, { id: channel.id })
  }

  /**
   * Handle channel disconnection - cleanup commands and fail pending requests
   */
  private _handleChannelClose(channel: ICommandChannel): void {
    this._log('info', `🎙️ Channel *${channel.id}* disconnected`)

    // Fail fast: reject all pending requests sent to this channel
    this._replyHandlers.forEach((entry, messageId) => {
      if (entry.targetChannel === channel.id) {
        this._log('debug', `Rejecting pending request ${messageId} due to channel disconnect`)
        entry.handler.reject(new ChannelDisconnectedError(`Channel ${channel.id} disconnected`))
        this._replyHandlers.delete(messageId)
      }
    })

    // Remove the channel from the map
    this._channels.delete(channel.id)

    // Remove any command handlers for the channel
    const removedCommands: CommandID[] = []
    this._commands.forEach((command, key) => {
      if (command.isLocal === false && command.channelId === channel.id) {
        removedCommands.push(key)
        this._commands.delete(key)
      }
    })

    if (removedCommands.length > 0) {
      this._log('info', `Removed ${removedCommands.length} commands from disconnected channel`)
    }
  }

  /**
   * Handle incoming messages from a channel
   *
   * @param channel  The channel sending the message
   * @param message   The message to handle
   */
  private _handleMessage = async (
    channel: ICommandChannel,
    message: CommandMessage,
  ): Promise<void> => {
    this._log('debug', `Received message from ${channel.id}:`, message)

    // Handle message based on type
    switch (message.type) {
      /**
       * Register Command Request
       * Forward up FIRST, add locally only on success
       */
      case MessageType.REGISTER_COMMAND_REQUEST: {
        this._log(
          'info',
          `📞 Registering remote command "${message.command.id}" for channel "${channel.id}"`,
        )

        // Check for local duplicate
        if (this._commands.has(message.command.id)) {
          const existingCommand = this._commands.get(message.command.id)
          // Allow re-registration from same channel (process restart)
          if (
            existingCommand?.isLocal ||
            (existingCommand?.isLocal === false && existingCommand.channelId !== channel.id)
          ) {
            channel.sendMessage({
              id: crypto.randomUUID(),
              type: MessageType.REGISTER_COMMAND_RESPONSE,
              thid: message.id,
              response: {
                ok: false,
                error: CommandRegisterErrorCode.DUPLICATE_COMMAND,
              },
            } as IMessageRegisterCommandResponse)
            break
          }
        }

        // If we have a router channel, propagate up FIRST and wait for confirmation
        if (this._config.routerChannel) {
          const router = this._channels.get(this._config.routerChannel)
          if (router) {
            try {
              await this._invoke(router, {
                type: MessageType.REGISTER_COMMAND_REQUEST,
                id: crypto.randomUUID(),
                command: message.command,
              } satisfies IMessageRegisterCommandRequest)

              // Success from parent - NOW add locally
              this._commands.set(message.command.id, {
                id: message.command.id,
                isLocal: false,
                channelId: channel.id,
                description: message.command.description,
                schema: message.command.schema,
              } satisfies ICommandDefinition)

              channel.sendMessage({
                type: MessageType.REGISTER_COMMAND_RESPONSE,
                id: crypto.randomUUID(),
                thid: message.id,
                response: { ok: true },
              } satisfies IMessageRegisterCommandResponse)
            } catch {
              // Failed at parent - don't add locally, propagate failure
              channel.sendMessage({
                type: MessageType.REGISTER_COMMAND_RESPONSE,
                id: crypto.randomUUID(),
                thid: message.id,
                response: {
                  ok: false,
                  error: CommandRegisterErrorCode.DUPLICATE_COMMAND,
                },
              } satisfies IMessageRegisterCommandResponse)
            }
            break
          }
        }

        // We are root - add and confirm
        this._commands.set(message.command.id, {
          id: message.command.id,
          isLocal: false,
          channelId: channel.id,
          description: message.command.description,
          schema: message.command.schema,
        } satisfies ICommandDefinition)

        channel.sendMessage({
          id: crypto.randomUUID(),
          type: MessageType.REGISTER_COMMAND_RESPONSE,
          thid: message.id,
          response: { ok: true },
        } satisfies IMessageRegisterCommandResponse)
        break
      }

      /**
       * Register Command Response
       */
      case MessageType.REGISTER_COMMAND_RESPONSE: {
        const entry = this._replyHandlers.get(message.thid)
        if (entry) {
          if (message.response.ok) {
            entry.handler.resolve(undefined)
          } else {
            entry.handler.reject(new DuplicateCommandRegistrationError())
          }
          this._replyHandlers.delete(message.thid)
        }
        break
      }

      /**
       * List Commands Request
       */
      case MessageType.LIST_COMMANDS_REQUEST: {
        // List all registered commands for this process (local only, non-private)
        const localCommands: ICommandDefinitionBase[] = Array.from(this._commands.values())
          .filter(
            (def): def is ICommandDefinition & { isLocal: true } => def.isLocal && !def.isPrivate,
          )
          .map((def) => ({
            id: def.id,
            description: def.description,
            schema: def.schema,
          }))

        this._log('debug', `Sending list of commands to channel *${channel.id}*`, localCommands)
        channel.sendMessage({
          id: crypto.randomUUID(),
          type: MessageType.LIST_COMMANDS_RESPONSE,
          thid: message.id,
          commands: localCommands,
        } satisfies IMessageListCommandsResponse)
        break
      }

      /**
       * List Commands Response
       */
      case MessageType.LIST_COMMANDS_RESPONSE: {
        // Add all remote commands to the registry
        this._log(
          'debug',
          `📞 Received list of commands from channel *${channel.id}*`,
          message.commands,
        )
        message.commands.forEach((command) => {
          this._commands.set(command.id, {
            id: command.id,
            isLocal: false,
            channelId: channel.id,
            description: command.description,
            schema: command.schema,
          } satisfies ICommandDefinition)
        })
        break
      }

      /**
       * Command Event Message - with deduplication
       */
      case MessageType.EVENT: {
        // Deduplication check using message.id
        if (this._seenEventIds.has(message.id)) {
          this._log('debug', `Dropping duplicate event ${message.id}`)
          break
        }

        // Mark as seen
        this._seenEventIds.set(message.id, true)

        // Process event locally and forward
        this._handleIncomingEvent(message, channel)
        break
      }

      /**
       * Execute Command Request
       */
      case MessageType.EXECUTE_COMMAND_REQUEST: {
        try {
          const command = this._commands.get(message.commandId)

          if (command) {
            if (command.isLocal) {
              // Execute locally
              const response = await command.handler(message.request ?? {})
              channel.sendMessage({
                id: crypto.randomUUID(),
                type: MessageType.EXECUTE_COMMAND_RESPONSE,
                thid: message.id,
                response: {
                  ok: true,
                  result: response,
                },
              } satisfies IMessageExecuteCommandResponse)
            } else {
              // Forward to known channel
              this._log('debug', `Forwarding request to remote channel *${command.channelId}*`)
              const remoteChannel = this._channels.get(command.channelId)
              if (remoteChannel) {
                this._routeHandlers.set(message.id, channel.id)
                remoteChannel.sendMessage(message)
              } else {
                // Channel disconnected, try escalating to router
                if (this._config.routerChannel) {
                  const router = this._channels.get(this._config.routerChannel)
                  if (router) {
                    this._routeHandlers.set(message.id, channel.id)
                    router.sendMessage(message)
                    break
                  }
                }
                throw new Error(`Remote channel ${command.channelId} not found`)
              }
            }
          } else {
            // Command not found locally - escalate to router if available
            if (this._config.routerChannel) {
              const router = this._channels.get(this._config.routerChannel)
              if (router) {
                this._log(
                  'debug',
                  `Escalating unknown command to router *${this._config.routerChannel}*`,
                )
                this._routeHandlers.set(message.id, channel.id)
                router.sendMessage(message)
                break
              }
            }
            // We are root and command not found
            throw new Error(`Command "${message.commandId}" not found`)
          }
        } catch (error) {
          channel.sendMessage({
            id: crypto.randomUUID(),
            type: MessageType.EXECUTE_COMMAND_RESPONSE,
            thid: message.id,
            response: {
              ok: false,
              error: {
                code: ExecuteCommandResponseErrorCode.NOT_FOUND,
                message: (error as Error).message,
              },
            },
          } satisfies IMessageExecuteCommandResponse)
        }
        break
      }

      /**
       * Execute Command Response
       */
      case MessageType.EXECUTE_COMMAND_RESPONSE: {
        const entry = this._replyHandlers.get(message.thid)
        if (entry) {
          if (message.response.ok) {
            entry.handler.resolve(message.response.result)
          } else {
            switch (message.response.error.code) {
              case ExecuteCommandResponseErrorCode.INVALID_REQUEST:
                entry.handler.reject(new InvalidCommandRequestError(message.response.error.message))
                break
              case ExecuteCommandResponseErrorCode.NOT_FOUND:
                entry.handler.reject(new CommandNotFoundError(message.response.error.message))
                break
              case ExecuteCommandResponseErrorCode.TIMEOUT:
                entry.handler.reject(new TimeoutError(message.response.error.message))
                break
              case ExecuteCommandResponseErrorCode.CHANNEL_DISCONNECTED:
                entry.handler.reject(new ChannelDisconnectedError(message.response.error.message))
                break
              case ExecuteCommandResponseErrorCode.INTERNAL_ERROR:
              default:
                entry.handler.reject(new InternalCommandError(message.response.error.message))
            }
          }
          this._replyHandlers.delete(message.thid)
        } else {
          // Check if we need to route the response back to the original process
          const originId = this._routeHandlers.get(message.thid)
          if (originId) {
            this._log('debug', `Forwarding response back to origin channel *${originId}*`)
            const originChannel = this._channels.get(originId)
            if (originChannel) {
              originChannel.sendMessage(message)
            } else {
              this._log('error', `Origin channel ${originId} not found`)
            }
            this._routeHandlers.delete(message.thid)
          } else {
            this._log('error', `No handler found for response: ${message.id}`)
          }
        }
        break
      }

      default:
        this._log('warn', `Unknown message type received from channel *${channel.id}*:`, message)
    }
  }

  /**
   * Handle incoming event - notify local listeners and forward to other channels
   */
  private _handleIncomingEvent(message: IMessageEvent, fromChannel: ICommandChannel): void {
    // Notify local listeners
    const eventListeners = this._listeners.get(message.eventId) || []
    eventListeners.forEach((callback) => {
      if (message.payload !== undefined) {
        ;(callback as (payload: any) => void)(message.payload)
      } else {
        ;(callback as () => void)()
      }
    })

    // Forward to all other channels (mesh broadcast with deduplication)
    if (!message.eventId.startsWith('_')) {
      this._channels.forEach((ch, channelId) => {
        if (channelId !== fromChannel.id) {
          ch.sendMessage(message)
        }
      })
    }
  }

  /**
   * Lists all the registered channels the registry is connected too
   *
   * @returns   An array of ChannelID
   */
  public listChannels(): ChannelID[] {
    return Array.from(this._channels.keys())
  }

  /**
   * Register a new local command in the registry.
   *
   * For non-private commands:
   * - If routerProvider is set, propagates registration up to root first
   * - Only adds locally after receiving confirmation from the tree
   * - This ensures globally unique command IDs
   *
   * Private commands (prefixed with `_`) are only registered locally.
   *
   * @param command     The unique Command to register
   * @param handler     The Command handler to execute when Command is invoked
   */
  async registerCommand<K extends CommandIDType<C>>(
    command: K,
    handler: RegisterCommandHandler<C, K>,
  ): Promise<void> {
    if (this._commands.has(command)) {
      throw new DuplicateCommandRegistrationError(
        `Command handler for "${command}" already registered`,
      )
    }

    this._log('debug', `Registering new command "${command}"`)

    // Build command definition
    let commandDef: ICommandDefinition

    if (this._schemas && this._schemas.commands && this._schemas.commands[command as keyof C]) {
      // Get the JSON schema for the command
      const commandSchema = this._schemas.commands[command as keyof C]
      const requestSchema = commandSchema.request
        ? toStandardJsonSchema(commandSchema.request)['~standard'].jsonSchema.input({
            target: 'draft-2020-12',
          })
        : undefined
      const responseSchema = commandSchema.response
        ? toStandardJsonSchema(commandSchema.response)['~standard'].jsonSchema.input({
            target: 'draft-2020-12',
          })
        : undefined

      commandDef = {
        id: command,
        isLocal: true,
        isPrivate: command.startsWith('_'),
        handler,
        schema: {
          request: requestSchema,
          response: responseSchema,
        },
        description: commandSchema.description,
      } as ICommandDefinition
    } else {
      // Log warning if schemas are provided but command not in schema map
      if (this._schemas && this._schemas.commands && !this._schemas.commands[command as keyof C]) {
        this._log('warn', `Command "${command}" not found in schema map`)
      }

      commandDef = {
        id: command,
        isLocal: true,
        isPrivate: command.startsWith('_'),
        handler,
      } as ICommandDefinition
    }

    // For non-private commands, propagate up to root FIRST
    if (!command.startsWith('_') && this._config.routerChannel) {
      const router = this._channels.get(this._config.routerChannel)
      if (router) {
        // Wait for confirmation from root before adding locally
        await this._invoke(router, {
          type: MessageType.REGISTER_COMMAND_REQUEST,
          id: crypto.randomUUID(),
          command: {
            id: commandDef.id,
            description: commandDef.description,
            schema: commandDef.schema,
          },
        } satisfies IMessageRegisterCommandRequest)
        // If invoke rejects, don't add locally - exception propagates to caller
      }
    }

    // Add locally only AFTER confirmation (or if no router/private command)
    this._commands.set(command, commandDef)
    this._log('info', `☎️ Registered new command "${command}"`)
  }

  /**
   * Lists all the registered commands the registry contains with their associated
   * metadata
   *
   * @returns   An array of ICommandDefinition for all registered commands
   */
  public listCommands(): readonly Omit<ICommandDefinition, 'handler'>[] {
    const result: Record<CommandID, ICommandDefinition> = Object.fromEntries(this._commands)
    // Return a clone of the result to prevent mutation
    const immutableClone: ReadonlyArray<Omit<ICommandDefinition, 'handler'>> = Object.freeze(
      Object.values(result).map((value) => {
        if (value.isLocal) {
          // Remove handler function reference from local commands
          const { handler: _handler, ...rest } = value
          return Object.freeze({ ...rest } as Omit<ICommandDefinition, 'handler'>)
        }
        return Object.freeze({ ...value })
      }),
    )
    return immutableClone
  }

  /**
   * Execute a command with optional payload P and return a Promise of type R
   *
   * Routing order:
   * 1. Check local commands (isLocal: true) → execute directly
   * 2. Check known remote commands (isLocal: false) → forward to providerId
   * 3. Escalate to routerProvider if set
   * 4. Throw CommandNotFoundError if at root and command not found
   *
   * @param commandId     Command ID to invoke
   * @param request       Optional payload to send with command
   * @throws              Error if command not found or fails
   */
  public async executeCommand<K extends CommandIDType<C>>(
    commandId: K,
    ...args: CommandRequestArgs<C, K>
  ): Promise<CommandResponseType<C, K>> {
    const payload = args.length > 0 ? args[0] : {}
    const command = this._commands.get(commandId)

    if (command) {
      if (command.isLocal) {
        // Execute locally
        return (await command.handler(payload as object)) as Promise<CommandResponseType<C, K>>
      }

      // Forward to known channel
      const ch = this._channels.get(command.channelId)
      if (ch) {
        return await this._invoke<CommandResponseType<C, K>>(ch, {
          type: MessageType.EXECUTE_COMMAND_REQUEST,
          id: crypto.randomUUID(),
          commandId,
          request: payload,
        } satisfies IMessageExecuteCommandRequest)
      }
      // Channel disconnected, fall through to router
    }

    // Command not found locally - escalate to router
    if (this._config.routerChannel) {
      const router = this._channels.get(this._config.routerChannel)
      if (router) {
        return await this._invoke<CommandResponseType<C, K>>(router, {
          type: MessageType.EXECUTE_COMMAND_REQUEST,
          id: crypto.randomUUID(),
          commandId,
          request: payload,
        } satisfies IMessageExecuteCommandRequest)
      }
      throw new ChannelDisconnectedError(
        `Router channel ${this._config.routerChannel} not connected`,
      )
    }

    // We are root and command not found
    throw new CommandNotFoundError(`Command "${commandId}" not found`)
  }

  /**
   * Send a request to execute to a remote process that expects a response
   * which needs to be handled by the client
   *
   * @param channel   The channel to send the request to
   * @param request   The request to send
   * @returns         A Promise that resolves with the response
   *                  or rejects with an error when command fails
   */
  private async _invoke<R>(
    channel: ICommandChannel,
    request: IMessageExecuteCommandRequest | IMessageRegisterCommandRequest,
  ): Promise<R> {
    channel.sendMessage(request)
    return new Promise<R>((resolve, reject) => {
      this._replyHandlers.set(request.id, {
        handler: { resolve, reject },
        targetChannel: channel.id,
      })
    })
  }

  /**
   * Emit an Event to all listeners. If an event starts with an underscore `_` it will only be emitted
   * locally and not broadcast to other channels.
   *
   * @param event     The Event to emit
   * @param payload   Optional payload to send with event
   */
  public emitEvent<K extends EventIDType<E>>(event: K, ...args: EventPayloadArgs<E, K>): void {
    const payload = (args as any[])[0]
    this._emitEvent(event, payload)
  }

  /**
   * Emit an Event to all listeners with deduplication support.
   *
   * @param eventId   The Event to emit
   * @param payload   Optional payload to send with event
   */
  private _emitEvent(eventId: EventID, payload?: object): void {
    const messageId = crypto.randomUUID()

    this._log('debug', `Emitting event *${eventId}*`)

    // Mark as seen (prevents echo back in mesh)
    this._seenEventIds.set(messageId, true)

    // Send event to all local listeners
    const eventListeners = this._listeners.get(eventId) || []
    eventListeners.forEach((callback) => {
      if (payload !== undefined) {
        ;(callback as (payload: any) => void)(payload)
      } else {
        ;(callback as () => void)()
      }
    })

    // Broadcast to all channels (if not private)
    if (!eventId.startsWith('_')) {
      const message: IMessageEvent = {
        type: MessageType.EVENT,
        id: messageId,
        eventId,
        payload,
      }
      this._channels.forEach((ch) => {
        ch.sendMessage(message)
      })
    }
  }

  /**
   * Add an Event listener for specific Command Events
   *
   * @param event       The Command Event name
   * @param callback    The function to invoke when event received
   * @returns           A function to remove the listener when no longer needed
   */
  public addEventListener<K extends EventIDType<E>>(
    event: K,
    callback: EventHandler<EventPayloadType<E, K>>,
  ): () => void {
    if (!this._listeners.get(event)) {
      this._listeners.set(event, [])
    }
    const eventListeners = this._listeners.get(event) || []
    eventListeners.push(callback as EventHandler)

    // Return remove function to clean up listener
    return () => {
      this.removeEventListener(event, callback)
    }
  }

  /**
   * Remove an Event listener for for specific Command Events
   *
   * @param event       The Command Event name
   * @param callback    The function to invoke when event received
   */
  public removeEventListener<K extends EventIDType<E>>(
    event: K,
    callback: EventHandler<EventPayloadType<E, K>>,
  ) {
    const callbacks = this._listeners.get(event) || []
    const updatedCallbacks = callbacks.filter((func) => func !== callback)
    this._listeners.set(event, updatedCallbacks)
  }

  /**
   * Dispose of the registry and clean up all resources.
   * Call this when the registry is no longer needed.
   */
  public dispose(): void {
    this._log('info', 'Disposing CommandRegistry')

    // Dispose all TTLMaps (stops cleanup intervals)
    this._seenEventIds.dispose()
    this._replyHandlers.dispose()
    this._routeHandlers.dispose()

    // Close all channels
    this._channels.forEach((ch) => {
      ch.close()
    })
    this._channels.clear()

    // Clear commands and listeners
    this._commands.clear()
    this._listeners.clear()
  }
}
