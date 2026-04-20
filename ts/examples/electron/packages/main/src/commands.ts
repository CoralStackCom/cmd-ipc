import { Notification, shell } from 'electron'

import { AppCommandIDs, AppEventIDs } from '@examples/electron-core'

import { CommandsRegistryMain } from './commands/command-registry-main'
import { LogManager } from './logging/log-manager'
import { Environment } from './utils/environment'

const logger = LogManager.getMainLogger('MainCommands')

/**
 * Setup Main Event Listerners and Commands
 */
export function setupMainCommands() {
  // Register Event Handlers

  // Handle Counter Changed Event
  CommandsRegistryMain.addEventListener(AppEventIDs.COUNTER_CHANGED, (event) => {
    if (!event) {
      return
    }
    const { count } = event
    logger.info('Counter Changed', count)
  })

  // Register Main Commands

  /**
   * Show Desktop Notification
   */
  CommandsRegistryMain.registerCommand(AppCommandIDs.SHOW_NOTIFICATION, async (request) => {
    // Show Desktop Notificiation
    if (!Environment.isTest) {
      new Notification(request).show()
    }
  })

  /**
   * Open up local browser with Angelfish website
   */
  CommandsRegistryMain.registerCommand(AppCommandIDs.OPEN_WEBSITE, async (request) => {
    await shell.openExternal(request.url)
  })
}
