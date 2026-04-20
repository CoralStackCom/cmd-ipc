import type { BrowserWindow } from 'electron'

/**
 * Holds information about a window process.
 */
export interface WindowProcess {
  /**
   * The unique identifier of the process.
   */
  id: string
  /**
   * The window instance.
   */
  window: BrowserWindow
  /**
   * The type of the process.
   */
  type: 'renderer' | 'process'
  /**
   * Whether to enable direct IPC channel for all other windows to connect directly to this process
   * without using the main process as a mediator. Only use this for processes that have a lot of IPC
   * calls with other processes to reduce performance overhead on main process.
   */
  directIPCChannel: boolean
}

/**
 * Options for creating a new process window.
 */
export interface ProcessWindowOptions {
  /**
   * The unique identifier of the process.
   */
  id: string
  /**
   * The URL to load in the window.
   */
  url: string
  /**
   * Allowed domains the Window can make requests to. Will set the CSP Headers to only
   * allow these domains. Must be a scheme-relative URL, i.e. 'https://sub.example.com'
   * as production builds only allow strict matches.
   * @default []
   */
  allowedDomains?: string[]
  /**
   * Should the Window have node integration enabled? If true, the window will not have any
   * context isolation or sandboxing enabled. This is not recommended for security reasons
   * and should only be used for trusted content.
   * @default false
   */
  nodeIntegration?: boolean
  /**
   * Should the Window create a direct IPC channel for all other windows to connect directly to this process
   * without using the main process as a mediator. Only use this for processes that have a lot of IPC
   * calls with other processes to reduce performance overhead on main process.
   * @default false
   */
  directIPCChannel?: boolean
}

/**
 * Options for creating a new renderer window.
 */
export interface RendererWindowOptions {
  /**
   * The unique identifier of the process.
   */
  id: string
  /**
   * The URL to load in the window.
   */
  url: string
  /**
   * The title of the window.
   */
  title: string
  /**
   * The width of the window.
   */
  width: number
  /**
   * The height of the window.
   */
  height: number
}
