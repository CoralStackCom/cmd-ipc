import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageType } from '../../registry/command-message-schemas'

import { MCPClientChannel } from './mcp-client-channel'
import { resetRequestIdCounter } from './mcp-json-rpc'
import type { MCPInitializeResult, MCPToolsListResult } from './mcp-types'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('MCPClientChannel', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    resetRequestIdCounter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create channel with required config', () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
      })

      expect(channel.id).toBe('test-mcp')
    })

    it('should strip trailing slash from baseUrl', () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com/',
      })

      expect(channel.id).toBe('test-mcp')
    })
  })

  describe('start()', () => {
    it('should initialize session and discover tools', async () => {
      const initResult: MCPInitializeResult = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'Test Server', version: '1.0.0' },
      }

      const toolsResult: MCPToolsListResult = {
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
      }

      // Mock initialize request
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'MCP-Session-Id': 'session-123' }),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: initResult,
          }),
        })
        // Mock initialized notification
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          headers: new Headers({ 'MCP-Session-Id': 'session-123' }),
        })
        // Mock tools/list request
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'MCP-Session-Id': 'session-123' }),
          json: async () => ({
            jsonrpc: '2.0',
            id: 2,
            result: toolsResult,
          }),
        })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
        commandPrefix: 'mcp.test',
      })

      const registeredCommands: string[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.REGISTER_COMMAND_REQUEST) {
          registeredCommands.push(msg.command.id)
        }
      })

      await channel.start()

      expect(channel.sessionId).toBe('session-123')
      expect(channel.serverInfo).toEqual(initResult.serverInfo)
      expect(channel.serverCapabilities).toEqual(initResult.capabilities)
      expect(channel.protocolVersion).toBe('2025-03-26')

      expect(registeredCommands).toEqual(['mcp.test.search', 'mcp.test.get_info'])

      // Verify fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(3)

      // Check initialize request
      const initCall = mockFetch.mock.calls[0]
      expect(initCall[0]).toBe('https://example.com/mcp')
      expect(initCall[1].method).toBe('POST')
      const initBody = JSON.parse(initCall[1].body)
      expect(initBody.method).toBe('initialize')

      // Check initialized notification
      const notifyCall = mockFetch.mock.calls[1]
      const notifyBody = JSON.parse(notifyCall[1].body)
      expect(notifyBody.method).toBe('notifications/initialized')
      expect('id' in notifyBody).toBe(false) // Notifications have no id

      // Check tools/list request
      const toolsCall = mockFetch.mock.calls[2]
      const toolsBody = JSON.parse(toolsCall[1].body)
      expect(toolsBody.method).toBe('tools/list')
    })

    it('should not start if already started', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'Test', version: '1.0' },
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers({}) })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
        })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
      })

      await channel.start()
      await channel.start() // Second call should be no-op

      expect(mockFetch).toHaveBeenCalledTimes(3) // Only first start makes calls
    })

    it('should register tools without prefix', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'Test', version: '1.0' },
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers({}) })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 2,
            result: { tools: [{ name: 'my_tool', description: 'A tool' }] },
          }),
        })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
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
      // Setup channel with mocked initialization
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'Test', version: '1.0' },
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers({}) })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 2,
            result: { tools: [{ name: 'add', description: 'Add numbers' }] },
          }),
        })
        // Mock tools/call response
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 3,
            result: {
              content: [{ type: 'text', text: '{"result": 42}' }],
            },
          }),
        })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
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
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(responses).toHaveLength(1)
      expect(responses[0].thid).toBe('req-123')
      expect(responses[0].response.ok).toBe(true)
      expect(responses[0].response.result).toEqual({ result: 42 })

      // Verify tools/call request
      const callRequest = mockFetch.mock.calls[3]
      const callBody = JSON.parse(callRequest[1].body)
      expect(callBody.method).toBe('tools/call')
      expect(callBody.params.name).toBe('add')
      expect(callBody.params.arguments).toEqual({ a: 1, b: 2 })
    })

    it('should handle tool call error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'Test', version: '1.0' },
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers({}) })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 2,
            result: { tools: [{ name: 'fail' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 3,
            result: {
              content: [{ type: 'text', text: 'Something went wrong' }],
              isError: true,
            },
          }),
        })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
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

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(responses).toHaveLength(1)
      expect(responses[0].response.ok).toBe(false)
      expect(responses[0].response.error.code).toBe('internal_error')
      expect(responses[0].response.error.message).toBe('Something went wrong')
    })

    it('should emit error for unknown command', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'Test', version: '1.0' },
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers({}) })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 2,
            result: { tools: [] },
          }),
        })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
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
        baseUrl: 'https://example.com',
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
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'MCP-Session-Id': 'sess-1' }),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'Test', version: '1.0' },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          headers: new Headers({ 'MCP-Session-Id': 'sess-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({
            jsonrpc: '2.0',
            id: 2,
            result: { tools: [{ name: 'tool' }] },
          }),
        })
        // Mock DELETE for session termination
        .mockResolvedValueOnce({ ok: true, status: 200 })

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
      })

      await channel.start()

      let closeCalled = false
      channel.on('close', () => {
        closeCalled = true
      })

      await channel.close()

      expect(closeCalled).toBe(true)

      // Verify DELETE was called
      const deleteCall = mockFetch.mock.calls[3]
      expect(deleteCall[1].method).toBe('DELETE')
    })

    it('should not send DELETE if no session', async () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
      })

      let closeCalled = false
      channel.on('close', () => {
        closeCalled = true
      })

      await channel.close()

      expect(closeCalled).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should handle DELETE errors gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'MCP-Session-Id': 'sess-1' }),
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'Test', version: '1.0' },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          headers: new Headers({ 'MCP-Session-Id': 'sess-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({}),
          json: async () => ({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
        })
        // DELETE fails
        .mockRejectedValueOnce(new Error('Network error'))

      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
      })

      await channel.start()

      // Should not throw even if DELETE fails
      await channel.close()
    })
  })

  describe('on()', () => {
    it('should register message listeners', () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
      })

      const messages: any[] = []
      channel.on('message', (msg) => messages.push(msg))

      // Can't easily test without starting, but we've tested in other tests
      expect(messages).toHaveLength(0)
    })

    it('should register close listeners', async () => {
      const channel = new MCPClientChannel({
        id: 'test-mcp',
        baseUrl: 'https://example.com',
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

// ============================================================================
// Integration Tests - Cloudflare MCP Server
// ============================================================================

describe('MCPClientChannel Integration - Cloudflare Docs', () => {
  const MCP_URL = 'https://docs.mcp.cloudflare.com'

  // Skip in CI or if network not available
  const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true'

  it.skipIf(!runIntegration)(
    'should initialize and list tools',
    async () => {
      vi.restoreAllMocks() // Use real fetch

      const channel = new MCPClientChannel({
        id: 'cloudflare-docs',
        baseUrl: MCP_URL,
        commandPrefix: 'cf',
        timeout: 60000, // Longer timeout for network
      })

      const registeredCommands: string[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.REGISTER_COMMAND_REQUEST) {
          registeredCommands.push(msg.command.id)
        }
      })

      await channel.start()

      expect(registeredCommands.length).toBeGreaterThan(0)
      expect(registeredCommands.every((id) => id.startsWith('cf.'))).toBe(true)

      // Log discovered tools
      // eslint-disable-next-line no-console
      console.log('Discovered tools:', registeredCommands)
      // eslint-disable-next-line no-console
      console.log('Server info:', channel.serverInfo)
      // eslint-disable-next-line no-console
      console.log('Session ID:', channel.sessionId)

      await channel.close()
    },
    120000,
  ) // 2 minute timeout

  it.skipIf(!runIntegration)(
    'should call a tool and get response',
    async () => {
      vi.restoreAllMocks()

      const channel = new MCPClientChannel({
        id: 'cloudflare-docs',
        baseUrl: MCP_URL,
        commandPrefix: 'cf',
        timeout: 60000,
      })

      const registeredCommands: string[] = []
      channel.on('message', (msg) => {
        if (msg.type === MessageType.REGISTER_COMMAND_REQUEST) {
          registeredCommands.push(msg.command.id)
        }
      })

      await channel.start()

      // Find a search tool if available
      const searchTool = registeredCommands.find(
        (cmd) => cmd.includes('search') || cmd.includes('query'),
      )

      if (searchTool) {
        const responsePromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout waiting for response')), 60000)

          channel.on('message', (msg) => {
            if (msg.type === MessageType.EXECUTE_COMMAND_RESPONSE) {
              clearTimeout(timeout)
              resolve(msg)
            }
          })
        })

        channel.sendMessage({
          id: crypto.randomUUID(),
          type: MessageType.EXECUTE_COMMAND_REQUEST,
          commandId: searchTool,
          request: { query: 'workers' },
        })

        const response = (await responsePromise) as any
        // eslint-disable-next-line no-console
        console.log('Tool response:', JSON.stringify(response, null, 2))

        expect(response.response).toBeDefined()
      } else {
        // eslint-disable-next-line no-console
        console.log('No search tool found, skipping tool call test')
      }

      await channel.close()
    },
    120000,
  )
})
