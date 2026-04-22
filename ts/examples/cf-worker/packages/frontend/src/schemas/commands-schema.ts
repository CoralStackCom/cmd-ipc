import * as v from 'valibot'

import type { CommandSchemaMap, InferCommandSchemaMapType } from '@coralstack/cmd-ipc'
import { defineIds } from '@coralstack/cmd-ipc'

import { CloudCommandSchema } from './generated/worker-commands'

/**
 * Local command schemas - these commands run in the browser
 */
const LocalCommandSchema = {
  'string.reverse': {
    description: 'Reverses a string locally in the browser',
    request: v.object({
      text: v.string(),
    }),
    response: v.object({
      result: v.string(),
      length: v.number(),
    }),
  },
  'string.uppercase': {
    description: 'Converts a string to uppercase locally',
    request: v.object({
      text: v.string(),
    }),
    response: v.object({
      result: v.string(),
    }),
  },
  'array.sum': {
    description: 'Sums an array of numbers locally',
    request: v.object({
      numbers: v.array(v.number()),
    }),
    response: v.object({
      result: v.number(),
      count: v.number(),
    }),
  },
} as const satisfies CommandSchemaMap

/**
 * Combined Command schema for both Local and Cloud commands
 */
export const CommandSchema = {
  ...LocalCommandSchema,
  ...CloudCommandSchema,
} as const satisfies CommandSchemaMap

/**
 * Command IDs for type-safe access
 */
export const CommandIDs = defineIds(CommandSchema)

/**
 * Type helpers for extracting request/response types
 */
type Commands = InferCommandSchemaMapType<typeof CommandSchema>
export type CommandRequest<K extends keyof Commands> = Commands[K]['request']
export type CommandResponse<K extends keyof Commands> = Promise<Commands[K]['response']>
