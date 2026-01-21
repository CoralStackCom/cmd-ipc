/**
 * Object provides easy access to environment data provided from window object and
 * initialised in preload script for each window/process
 */
export const Environment = new (class {
  // Constants
  public readonly DEVELOPMENT = 'development'
  public readonly TEST = 'test'
  public readonly PRODUCTION = 'production'

  /**
   * The environment the app is running in
   */
  public get environment(): string {
    return window.environment.environment
  }

  /**
   * Boolean flag to determine if the app is running in development mode
   */
  public get isDev(): boolean {
    return window.environment.environment === this.DEVELOPMENT
  }

  /**
   * Boolean flag to determine if the app is running in test mode
   */
  public get isTest(): boolean {
    return window.environment.environment === this.TEST
  }

  /**
   * Boolean flag to determine if the app is running in production mode
   */
  public get isProduction(): boolean {
    return window.environment.environment === this.PRODUCTION
  }

  /**
   * The OS platform the app is running on
   */
  public get platform(): 'macos' | 'windows' | 'linux' | string {
    return window.environment.platform
  }

  /**
   * The process ID of the current process
   */
  public get processId(): string {
    return window.environment.processId
  }

  /**
   * Location of the logs directory for app if process is writing logs directly
   */
  public get logsDir(): string {
    return window.environment.logsDir
  }

  /**
   * Location of the user data directory for app
   */
  public get userDataDir(): string {
    return window.environment.userDataDir
  }

  /**
   * Get the current log level for the current process
   */
  public get logLevel(): 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly' | false {
    return window.environment.logLevel
  }

  /**
   * Helper method to return environment data as an object for logging if needed
   *
   * @returns Object with environment data
   */
  public toObject() {
    return {
      environment: this.environment,
      isDev: this.isDev,
      platform: this.platform,
      processId: this.processId,
      logsDir: this.logsDir,
      userDataDir: this.userDataDir,
      logLevel: this.logLevel,
    }
  }
})()
