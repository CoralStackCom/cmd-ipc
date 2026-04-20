/**
 * Channel IDs for the web workers example.
 * Each worker and the main thread has a unique ID for routing.
 */
export enum ChannelIDs {
  /**
   * Main UI thread - handles UI commands and routes between workers
   */
  MAIN = 'main',
  /**
   * Calc Worker - handles mathematical operations
   */
  CALC = 'calc',
  /**
   * Data Worker - handles data fetching, filtering, and storage
   */
  DATA = 'data',
  /**
   * Crypto Worker - handles cryptographic operations using Web Crypto API
   */
  CRYPTO = 'crypto',
}
