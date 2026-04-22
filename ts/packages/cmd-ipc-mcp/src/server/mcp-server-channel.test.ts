import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ExecuteCommandResponseErrorCode, MessageType } from '@coralstack/cmd-ipc'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import { MCPServerChannel } from './mcp-server-channel'

/**
 * Create a mock transport that acts as an MCP client.
 *
 * The transport captures messages sent by the server and provides
 * a method to send messages to the server (simulating client requests).
 */
function createMockClientTransport() {
  const sentMessages: JSONRPCMessage[] = []
  let messageIdCounter = 0

  const transport: Transport = {
    async start() {
      // Transport started
    },
    async send(message) {
      sentMessages.push(message as JSONRPCMessage)
    },
    async close() {
      transport.onclose?.()
    },
  }

  return {
    transport,
    sentMessages,
    /**
     * Send a JSON-RPC request from the client to the server
     */
    sendRequest(method: string, params?: Record<string, unknown>): number {
      const id = ++messageIdCounter
      const msg: any = {
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? {},
      }
      transport.onmessage?.(msg)
      return id
    },
    /**
     * Send a JSON-RPC notification from the client to the server
     */
    sendNotification(method: string, params?: Record<string, unknown>): void {
      const msg: any = {
        jsonrpc: '2.0',
        method,
        params: params ?? {},
      }
      transport.onmessage?.(msg)
    },
    /**
     * Find a response by request ID
     */
    findResponse(id: number): any {
      return sentMessages.find((m: any) => m.id === id)
    },
    /**
     * Wait for a response to appear for the given request ID
     */
    async waitForResponse(id: number, timeoutMs = 1000): Promise<any> {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const response = sentMessages.find((m: any) => m.id === id)
        if (response) return response
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error(`Timeout waiting for response to request ${id}`)
    },
  }
}

/**
 * Connect a mock client transport to the server channel,
 * performing the full MCP initialization handshake.
 */
async function connectAndInitialize(channel: MCPServerChannel) {
  const client = createMockClientTransport()
  await channel.connectTransport(client.transport)

  // Perform MCP handshake: initialize request + initialized notification
  const initId = client.sendRequest('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'Test Client', version: '1.0.0' },
  })

  const initResponse = await client.waitForResponse(initId)
  expect(initResponse.result).toBeDefined()
  expect(initResponse.result.serverInfo).toBeDefined()

  client.sendNotification('notifications/initialized')

  // Small delay for notification to process
  await new Promise((resolve) => setTimeout(resolve, 10))

  return client
}

