import type { ICommandRegistry } from '@coralstack/cmd-ipc'

import type { AppCommandSchema, AppEventSchema } from './ipc'

/**
 * Define Global Types Here
 */

declare global {
  interface Window {
    /**
     * Commands API for registering and executing commands and events
     * Typed with App-specific commands and events for full type safety
     */
    commands: ICommandRegistry<typeof AppCommandSchema, typeof AppEventSchema>
    /**
     * Environment variables for the application
     */
    environment: {
      /**
       * Environment app is running in
       */
      environment: string
      /**
       * The OS platform the app is running on
       */
      platform: 'macos' | 'windows' | 'linux' | string
      /**
       * The process ID of the current process
       */
      processId: string
      /**
       * Location of the logs directory for app if process is writing logs directly
       */
      logsDir: string
      /**
       * Location of the user data directory for app
       */
      userDataDir: string
      /**
       * Log level for the current process
       */
      logLevel: 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly' | false
    }
    /**
     * Log API for logging messages to the console and main process to write to file
     */
    log: {
      error: (scope: string, ...args: any[]) => void
      warn: (scope: string, ...args: any[]) => void
      info: (scope: string, ...args: any[]) => void
      verbose: (scope: string, ...args: any[]) => void
      debug: (scope: string, ...args: any[]) => void
      silly: (scope: string, ...args: any[]) => void
    }
  }
}
