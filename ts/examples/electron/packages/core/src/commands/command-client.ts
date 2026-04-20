import type { ChannelID, ICommandRegistry } from '@coralstack/cmd-ipc'
import { CommandRegistryEventIds } from '@coralstack/cmd-ipc'

import type { AppCommandSchema, AppEventSchema } from '../ipc'

/**
 * Command Client Interface
 *
 * Type-safe interface for the CommandRegistry with App-specific command and event types.
 * Extends ICommandRegistry but omits registerChannel as that's handled by the main process.
 */
export interface ICommandClient
  extends Omit<
    ICommandRegistry<typeof AppCommandSchema, typeof AppEventSchema>,
    'registerChannel'
  > {
  /**
   * Returns a promise which resolves when all listed channels are registered.
   *
   * @param channels  A list of channel IDs to wait for.
   */
  isReady(channels: ChannelID[]): Promise<void>
}

/**
 * Command client - provides type-safe access to the CommandRegistry with App commands/events.
 *
 * All methods are fully typed based on AppCommands and AppEvents definitions.
 *
 * Example usage:
 * ```typescript
 * import { AppCommandIds, AppEventIds, CommandClient } from '@examples/electron-core'
 *
 * // Execute a command with full type safety
 * // greeting is typed as string
 * const greeting = await CommandClient.executeCommand(
 *   AppCommandIds.HELLO_WORLD,
 *   { name: 'World' }
 * )
 *
 * // Emit an event with full type safety
 * CommandClient.emitEvent(AppEventIds.ON_COUNTER_CHANGED, { count: 5 })
 *
 * // Listen to an event with full type safety
 * CommandClient.addEventListener(AppEventIds.ON_COUNTER_CHANGED, (payload) => {
 *   console.log('Count:', payload.count) // payload is properly typed
 * })
 * ```
 */
export const CommandClient: ICommandClient = {
  /**
   * Register a command with the CommandRegistry.
   * Commands starting with underscores will only be available locally.
   *
   * @param command   The ID of the command to register
   * @param handler   The handler for the command
   */
  registerCommand: async (command, handler) => {
    return await window.commands.registerCommand(command, handler)
  },

  /**
   * Execute a command with full type safety.
   *
   * @param command   The command ID to execute
   * @param args      The request payload (optional if request type is void)
   * @returns         A promise that resolves with the typed response
   */
  executeCommand: async (command, ...args) => {
    return await window.commands.executeCommand(command, ...args)
  },

  /**
   * Emit an event with full type safety.
   * Events starting with underscores will only emit locally.
   *
   * @param event   The event ID to emit
   * @param args    The event payload (optional if payload type is void)
   */
  emitEvent: (event, ...args) => {
    window.commands.emitEvent(event, ...args)
  },

  /**
   * Add an event listener with full type safety.
   *
   * @param event       The event ID to listen for
   * @param callback    The event handler (payload is properly typed)
   * @returns           A function to remove the event listener
   */
  addEventListener: (event, callback) => {
    return window.commands.addEventListener(event, callback)
  },

  /**
   * Remove an event listener.
   *
   * @param event       The event ID
   * @param callback    The handler to remove
   */
  removeEventListener: (event, callback) => {
    window.commands.removeEventListener(event, callback)
  },

  /**
   * List all registered commands.
   *
   * @returns A record of all registered commands
   */
  listCommands: () => {
    return window.commands.listCommands()
  },

  /**
   * List all registered channels.
   *
   * @returns An array of channel IDs
   */
  listChannels: () => {
    return window.commands.listChannels()
  },

  /**
   * Returns a promise which resolves when all listed channels are registered.
   *
   * @param channels  A list of channel IDs to wait for
   */
  isReady: async (channels: ChannelID[]): Promise<void> => {
    // Check if all channels are already registered
    const currentChannels = window.commands.listChannels()
    if (channels.every((channel) => currentChannels.includes(channel))) {
      return
    }

    // Otherwise wait for all channels to be registered
    return new Promise((resolve) => {
      const handler = () => {
        const currentChannels = window.commands.listChannels()
        if (channels.every((channel) => currentChannels.includes(channel))) {
          window.commands.removeEventListener(
            CommandRegistryEventIds._NEW_CHANNEL_REGISTERED,
            handler,
          )
          resolve()
        }
      }
      window.commands.addEventListener(CommandRegistryEventIds._NEW_CHANNEL_REGISTERED, handler)
    })
  },
}
