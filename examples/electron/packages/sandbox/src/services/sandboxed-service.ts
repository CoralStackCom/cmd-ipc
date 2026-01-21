import { Command } from '@coralstack/cmd-ipc'

import type { AppCommandRequest, AppCommandResponse } from '@examples/electron-core'
import { AppCommandIDs, Logger } from '@examples/electron-core'

import { SandboxClient, SandboxLocalCommandIDs } from '../local-commands'

const logger = Logger.scope('SandboxedService')

/**
 * Sandboxed Service: Demonstrates how to build services that use the CommandRegistry to
 * handler commands and events in a Sandboxed environment.
 */
class SandboxedServiceClass {
  /**
   * Calls external API to test CSP settings on Sandboxed Service
   *
   * @param payload The payload for the command
   * @returns       The response from the command
   */
  @Command(AppCommandIDs.CALL_API)
  public async callAPI({
    url,
  }: AppCommandRequest<typeof AppCommandIDs.CALL_API>): AppCommandResponse<
    typeof AppCommandIDs.CALL_API
  > {
    logger.info(`Calling external endpoint ${url}`)
    // Log the URL using local command
    await SandboxClient.executeCommand(SandboxLocalCommandIDs._SANDBOX_LOG_URL, { url })
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
    }
    const data = await response.json()
    return {
      data,
    }
  }
}

// Export instance of Class
export const SandboxedService = new SandboxedServiceClass()
