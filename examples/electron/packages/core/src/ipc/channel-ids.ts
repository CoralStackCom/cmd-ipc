/**
 * Default Channel IDs for the application for IPC communication
 * between different processes.
 */
export enum ChannelIDs {
  /**
   * Main process
   */
  MAIN = 'main',
  /**
   * Main App window
   */
  APP = 'app',
  /**
   * Worker Process
   */
  WORKER = 'worker',
  /**
   * Sandboxed Process
   */
  SANDBOX = 'sandbox',
}
