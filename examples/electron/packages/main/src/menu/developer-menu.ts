import type { MenuItemConstructorOptions } from 'electron'
import type { LogLevel } from 'electron-log'

import { CommandsRegistryMain } from '../commands/command-registry-main'
import { LogManager } from '../logging/log-manager'

const logger = LogManager.getMainLogger('DeveloperMenu')

export const DeveloperMenu: MenuItemConstructorOptions = {
  label: 'Development',
  submenu: [
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    {
      label: 'Log Level',
      submenu: generateLogLevelMenu(),
    },
    { type: 'separator' },
    {
      label: 'List Main Channels',
      click: () => {
        logger.info('Listing Main Connected Channels', CommandsRegistryMain.listChannels())
      },
    },
    {
      label: 'List Main Commands',
      click: () => {
        logger.info('Listing Main Registered Commands', CommandsRegistryMain.listCommands())
      },
    },
  ],
}

/**
 * Generate a submenu to change log level of the app and any workers
 *
 * @returns MenuItemConstructorOptions[]
 */
function generateLogLevelMenu(): MenuItemConstructorOptions[] {
  const levels: LogLevel[] = ['error', 'warn', 'info', 'verbose', 'debug', 'silly']
  return levels.map((level) => ({
    label: level,
    id: `developer-log-level-${level}`,
    type: 'radio',
    checked: LogManager.getLogLevel() === level,
    click: () => {
      LogManager.setLogLevel(level)
    },
  }))
}
