import type { MessagePortMain } from 'electron'

import type {
  ChannelCloseListener,
  ChannelEventListeners,
  ICommandChannel,
} from '@coralstack/cmd-ipc'

/**
 * MessagePortMainChannel: Implements ICommandChannel using MessagePortMain for the main Electron
 * node.js process for communication with child windows.
 */
export class MessagePortMainChannel implements ICommandChannel {
  /**
   * ID of the Channel
   */
  public readonly id: string
  /**
   * MessagePort used for communication
   */
  private readonly port: MessagePortMain

  /**
   * Constructor for MessagePortMainChannel
   *
   * @param id    ID of the Channel
   * @param port  The MessagePort used for communication
   */
  constructor(id: string, port: MessagePortMain) {
    this.id = id
    this.port = port
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
      this.port.on('message', (event) => {
        listener(event.data)
      })
    } else {
      this.port.on('close', listener as ChannelCloseListener)
    }
  }
}
