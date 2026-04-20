import { registerCommands } from '@coralstack/cmd-ipc'
import { CommandClient, Logger } from '@examples/electron-core'

import { LocalService } from './services/local-service'
import { SandboxedService } from './services/sandboxed-service'

const logger = Logger.scope('SyncProcess')

window.onload = async () => {
  // Wait for the main and worker IPC channels to be ready
  await CommandClient.isReady(['main', 'worker'])

  // Register Commands
  registerCommands([SandboxedService, LocalService], CommandClient)
  logger.info('🚀 Sandboxed Process Loaded')
}
