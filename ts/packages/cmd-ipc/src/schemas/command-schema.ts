import type { InferInput, InferOutput, ObjectEntries, ObjectSchema } from 'valibot'

/**
 * Allowed schema types for command request/response
 * Only object schemas or void are permitted
 */
export type CommandPayloadSchema = ObjectSchema<ObjectEntries, undefined>

/**
 * Command Definition Schema
 * Each command defines optional request and response schemas using Valibot to enforce type safety
 * when calling commands across process boundaries. An optional description can also be provided
 * for documentation purposes/LLMs.
 *
 * - Omit `request` for commands that take no payload (void)
 * - Omit `response` for commands that return nothing (void)
 */
export interface CommandSchemaDefinition {
  /**
   * The request schema using valibot for the command payload
   * Omit for commands that take no payload (void)
   */
  request?: CommandPayloadSchema
  /**
   * The response schema using valibot for the command result
   * Omit for commands that return nothing (void)
   */
  response?: CommandPayloadSchema
  /**
   * Optional description for the command
   */
  description?: string
}

/**
 * Command Map Type: A mapping of command names to their definitions
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
 * const CommandMapA: CommandMap = {
 *   'command.a': {
 *     request: v.object({ a: v.string() }),
 *     response: v.object({ success: v.boolean() }),
 *   },
 * } as const satisfies CommandMap;
 *
 * const CommandMapB: CommandMap = {
 *   'command.b': {
 *     request: v.object({ b: v.number() }),
 *     response: v.object({ result: v.number() }),
 *   },
 * } as const satisfies CommandMap;
 *
 * const MergedCommandMap: CommandMap = {
 *   ...CommandMapA,
 *   ...CommandMapB,
 * } as const satisfies CommandMap;
 * ```
 */
export type CommandSchemaMap = Record<string, CommandSchemaDefinition>

/**
 * Utility Type to infer the output types of a CommandSchemaMap
 * Ignores additional metadata like descriptions
 * Missing request/response are inferred as void
 */
export type InferCommandSchemaMapType<M extends CommandSchemaMap> = {
  [K in keyof M]: {
    request: M[K]['request'] extends CommandPayloadSchema ? InferInput<M[K]['request']> : void
    response: M[K]['response'] extends CommandPayloadSchema ? InferOutput<M[K]['response']> : void
  }
}
