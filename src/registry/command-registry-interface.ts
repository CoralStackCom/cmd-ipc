import type { StandardJsonSchema } from '@valibot/to-json-schema'
import type { InferInput, InferOutput } from 'valibot'

import type { ICommandChannel } from '../channels/command-channel-interface'
import type { CommandPayloadSchema, CommandSchemaMap, EventSchemaMap } from '../schemas'
import type { CommandRegistryEventsSchemaType } from './command-registry-events'

/**
 * Command Handler Type: Callback handler function to handle commands
 * with generic payload and response types P and R
 *
 * @param payload   Payload to send with command
 * @returns         A Promise that resolves with the response
 *                  or rejects with an error when command fails
 */
export type CommandHandler<P = any, R = any> = (payload: P) => Promise<R>

/**
 * Base Command Definition Interface with common properties
 */
export interface ICommandDefinitionBase {
  /**
   * Unique ID of the Command (e.g. register.user)
   */
  id: CommandID
  /**
   * Optional description of the command
   */
  description?: string
  /**
   * Optional JSON schema definitions for request and response to help with
   * validation and documentation
   */
  schema?: {
    /**
     * JSON schema for request payload
     */
    request?: StandardJsonSchema<unknown, unknown>
    /**
     * JSON schema for response payload
     */
    response?: StandardJsonSchema<unknown, unknown>
  }
}

/**
 * Command Interface for local Commands local to the process
 */
interface ILocalCommandDefinition extends ICommandDefinitionBase {
  /**
   * Whether the Command is local to Channel (true) or hosted remotely by another Channel (false)
   */
  isLocal: true
  /**
   * Whether the Command is private (true) and not broadcast to other Channels
   * Private commands start with an underscore `_` (e.g. _private.command)
   */
  isPrivate: boolean
  /**
   * The Command handler function to execute when Command is invoked
   */
  handler: CommandHandler
}

/**
 * Command Interface for remote Commands that need to be called via
 * a channel
 */
interface IRemoteCommandDefinition extends ICommandDefinitionBase {
  /**
   * Whether the Command is local to Channel (true) or hosted remotely by another Channel (false)
   */
  isLocal: false
  /**
   * The channel ID to call for remote commands
   */
  channelId: ChannelID
}

/**
 * Command Type: Holds metadata for a command
 */
export type ICommandDefinition = ILocalCommandDefinition | IRemoteCommandDefinition

/**
 * Unique ID for Channel
 */
export type ChannelID = string
/**
 * Unique ID for Command (i.e. register.user)
 */
export type CommandID = string
/**
 * Unique message ID
 */
export type MessageID = string
/**
 * Event ID for emitted events
 */
export type EventID = string

/**
 * Utility types and helpers for ICommandRegistry with schema support
 */

// Helper to make request optional when request is void/undefined
type RequestArg<Req> = [Req] extends [void]
  ? []
  : [Req] extends [undefined]
    ? []
    : [Req] extends [never]
      ? []
      : [payload: Req]

// Helper to make payload optional when payload is void/undefined
type EventArg<Payload> = [Payload] extends [void]
  ? []
  : [Payload] extends [undefined]
    ? []
    : [Payload] extends [never]
      ? []
      : [payload: Payload]

// Utility Type to extract string keys from a type T Internal helper - not part of public API
type StringKeyOf<T> = Extract<keyof T, string>

// Check if C is the loose/default CommandSchemaMap
// We check if the keys are literally 'string' (loose mode) vs a union of specific strings (strict mode)
type IsLooseCommandMode<C extends CommandSchemaMap> = string extends StringKeyOf<C> ? true : false

// Helper to extract request type from schema, returning void if not defined
type ExtractRequestType<C extends CommandSchemaMap, K extends string> =
  K extends StringKeyOf<C>
    ? C[K]['request'] extends CommandPayloadSchema
      ? InferInput<C[K]['request']>
      : void
    : never

// Helper to extract response type from schema, returning void if not defined
type ExtractResponseType<C extends CommandSchemaMap, K extends string> =
  K extends StringKeyOf<C>
    ? C[K]['response'] extends CommandPayloadSchema
      ? InferOutput<C[K]['response']>
      : void
    : never

// Check if E is the loose/default EventSchemaMap
// We check if the keys are literally 'string' (loose mode) vs a union of specific strings (strict mode)
type IsLooseEventMode<E extends EventSchemaMap> = string extends StringKeyOf<E> ? true : false

// Merge user-defined event schemas with system event schemas
// In strict mode, system events are always available alongside user events
type MergedEventSchemas<E extends EventSchemaMap> =
  IsLooseEventMode<E> extends true ? E : E & CommandRegistryEventsSchemaType

/**
 * Command ID type - string if loose mode, otherwise constrained to keys of C
 */
export type CommandIDType<C extends CommandSchemaMap> =
  IsLooseCommandMode<C> extends true ? string : StringKeyOf<C>

/**
 * Response type - any if loose mode, otherwise typed using InferOutput
 * Returns void if response schema is not defined
 */
