import { registerCommands } from '@coralstack/cmd-ipc'
import { ChannelIDs, CommandClient } from '@examples/electron-core'
import { getWorkerLogger } from './logger'

import { TestService } from './services/test-service'

const logger = getWorkerLogger('WorkerProcess')

window.onload = async () => {
  await CommandClient.isReady([ChannelIDs.MAIN])

  // Register Commands
  registerCommands([TestService], CommandClient)
  logger.info('🚀 Worker window loaded')
}
