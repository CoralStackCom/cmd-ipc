import { InvalidMessageError } from '../../registry/command-errors'
import type { IMessageExecuteCommandRequest } from '../../registry/command-message-schemas'
import { MessageType } from '../../registry/command-message-schemas'
import { HTTPChannel } from './http-channel'

/**
 * Helper to create a valid LIST_COMMANDS_RESPONSE mock
 */
function createListCommandsResponse(
  commands: Array<{ id: string; description?: string }>,
  thid = 'list-request',
) {
  return {
    id: crypto.randomUUID(),
    type: MessageType.LIST_COMMANDS_RESPONSE,
    thid,
    commands,
  }
}

/**
 * Helper to create a valid EXECUTE_COMMAND_RESPONSE mock
 */
function createExecuteCommandResponse(thid: string, result?: unknown) {
  return {
    id: crypto.randomUUID(),
    type: MessageType.EXECUTE_COMMAND_RESPONSE,
    thid,
    response: { ok: true as const, result },
  }
}

describe('HTTPChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Client Mode', () => {
    it('should fetch commands on start() and emit register.command.request for each', async () => {
      const mockResponse = createListCommandsResponse([
        { id: 'user.create', description: 'Create a user' },
        { id: 'user.get', description: 'Get a user' },
      ])

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      // Verify the fetch call
      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall[0]).toBe('https://api.example.com/cmd')

      const options = fetchCall[1] as RequestInit
      expect(options.method).toBe('POST')
      expect((options.headers as Headers).get('Content-Type')).toBe('application/json')

      // Verify the body contains the correct type (id is dynamic UUID)
      const body = JSON.parse(options.body as string)
      expect(body.type).toBe(MessageType.LIST_COMMANDS_REQUEST)
      expect(body.id).toBeDefined()

      // Should emit register.command.request for each command
      expect(messageHandler).toHaveBeenCalledTimes(2)

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.REGISTER_COMMAND_REQUEST,
          command: { id: 'user.create', description: 'Create a user', schema: undefined },
        }),
      )

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.REGISTER_COMMAND_REQUEST,
          command: { id: 'user.get', description: 'Get a user', schema: undefined },
        }),
      )
    })

    it('should apply commandPrefix to fetched commands', async () => {
      const mockResponse = createListCommandsResponse([
        { id: 'user.create', description: 'Create a user' },
        { id: 'user.get', description: 'Get a user' },
      ])

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
        commandPrefix: 'cloud',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      // Should emit register.command.request with prefixed IDs
      expect(messageHandler).toHaveBeenCalledTimes(2)

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.REGISTER_COMMAND_REQUEST,
          command: { id: 'cloud.user.create', description: 'Create a user', schema: undefined },
        }),
      )

      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.REGISTER_COMMAND_REQUEST,
          command: { id: 'cloud.user.get', description: 'Get a user', schema: undefined },
        }),
      )
    })

    it('should strip commandPrefix from commandId before sending to remote', async () => {
      const mockListResponse = createListCommandsResponse([{ id: 'user.create' }])
      const mockExecuteResponse = createExecuteCommandResponse('request-123', { id: 'user-456' })

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockListResponse),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockExecuteResponse),
          }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
        commandPrefix: 'cloud',
      })

      channel.on('message', vi.fn())
      await channel.start()

      // Send request with prefixed commandId
      channel.sendMessage({
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        id: 'request-123',
        commandId: 'cloud.user.create',
        request: { name: 'John' },
      })

      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(2)
      })

      // The second fetch call should have the prefix stripped
      expect(fetch).toHaveBeenLastCalledWith(
        'https://api.example.com/cmd',
        expect.objectContaining({
          body: JSON.stringify({
            type: MessageType.EXECUTE_COMMAND_REQUEST,
            id: 'request-123',
            commandId: 'user.create', // Prefix stripped
            request: { name: 'John' },
          }),
        }),
      )
    })

    it('should send HTTP POST on sendMessage() and emit response', async () => {
      const mockListResponse = createListCommandsResponse([])
      const mockExecuteResponse = createExecuteCommandResponse('request-123', { id: 'user-456' })

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockListResponse),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockExecuteResponse),
          }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      // No commands in response, so no register.command.request messages
      expect(messageHandler).not.toHaveBeenCalled()

      const request: IMessageExecuteCommandRequest = {
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        id: 'request-123',
        commandId: 'user.create',
        request: { name: 'John' },
      }

      channel.sendMessage(request)

      await vi.waitFor(() => {
        expect(messageHandler).toHaveBeenCalledTimes(1)
      })

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(messageHandler).toHaveBeenLastCalledWith(mockExecuteResponse)
    })

    it('should silently ignore network errors', async () => {
      const mockListResponse = createListCommandsResponse([])

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockListResponse),
          })
          .mockRejectedValueOnce(new Error('Network error')),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      // No commands in response, so no register.command.request messages
      expect(messageHandler).not.toHaveBeenCalled()

      channel.sendMessage({
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        id: 'request-123',
        commandId: 'user.create',
      })

      // Wait a bit for the async error to be handled
      await new Promise((resolve) => setTimeout(resolve, 50))

      // No messages should have been emitted (network error was silently ignored)
      expect(messageHandler).not.toHaveBeenCalled()
    })

    it('should not send after close()', async () => {
      const mockListResponse = createListCommandsResponse([])

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockListResponse),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      await channel.start()
      await channel.close()

      channel.sendMessage({ id: crypto.randomUUID(), type: MessageType.LIST_COMMANDS_REQUEST })
      expect(fetch).toHaveBeenCalledTimes(1) // Only the start() call
    })
  })

  describe('Server Mode', () => {
    it('should trigger on("message") when handleMessage() is called', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      const request = {
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        id: 'request-123',
        commandId: 'user.create',
        request: { name: 'John' },
      } as const

      const responsePromise = channel.handleMessage(request)

      expect(messageHandler).toHaveBeenCalledWith(request)

      // Simulate registry sending response
      const id = crypto.randomUUID()
      channel.sendMessage({
        id,
        type: MessageType.EXECUTE_COMMAND_RESPONSE,
        thid: 'request-123',
        response: { ok: true, result: { id: 'user-456' } },
      })

      const response = await responsePromise
      expect(response).toEqual({
        id,
        type: MessageType.EXECUTE_COMMAND_RESPONSE,
        thid: 'request-123',
        response: { ok: true, result: { id: 'user-456' } },
      })
    })

    it('should handle list.commands.request in server mode', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      const request = {
        type: MessageType.LIST_COMMANDS_REQUEST,
        id: 'list-123',
      } as const

      const responsePromise = channel.handleMessage(request)

      expect(messageHandler).toHaveBeenCalledWith(request)

      const id = crypto.randomUUID()
      channel.sendMessage({
        id,
        type: MessageType.LIST_COMMANDS_RESPONSE,
        thid: 'list-123',
        commands: [{ id: 'user.create' }],
      })

      const response = await responsePromise
      expect(response).toEqual({
        id,
        type: MessageType.LIST_COMMANDS_RESPONSE,
        thid: 'list-123',
        commands: [{ id: 'user.create' }],
      })
    })

    it('should throw when handleMessage() is called in client mode', async () => {
      const mockListResponse = createListCommandsResponse([])

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockListResponse),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      await channel.start()

      await expect(
        channel.handleMessage({ type: MessageType.LIST_COMMANDS_REQUEST, id: 'list-123' }),
      ).rejects.toThrow('handleMessage() can only be used in server mode')
    })

    it('should throw when closed', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      await channel.start()
      await channel.close()

      await expect(
        channel.handleMessage({
          type: MessageType.EXECUTE_COMMAND_REQUEST,
          id: 'request-123',
          commandId: 'user.create',
        }),
      ).rejects.toThrow('Channel is closed')
    })

    it('should throw InvalidMessageError for invalid message schema', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      await channel.start()

      // Test null message
      await expect(channel.handleMessage(null)).rejects.toThrow(InvalidMessageError)

      // Test non-object message
      await expect(channel.handleMessage('not an object')).rejects.toThrow(InvalidMessageError)

      // Test message without id
      await expect(
        channel.handleMessage({ type: MessageType.EXECUTE_COMMAND_REQUEST }),
      ).rejects.toThrow(InvalidMessageError)

      // Test message without type
      await expect(channel.handleMessage({ id: 'test-123' })).rejects.toThrow(InvalidMessageError)
    })

    it('should throw error for forbidden message types', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      // Forbidden message types should throw an error
      await expect(
        channel.handleMessage({
          type: MessageType.REGISTER_COMMAND_REQUEST,
          id: 'register-123',
          command: { id: 'malicious.cmd' },
        }),
      ).rejects.toThrow(`Message type ${MessageType.REGISTER_COMMAND_REQUEST} is not allowed`)

      await expect(
        channel.handleMessage({
          type: MessageType.REGISTER_COMMAND_RESPONSE,
          id: 'register-123',
          thid: 'some-thid',
          response: { ok: true },
        }),
      ).rejects.toThrow(`Message type ${MessageType.REGISTER_COMMAND_RESPONSE} is not allowed`)

      await expect(
        channel.handleMessage({
          type: MessageType.EVENT,
          id: 'event-123',
          eventId: 'user.updated',
          payload: { userId: '456' },
        }),
      ).rejects.toThrow(`Message type ${MessageType.EVENT} is not allowed`)

      // Message handler should not have been called for any forbidden messages
      expect(messageHandler).not.toHaveBeenCalled()
    })

    it('should timeout pending requests to prevent memory leaks', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
        timeout: 50, // Very short timeout for testing
      })

      await channel.start()

      const request = {
        type: MessageType.EXECUTE_COMMAND_REQUEST,
        id: 'request-123',
        commandId: 'user.create',
      } as const

      // Don't send a response - let it timeout
      await expect(channel.handleMessage(request)).rejects.toThrow(
        'Request request-123 timed out after 50ms',
      )
    })
  })

  describe('Middleware', () => {
    it('should call middleware in order and allow modifying headers', async () => {
      const mockListResponse = createListCommandsResponse([])

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockListResponse),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      const callOrder: string[] = []

      // Add first middleware - adds auth header
      channel.use(async (ctx, next) => {
        callOrder.push('middleware1-before')
        ctx.headers.set('Authorization', 'Bearer token123')
        const result = await next()
        callOrder.push('middleware1-after')
        return result
      })

      // Add second middleware - adds custom header
      channel.use(async (ctx, next) => {
        callOrder.push('middleware2-before')
        ctx.headers.set('X-Custom-Header', 'custom-value')
        const result = await next()
        callOrder.push('middleware2-after')
        return result
      })

      await channel.start()

      // Verify middleware was called in order
      expect(callOrder).toEqual([
        'middleware1-before',
        'middleware2-before',
        'middleware2-after',
        'middleware1-after',
      ])

      // Verify headers were set
      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Headers
      expect(headers.get('Authorization')).toBe('Bearer token123')
      expect(headers.get('X-Custom-Header')).toBe('custom-value')
      expect(headers.get('Content-Type')).toBe('application/json')
    })

    it('should allow middleware to modify the response', async () => {
      const mockListResponse = createListCommandsResponse([{ id: 'test.cmd' }])

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockListResponse),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      // Middleware that wraps the response
      channel.use(async (_ctx, next) => {
        const result = await next()
        // Modify the response
        if (result.type === MessageType.LIST_COMMANDS_RESPONSE) {
          result.commands = result.commands.map((cmd) => ({ ...cmd, id: `modified.${cmd.id}` }))
          return result
        }
        return result
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      // The command ID should be modified by middleware
      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({ id: 'modified.test.cmd' }),
        }),
      )
    })

    it('should allow middleware to abort the request by throwing', async () => {
      vi.stubGlobal('fetch', vi.fn())

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      channel.use(async () => {
        throw new Error('Request aborted by middleware')
      })

      await expect(channel.start()).rejects.toThrow('Request aborted by middleware')
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('Lifecycle', () => {
    it('should only start once and not start after close', async () => {
      const mockListResponse = createListCommandsResponse([])

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockListResponse),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      // First start should fetch
      await channel.start()
      expect(fetch).toHaveBeenCalledTimes(1)

      // Second start should be no-op
      await channel.start()
      expect(fetch).toHaveBeenCalledTimes(1)

      // Close and try to start again
      await channel.close()
      await channel.start()
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('should only close once and notify listeners', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      const closeHandler = vi.fn()
      channel.on('close', closeHandler)

      await channel.start()
      await channel.close()
      await channel.close()

      expect(closeHandler).toHaveBeenCalledTimes(1)
    })
  })
})
