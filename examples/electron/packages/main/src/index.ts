import { app, Menu, net, protocol } from 'electron'
import path from 'path'
import { updateElectronApp } from 'update-electron-app'

// Set user data path as early as possible
import { Environment } from './utils/environment'
app.setPath('userData', Environment.userDataDir)

import { setupMainCommands } from './commands'
import { LogManager } from './logging/log-manager'
import { menu } from './menu'
import { createWindows } from './windows/create-windows'

const logger = LogManager.getMainLogger('main')
logger.info(`Setting user data path to ${Environment.userDataDir}`)

/**
 * Setup Autoupdater
 */

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require('electron-squirrel-startup')) {
  app.quit()
}

if (Environment.isProduction && !Environment.isLinux) {
  updateElectronApp({
    repo: 'angelfishapp/desktop-releases',
    updateInterval: '1 hour',
    logger,
  })
}

// Alert developer if overriding environment with flag
if (Environment.nodeEnvironment !== Environment.environment) {
  logger.info(`Overriding Environment to ${Environment.environment}`)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  logger.debug('Electron Ready...')

  // Override file:// protocol for serving static assets in distribution
  protocol.handle('file', (request) => {
    const url = request.url.substring(7) /* all urls start with 'file://' */
    if (url.includes('/assets/')) {
      // Only rewrite files looking for assets folder
      const assetUrl = url.split('/assets/')[1]
      const newPath = path.normalize(`${__dirname}/../renderer/assets/${assetUrl}`)
      logger.debug(`Intercepted File protocol: url=${url}, newPath=${newPath}`)
      return net.fetch(`file://${newPath}`)
    }
    return net.fetch(`file://${url}`)
  })

  // Create Windows
  createWindows()

  // Set Application Menu
  Menu.setApplicationMenu(menu)
  // Register Commands & Event Handlers
  setupMainCommands()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // Re-Create Windows for MacOS, function checks if windows already exist
  // so will only re-create any closed windows
  createWindows()
})
