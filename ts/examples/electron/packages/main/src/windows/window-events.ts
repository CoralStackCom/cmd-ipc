/**
 * Enum for Window Event IDs used to initialise Processes/Windows
 */
export enum WindowEventIDs {
  /**
   * Event ID to pass process ports to child processes/Windows
   */
  REGISTER_NEW_CHANNEL = 'register.new.channel',
  /**
   * Event ID to set log level across processes/Windows
   */
  SET_LOGGING_LEVEL = 'set.logging.level',
}
