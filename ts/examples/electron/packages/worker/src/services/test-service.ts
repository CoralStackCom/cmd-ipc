import { Command } from '@coralstack/cmd-ipc'
import type { AppCommandRequest, AppCommandResponse } from '@examples/electron-core'
import { AppCommandIDs, AppEventIDs, CommandClient } from '@examples/electron-core'

import { getWorkerLogger } from '../logger'

const logger = getWorkerLogger('TestService')

/**
 * Test Service: Demonstrates how to build services that use the CommandRegistry to
 * handler commands and events.
 */
class TestServiceClass {
  /**
   * Public constructor - add any event listeners here
   */
  public constructor() {
    logger.info('TestService constructed')
    CommandClient.addEventListener(AppEventIDs.MAIN_TEST_EVENT, () => {
      logger.info('test event received')
    })
    CommandClient.addEventListener(AppEventIDs.COUNTER_CHANGED, (event) => {
      logger.info('Counter Changed:', event.count)
    })
  }

  /**
   * Simple 'hello.world' command
   *
   * @param payload The payload for the command
   * @returns       The response from the command
   */
  @Command(AppCommandIDs.HELLO_WORLD)
  public async helloWorld({
    name,
  }: AppCommandRequest<typeof AppCommandIDs.HELLO_WORLD>): AppCommandResponse<
    typeof AppCommandIDs.HELLO_WORLD
  > {
    logger.info('Test command hello.world invoked with payload:', name)
    return { message: `Hello ${name}` }
  }
}

// Export instance of Class
export const TestService = new TestServiceClass()
