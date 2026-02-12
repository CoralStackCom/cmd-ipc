import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageType } from '@coralstack/cmd-ipc'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import { MCPClientChannel } from './mcp-client-channel'

/**
 * Create a mock Transport that captures the Client's connect behavior.
 *
 * The SDK Client calls transport.start() then sends an initialize request.
 * We intercept via onmessage to simulate server responses.
 */
function createMockTransport(options?: {
  serverInfo?: { name: string; version: string }
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
}): Transport {
  const serverInfo = options?.serverInfo ?? { name: 'Test Server', version: '1.0.0' }
  // SDK validates that every tool has an inputSchema, so provide a default
  const tools = (options?.tools ?? []).map((t) => ({
    ...t,
    inputSchema: t.inputSchema ?? { type: 'object' as const },
  }))

  const transport: Transport = {
    async start() {
      // Transport started
    },
    async send(message) {
      // Intercept messages from the Client and respond
      const msg = message as Record<string, unknown>
      const method = msg.method as string | undefined
      const id = msg.id as string | number | undefined

      if (method === 'initialize' && id !== undefined) {
        // Respond to initialize
        setTimeout(() => {
          transport.onmessage?.({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: { listChanged: true } },
              serverInfo,
            },
          } as any)
        }, 0)
      } else if (method === 'notifications/initialized') {
        // Notification - no response needed
      } else if (method === 'tools/list' && id !== undefined) {
        // Respond to tools/list
        setTimeout(() => {
          transport.onmessage?.({
            jsonrpc: '2.0',
            id,
            result: { tools },
          } as any)
        }, 0)
      } else if (method === 'tools/call' && id !== undefined) {
        const params = msg.params as Record<string, unknown>
        const toolName = params?.name as string

        // Default: return success result
        setTimeout(() => {
          if (toolName === 'fail') {
            transport.onmessage?.({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: 'Something went wrong' }],
                isError: true,
              },
            } as any)
          } else {
            transport.onmessage?.({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: '{"result": 42}' }],
              },
            } as any)
          }
        }, 0)
      }
    },
    async close() {
      // Transport closed
    },
  }

  return transport
}

describe('MCPClientChannel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create channel with required config', () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport: createMockTransport(),
      })

      expect(channel.id).toBe('test-mcp')
    })
  })

  describe('start()', () => {
    it('should initialize session and discover tools', async () => {
      const transport = createMockTransport({
        tools: [
          {
            name: 'search',
            description: 'Search docs',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
          {
            name: 'get_info',
            description: 'Get info',
          },
        ],
      })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport,
        commandPrefix: 'mcp.test',
      })

      const registeredCommands: string[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.REGISTER_COMMAND_REQUEST) {
          registeredCommands.push(msg.command.id)
        }
      })

      await channel.start()

      expect(channel.serverInfo).toEqual({ name: 'Test Server', version: '1.0.0' })
      expect(registeredCommands).toEqual(['mcp.test.search', 'mcp.test.get_info'])
    })

    it('should not start if already started', async () => {
      const sendSpy = vi.fn()
      const transport = createMockTransport()
      const origSend = transport.send!
      transport.send = async (msg, opts) => {
        sendSpy(msg)
        return origSend.call(transport, msg, opts)
      }

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport,
      })

      await channel.start()
      const callCountAfterFirst = sendSpy.mock.calls.length
      await channel.start() // Second call should be no-op

      expect(sendSpy.mock.calls.length).toBe(callCountAfterFirst)
    })

    it('should register tools without prefix', async () => {
      const transport = createMockTransport({
        tools: [{ name: 'my_tool', description: 'A tool' }],
      })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport,
        // No commandPrefix
      })

      const registeredCommands: string[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.REGISTER_COMMAND_REQUEST) {
          registeredCommands.push(msg.command.id)
        }
      })

      await channel.start()

      expect(registeredCommands).toEqual(['my_tool'])
    })
  })

  describe('sendMessage()', () => {
    it('should execute tool call and emit response', async () => {
      const transport = createMockTransport({
        tools: [{ name: 'add', description: 'Add numbers' }],
      })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport,
        commandPrefix: 'calc',
      })

      await channel.start()

      const responses: any[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.EXECUTE_COMMAND_RESPONSE) {
          responses.push(msg)
        }
      })

      channel.sendMessage({
        id: 'req-123',
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        commandId: 'calc.add',
        request: { a: 1, b: 2 },
      })

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(responses).toHaveLength(1)
      expect(responses[0].thid).toBe('req-123')
      expect(responses[0].response.ok).toBe(true)
      expect(responses[0].response.result).toEqual({ result: 42 })
    })

    it('should handle tool call error', async () => {
      const transport = createMockTransport({
        tools: [{ name: 'fail' }],
      })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport,
      })

      await channel.start()

      const responses: any[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.EXECUTE_COMMAND_RESPONSE) {
          responses.push(msg)
        }
      })

      channel.sendMessage({
        id: 'req-456',
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        commandId: 'fail',
        request: {},
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(responses).toHaveLength(1)
      expect(responses[0].response.ok).toBe(false)
      expect(responses[0].response.error.code).toBe('internal_error')
      expect(responses[0].response.error.message).toBe('Something went wrong')
    })

    it('should emit error for unknown command', async () => {
      const transport = createMockTransport({ tools: [] })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport,
      })

      await channel.start()

      const responses: any[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.EXECUTE_COMMAND_RESPONSE) {
          responses.push(msg)
        }
      })

      channel.sendMessage({
        id: 'req-789',
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        commandId: 'unknown.command',
        request: {},
      })

      expect(responses).toHaveLength(1)
      expect(responses[0].response.ok).toBe(false)
      expect(responses[0].response.error.code).toBe('not_found')
    })

    it('should ignore non-execute messages', async () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport: createMockTransport(),
      })

      // Should not throw
      channel.sendMessage({
        id: 'msg-1',
        type: MessageType.LIST_COMMANDS_REQUEST,
      })
    })
  })

  describe('close()', () => {
    it('should close and notify listeners', async () => {
      const transport = createMockTransport({
        tools: [{ name: 'tool' }],
      })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport,
      })

      await channel.start()

      let closeCalled = false
      channel.on('close', () => {
        closeCalled = true
      })

      await channel.close()

      expect(closeCalled).toBe(true)
    })

    it('should handle close when not started', async () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport: createMockTransport(),
      })

      let closeCalled = false
      channel.on('close', () => {
        closeCalled = true
      })

      await channel.close()

      expect(closeCalled).toBe(true)
    })
  })

  describe('on()', () => {
    it('should register message listeners', () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport: createMockTransport(),
      })

      const messages: any[] = []
      channel.on('message', (msg) => messages.push(msg))

      expect(messages).toHaveLength(0)
    })

    it('should register close listeners', async () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        transport: createMockTransport(),
      })

      let closeCalled = false
      channel.on('close', () => {
        closeCalled = true
      })

      await channel.close()

      expect(closeCalled).toBe(true)
    })
  })
})
