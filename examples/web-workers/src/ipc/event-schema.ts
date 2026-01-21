import * as v from 'valibot'

import type { EventSchemaMap } from '@coralstack/cmd-ipc'
import { defineIds } from '@coralstack/cmd-ipc'

/**
 * Web Worker Event Schemas
 *
 * Defines all events that can be broadcast across workers.
 */
export const WebWorkerEventSchema = {
  /**
   * Emitted by each worker when it starts up or changes state.
   * Main thread uses this to update the worker status display.
   */
  'worker.ready': v.object({
    workerId: v.pipe(v.string(), v.description('ID of the worker that is ready')),
    commandCount: v.pipe(v.number(), v.description('Number of commands registered by this worker')),
  }),

  /**
   * Emitted when a computation completes. Useful for progress tracking
   * and demonstrating cross-worker event broadcasting.
   */
  'computation.complete': v.object({
    commandId: v.pipe(v.string(), v.description('ID of the command that completed')),
    workerId: v.pipe(v.string(), v.description('ID of the worker that executed the command')),
    durationMs: v.pipe(v.number(), v.description('Time taken to execute in milliseconds')),
  }),

  /**
   * Emitted by Data Worker when its internal dataset changes
   * (after fetch, filter, sort, or store operations).
   */
  'data.updated': v.object({
    operation: v.pipe(
      v.picklist(['fetch', 'filter', 'sort', 'store', 'clear']),
      v.description('The operation that caused the update'),
    ),
    count: v.pipe(v.number(), v.description('Number of items in dataset after operation')),
  }),

  /**
   * Generic log event for the debug panel.
   * Workers can emit this to log messages to the UI.
   */
  'debug.log': v.object({
    source: v.pipe(v.string(), v.description('Source of the log (worker ID or "main")')),
    level: v.pipe(v.picklist(['debug', 'info', 'warn', 'error']), v.description('Log level')),
    message: v.pipe(v.string(), v.description('Log message')),
    timestamp: v.pipe(v.number(), v.description('Unix timestamp in milliseconds')),
  }),
} as const satisfies EventSchemaMap

/**
 * Event IDs for type-safe access
 */
export const EventIDs = defineIds(WebWorkerEventSchema)
