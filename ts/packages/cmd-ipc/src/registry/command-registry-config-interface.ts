import type { CommandSchemaMap, EventSchemaMap } from '../schemas'
import type { ChannelID } from './command-registry-interface'

/**
 * All logging implementations must adhere to this interface to send logs
 * to the appropriate logging destination.
 */
export interface ICommandRegistryLogger {
  /**
   * Log an error message
   */
  error(...params: any[]): void

  /**
   * Log a warning message
   */
  warn(...params: any[]): void

  /**
   * Log an informational message
   */
  info(...params: any[]): void

  /**
   * Log a debug message
   */
  debug(...params: any[]): void
}

/**
 * Supported Log Levels for filtering logs in the Command Registry
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

/**
 * Schema configuration for CommandRegistry
 * Pass schema maps to enable type inference and runtime validation
 */
export interface ICommandRegistrySchemas<
  C extends CommandSchemaMap = CommandSchemaMap,
  E extends EventSchemaMap = EventSchemaMap,
> {
  /**
   * Command schema map defining request/response types for each command
   */
  commands?: C
  /**
   * Event schema map defining payload types for each event
   */
  events?: E
}

/**
 * CommandRegistryConfig Interface to configure the registry when initialised
 */
export interface ICommandRegistryConfig<
  C extends CommandSchemaMap = CommandSchemaMap,
  E extends EventSchemaMap = EventSchemaMap,
> {
  /**
   * Optional ID to identify the channel in logs if running unit tests in single thread
   * @default undefined
   */
  id?: ChannelID
  /**
   * Optional logger to use for logging, if not provided no logs will be written
   * @default undefined
   */
  logger?: ICommandRegistryLogger
  /**
   * The Channel ID to use for routing commands. If set will forward any commands
   * not registered in local Registry to router channel to be forwarded on. This
   * is usually the main/parent process in multi-process architectures and should
   * be configured for each child process to enable command routing.
   * If not set, this registry acts as the root router.
   * @default undefined
   */
  routerChannel?: ChannelID
  /**
   * Optional schema maps for type-safe commands and events.
   * When provided, TypeScript will infer types from these schemas and
   * put the registry into strict mode with runtime validation.
   */
  schemas?: ICommandRegistrySchemas<C, E>
  /**
   * TTL for request handlers in milliseconds. Requests that don't receive
   * a response within this time will timeout with a TimeoutError.
   * @default 30000 (30 seconds)
   */
  requestTTL?: number
  /**
   * TTL for event deduplication in milliseconds. Event message IDs are
   * remembered for this duration to prevent duplicate processing in mesh topologies.
   * @default 5000 (5 seconds)
   */
  eventTTL?: number
}
