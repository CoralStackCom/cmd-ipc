import * as v from 'valibot'

import type { EventSchemaMap, InferEventSchemaMapType } from '../schemas'
import { defineIds } from '../schemas'

/**
 * Command Registry Event Type Definitions
 *
 * These events are always available regardless of user-defined event types.
 * They are automatically merged with user event types in strict typing mode.
 */
export const CommandRegistryEventsSchema = {
  '_new.channel.registered': v.object({
    id: v.string(),
  }),
} as const satisfies EventSchemaMap

/**
 * Command Registry Event IDs
 */
export const CommandRegistryEventIds = defineIds(CommandRegistryEventsSchema)

/**
 * Inferred Command Registry Event Payload Types
 */
export type CommandRegistryEventsPayload = InferEventSchemaMapType<
  typeof CommandRegistryEventsSchema
>

/**
 * Schema type for Command Registry Events (for merging with user event schemas)
 */
export type CommandRegistryEventsSchemaType = typeof CommandRegistryEventsSchema
