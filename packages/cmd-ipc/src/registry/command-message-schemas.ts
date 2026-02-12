import * as v from 'valibot'

import {
  CommandRegisterErrorCode,
  ExecuteCommandResponseErrorCode,
  InvalidMessageError,
} from './command-errors'

/**
 * Enum of all Command Message Types
 */
export enum MessageType {
  // Command Registry Methods
  REGISTER_COMMAND_REQUEST = 'register.command.request',
  REGISTER_COMMAND_RESPONSE = 'register.command.response',
  LIST_COMMANDS_REQUEST = 'list.commands.request',
  LIST_COMMANDS_RESPONSE = 'list.commands.response',

  // Execute Command
  EXECUTE_COMMAND_REQUEST = 'execute.command.request',
  EXECUTE_COMMAND_RESPONSE = 'execute.command.response',

  // Events
  EVENT = 'event',
}

/**
 * Command Definition Base Schema
 */
const CommandDefinitionBaseSchema = v.object({
  id: v.string(),
  description: v.optional(v.string()),
  schema: v.optional(
    v.object({
      request: v.optional(v.any()),
      response: v.optional(v.any()),
    }),
  ),
})

/**
 * Message Schemas
 */

/**
 * Register Command Request
 */
const MessageRegisterCommandRequestSchema = v.object({
  id: v.string(),
  type: v.literal(MessageType.REGISTER_COMMAND_REQUEST),
  command: CommandDefinitionBaseSchema,
})

/**
 * Register Command Response
 */
const MessageRegisterCommandResponseSchema = v.object({
  id: v.string(),
  type: v.literal(MessageType.REGISTER_COMMAND_RESPONSE),
  thid: v.string(),
  response: v.union([
    v.object({ ok: v.literal(true) }),
    v.object({
      ok: v.literal(false),
      error: v.enum(CommandRegisterErrorCode),
    }),
  ]),
})

/**
 * List Commands Request
 */
const MessageListCommandsRequestSchema = v.object({
  id: v.string(),
  type: v.literal(MessageType.LIST_COMMANDS_REQUEST),
})

/**
 * List Commands Response
 */
const MessageListCommandsResponseSchema = v.object({
  id: v.string(),
  type: v.literal(MessageType.LIST_COMMANDS_RESPONSE),
  thid: v.string(),
  commands: v.array(CommandDefinitionBaseSchema),
})

/**
 * Execute Command Request
 */
const MessageExecuteCommandRequestSchema = v.object({
  id: v.string(),
  type: v.literal(MessageType.EXECUTE_COMMAND_REQUEST),
  commandId: v.string(),
  request: v.optional(v.record(v.string(), v.any())),
})

/**
 * Execute Command Response
 */
const MessageExecuteCommandResponseSchema = v.object({
  id: v.string(),
  type: v.literal(MessageType.EXECUTE_COMMAND_RESPONSE),
  thid: v.string(),
  response: v.union([
    v.object({
      ok: v.literal(true),
      result: v.optional(v.any()),
    }),
    v.object({
      ok: v.literal(false),
      error: v.object({
        code: v.enum(ExecuteCommandResponseErrorCode),
        message: v.string(),
      }),
    }),
  ]),
})

/**
 * Event Message
 */
const MessageEventSchema = v.object({
  id: v.string(),
  type: v.literal(MessageType.EVENT),
  eventId: v.string(),
  payload: v.optional(v.any()),
})

/**
 * Union of all Command Messages (discriminated by 'type')
 */
export const CommandMessageSchema = v.variant('type', [
  MessageRegisterCommandRequestSchema,
  MessageRegisterCommandResponseSchema,
  MessageListCommandsRequestSchema,
  MessageListCommandsResponseSchema,
  MessageExecuteCommandRequestSchema,
  MessageExecuteCommandResponseSchema,
  MessageEventSchema,
])

/**
 * Inferred Types from Schemas
 */
export type IMessageRegisterCommandRequest = v.InferOutput<
  typeof MessageRegisterCommandRequestSchema
>
export type IMessageRegisterCommandResponse = v.InferOutput<
  typeof MessageRegisterCommandResponseSchema
>
export type IMessageListCommandsRequest = v.InferOutput<typeof MessageListCommandsRequestSchema>
export type IMessageListCommandsResponse = v.InferOutput<typeof MessageListCommandsResponseSchema>
export type IMessageExecuteCommandRequest = v.InferOutput<typeof MessageExecuteCommandRequestSchema>
export type IMessageExecuteCommandResponse = v.InferOutput<
  typeof MessageExecuteCommandResponseSchema
>
export type IMessageEvent = v.InferOutput<typeof MessageEventSchema>
export type CommandMessage = v.InferOutput<typeof CommandMessageSchema>

/**
 * Validates a message structure against its schema based on message type.
 * Uses discriminated union validation for type-safe message handling.
 *
 * @param message - The message to validate (unknown input)
 * @throws {InvalidMessageError} If the message does not conform to any known schema
 */
export function validateMessage(message: unknown): void {
  const result = v.safeParse(CommandMessageSchema, message)
  if (!result.success) {
    throw new InvalidMessageError(result.issues)
  }
}
