import type { GenericSchema, InferOutput } from 'valibot'

/**
 * Event Map Type: A mapping of event names to their payload schemas
 *
 * Make a const and use 'satisfies CommandMap' to ensure type safety.
 *
 * @example
 * ```ts
 * const MyCommands: CommandMap = {
 *   'my.command': {
 *     request: v.object({ id: v.string() }),
 *     response: v.object({ success: v.boolean() }),
 *     description: 'A sample command'
 *   }
 * } as const satisfies CommandMap;
 * ```
 *
 * You can merge multiple CommandMaps using intersection types:
 *
 * @example
 * ```ts
 * const EventMapA: EventMap = {
 *   'event.a': v.object({ a: v.string() }),
 * } as const satisfies EventMap;
 *
 * const EventMapB = {
 *   'event.b': v.object({ b: v.number() }),
 * } as const satisfies EventMap;
 *
 * const MergedEventMap = {
 *   ...EventMapA,
 *   ...EventMapB,
 * } as const satisfies EventMap;
 * ```
 */
export type EventSchemaMap = Record<string, GenericSchema>

/**
 * Utility Type to infer the output types of an EventSchemaMap
 */
export type InferEventSchemaMapType<M extends EventSchemaMap> = {
  [K in keyof M]: InferOutput<M[K]>
}
