import 'reflect-metadata'

import { Command, CommandRegistry, MessagePortChannel, registerCommands } from '@coralstack/cmd-ipc'

import { ChannelIDs } from '../ipc/channel-ids'
import type { CommandRequest, CommandResponse } from '../ipc/command-schema'
import { CommandIDs, WebWorkerCommandSchema } from '../ipc/command-schema'
import { EventIDs, WebWorkerEventSchema } from '../ipc/event-schema'

/**
 * Data Worker Service
 *
 * Handles data fetching, filtering, sorting, and storage operations.
 * Maintains an in-memory dataset that can be manipulated.
 */
class DataService {
  private data: any[] = []
  private registry: CommandRegistry<typeof WebWorkerCommandSchema, typeof WebWorkerEventSchema>

  constructor(
    registry: CommandRegistry<typeof WebWorkerCommandSchema, typeof WebWorkerEventSchema>,
  ) {
    this.registry = registry
  }

  @Command(CommandIDs.DATA_FETCH)
  public async fetch({
    url,
  }: CommandRequest<typeof CommandIDs.DATA_FETCH>): CommandResponse<typeof CommandIDs.DATA_FETCH> {
    let response: Response
    try {
      response = await globalThis.fetch(url)
    } catch (error) {
      // CSP/CORS violations result in "TypeError: Failed to fetch"
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        const domain = new URL(url).origin
        await this.registry.executeCommand(CommandIDs.UI_NOTIFY, {
          message: `Fetch blocked for domain "${domain}". This domain is not in the allowed list for this sandboxed worker.`,
          type: 'error',
        })
        throw new Error(
          `Fetch blocked for domain "${domain}". This domain is not in the allowed list for this sandboxed worker.`,
        )
      }
      throw error
    }

    const data = await response.json()

    // If the response is an array, store it as our dataset
    if (Array.isArray(data)) {
      this.data = data
      this.registry.emitEvent(EventIDs.DATA_UPDATED, {
        operation: 'fetch',
        count: this.data.length,
      })
    }

    return { data }
  }

  @Command(CommandIDs.DATA_FILTER)
  public async filter({
    field,
    operator,
    value,
  }: CommandRequest<typeof CommandIDs.DATA_FILTER>): CommandResponse<
    typeof CommandIDs.DATA_FILTER
  > {
    const filtered = this.data.filter((item) => {
      const fieldValue = item[field]
      switch (operator) {
        case 'eq':
          return fieldValue === value
        case 'neq':
          return fieldValue !== value
        case 'gt':
          return fieldValue > value
        case 'gte':
          return fieldValue >= value
        case 'lt':
          return fieldValue < value
        case 'lte':
          return fieldValue <= value
        case 'contains':
          return String(fieldValue).includes(String(value))
        default:
          return true
      }
    })

    this.data = filtered
    this.registry.emitEvent(EventIDs.DATA_UPDATED, {
      operation: 'filter',
      count: this.data.length,
    })

    return { data: filtered, count: filtered.length }
  }

  @Command(CommandIDs.DATA_SORT)
  public async sort({
    field,
    order,
  }: CommandRequest<typeof CommandIDs.DATA_SORT>): CommandResponse<typeof CommandIDs.DATA_SORT> {
    const sorted = [...this.data].sort((a, b) => {
      const aVal = a[field]
      const bVal = b[field]
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return order === 'asc' ? comparison : -comparison
    })

    this.data = sorted
    this.registry.emitEvent(EventIDs.DATA_UPDATED, {
      operation: 'sort',
      count: this.data.length,
    })

    return { data: sorted }
  }

  @Command(CommandIDs.DATA_STORE)
  public async store({
    value,
  }: CommandRequest<typeof CommandIDs.DATA_STORE>): CommandResponse<typeof CommandIDs.DATA_STORE> {
    const index = this.data.push(value) - 1
    this.registry.emitEvent(EventIDs.DATA_UPDATED, {
      operation: 'store',
      count: this.data.length,
    })

    return { index }
  }

  @Command(CommandIDs.DATA_GET)
  public async get(): CommandResponse<typeof CommandIDs.DATA_GET> {
    return { data: this.data, count: this.data.length }
  }
}

// Initialize the worker
const registry = new CommandRegistry({
  id: ChannelIDs.DATA,
  schemas: {
    commands: WebWorkerCommandSchema,
    events: WebWorkerEventSchema,
  },
})

// Register commands from the service
const dataService = new DataService(registry)
registerCommands([dataService], registry)

// Listen for the MessagePort from the main thread
self.onmessage = (event: MessageEvent) => {
  if (event.data.type === 'init' && event.ports[0]) {
    const port = event.ports[0]
    const channel = new MessagePortChannel(ChannelIDs.MAIN, port)
    registry.registerChannel(channel)
    channel.start()

    // Notify main thread that we're ready
    registry.emitEvent('worker.ready', {
      workerId: ChannelIDs.DATA,
      commandCount: 5,
    })
  }
}
