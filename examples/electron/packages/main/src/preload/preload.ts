/**
 * Client preload script to expose the `commands` API to all client/renderer processes.
 *
 * See the Electron documentation for details on how to use preload scripts:
 * https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { LevelOption } from 'electron-log'

import { CommandRegistry, MessagePortChannel } from '@coralstack/cmd-ipc'

import { AppCommandSchema, AppEventIDs, AppEventSchema, ChannelIDs } from '@examples/electron-core'

import { WindowEventIDs } from '../windows/window-events'
import log, { logBridge } from './preload-logger'
import { getArgumentValue } from './preload-utils'

// Initialise Command APIs
const commandRegistry = new CommandRegistry({
  logger: log.scope('Preload'),
  routerChannel: ChannelIDs.MAIN,
  schemas: { commands: AppCommandSchema, events: AppEventSchema },
})
const commandBridge = {
  listChannels: commandRegistry.listChannels.bind(commandRegistry),
  registerCommand: commandRegistry.registerCommand.bind(commandRegistry),
  listCommands: commandRegistry.listCommands.bind(commandRegistry),
  executeCommand: commandRegistry.executeCommand.bind(commandRegistry),
  emitEvent: commandRegistry.emitEvent.bind(commandRegistry),
  addEventListener: commandRegistry.addEventListener.bind(commandRegistry),
  removeEventListener: commandRegistry.removeEventListener.bind(commandRegistry),
}

// Initialise Environment Variables
const environmentBridge = {
  // The environment the app is running in
  environment: getArgumentValue('environment'),
  // The OS platform the app is running on
  platform: getArgumentValue('platform'),
  // The process ID of the current process
  processId: getArgumentValue('process'),
  // Location of the logs directory for app if process is writing logs directly
  logsDir: getArgumentValue('logsDir'),
  // Location of the user data directory for app
  userDataDir: getArgumentValue('user-data-dir'),
  // Log level for the current process
  logLevel: 'debug' as LevelOption,
}

// Expose Bridges to window object
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('commands', commandBridge)
  contextBridge.exposeInMainWorld('environment', environmentBridge)
  contextBridge.exposeInMainWorld('log', logBridge)
} else {
  // @ts-ignore - Expose commands to the global window object when not context isolated
  window.commands = commandBridge
  // @ts-ignore - Expose environment to the global window object when not context isolated
  window.environment = environmentBridge
  // @ts-ignore - Expose log to the global window object when not context isolated
  window.log = logBridge
}

// Handle new channel connections
ipcRenderer.on(WindowEventIDs.REGISTER_NEW_CHANNEL, (event, id: string) => {
  const [port] = event.ports
  const channel = new MessagePortChannel(id, port)
  commandRegistry.registerChannel(channel)
})

// Handle log level changes between refreshes
ipcRenderer.on(WindowEventIDs.SET_LOGGING_LEVEL, (_event, level: LevelOption) => {
  // As we're only logging to console in development, check if we're in development
  if (environmentBridge.platform === 'development') {
    log.transports.console.level = level
    log.scope('Preload').info(`Log level set to ${level}`)
  }
})

// Handle dynamic app log level changes
commandRegistry.addEventListener(
  AppEventIDs.LOGGING_LEVEL_CHANGED,
  (change: { level: LevelOption }) => {
    // As we're only logging to console in development, check if we're in development
    if (environmentBridge.environment === 'development') {
      log.transports.console.level = change.level
      environmentBridge.logLevel = change.level
      log.scope('Preload').info(`Log level changed to ${change.level}`)
    }
  },
)
