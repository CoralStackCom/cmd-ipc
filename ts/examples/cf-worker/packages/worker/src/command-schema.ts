import * as v from 'valibot'

import type { CommandSchemaMap, InferCommandSchemaMapType } from '@coralstack/cmd-ipc'
import { defineIds } from '@coralstack/cmd-ipc'

/**
 * Cloudflare Worker Command Schemas
 *
 * Defines all commands available from this worker with full type safety.
 * The frontend will generate its own schema using the CLI:
 *   cmd-ipc generate-schema --url http://localhost:8787 --output src/generated/worker-commands.ts --prefix cloud
 */
export const WorkerCommandSchema = {
  // ═══════════════════════════════════════════════════════════════════════════
  // Math Operations
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
    description: 'Computes the factorial of n (n!). Demonstrates CPU-intensive work on the edge.',
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
} as const satisfies CommandSchemaMap

/**
 * Command IDs for type-safe access
 */
export const CommandIDs = defineIds(WorkerCommandSchema)

/**
 * Type helpers for extracting request/response types
 */
type Commands = InferCommandSchemaMapType<typeof WorkerCommandSchema>
export type CommandRequest<K extends keyof Commands> = Commands[K]['request']
export type CommandResponse<K extends keyof Commands> = Promise<Commands[K]['response']>
