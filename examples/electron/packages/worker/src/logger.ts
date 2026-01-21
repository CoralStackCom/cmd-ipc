import type { LevelOption } from 'electron-log'
import log from 'electron-log/node'
import path from 'path'

import { AppEventIDs, CommandClient, Environment } from '@examples/electron-core'

// Setup worker logger
log.transports.console.level = Environment.logLevel
log.transports.file.level = Environment.logLevel
log.transports.file.resolvePathFn = () => {
  return path.join(Environment.logsDir, `${Environment.processId}.log`)
}

/**
 * Returns a scopped logger. Scopes help identify which part of the
 * application generated the log
 */
export function getWorkerLogger(scope: string) {
  return log.scope(scope)
}

// Listen for logging level changes
CommandClient.addEventListener(
  AppEventIDs.LOGGING_LEVEL_CHANGED,
  (change: { level: LevelOption }) => {
    log.scope('Logger').info(`Log level changed to ${change.level}`)
    log.transports.console.level = change.level
    log.transports.file.level = change.level
  },
)
