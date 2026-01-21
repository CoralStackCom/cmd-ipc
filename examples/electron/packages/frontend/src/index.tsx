/**
 * Main entry point for the App frontend renderer process.
 */

import { createRoot } from 'react-dom/client'

import { ChannelIDs, CommandClient, Logger } from '@examples/electron-core'

import { default as App } from './App'
import './index.css'

const logger = Logger.scope('Frontend')

// Wait for window to load before executing the script
window.onload = async () => {
  await CommandClient.isReady([ChannelIDs.MAIN, ChannelIDs.WORKER])

  const rootElement = document.getElementById('root')
  if (!rootElement) {
    logger.error('Root element not found')
    throw new Error('Root element not found')
  }
  const root = createRoot(rootElement, {
    onUncaughtError: (error, errorInfo) => {
      logger.error('Uncaught Error', error, errorInfo)
    },
    onCaughtError: (error, errorInfo) => {
      logger.error('React Caught Error', error, errorInfo)
    },
  })
  root.render(<App />)
}
