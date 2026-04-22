import type { LevelOption, MainLogger } from 'electron-log'
import log from 'electron-log/main'
import path from 'path'

import { AppEventIDs, ChannelIDs } from '@examples/electron-core'

import { CommandsRegistryMain } from '../commands/command-registry-main'
import { Environment } from '../utils/environment'

/**
 * Manages the logging of the application, creating loggers for each process
 * and setting up the correct transports for each logger, as well as updating
 * log levels when user settings change
 */
class LogManagerClass {
  /**
   * Hold a list of all loggers created by the LogManager
   */
  private _loggers: Record<string, MainLogger> = {}

  /**
   * Current logging level for the app
   */
  private _logLevel: LevelOption = 'debug'

  /**
   * Default constructor
   */
  constructor() {
    // Turn off default logger to avoid double logging
    log.transports.console.level = false
    log.transports.file.level = false

    // Create and configure main logger
    const mainLogger = log.create({ logId: ChannelIDs.MAIN })
    mainLogger.transports.console.level = this._getLogLevel('console')
    this._logLevel = this._getLogLevel('file')
    mainLogger.transports.file.level = this._logLevel
    mainLogger.transports.file.resolvePathFn = () => {
      return path.join(Environment.logsDir, `${ChannelIDs.MAIN}.log`)
    }
    this._loggers[ChannelIDs.MAIN] = mainLogger
  }

  /**
   * Get a scoped instance of the Main logger
   *
   * @param scope   The scope of the logger
   * @returns       A scoped logger for Main process
   */
  public getMainLogger(scope: string) {
    return this._loggers[ChannelIDs.MAIN].scope(scope)
  }

  /**
   * Create a new logger for a process
   *
   * @param logId   The unique identifier for the logger
   */
  public createProcessLogger(logId: string) {
    const processLogger = log.create({ logId })
    // We don't need console as we are logging to console in the process window
    // during development
    processLogger.transports.console.level = false
    processLogger.transports.file.level = this._getLogLevel('file')
    processLogger.transports.file.resolvePathFn = () => {
      return path.join(Environment.logsDir, `${logId}.log`)
    }
    this._loggers[logId] = processLogger
  }

  /**
   * Set the log level for all loggers across the app
   *
   * @param level   The log level to set
   */
  public setLogLevel(level: LevelOption) {
    if (this._logLevel !== level) {
      this._logLevel = level
      // Loop through loggers and update log level
      for (const [id, logger] of Object.entries(this._loggers)) {
        if (id === ChannelIDs.MAIN) {
          logger.scope('Logger').info(`Changing Log Level to ${level}`)
          logger.transports.console.level = this._getLogLevel('console')
          logger.transports.file.level = this._getLogLevel('file')
        } else {
          logger.transports.file.level = this._getLogLevel('file')
        }
      }
    }
    // Notify processes of log level change
    CommandsRegistryMain.emitEvent(AppEventIDs.LOGGING_LEVEL_CHANGED, {
      level,
    })
  }

  /**
   * Get current log level for the app
   *
   * @returns  LogLevelOption
   */
  public getLogLevel() {
    return this._logLevel
  }

  /**
   * Helper function to determine correct log level for app.
   *
   * In test, turn off file logging or use 'CONSOLE_LOG_LEVEL'
   * environment variable to set log level
   *
   * @returns     The log level for the app
   */
  private _getLogLevel(transport: 'file' | 'console'): LevelOption {
    if (Environment.isTest) {
      if (transport === 'file') {
        return false
      }
      return (process.env.CONSOLE_LOG_LEVEL as LevelOption) || 'debug'
    }

    // For development and production, use local settings
    return this._logLevel
  }
}

// Export instance of Class
export const LogManager = new LogManagerClass()