describe('MCPServerChannel', () => {
  let channel: MCPServerChannel

  beforeEach(() => {
    channel = new MCPServerChannel({
      id: 'test-server',
      serverInfo: { name: 'Test Server', version: '1.0.0' },
      instructions: 'A test MCP server',
    })
  })

  afterEach(async () => {
    await channel.close()
  })

  describe('constructor', () => {
    it('should create channel with required config', () => {
      const ch = new MCPServerChannel({ id: 'minimal' })
      expect(ch.id).toBe('minimal')
    })

    it('should create channel with full config', () => {
      const ch = new MCPServerChannel({
        id: 'full',
        serverInfo: { name: 'Full Server', version: '2.0.0' },
        instructions: 'Full instructions',
        timeout: 60000,
      })
      expect(ch.id).toBe('full')
    })
  })

  describe('start()', () => {
    it('should start the channel', async () => {
      await channel.start()
      // No error means success
    })

    it('should not start if already started', async () => {
      await channel.start()
      await channel.start() // Second call is no-op
    })
  })

  describe('close()', () => {
    it('should close and notify listeners', async () => {
      let closeCalled = false
      channel.on('close', () => {
        closeCalled = true
      })

      await channel.close()

      expect(closeCalled).toBe(true)
    })

    it('should handle close when already closed', async () => {
      await channel.close()
      await channel.close() // Second call is no-op
    })
  })

  describe('connectTransport()', () => {
    it('should handle initialize request', async () => {
      await channel.start()
      const client = createMockClientTransport()
      await channel.connectTransport(client.transport)

      const initId = client.sendRequest('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'Test Client', version: '1.0.0' },
      })

      const response = await client.waitForResponse(initId)

      expect(response.result).toBeDefined()
      expect(response.result.serverInfo.name).toBe('Test Server')
      expect(response.result.instructions).toBe('A test MCP server')
    })
  })

  describe('tools/list', () => {
    it('should list tools from registered commands', async () => {
      await channel.start()

      // Set up message listener to handle list request
      channel.on('message', (msg) => {
        if (msg.type === MessageType.LIST_COMMANDS_REQUEST) {
          // Simulate registry response
          channel.sendMessage({
            id: crypto.randomUUID(),
            type: MessageType.LIST_COMMANDS_RESPONSE,
            thid: msg.id,
            commands: [
              {
                id: 'math.add',
                description: 'Add numbers',
                schema: { request: { type: 'object' } },
              },
              { id: 'math.sub', description: 'Subtract numbers' },
              { id: '_internal', description: 'Private command' }, // Should be filtered
            ],
          })
        }
      })

      const client = await connectAndInitialize(channel)

      const listId = client.sendRequest('tools/list')
      const response = await client.waitForResponse(listId)

      expect(response.result).toBeDefined()
      expect(response.result.tools).toHaveLength(2) // _internal filtered out
      expect(response.result.tools[0].name).toBe('math.add')
      expect(response.result.tools[0].description).toBe('Add numbers')
      expect(response.result.tools[1].name).toBe('math.sub')
    })
  })

  describe('tools/call', () => {
    it('should execute tool and return result', async () => {
      await channel.start()

      // Set up message listener to handle execute request
      channel.on('message', (msg) => {
        if (msg.type === MessageType.EXECUTE_COMMAND_REQUEST) {
          // Simulate command execution
          channel.sendMessage({
            id: crypto.randomUUID(),
            type: MessageType.EXECUTE_COMMAND_RESPONSE,
            thid: msg.id,
            response: {
              ok: true,
              result: { sum: 42 },
            },
          })
        }
      })

      const client = await connectAndInitialize(channel)

      const callId = client.sendRequest('tools/call', {
        name: 'math.add',
        arguments: { a: 20, b: 22 },
      })

      const response = await client.waitForResponse(callId)

      expect(response.result).toBeDefined()
      expect(response.result.content).toHaveLength(1)
      expect(response.result.content[0].type).toBe('text')
      expect(JSON.parse(response.result.content[0].text)).toEqual({ sum: 42 })
    })

    it('should return error for failed tool call', async () => {
      await channel.start()

      channel.on('message', (msg) => {
        if (msg.type === MessageType.EXECUTE_COMMAND_REQUEST) {
          channel.sendMessage({
            id: crypto.randomUUID(),
            type: MessageType.EXECUTE_COMMAND_RESPONSE,
            thid: msg.id,
            response: {
              ok: false,
              error: {
                code: ExecuteCommandResponseErrorCode.INTERNAL_ERROR,
                message: 'Something went wrong',
              },
            },
          })
        }
      })

      const client = await connectAndInitialize(channel)

      const callId = client.sendRequest('tools/call', {
        name: 'fail.tool',
        arguments: {},
      })

      const response = await client.waitForResponse(callId)

      expect(response.result).toBeDefined()
      expect(response.result.isError).toBe(true)
      expect(response.result.content[0].text).toBe('Something went wrong')
    })
  })

  describe('on()', () => {
    it('should register message listeners', async () => {
      const messages: any[] = []
      channel.on('message', (msg) => messages.push(msg))

      await channel.start()

      const client = await connectAndInitialize(channel)

      // Send a tools/call which triggers EXECUTE_COMMAND_REQUEST
      client.sendRequest('tools/call', { name: 'test', arguments: {} })

      // Wait a bit for message to be emitted
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(messages.length).toBeGreaterThan(0)
      // The last message should be an EXECUTE_COMMAND_REQUEST
      const execMessages = messages.filter((m) => m.type === MessageType.EXECUTE_COMMAND_REQUEST)
      expect(execMessages.length).toBeGreaterThan(0)
      expect(execMessages[0].commandId).toBe('test')
    })

    it('should register close listeners', async () => {
      let closeCalled = false
      channel.on('close', () => {
        closeCalled = true
      })

      await channel.close()

      expect(closeCalled).toBe(true)
    })
  })

  describe('server property', () => {
    it('should expose underlying SDK server', () => {
      expect(channel.server).toBeDefined()
    })
  })
})
