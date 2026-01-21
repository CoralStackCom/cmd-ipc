import 'reflect-metadata'

import { CommandRegistry, HTTPChannel, registerCommands } from '@coralstack/cmd-ipc'
import { TestLogger } from '@coralstack/cmd-ipc/testing'

import { WorkerCommandSchema } from './command-schema'
import { CalcService } from './services/calc-service'

// CORS headers for local development
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Lazy initialization - CF Workers don't allow async operations at global scope
let registry: CommandRegistry<typeof WorkerCommandSchema> | null = null
let channel: HTTPChannel | null = null

async function getRegistry() {
  if (!registry) {
    // Initialize registry with command schemas
    registry = new CommandRegistry({
      id: 'cf-worker',
      schemas: { commands: WorkerCommandSchema },
      logger: TestLogger,
    })

    // Create HTTP channel in server mode (no baseUrl)
    channel = new HTTPChannel({ id: 'http-server' })

    // Register all command services
    registerCommands([CalcService], registry)

    // Register the channel
    await registry.registerChannel(channel)
  }
  return { registry, channel: channel! }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { registry, channel } = await getRegistry()

    const url = new URL(request.url)

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Handle command requests
    if (request.method === 'POST' && url.pathname === '/cmd') {
      try {
        const body = await request.json()
        const response = await channel.handleMessage(body)
        return new Response(JSON.stringify(response), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        })
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error handling request:', error)
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        })
      }
    }

    // Command schema endpoint
    if (request.method === 'GET' && url.pathname === '/cmds.json') {
      return new Response(JSON.stringify({ status: 'ok', commands: registry.listCommands() }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      })
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  },
}