export type CommandResponseType<C extends CommandSchemaMap, K extends string> =
  IsLooseCommandMode<C> extends true ? any : ExtractResponseType<C, K>

/**
 * Request args with optional handling - empty array if void/undefined/not defined, otherwise payload
 */
export type CommandRequestArgs<C extends CommandSchemaMap, K extends string> =
  IsLooseCommandMode<C> extends true ? [request?: any] : RequestArg<ExtractRequestType<C, K>>

/**
 * Handler type for registerCommand
 * - Loose mode: accepts any valid command handler
 * - Strict mode: handler is typed based on the schema for command K
 * - Returns Promise<void> if response schema is not defined
 * - Takes no args if request schema is not defined
 */
export type RegisterCommandHandler<C extends CommandSchemaMap, K extends string> =
  IsLooseCommandMode<C> extends true
    ? (request?: any) => Promise<any>
    : (...args: RequestArg<ExtractRequestType<C, K>>) => Promise<ExtractResponseType<C, K>>

/**
 * Event ID type - string if loose mode, otherwise constrained to keys of merged events
 */
export type EventIDType<E extends EventSchemaMap> =
  IsLooseEventMode<E> extends true ? string : StringKeyOf<MergedEventSchemas<E>>

/**
 * Event payload type - any if loose mode, otherwise typed using InferOutput from merged events
 */
export type EventPayloadType<E extends EventSchemaMap, K extends string> =
  IsLooseEventMode<E> extends true
    ? any
    : K extends StringKeyOf<MergedEventSchemas<E>>
      ? InferOutput<MergedEventSchemas<E>[K]>
      : never

/**
 * Event args with optional handling - empty array if void/undefined, otherwise payload
 */
export type EventPayloadArgs<E extends EventSchemaMap, K extends string> =
  IsLooseEventMode<E> extends true
    ? [payload?: any]
    : K extends StringKeyOf<MergedEventSchemas<E>>
      ? EventArg<InferOutput<MergedEventSchemas<E>[K]>>
      : never

/**
 * Event Handler Type: Callback function to handle events
 *
 * The payload parameter is:
 * - Required when P is a concrete type (object, string, number, etc.)
 * - Omitted when P is void/undefined
 */
export type EventHandler<P = any> = [P] extends [void]
  ? () => void
  : [P] extends [undefined]
    ? () => void
    : [P] extends [never]
      ? () => void
      : (payload: P) => void

/**
 * CommandRegistry Interface
 */
export interface ICommandRegistry<
  C extends CommandSchemaMap = CommandSchemaMap,
  E extends EventSchemaMap = EventSchemaMap,
> {
  /**
   * Register a new channel to the client and setup the message handler
   * to handle incoming messages from the channel.
   *
   * @param channel  The ICommandChannel to register
   */
  registerChannel(channel: ICommandChannel): void
  /**
   * Lists all the registered channels the registry is connected too
   *
   * @returns   An array of ChannelID
   */
  listChannels(): ChannelID[]
  /**
   * Register a new local command in the registry. Will broadcast the new command to
   * all connected channels so they are able to route the command to the correct process
   *
   * If am command start with underscore, it will be considered as a private command only
   * local to the process and not broadcast to other channels (i.e. _private.command)
   *
   * @param command     The unique Command to register
   * @param handler     The Command handler to execute when Command is invoked
   */
  registerCommand<K extends CommandIDType<C>>(
    command: K,
    handler: RegisterCommandHandler<C, K>,
  ): Promise<void>
  /**
   * Lists all the registered commands the registry contains with their associated
   * metadata
   *
   * @returns   An array of ICommandDefinition for all registered commands
   */
  listCommands(): readonly Omit<ICommandDefinition, 'handler'>[]
  /**
   * Execute a command with optional payload P and return a Promise of type R
   *
   * @param commandId     Command ID to invoke
   * @param request       Optional request to send with command
   * @throws              Error if command not found or fails
   */
  executeCommand<K extends CommandIDType<C>>(
    command: K,
    ...args: CommandRequestArgs<C, K>
  ): Promise<CommandResponseType<C, K>>
  /**
   * Emit an Event to all listeners. If an event starts with an underscore `_` it will only be emitted
   * locally and not broadcast to other channels.
   *
   * @param event     The Event to emit
   * @param payload   Optional payload to send with event
   */
  emitEvent<K extends EventIDType<E>>(event: K, ...args: EventPayloadArgs<E, K>): void
  /**
   * Add an Event listener for specific Command Events
   *
   * @param event       The Command Event name
   * @param callback    The function to invoke when event received
   * @returns           A function to remove the listener when no longer needed
   */
  addEventListener<K extends EventIDType<E>>(
    event: K,
    callback: EventHandler<EventPayloadType<E, K>>,
  ): () => void
  /**
   * Remove an Event listener for for specific Command Events
   *
   * @param event       The Command Event name
   * @param callback    The function to invoke when event received
   */
  removeEventListener<K extends EventIDType<E>>(
    event: K,
    callback: EventHandler<EventPayloadType<E, K>>,
  ): void
}
