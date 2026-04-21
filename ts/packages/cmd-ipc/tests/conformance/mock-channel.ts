import type {
  ChannelCloseListener,
  ChannelEventListeners,
  ChannelMessageListener,
  ICommandChannel,
} from '../../src/channels/command-channel-interface'

/**
 * In-memory channel used by the conformance behavior harness.
 *
 * Captures outbound messages (those the registry-under-test sends) in a queue,
 * and exposes `deliver()` so the harness can inject inbound messages.
 */
export class MockChannel implements ICommandChannel {
  public readonly id: string
  private messageListeners: ChannelMessageListener[] = []
  private closeListeners: ChannelCloseListener[] = []
  private outbound: unknown[] = []

  constructor(id: string) {
    this.id = id
  }

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.closeListeners.forEach((l) => l())
  }

  sendMessage(message: unknown): void {
    this.outbound.push(message)
  }

  on(event: 'close' | 'message', listener: ChannelEventListeners): void {
    if (event === 'message') {
      this.messageListeners.push(listener as ChannelMessageListener)
    } else if (event === 'close') {
      this.closeListeners.push(listener as ChannelCloseListener)
    }
  }

  // --- harness-only helpers ---

  /** Inject a message as if received from the remote peer. */
  deliver(message: unknown): void {
    this.messageListeners.forEach((l) => l(message))
  }

  /** Take the oldest outbound message, or undefined if queue is empty. */
  takeOutbound(): unknown | undefined {
    return this.outbound.shift()
  }

  /** Drop any outbound messages matching the predicate (used to drain the
   *  auto-sent `list.commands.request` from channel registration). */
  drainWhere(pred: (msg: any) => boolean): void {
    this.outbound = this.outbound.filter((m) => !pred(m))
  }

  pendingOutboundCount(): number {
    return this.outbound.length
  }

  peekOutbound(): unknown[] {
    return [...this.outbound]
  }
}
