/**
 * Base class for all Command Registry Errors
 */
export abstract class CommandRegistryError extends Error {
  abstract readonly code: string
}

/**
 * Enum of all Command Error Codes
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
