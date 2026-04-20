import 'reflect-metadata'

import { Command, CommandRegistry, MessagePortChannel, registerCommands } from '@coralstack/cmd-ipc'

import { ChannelIDs } from '../ipc/channel-ids'
import type { CommandRequest, CommandResponse } from '../ipc/command-schema'
import { CommandIDs, WebWorkerCommandSchema } from '../ipc/command-schema'
import { WebWorkerEventSchema } from '../ipc/event-schema'

/**
 * Calc Worker Service
 *
 * Provides mathematical operations that can be offloaded from the main thread.
 */
class CalcService {
  @Command(CommandIDs.MATH_ADD)
  public async add({
    a,
    b,
  }: CommandRequest<typeof CommandIDs.MATH_ADD>): CommandResponse<typeof CommandIDs.MATH_ADD> {
    return { result: a + b }
  }

  @Command(CommandIDs.MATH_MULTIPLY)
  public async multiply({
    a,
    b,
  }: CommandRequest<typeof CommandIDs.MATH_MULTIPLY>): CommandResponse<
    typeof CommandIDs.MATH_MULTIPLY
  > {
    return { result: a * b }
  }

  @Command(CommandIDs.MATH_FACTORIAL)
  public async factorial({
    n,
  }: CommandRequest<typeof CommandIDs.MATH_FACTORIAL>): CommandResponse<
    typeof CommandIDs.MATH_FACTORIAL
  > {
    let result = 1
    for (let i = 2; i <= n; i++) {
      result *= i
    }
    return { result }
  }
}

// Initialize the worker
const registry = new CommandRegistry({
  id: ChannelIDs.CALC,
  schemas: {
    commands: WebWorkerCommandSchema,
    events: WebWorkerEventSchema,
  },
})

// Register commands from the service
const calcService = new CalcService()
registerCommands([calcService], registry)

// Listen for the MessagePort from the main thread
self.onmessage = (event: MessageEvent) => {
  if (event.data.type === 'init' && event.ports[0]) {
    const port = event.ports[0]
    const channel = new MessagePortChannel(ChannelIDs.MAIN, port)
    registry.registerChannel(channel)
    channel.start()

    // Notify main thread that we're ready
    registry.emitEvent('worker.ready', {
      workerId: ChannelIDs.CALC,
      commandCount: 3,
    })
  }
}
