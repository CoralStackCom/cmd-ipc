/**
 * IframeSandboxFactory - Creates workers inside iframes with CSP restrictions
 *
 * This factory launches each worker in an iframe, providing:
 * - Restricted fetch access via CSP connect-src directive
 * - Direct MessagePort communication between main thread and worker
 *
 * Note: The iframe sandbox attribute is not used because Web Workers
 * require both allow-scripts and allow-same-origin, which together
 * allow sandbox escape. Security is enforced via CSP instead.
 */

import iframeSandboxHtml from './iframe-sandbox.html?raw'

export interface SandboxWorkerConfig {
  /** Unique identifier for the worker */
  id: string
  /** URL to the worker script (can be a blob URL or regular URL) */
  workerUrl: string
  /** Optional allowed domains for fetch requests (defaults to none) */
  allowedDomains?: string[]
}

export interface SandboxedWorker {
  /** The worker's identifier */
  id: string
  /** The MessagePort for communicating with the worker */
  port: MessagePort
  /** Clean up the sandboxed worker and iframe */
  destroy: () => void
}

interface PendingWorker {
  resolve: (worker: SandboxedWorker) => void
  reject: (error: Error) => void
  config: SandboxWorkerConfig
  iframe: HTMLIFrameElement
  port: MessagePort
}

/**
 * Factory for creating workers inside sandboxed iframes
 */
export class IframeSandboxFactory {
  private pendingWorkers: Map<string, PendingWorker> = new Map()
  private activeWorkers: Map<string, SandboxedWorker> = new Map()

  constructor() {
    // Listen for messages from sandboxed iframes
    window.addEventListener('message', this.handleIframeMessage.bind(this))
  }

  /**
   * Create a sandboxed worker
   */
  async createWorker(config: SandboxWorkerConfig): Promise<SandboxedWorker> {
    const { id, workerUrl, allowedDomains = [] } = config

    if (this.activeWorkers.has(id)) {
      throw new Error(`Worker with id "${id}" already exists`)
    }

    return new Promise((resolve, reject) => {
      // Create the sandboxed iframe
      const iframe = this.createSandboxedIframe(id, allowedDomains)

      // Create MessageChannel for main thread <-> worker communication
      const channel = new MessageChannel()

      // Store pending worker info
      this.pendingWorkers.set(id, {
        resolve,
        reject,
        config,
        iframe,
        port: channel.port1,
      })

      // Once iframe is loaded, send the init message with worker URL and port
      iframe.onload = () => {
        iframe.contentWindow?.postMessage(
          {
            type: 'sandbox-init',
            workerId: id,
            workerUrl,
          },
          '*',
          [channel.port2],
        )
      }

      iframe.onerror = () => {
        this.pendingWorkers.delete(id)
        reject(new Error(`Failed to load sandbox iframe for worker "${id}"`))
      }

      // Append iframe to document (hidden)
      document.body.appendChild(iframe)

      // eslint-disable-next-line no-console
      console.info(`🚀 ${id} sandboxed worker created with URL: ${workerUrl}`)
    })
  }

  /**
   * Create an iframe with CSP restrictions for fetch access control
   *
   * Note: We don't use the sandbox attribute because:
   * - Web Workers require same-origin context (allow-same-origin)
   * - JavaScript execution requires allow-scripts
   * - Combining both allows sandbox escape (browser warning)
   *
   * Instead, security is enforced via CSP connect-src directive which
   * restricts which domains the worker can fetch from.
   */
  private createSandboxedIframe(workerId: string, allowedDomains: string[]): HTMLIFrameElement {
    const iframe = document.createElement('iframe')

    // Hide the iframe
    iframe.style.display = 'none'
    iframe.setAttribute('data-sandbox-worker-id', workerId)

    // Build CSP connect-src directive - this is the real security mechanism
    const connectSrc =
      allowedDomains.length > 0 ? `connect-src ${allowedDomains.join(' ')}` : "connect-src 'none'"

    // Create iframe content with CSP meta tag
    iframe.srcdoc = this.createIframeSandboxContent(connectSrc)

    return iframe
  }

  /**
   * Creates the iframe HTML content with the specified CSP connect-src directive
   */
  private createIframeSandboxContent(connectSrcDirective: string): string {
    return iframeSandboxHtml.replace('{{CONNECT_SRC_DIRECTIVE}}', connectSrcDirective)
  }

  /**
   * Handle messages from sandboxed iframes
   */
  private handleIframeMessage(event: MessageEvent): void {
    const { type, workerId, error } = event.data || {}

    if (!workerId || !this.pendingWorkers.has(workerId)) {
      return
    }

    const pending = this.pendingWorkers.get(workerId)!

    if (type === 'sandbox-ready') {
      // Worker successfully created
      this.pendingWorkers.delete(workerId)

      const sandboxedWorker: SandboxedWorker = {
        id: workerId,
        port: pending.port,
        destroy: () => this.destroyWorker(workerId),
      }

      this.activeWorkers.set(workerId, sandboxedWorker)
      pending.resolve(sandboxedWorker)
    } else if (type === 'sandbox-error') {
      // Worker creation failed
      this.pendingWorkers.delete(workerId)
      pending.iframe.remove()
      pending.reject(new Error(error || 'Unknown sandbox error'))
    }
  }

  /**
   * Destroy a sandboxed worker
   */
  destroyWorker(workerId: string): void {
    const worker = this.activeWorkers.get(workerId)
    if (!worker) return

    // Find and remove the iframe
    const iframe = document.querySelector(
      `iframe[data-sandbox-worker-id="${workerId}"]`,
    ) as HTMLIFrameElement

    if (iframe) {
      // Send destroy message to iframe
      iframe.contentWindow?.postMessage(
        {
          type: 'sandbox-destroy',
          workerId,
        },
        '*',
      )
      // Remove iframe from DOM
      iframe.remove()
    }

    this.activeWorkers.delete(workerId)
    // eslint-disable-next-line no-console
    console.info(`💥 ${workerId} worker and its iFrame destroyed`)
  }

  /**
   * Destroy all sandboxed workers
   */
  destroyAll(): void {
    for (const workerId of this.activeWorkers.keys()) {
      this.destroyWorker(workerId)
    }
  }

  /**
   * Get a sandboxed worker by ID
   */
  getWorker(workerId: string): SandboxedWorker | undefined {
    return this.activeWorkers.get(workerId)
  }
}
