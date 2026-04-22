import os from 'os'
import path from 'path'

/**
 * Utility class to help determine current environment/platform.
 * Environment is determined from environment variable set when node.js is
 * run `NODE_ENV` with following values:
 *
 *  development, test, production
 */
export class Environment {
  // Constants
  public static readonly DEVELOPMENT = 'development'
  public static readonly TEST = 'test'
  public static readonly PRODUCTION = 'production'

  public static readonly WINDOWS = 'win32'
  public static readonly MACOS = 'darwin'
  public static readonly LINUX = 'linux'

  public static readonly APP_NAME = 'ELECTRON-COMMAND-IPC'

  /**
   * Get the current platform the app is running on:
   *  win31, darwin (MacOS), linux
   */
  public static get platform(): 'macos' | 'windows' | 'linux' | string {
    switch (process.platform) {
      case Environment.WINDOWS:
        return 'windows'
      case Environment.MACOS:
        return 'macos'
      case Environment.LINUX:
        return 'linux'
      default:
        return process.platform
    }
  }

  /**
   * Is the app running on Microsoft Windows?
   */
  public static get isWin(): boolean {
    return process.platform === Environment.WINDOWS
  }

  /**
   * Is the app running on MacOS?
   */
  public static get isMacOS(): boolean {
    return process.platform === Environment.MACOS
  }

  /**
   * Is the app running on Linux?
   */
  public static get isLinux(): boolean {
    return process.platform === Environment.LINUX
  }

  /**
   * What environment is the app running in:
   *  development, test, production
   */
  public static get environment() {
    return Environment.getEnvironment()
  }

  /**
   * Returns the actual Node.JS environment, useful to
   * get in case the Environment variable is being overriden
   * at startup
   */
  public static get nodeEnvironment() {
    return process.env.NODE_ENV
  }

  /**
   * Is the app running in development?
   */
  public static get isDevelopment(): boolean {
    return Environment.getEnvironment() === Environment.DEVELOPMENT
  }

  /**
   * Is the app running in test?
   */
  public static get isTest(): boolean {
    return Environment.getEnvironment() === Environment.TEST
  }

  /**
   * Is the app running in production?
   */
  public static get isProduction(): boolean {
    return Environment.getEnvironment() === Environment.PRODUCTION
  }

  /**
   * Get the user data directory for the current environment where application
   * data such as settings/config can be stored and referrence by the app. By default
   * points to:
   *
   * * %APPDATA%/Angelfish on Windows
   * * $XDG_CONFIG_HOME/Angelfish on Linux
   * * ~/Library/Application Support/Angelfish on macOS
   *
   * Will append `-development` to folder if running in development mode to seperate
   * data used during development and when running the built production ap locally on
   * the same computer
   */
  public static get userDataDir(): string {
    if (Environment.isMacOS) {
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        Environment.isProduction
          ? Environment.APP_NAME
          : `${Environment.APP_NAME}-${Environment.environment}`,
      )
    }
    if (Environment.isWin) {
      return path.join(
        process.env.APPDATA as string,
        Environment.isProduction
          ? Environment.APP_NAME
          : `${Environment.APP_NAME}-${Environment.environment}`,
      )
    }
    if (Environment.isLinux) {
      const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '/.config')
      return path.join(
        configHome,
        Environment.isProduction
          ? Environment.APP_NAME
          : `${Environment.APP_NAME}-${Environment.environment}`,
      )
    }

    // Unknown OS, use home directory
    return path.join(
      os.homedir(),
      Environment.isProduction
        ? Environment.APP_NAME
        : `${Environment.APP_NAME}-${Environment.environment}`,
    )
  }

  /**
   * Get the log directory for the current environment where application logs can be written
   * to by the app for support/troubleshooting
   *
   * * %APPDATA%/Angelfish on Windows
   * * $XDG_CONFIG_HOME/Angelfish on Linux
   * * ~/Library/Application Support/Angelfish on macOS
   */
  public static get logsDir(): string {
    if (Environment.isMacOS) {
      return path.join(
        os.homedir(),
        'Library',
        'Logs',
        Environment.isProduction
          ? Environment.APP_NAME
          : `${Environment.APP_NAME}-${Environment.environment}`,
      )
    }
    return path.join(Environment.userDataDir, 'logs')
  }

  /**
   * Allows user to override environment settings to specific environment
   * if needed. I.e. If you want to view production data using dev mode.
   * You need to pass -environment flag with name of environment in command
   * line to use this.
   *
   * Will return process.env.NODE_ENV if command line flag not set
   */
  private static getEnvironment(): string {
    const envFlagIndex = process.argv.indexOf('-environment')
    if (envFlagIndex > -1) {
      return process.argv[envFlagIndex + 1]
    }
    return process.env.NODE_ENV as string
  }
}
