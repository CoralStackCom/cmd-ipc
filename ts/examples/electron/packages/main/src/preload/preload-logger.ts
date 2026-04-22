import { ipcRenderer } from 'electron'
import type { LogMessage, Transport } from 'electron-log'
import log from 'electron-log/renderer'

import { getArgumentValue } from './preload-utils'

// Initialise logId and initial log level
const logId = getArgumentValue('process')

// Override default IPC transport
const customIPC: Transport = (message: LogMessage) => {
  ipcRenderer.send('__ELECTRON_LOG__', {
    data: message.data,
    level: message.level,
    variables: message.variables,
    scope: message.scope,
    logId,
  })
}
customIPC.level = 'info'
customIPC.transforms = []
log.transports.ipc = customIPC
// Only log to console in development
log.transports.console.level = getArgumentValue('environment') === 'development' ? 'debug' : false

export default log

/**
 * Bridge to expose the `log` API to all client/renderer processes.
 */
export const logBridge = {
  error: (scope: string, ...args: any[]) => log.scope(scope).error(...args),
  warn: (scope: string, ...args: any[]) => log.scope(scope).warn(...args),
  info: (scope: string, ...args: any[]) => log.scope(scope).info(...args),
  verbose: (scope: string, ...args: any[]) => log.scope(scope).verbose(...args),
  debug: (scope: string, ...args: any[]) => log.scope(scope).debug(...args),
  silly: (scope: string, ...args: any[]) => log.scope(scope).silly(...args),
}
