import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ExecuteCommandResponseErrorCode } from '../../../registry/command-errors'
import { MessageType } from '../../../registry/command-message-schemas'

import { MCPServerChannel } from './mcp-server-channel'
import type { MCPHttpResponse } from './mcp-server-types'

/**
 * Helper to resolve handleRequest response (handles Promise | MCPHttpResponse)
 */
async function resolveResponse(
  response: MCPHttpResponse | Promise<MCPHttpResponse>,
): Promise<MCPHttpResponse> {
  return response instanceof Promise ? response : response
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
        capabilities: { tools: { listChanged: true } },
        protocolVersion: '2025-03-26',
        enableSessions: true,
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

  describe('handleRequest() - Initialize', () => {
    it('should handle initialize request', async () => {
      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'Test Client', version: '1.0.0' },
            },
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('application/json')
      expect(response.headers['MCP-Session-Id']).toBeDefined()

      const body = JSON.parse(response.body as string)
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(1)
      expect(body.result.protocolVersion).toBe('2025-11-25')
      expect(body.result.serverInfo.name).toBe('Test Server')
      expect(body.result.instructions).toBe('A test MCP server')
    })

    it('should not create session when sessions disabled', async () => {
      const noSessionChannel = new MCPServerChannel({
        id: 'no-sessions',
        enableSessions: false,
      })

      const response = await resolveResponse(
        noSessionChannel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'Test', version: '1.0' },
            },
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(200)
      expect(response.headers['MCP-Session-Id']).toBeUndefined()
    })
  })

  describe('handleRequest() - Initialized notification', () => {
    it('should handle initialized notification', async () => {
      // First initialize to get session
      const initResponse = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'Test', version: '1.0' },
            },
          },
          new Headers(),
        ),
      )

      const sessionId = initResponse.headers['MCP-Session-Id']

      // Send initialized notification
      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          },
          new Headers({ 'MCP-Session-Id': sessionId! }),
        ),
      )

      expect(response.status).toBe(202)
    })
  })

  describe('handleRequest() - tools/list', () => {
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

      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.result.tools).toHaveLength(2) // _internal filtered out
      expect(body.result.tools[0].name).toBe('math.add')
      expect(body.result.tools[0].description).toBe('Add numbers')
      expect(body.result.tools[1].name).toBe('math.sub')
    })
  })

  describe('handleRequest() - tools/call', () => {
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

      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'math.add',
              arguments: { a: 20, b: 22 },
            },
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.id).toBe(3)
      expect(body.result.content).toHaveLength(1)
      expect(body.result.content[0].type).toBe('text')
      expect(JSON.parse(body.result.content[0].text)).toEqual({ sum: 42 })
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

      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'fail.tool', arguments: {} },
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toBe('Something went wrong')
    })

    it('should return error for missing tool name', async () => {
      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { arguments: {} }, // Missing name
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(-32602) // INVALID_PARAMS
    })
  })

  describe('handleRequest() - Unknown method', () => {
    it('should return method not found error', async () => {
      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 6,
            method: 'unknown/method',
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(-32601) // METHOD_NOT_FOUND
    })
  })

  describe('handleRequest() - GET (SSE)', () => {
    it('should return SSE stream', async () => {
      // First initialize to get session
      const initResponse = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'Test', version: '1.0' },
            },
          },
          new Headers(),
        ),
      )

      const sessionId = initResponse.headers['MCP-Session-Id']

      const response = await resolveResponse(
        channel.handleRequest('GET', undefined, new Headers({ 'MCP-Session-Id': sessionId! })),
      )

      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('text/event-stream')
      expect(response.body).toBeInstanceOf(ReadableStream)
    })

    it('should require session ID', async () => {
      const response = await resolveResponse(channel.handleRequest('GET', undefined, new Headers()))

      expect(response.status).toBe(400)
    })

    it('should return error for unknown session', async () => {
      const response = await resolveResponse(
        channel.handleRequest(
          'GET',
          undefined,
          new Headers({ 'MCP-Session-Id': 'unknown-session' }),
        ),
      )

      expect(response.status).toBe(404)
    })
  })

  describe('handleRequest() - DELETE', () => {
    it('should terminate session', async () => {
      // First initialize to get session
      const initResponse = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'Test', version: '1.0' },
            },
          },
          new Headers(),
        ),
      )

      const sessionId = initResponse.headers['MCP-Session-Id']
      expect(channel.activeSessions).toBe(1)

      const response = await resolveResponse(
        channel.handleRequest('DELETE', undefined, new Headers({ 'MCP-Session-Id': sessionId! })),
      )

      expect(response.status).toBe(200)
      expect(channel.activeSessions).toBe(0)
    })

    it('should require session ID', async () => {
      const response = await resolveResponse(
        channel.handleRequest('DELETE', undefined, new Headers()),
      )

      expect(response.status).toBe(400)
    })

    it('should return error for unknown session', async () => {
      const response = await resolveResponse(
        channel.handleRequest(
          'DELETE',
          undefined,
          new Headers({ 'MCP-Session-Id': 'unknown-session' }),
        ),
      )

      expect(response.status).toBe(404)
    })

    it('should return 405 when sessions disabled', async () => {
      const noSessionChannel = new MCPServerChannel({
        id: 'no-sessions',
        enableSessions: false,
      })

      const response = await resolveResponse(
        noSessionChannel.handleRequest('DELETE', undefined, new Headers()),
      )

      expect(response.status).toBe(405)
    })
  })

  describe('handleRequest() - Invalid message', () => {
    it('should return error for invalid JSON-RPC message', async () => {
      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          { invalid: 'message' }, // Not a valid JSON-RPC message
          new Headers(),
        ),
      )

      expect(response.status).toBe(400)

      const body = JSON.parse(response.body as string)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(-32600) // INVALID_REQUEST
    })
  })

  describe('handleRequest() - SSE responses', () => {
    it('should return SSE response when Accept header prefers it', async () => {
      await channel.start()

      channel.on('message', (msg) => {
        if (msg.type === MessageType.LIST_COMMANDS_REQUEST) {
          channel.sendMessage({
            id: crypto.randomUUID(),
            type: MessageType.LIST_COMMANDS_RESPONSE,
            thid: msg.id,
            commands: [{ id: 'test.tool', description: 'A tool' }],
          })
        }
      })

      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/list',
          },
          new Headers({ Accept: 'text/event-stream, application/json' }),
        ),
      )

      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('text/event-stream')
      expect(response.body).toBeInstanceOf(ReadableStream)
    })
  })

  describe('handleRequest() - Closed channel', () => {
    it('should return 503 when channel is closed', async () => {
      await channel.close()

      const response = await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'Test', version: '1.0' },
            },
          },
          new Headers(),
        ),
      )

      expect(response.status).toBe(503)
    })
  })

  describe('on()', () => {
    it('should register message listeners', async () => {
      const messages: any[] = []
      channel.on('message', (msg) => messages.push(msg))

      await channel.start()

      // Trigger a tools/call which emits a message
      channel.handleRequest(
        'POST',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'test', arguments: {} },
        },
        new Headers(),
      )

      // Wait a bit for message to be emitted
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(messages.length).toBeGreaterThan(0)
      expect(messages[0].type).toBe(MessageType.EXECUTE_COMMAND_REQUEST)
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

  describe('activeSessions', () => {
    it('should track session count', async () => {
      expect(channel.activeSessions).toBe(0)

      await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'Client 1', version: '1.0' },
            },
          },
          new Headers(),
        ),
      )

      expect(channel.activeSessions).toBe(1)

      await resolveResponse(
        channel.handleRequest(
          'POST',
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'Client 2', version: '1.0' },
            },
          },
          new Headers(),
        ),
      )

      expect(channel.activeSessions).toBe(2)
    })
  })
})
