import * as v from 'valibot'

import type { CommandSchemaMap, EventSchemaMap } from '../schemas'
import { TestLogger } from '../testing/utils/index'
import { CommandRegistry } from './command-registry'
import { CommandRegistryEventIds } from './command-registry-events'

/**
 * Valid Commands for strict typing tests
 */
const ValidCommandsSchema = {
  'typed.command': {
    request: v.object({
      message: v.string(),
      count: v.number(),
    }),
    response: v.object({
      success: v.boolean(),
      result: v.string(),
    }),
    description: 'A sample typed command',
  },
  'no.payload.command': {
    response: v.object({ status: v.literal('ok') }),
    description: 'A command with no payload',
  },
} as const satisfies CommandSchemaMap

/**
 * Valid Events for strict typing tests
 */
const ValidEventsSchema = {
  'typed.event': v.object({
    value: v.number(),
    message: v.string(),
  }),
  'simple.event': v.void(),
} as const satisfies EventSchemaMap

describe('CommandRegistry Type Safety', () => {
  describe('Strict Typing Mode', () => {
    it('should allow valid command definitions with request and response', () => {
      // This should compile without errors - types inferred from schemas
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          commands: ValidCommandsSchema,
          events: ValidEventsSchema,
        },
      })

      expect(registry).toBeDefined()
    })

    it('should enforce correct command names', async () => {
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          commands: ValidCommandsSchema,
        },
      })

      const mockFn = vi.fn(async (req: { message: string; count: number }) => ({
        success: true,
        result: `${req.message} - ${req.count}`,
      }))

      await registry.registerCommand('typed.command', mockFn)

      // ✅ Valid: correct command name
      const result = await registry.executeCommand('typed.command', {
        message: 'hello',
        count: 42,
      })

      expect(result.success).toBe(true)
      expect(result.result).toBe('hello - 42')

      // Note: The following would cause a TypeScript error:
      try {
        // @ts-expect-error - Invalid command name
        await registry.executeCommand('nonexistent.command', { message: 'test', count: 1 })
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
    })

    it('should enforce correct request payload structure', async () => {
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          commands: ValidCommandsSchema,
        },
      })

      const mockFn = vi.fn(async (req: { message: string; count: number }) => ({
        success: true,
        result: `${req.message} - ${req.count}`,
      }))

      await registry.registerCommand('typed.command', mockFn)

      // ✅ Valid: correct payload structure
      await registry.executeCommand('typed.command', {
        message: 'hello',
        count: 42,
      })

      expect(mockFn).toHaveBeenCalledWith({ message: 'hello', count: 42 })

      // Note: The following would cause TypeScript errors:
      try {
        // @ts-expect-error - has incorrect request type
        await registry.registerCommand('typed.command', ({ _badArg }) =>
          // @ts-expect-error - has incorrect response type
          Promise.resolve({ fail: true, result: 'ok' }),
        )
      } catch (e) {
        // Throws error as command already registered
        expect(e).toBeInstanceOf(Error)
      }
      // @ts-expect-error - missing 'count' property
      await registry.executeCommand('typed.command', { message: 'hello' })
      // @ts-expect-error - 'extra' property not defined in request type
      await registry.executeCommand('typed.command', { message: 'hello', count: 42, extra: true })
      // @ts-expect-error - wrong structure
      await registry.executeCommand('typed.command', { wrong: 'payload' })
    })

    it('should support void request types', async () => {
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          commands: ValidCommandsSchema,
        },
      })

      const mockFn = vi.fn(async () => ({ status: 'ok' as const }))
      await registry.registerCommand('no.payload.command', mockFn)

      // ✅ Valid: no payload required for void request
      const result = await registry.executeCommand('no.payload.command')

      // @ts-expect-error - payload not expected
      await registry.executeCommand('no.payload.command', { wrong: 'payload' })

      expect(result.status).toBe('ok')
    })

    it('should enforce correct event payload types', async () => {
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          commands: ValidCommandsSchema,
          events: ValidEventsSchema,
        },
      })

      const eventHandler = vi.fn()
      registry.addEventListener('typed.event', eventHandler)

      // ✅ Valid: correct event payload
      registry.emitEvent('typed.event', { value: 123, message: 'test' })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventHandler).toHaveBeenCalledWith({ value: 123, message: 'test' })

      // Check System Events have been merged correctly
      registry.emitEvent(CommandRegistryEventIds._NEW_CHANNEL_REGISTERED, { id: 'channel1' })

      // Note: The following would cause TypeScript errors:
      // @ts-expect-error - wrong payload structure
      registry.emitEvent(CommandRegistryEventIds._NEW_CHANNEL_REGISTERED)
      // @ts-expect-error - missing 'message' property
      registry.emitEvent('typed.event', { message: 'payload' })
      // @ts-expect-error - nonexistent event name
      registry.emitEvent('nonexistent.event', {})
    })

    it('should support void event payloads', async () => {
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          commands: ValidCommandsSchema,
          events: ValidEventsSchema,
        },
      })

      const eventHandler = vi.fn()
      registry.addEventListener('simple.event', eventHandler)

      // ✅ Valid: no payload required for void event
      registry.emitEvent('simple.event')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventHandler).toHaveBeenCalled()

      // @ts-expect-error - payload not expected
      registry.emitEvent('simple.event', { wrong: 'payload' })
    })
  })

  describe('Loose Typing Mode', () => {
    it('should allow any command name and payload when no schemas specified', async () => {
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
      })

      const mockFn = vi.fn(async (_payload: any) => ({ result: 'success' }))
      await registry.registerCommand('any.command.name', mockFn)

      // ✅ Valid: any command and payload allowed in loose mode
      await registry.executeCommand('any.command.name', { any: 'payload' })
      await registry.executeCommand('any.command.name', { different: 'structure' })
      await registry.executeCommand('any.command.name')

      expect(mockFn).toHaveBeenCalledTimes(3)
    })

    it('should allow any event name and payload when no schemas specified', async () => {
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
      })

      const eventHandler = vi.fn()
      registry.addEventListener('any.event', eventHandler)

      // ✅ Valid: any event and payload allowed in loose mode
      registry.emitEvent('any.event', { any: 'payload' })
      registry.emitEvent('another.event', { different: 'payload' })
      registry.emitEvent('no.payload.event')

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(eventHandler).toHaveBeenCalled()
    })
  })

  describe('Type Constraint Validation', () => {
    it('should accept valid command schemas with both request and response', () => {
      const validSchema = {
        'good.command': {
          request: v.object({ foo: v.string() }),
          response: v.object({ bar: v.number() }),
        },
      } as const satisfies CommandSchemaMap

      // ✅ Valid: This should compile without errors
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          commands: validSchema,
        },
      })

      expect(registry).toBeDefined()
    })

    it('should accept event schemas with various payload types', () => {
      const validEventSchema = {
        'object.event': v.object({ value: v.number() }),
        'string.event': v.string(),
        'number.event': v.number(),
        'void.event': v.void(),
      } as const satisfies EventSchemaMap

      // ✅ Valid: Various payload types are allowed
      const registry = new CommandRegistry({
        id: 'test',
        logger: TestLogger,
        schemas: {
          events: validEventSchema,
        },
      })

      expect(registry).toBeDefined()
    })
  })
})
