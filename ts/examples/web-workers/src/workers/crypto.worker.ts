import 'reflect-metadata'

import { Command, CommandRegistry, MessagePortChannel, registerCommands } from '@coralstack/cmd-ipc'

import { ChannelIDs } from '../ipc/channel-ids'
import type { CommandRequest, CommandResponse } from '../ipc/command-schema'
import { CommandIDs, WebWorkerCommandSchema } from '../ipc/command-schema'
import { WebWorkerEventSchema } from '../ipc/event-schema'

/**
 * Crypto Worker Service
 *
 * Provides cryptographic operations using the Web Crypto API.
 */
class CryptoService {
  @Command(CommandIDs.CRYPTO_HASH)
  public async hash({
    text,
    algorithm,
  }: CommandRequest<typeof CommandIDs.CRYPTO_HASH>): CommandResponse<
    typeof CommandIDs.CRYPTO_HASH
  > {
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    const hashBuffer = await crypto.subtle.digest(algorithm, data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    return { hash }
  }

  @Command(CommandIDs.CRYPTO_RANDOM)
  public async random({
    min,
    max,
  }: CommandRequest<typeof CommandIDs.CRYPTO_RANDOM>): CommandResponse<
    typeof CommandIDs.CRYPTO_RANDOM
  > {
    const range = max - min + 1
    const randomBuffer = new Uint32Array(1)
    crypto.getRandomValues(randomBuffer)
    const value = min + (randomBuffer[0] % range)
    return { value }
  }

  @Command(CommandIDs.CRYPTO_UUID)
  public async uuid(): CommandResponse<typeof CommandIDs.CRYPTO_UUID> {
    const uuid = crypto.randomUUID()
    return { uuid }
  }
}

// Initialize the worker
const registry = new CommandRegistry({
  id: ChannelIDs.CRYPTO,
  schemas: {
    commands: WebWorkerCommandSchema,
    events: WebWorkerEventSchema,
  },
})

// Register commands from the service
const cryptoService = new CryptoService()
registerCommands([cryptoService], registry)

// Listen for the MessagePort from the main thread
self.onmessage = (event: MessageEvent) => {
  if (event.data.type === 'init' && event.ports[0]) {
    const port = event.ports[0]
    const channel = new MessagePortChannel(ChannelIDs.MAIN, port)
    registry.registerChannel(channel)
    channel.start()

    // Notify main thread that we're ready
    registry.emitEvent('worker.ready', {
      workerId: ChannelIDs.CRYPTO,
      commandCount: 3,
    })
  }
}
