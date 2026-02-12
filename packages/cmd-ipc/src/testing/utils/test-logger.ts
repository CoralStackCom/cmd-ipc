/**
 * Test Logger, logs to console and removed ESLint console errors
 * by keeping all console statements in one file for tests
 */
/* eslint-disable no-console */
export const TestLogger = {
  log: (message?: any, ...optionalParams: any[]) => {
    console.log(message, ...optionalParams)
  },
  info: (message?: any, ...optionalParams: any[]) => {
    console.info(message, ...optionalParams)
  },
  warn: (message?: any, ...optionalParams: any[]) => {
    console.warn(message, ...optionalParams)
  },
  error: (message?: any, ...optionalParams: any[]) => {
    console.error(message, ...optionalParams)
  },
  debug: (message?: any, ...optionalParams: any[]) => {
    console.debug(message, ...optionalParams)
  },
  verbose: (message?: any, ...optionalParams: any[]) => {
    console.debug(message, ...optionalParams)
  },
  silly: (message?: any, ...optionalParams: any[]) => {
    console.debug(message, ...optionalParams)
  },
}
/* eslint-enable no-console */
