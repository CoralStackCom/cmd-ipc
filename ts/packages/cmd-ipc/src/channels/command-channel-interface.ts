/**
 * Close listener type for ICommandChannel
 */
export type ChannelCloseListener = () => void

/**
 * Message listener type for ICommandChannel
 */
export type ChannelMessageListener = (message: any) => void

/**
 * Union type for Channel event listeners
 */
export type ChannelEventListeners = ChannelCloseListener | ChannelMessageListener

/**
 * Interface for Command Channels.
 *
 * Channels can be a local process, a remote connection (i.e. websocket, http), or
 * any other mechanism that can send and receive command messages.
 */
export interface ICommandChannel {
  /**
   * The unique identifier of the command channel.
   */
  id: string
  /**
   * The **`start()`** method starts the channel and prepares it for sending/receiving messages.
   * For some channels (like HTTPChannel), this may involve async operations like fetching
   * remote command lists. Resolves when the channel is ready.
   */
  start(): Promise<void>
  /**
   * The **`close()`** method closes the connection to the Channel, so it is no longer active.
   * Resolves when cleanup is complete.
   */
  close(): Promise<void>
  /**
   * Send a message to the Channel
   *
   * @param message The message to send
   */
  sendMessage(message: any): void
  /**
   * Emitted when the Channel is disconnected.
   */
  on(event: 'close', listener: ChannelCloseListener): void
  /**
   * Emitted when a new message is received from the Channel.
   */
  on(event: 'message', listener: ChannelMessageListener): void
}
