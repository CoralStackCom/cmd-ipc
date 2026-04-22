/**
 * Logger class to log messages in sandboxed renderer processes
 *
 * @example
 * const logger = Logger.scope('MyComponent')
 * logger.info('Hello World!')
 */
export class Logger {
  private scope: string

  /**
   * Private constructor to inisitalised scoped logger
   *
   * @param scope Scope of the logger
   */
  private constructor(scope: string) {
    this.scope = scope
  }

  /**
   * Get a scoped instance of the logger
   *
   * @param scope Scope of the logger
   * @returns     Scoped instance of the logger
   */
  public static scope(scope: string) {
    return new Logger(scope)
  }

  /**
   * Log with error level
   *
   * @param args      Arguments to log
   */
  public error(...args: any[]) {
    window.log.error(this.scope, ...args)
  }

  /**
   * Log with warn level
   *
   * @param args      Arguments to log
   */
  public warn(...args: any[]) {
    window.log.warn(this.scope, ...args)
  }

  /**
   * Log with info level
   *
   * @param args      Arguments to log
   */
  public info(...args: any[]) {
    window.log.info(this.scope, ...args)
  }

  /**
   * Log with verbose level
   *
   * @param args      Arguments to log
   */
  public verbose(...args: any[]) {
    window.log.verbose(this.scope, ...args)
  }

  /**
   * Log with debug level
   *
   * @param args      Arguments to log
   */
  public debug(...args: any[]) {
    window.log.debug(this.scope, ...args)
  }

  /**
   * Log with silly level
   *
   * @param args      Arguments to log
   */
  public silly(...args: any[]) {
    window.log.silly(this.scope, ...args)
  }
}
