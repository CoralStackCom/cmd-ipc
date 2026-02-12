import type * as v from 'valibot'

import type { CommandMessageSchema } from './command-message-schemas'

/**
 * Base class for all Command Registry Errors
 */
export abstract class CommandRegistryError extends Error {
  abstract readonly code: string
}

/**
 * Enum of all Command Registry Error Codes
 */
export enum CommandRegistryErrorCode {
  INVALID_MESSAGE = 'invalid_message',
}

/**
 * Error thrown if the registry receives an invalid message
 */
export class InvalidMessageError extends CommandRegistryError {
  readonly code = CommandRegistryErrorCode.INVALID_MESSAGE
  readonly issues: v.SafeParseResult<typeof CommandMessageSchema>['issues']

  constructor(issues: v.SafeParseResult<typeof CommandMessageSchema>['issues']) {
    super('Invalid message received by Command Registry')
    this.issues = issues
  }
}

/**
 * Enum of all Register Command Error Codes
 */
export enum CommandRegisterErrorCode {
  DUPLICATE_COMMAND = 'duplicate_command',
}

/**
 * Error for Duplicate Command Registration
 */
export class DuplicateCommandRegistrationError extends CommandRegistryError {
  readonly code = CommandRegisterErrorCode.DUPLICATE_COMMAND
}

/**
 * Enum of all Execute Command Error Codes
 */
export enum ExecuteCommandResponseErrorCode {
  NOT_FOUND = 'not_found',
  INVALID_REQUEST = 'invalid_request',
  INTERNAL_ERROR = 'internal_error',
  TIMEOUT = 'timeout',
  CHANNEL_DISCONNECTED = 'channel_disconnected',
}

/**
 * Error for Command Not Found
 */
export class CommandNotFoundError extends CommandRegistryError {
  readonly code = ExecuteCommandResponseErrorCode.NOT_FOUND
}

/**
 * Error for Invalid Command Request
 */
export class InvalidCommandRequestError extends CommandRegistryError {
  readonly code = ExecuteCommandResponseErrorCode.INVALID_REQUEST
}

/**
 * Error for Internal Command Error
 */
export class InternalCommandError extends CommandRegistryError {
  readonly code = ExecuteCommandResponseErrorCode.INTERNAL_ERROR
}

/**
 * Error for Request Timeout
 */
export class TimeoutError extends CommandRegistryError {
  readonly code = ExecuteCommandResponseErrorCode.TIMEOUT
}

/**
 * Error for Channel Disconnected during request
 */
export class ChannelDisconnectedError extends CommandRegistryError {
  readonly code = ExecuteCommandResponseErrorCode.CHANNEL_DISCONNECTED
}
