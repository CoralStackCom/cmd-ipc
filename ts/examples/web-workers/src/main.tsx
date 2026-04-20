import 'reflect-metadata'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { CommandRegistry, MessagePortChannel } from '@coralstack/cmd-ipc'

import App from './App'
import { ChannelIDs } from './ipc/channel-ids'
import { CommandIDs, WebWorkerCommandSchema } from './ipc/command-schema'
import { WebWorkerEventSchema } from './ipc/event-schema'
import { IframeSandboxFactory } from './sandbox'

import './styles.css'

// Worker URLs
import calcWorkerUrl from './workers/calc.worker?worker&url'
import cryptoWorkerUrl from './workers/crypto.worker?worker&url'
import dataWorkerUrl from './workers/data.worker?worker&url'

// Allowed fetch domains for the data worker
const ALLOWED_FETCH_DOMAINS = ['https://jsonplaceholder.typicode.com', 'https://api.github.com']

/**
 * Initialize the main thread CommandRegistry and connect sandboxed workers
 */
async function initializeRegistry() {
  const registry = new CommandRegistry({
    id: ChannelIDs.MAIN,
    schemas: {
      commands: WebWorkerCommandSchema,
      events: WebWorkerEventSchema,
    },
  })

  // Register UI notification command on main thread
  registry.registerCommand(CommandIDs.UI_NOTIFY, async ({ message, type }) => {
    window.dispatchEvent(new CustomEvent('ui-notify', { detail: { message, type } }))
  })

  // Create sandboxed workers with fetch restrictions
  const sandboxFactory = new IframeSandboxFactory()

  const workers = [
    { id: ChannelIDs.CALC, workerUrl: calcWorkerUrl },
    { id: ChannelIDs.DATA, workerUrl: dataWorkerUrl, allowedDomains: ALLOWED_FETCH_DOMAINS },
    { id: ChannelIDs.CRYPTO, workerUrl: cryptoWorkerUrl },
  ]

  for (const { id, workerUrl, allowedDomains } of workers) {
    const { port } = await sandboxFactory.createWorker({ id, workerUrl, allowedDomains })
    registry.registerChannel(new MessagePortChannel(id, port))
  }

  return registry
}

// Initialize and render the React app
initializeRegistry().then((registry) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App registry={registry} />
    </StrictMode>,
  )
})
