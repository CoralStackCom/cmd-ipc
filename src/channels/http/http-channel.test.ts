import type { IMessageExecuteCommandRequest } from '../../registry/command-messages-types'
import { MessageType } from '../../registry/command-messages-types'
import { HTTPChannel } from './http-channel'

describe('HTTPChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Client Mode', () => {
    it('should fetch commands on start() and emit register.command.request for each', async () => {
      const mockCommands = {
        type: MessageType.LIST_COMMANDS_RESPONSE,
        commands: [
          { id: 'user.create', description: 'Create a user' },
          { id: 'user.get', description: 'Get a user' },
        ],
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockCommands),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      const messageHandler = vi.fn()
      channel.on('message', messageHandler)

      await channel.start()

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/cmd',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      // Verify the body contains the correct type (id is dynamic UUID)
      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse(fetchCall[1]?.body as string)
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
      const mockCommands = {
        type: MessageType.LIST_COMMANDS_RESPONSE,
        commands: [
          { id: 'user.create', description: 'Create a user' },
          { id: 'user.get', description: 'Get a user' },
        ],
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockCommands),
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
      const mockListResponse = {
        type: MessageType.LIST_COMMANDS_RESPONSE,
        commands: [{ id: 'user.create' }],
      }

      const mockExecuteResponse = {
        type: MessageType.EXECUTE_COMMAND_RESPONSE,
        thid: 'request-123',
        response: { ok: true, result: { id: 'user-456' } },
      }

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
      const mockListResponse = {
        type: MessageType.LIST_COMMANDS_RESPONSE,
        commands: [],
      }

      const mockExecuteResponse = {
        type: MessageType.EXECUTE_COMMAND_RESPONSE,
        thid: 'request-123',
        response: { ok: true, result: { id: 'user-456' } },
      }

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
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ type: MessageType.LIST_COMMANDS_RESPONSE, commands: [] }),
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
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ type: MessageType.LIST_COMMANDS_RESPONSE, commands: [] }),
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
    it('should start immediately in server mode', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      await channel.start()
      // Should not throw
    })

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
      }

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
      }

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
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ type: MessageType.LIST_COMMANDS_RESPONSE, commands: [] }),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      await channel.start()

      await expect(channel.handleMessage({ type: 'test' })).rejects.toThrow(
        'handleMessage() can only be used in server mode',
      )
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
        }),
      ).rejects.toThrow('Channel is closed')
    })

    it('should notify close listeners on close()', async () => {
      const channel = new HTTPChannel({
        id: 'test-channel',
      })

      const closeHandler = vi.fn()
      channel.on('close', closeHandler)

      await channel.start()
      await channel.close()

      expect(closeHandler).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should not start twice', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ type: MessageType.LIST_COMMANDS_RESPONSE, commands: [] }),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      await channel.start()
      await channel.start()

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('should not close twice', async () => {
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

    it('should not start a closed channel', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ type: MessageType.LIST_COMMANDS_RESPONSE, commands: [] }),
        }),
      )

      const channel = new HTTPChannel({
        id: 'test-channel',
        baseUrl: 'https://api.example.com',
      })

      await channel.close()
      await channel.start()

      // Fetch should not be called since channel was closed
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
