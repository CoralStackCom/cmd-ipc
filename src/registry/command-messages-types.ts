import type { CommandRegisterErrorCode, ExecuteCommandResponseErrorCode } from './command-errors'
import type { ICommandDefinitionBase } from './command-registry-interface'

/**
 * Base Command Message Types
 */

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
 * Base Command Message Interface
 */
interface IMessage {
  /**
   * UUID for message
   */
  id: string
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType
}

/**
 * Register Command Message Types
 */

/**
 * Register a new Command with the Command Registry
 * from another process
 */
export interface IMessageRegisterCommandRequest extends IMessage {
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType.REGISTER_COMMAND_REQUEST
  /**
   * Command being registered, must be globally unique
   */
  command: ICommandDefinitionBase
}

/**
 * Response to a Register Command Request
 */
export interface IMessageRegisterCommandResponse extends IMessage {
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType.REGISTER_COMMAND_RESPONSE
  /**
   * Thread ID for message to correlate responses with requests
   */
  thid: string
  /**
   * Response indicating success or failure of command registration
   */
  response:
    | {
        /**
         * Indicates if command execution was successful
         */
        ok: true
      }
    | {
        /**
         * Indicates if command execution was successful
         */
        ok: false
        /**
         * Error information for failed command registration
         */
        error: CommandRegisterErrorCode
      }
}

/**
 * List Command Messages
 */

/**
 * 'list' is used to request a list of all registered Commands
 * that a process can execute. Used when initialising new channels
 */
export interface IMessageListCommandsRequest extends IMessage {
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType.LIST_COMMANDS_REQUEST
}

/**
 * 'list-response' is returned in response to a 'list' request
 * and contains a list of all registered Commands for a remote process
 */
export interface IMessageListCommandsResponse extends IMessage {
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType.LIST_COMMANDS_RESPONSE
  /**
   * Thread ID for message to correlate responses with requests
   */
  thid: string
  /**
   * List of all registered Commands
   */
  commands: ICommandDefinitionBase[]
}

/**
 * Execute Command Messages
 */

/**
 * 'request' is used to make a request to execute Command
 */
export interface IMessageExecuteCommandRequest extends IMessage {
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType.EXECUTE_COMMAND_REQUEST
  /**
   * Command ID being invoked for request
   */
  commandId: string
  /**
   * Request as determined by specific Command handler
   */
  request?: object
}

/**
 * Error response for Execute Command Response
 */
export interface ExecuteCommandResponseError {
  code: ExecuteCommandResponseErrorCode
  message: string
}

/**
 * 'response' is used to send a successful response from the Command handler
 */
export interface IMessageExecuteCommandResponse extends IMessage {
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType.EXECUTE_COMMAND_RESPONSE
  /**
   * Thread ID for message to correlate responses with requests
   */
  thid: string
  /**
   * Payload for response as determined by specific Command handler
   */
  response:
    | {
        /**
         * Indicates if command execution was successful
         */
        ok: true
        /**
         * Result of command execution
         */
        result?: any
      }
    | {
        /**
         * Indicates if command execution was successful
         */
        ok: false
        /**
         * Error information for failed command execution
         */
        error: ExecuteCommandResponseError
      }
}

/**
 * 'event' is used to broadcast events to clients
 */
export interface IMessageEvent extends IMessage {
  /**
   * Type of Command Message being sent/received
   */
  type: MessageType.EVENT
  /**
   * The Event ID being broadcast (i.e. `event.name`)
   */
  eventId: string
  /**
   * Payload for message as determined by specific Event
   */
  payload?: any
}

/**
 * Command Message Type: Union type of all Command Messages
 */
export type CommandMessage =
  | IMessageRegisterCommandRequest
  | IMessageRegisterCommandResponse
  | IMessageExecuteCommandRequest
  | IMessageEvent
  | IMessageExecuteCommandResponse
  | IMessageListCommandsRequest
  | IMessageListCommandsResponse
