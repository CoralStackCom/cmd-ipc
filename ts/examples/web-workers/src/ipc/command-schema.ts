import * as v from 'valibot'

import type { CommandSchemaMap, InferCommandSchemaMapType } from '@coralstack/cmd-ipc'
import { defineIds } from '@coralstack/cmd-ipc'

/**
 * Web Worker Command Schemas
 *
 * Defines all commands available across workers with full type safety.
 */
export const WebWorkerCommandSchema = {
  // ═══════════════════════════════════════════════════════════════════════════
  // Calc Worker - Mathematical operations
  // ═══════════════════════════════════════════════════════════════════════════

  'math.add': {
    description: 'Adds two numbers together and returns the sum.',
    request: v.object({
      a: v.pipe(v.number(), v.description('First number to add')),
      b: v.pipe(v.number(), v.description('Second number to add')),
    }),
    response: v.object({
      result: v.pipe(v.number(), v.description('Sum of a + b')),
    }),
  },

  'math.multiply': {
    description: 'Multiplies two numbers together and returns the product.',
    request: v.object({
      a: v.pipe(v.number(), v.description('First number to multiply')),
      b: v.pipe(v.number(), v.description('Second number to multiply')),
    }),
    response: v.object({
      result: v.pipe(v.number(), v.description('Product of a * b')),
    }),
  },

  'math.factorial': {
    description:
      'Computes the factorial of n (n!). Demonstrates CPU-intensive work offloaded to a worker.',
    request: v.object({
      n: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(0),
        v.maxValue(170),
        v.description('Non-negative integer to compute factorial of (max 170)'),
      ),
    }),
    response: v.object({
      result: v.pipe(v.number(), v.description('The factorial n!')),
    }),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Worker - Data fetching, filtering, and storage
  // ═══════════════════════════════════════════════════════════════════════════

  'data.fetch': {
    description:
      'Fetches JSON data from a URL. Worker handles the network request to avoid blocking the main thread.',
    request: v.object({
      url: v.pipe(v.string(), v.url(), v.description('URL to fetch JSON data from')),
    }),
    response: v.object({
      data: v.pipe(v.any(), v.description('The fetched JSON data')),
    }),
  },

  'data.filter': {
    description:
      'Filters the current dataset using a predicate expression (e.g., "age > 25"). Uses safe evaluation.',
    request: v.object({
      field: v.pipe(v.string(), v.description('Field name to filter on')),
      operator: v.pipe(
        v.picklist(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']),
        v.description('Comparison operator'),
      ),
      value: v.pipe(v.union([v.string(), v.number()]), v.description('Value to compare against')),
    }),
    response: v.object({
      data: v.pipe(v.array(v.any()), v.description('Filtered array of items')),
      count: v.pipe(v.number(), v.description('Number of items after filtering')),
    }),
  },

  'data.sort': {
    description: 'Sorts the current dataset by a field in ascending or descending order.',
    request: v.object({
      field: v.pipe(v.string(), v.description('Field name to sort by')),
      order: v.pipe(v.picklist(['asc', 'desc']), v.description('Sort direction')),
    }),
    response: v.object({
      data: v.pipe(v.array(v.any()), v.description('Sorted array of items')),
    }),
  },

  'data.store': {
    description:
      "Stores a value in the worker's in-memory data array. Returns the index where it was stored.",
    request: v.object({
      value: v.pipe(v.any(), v.description('Value to store')),
    }),
    response: v.object({
      index: v.pipe(v.number(), v.description('Index where the value was stored')),
    }),
  },

  'data.get': {
    description: 'Returns the current dataset stored in the worker.',
    response: v.object({
      data: v.pipe(v.array(v.any()), v.description('Current dataset')),
      count: v.pipe(v.number(), v.description('Number of items in dataset')),
    }),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Crypto Worker - Cryptographic operations using Web Crypto API
  // ═══════════════════════════════════════════════════════════════════════════

  'crypto.hash': {
    description:
      'Generates a cryptographic hash of the input text using the specified algorithm (SHA-256, SHA-384, SHA-512).',
    request: v.object({
      text: v.pipe(v.string(), v.description('Text to hash')),
      algorithm: v.pipe(
        v.picklist(['SHA-256', 'SHA-384', 'SHA-512']),
        v.description('Hash algorithm to use'),
      ),
    }),
    response: v.object({
      hash: v.pipe(v.string(), v.description('Hexadecimal hash string')),
    }),
  },

  'crypto.random': {
    description:
      'Generates a cryptographically secure random integer between min and max (inclusive).',
    request: v.object({
      min: v.pipe(v.number(), v.integer(), v.description('Minimum value (inclusive)')),
      max: v.pipe(v.number(), v.integer(), v.description('Maximum value (inclusive)')),
    }),
    response: v.object({
      value: v.pipe(v.number(), v.description('Random integer between min and max')),
    }),
  },

  'crypto.uuid': {
    description: 'Generates a cryptographically secure UUID v4.',
    response: v.object({
      uuid: v.pipe(v.string(), v.description('Generated UUID v4 string')),
    }),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Main Thread (UI) - Commands handled by the main thread
  // ═══════════════════════════════════════════════════════════════════════════

  'ui.notify': {
    description:
      'Displays a toast notification in the UI. Can be called from any worker to show feedback.',
    request: v.object({
      message: v.pipe(v.string(), v.description('Notification message to display')),
      type: v.pipe(
        v.picklist(['info', 'success', 'warning', 'error']),
        v.description('Notification type for styling'),
      ),
    }),
  },

  '_ui.log': {
    description:
      'Private command for internal UI logging. Not exposed to workers (underscore prefix).',
    request: v.object({
      level: v.picklist(['debug', 'info', 'warn', 'error']),
      message: v.string(),
    }),
  },
} as const satisfies CommandSchemaMap

/**
 * Command IDs for type-safe access
 */
export const CommandIDs = defineIds(WebWorkerCommandSchema)

/**
 * Type helpers for extracting request/response types
 */
type Commands = InferCommandSchemaMapType<typeof WebWorkerCommandSchema>
export type CommandRequest<K extends keyof Commands> = Commands[K]['request']
export type CommandResponse<K extends keyof Commands> = Promise<Commands[K]['response']>
