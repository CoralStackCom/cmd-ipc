import type {
  ChannelEventListeners,
  ChannelMessageListener,
  ICommandChannel,
} from '../command-channel-interface'

/**
 * MessagePortChannel: Implements ICommandChannel using MessagePort for communication
 * between 'worker_threads'. Note that MessagePorts do not emit a 'close' event if the
 * remote port is closed, so the 'close' event handling is not implemented here.
 */
export class MessagePortChannel implements ICommandChannel {
  /**
   * ID of the Channel
   */
  public readonly id: string
  /**
   * MessagePort used for communication
   */
  private readonly port: MessagePort
  /**
   * Set of message listeners registered with the Channel
   */
  private readonly messageListeners = new Set<ChannelMessageListener>()

  /**
   * Constructor for MessagePortChannel
   *
   * @param id    ID of the Channel
   * @param port  The MessagePort used for communication
   */
  constructor(id: string, port: MessagePort) {
    this.id = id
    this.port = port
    this.port.onmessage = (event) => {
      for (const listener of this.messageListeners) {
        listener(event.data)
      }
    }
  }

  public async start(): Promise<void> {
    this.port.start()
  }

  public async close(): Promise<void> {
    this.port.close()
  }

  sendMessage(message: any): void {
    this.port.postMessage(message)
  }

  on(event: 'close' | 'message', listener: ChannelEventListeners): void {
    if (event === 'message') {
      this.messageListeners.add(listener as ChannelMessageListener)
    }
  }
}
