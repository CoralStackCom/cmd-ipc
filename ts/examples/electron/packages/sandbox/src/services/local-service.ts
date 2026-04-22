import { Command } from '@coralstack/cmd-ipc'

import { Logger } from '@examples/electron-core'
import type { SandboxCommandRequest, SandboxCommandResponse } from '../local-commands'
import { SandboxLocalCommandIDs } from '../local-commands'

const logger = Logger.scope('LocalService')

/**
 * Local Service: Demonstrates how to build local services that use the CommandRegistry to
 * let other local services call the commands without having to couple services together.
 *
 * This makes it much easier to build modular services that can be tested independently
 * and mock commands for faster, more reliable testing.
 */
class LocalServiceClass {
  /**
   * Logs the URL
   */
  @Command(SandboxLocalCommandIDs._SANDBOX_LOG_URL)
  public async logUrl({
    url,
  }: SandboxCommandRequest<typeof SandboxLocalCommandIDs._SANDBOX_LOG_URL>): SandboxCommandResponse<
    typeof SandboxLocalCommandIDs._SANDBOX_LOG_URL
  > {
    logger.info(`Logging URL: ${url}`)
  }
}

// Export instance of Class
export const LocalService = new LocalServiceClass()
