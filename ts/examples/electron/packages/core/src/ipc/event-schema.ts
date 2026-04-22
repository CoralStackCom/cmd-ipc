import * as v from 'valibot'

import type { EventSchemaMap } from '@coralstack/cmd-ipc'
import { defineIds } from '@coralstack/cmd-ipc'

/**
 * App Event Schemas
 */
export const AppEventSchema = {
  'logging.level.changed': v.object({
    level: v.union([
      v.picklist(['error', 'warn', 'info', 'verbose', 'debug', 'silly']),
      v.literal(false),
    ]),
  }),
  'counter.changed': v.object({
    count: v.number(),
  }),
  'main.test.event': v.object({
    payload: v.any(),
  }),
} as const satisfies EventSchemaMap

/**
 * App Event IDs
 */
export const AppEventIDs = defineIds(AppEventSchema)
