import * as v from 'valibot'

import { MessagePortChannel } from '../channels'
import type { CommandSchemaMap, EventSchemaMap } from '../schemas'
import { TestLogger } from '../testing/utils/index'
import { CommandRegistry } from './command-registry'

/**
 * Mock Channel IDs
 */
enum ChannelIDs {
  MAIN = 'main',
  APP = 'app',
  WORKER = 'worker',
  CHILD = 'child',
  NEW = 'new',
}

/**
 * Typed Commands Schema for the new process
 */
const TypedCommandsSchema = {
  'worker.test.command': {
    request: v.object({ test: v.string() }),
    response: v.object({ test: v.string() }),
  },
  'main.test.command': {
    request: v.object({ test: v.string() }),
    response: v.object({ test: v.string() }),
  },
  'typed.command': {
    request: v.object({ message: v.string(), count: v.number() }),
    response: v.object({ success: v.boolean(), result: v.string() }),
  },
  'no.payload.command': {
    response: v.object({ status: v.literal('ok') }),
  },
} as const satisfies CommandSchemaMap

/**
 * Typed Events Schema for the new process
 */
const TypedEventsSchema = {
  'test.event': v.object({ test: v.string() }),
  'typed.event': v.object({ value: v.number(), message: v.string() }),
  'simple.event': v.void(),
} as const satisfies EventSchemaMap

describe('CommandRegistry', () => {
  // Setup 4 processes with MessageChannels
  const mainProcess = new CommandRegistry({
    id: ChannelIDs.MAIN,
    logger: TestLogger,
  })
  const workerProcess = new CommandRegistry({
    id: ChannelIDs.WORKER,
    logger: TestLogger,
    routerChannel: ChannelIDs.MAIN,
  })
  const appProcess = new CommandRegistry({
    id: ChannelIDs.APP,
    logger: TestLogger,
    routerChannel: ChannelIDs.MAIN,
  })
  // Child process is only connect to main 'router' process so all
  // other processes calling it will need to route through main
  const childProcess = new CommandRegistry({
    id: ChannelIDs.CHILD,
    logger: TestLogger,
    routerChannel: ChannelIDs.MAIN,
  })
  // New process is not connected to any other processes
  // until later in tests to simulate a new process being setup
  // after initial setup or one of the other processes being restarted
  // This process uses TYPED commands and events for type safety via schemas
  const newProcess = new CommandRegistry({
    id: ChannelIDs.NEW,
    logger: TestLogger,
    routerChannel: ChannelIDs.MAIN,
    schemas: {
      commands: TypedCommandsSchema,
      events: TypedEventsSchema,
    },
  })

  // Setup the channels between the processes
  // Main channel connects to all processes as router
  const { port1: workerMainPort1, port2: workerMainPort2 } = new MessageChannel()
  mainProcess.registerChannel(new MessagePortChannel(ChannelIDs.WORKER, workerMainPort1))
  workerProcess.registerChannel(new MessagePortChannel(ChannelIDs.MAIN, workerMainPort2))
  const { port1: appMainPort1, port2: appMainPort2 } = new MessageChannel()
  mainProcess.registerChannel(new MessagePortChannel(ChannelIDs.APP, appMainPort1))
  appProcess.registerChannel(new MessagePortChannel(ChannelIDs.MAIN, appMainPort2))
  const { port1: childMainPort1, port2: childMainPort2 } = new MessageChannel()
  mainProcess.registerChannel(new MessagePortChannel(ChannelIDs.CHILD, childMainPort1))
  childProcess.registerChannel(new MessagePortChannel(ChannelIDs.MAIN, childMainPort2))

  // Connect the worker to all other processes for direct connection
  const { port1: workerAppPort1, port2: workerAppPort2 } = new MessageChannel()
  workerProcess.registerChannel(new MessagePortChannel(ChannelIDs.APP, workerAppPort1))
  appProcess.registerChannel(new MessagePortChannel(ChannelIDs.WORKER, workerAppPort2))
  const { port1: workerChildPort1, port2: workerChildPort2 } = new MessageChannel()
  workerProcess.registerChannel(new MessagePortChannel(ChannelIDs.CHILD, workerChildPort1))
  childProcess.registerChannel(new MessagePortChannel(ChannelIDs.WORKER, workerChildPort2))

  it('should register and execute a command in MAIN', async () => {
    const mockFn = vi.fn(async (payload) => payload)
    await mainProcess.registerCommand('main.test.command', mockFn)
    const localResult = await mainProcess.executeCommand('main.test.command', {
      test: 'payload',
    })
    expect(mockFn).toBeCalledTimes(1) // Ensure the function was called
    expect(localResult.test).toBe('payload')

    // Try calling from another process remotely
    const remoteResult = await workerProcess.executeCommand('main.test.command', {
      test: 'payload',
    })
    expect(mockFn).toBeCalledTimes(2) // Ensure the function was called
    expect(remoteResult.test).toBe('payload')
  })

  it('should register and execute a command in WORKER', async () => {
    const mockFn = vi.fn(async (payload) => payload)
    await workerProcess.registerCommand('worker.test.command', mockFn)
    const localResult = await workerProcess.executeCommand('worker.test.command', {
      test: 'payload',
    })
    expect(mockFn).toBeCalledTimes(1) // Ensure the function was called
    expect(localResult.test).toBe('payload')

    // Try calling from MAIN
    const remoteResult = await mainProcess.executeCommand('worker.test.command', {
      test: 'payload',
    })
    expect(mockFn).toBeCalledTimes(2) // Ensure the function was called
    expect(remoteResult.test).toBe('payload')
  })

  it('should register and execute a command in APP and route from CHILD', async () => {
    const mockFn = vi.fn(async (payload) => payload)
    await appProcess.registerCommand('app.test.command', mockFn)
    const localResult = await appProcess.executeCommand('app.test.command', {
      test: 'payload',
    })
    expect(mockFn).toBeCalledTimes(1) // Ensure the function was called
    expect(localResult.test).toBe('payload')

    // Try calling from child process which isn't connected to app so should route through main
    const remoteResult = await childProcess.executeCommand('app.test.command', {
      test: 'payload',
    })
    expect(mockFn).toBeCalledTimes(2) // Ensure the function was called
    expect(remoteResult.test).toBe('payload')
  })

  it('private commands should not be accessible from other processes', async () => {
    const mockFn = vi.fn(async (payload) => payload)
    await appProcess.registerCommand('_app.test.command', mockFn)
    const localResult = await appProcess.executeCommand('_app.test.command', {
      test: 'payload',
    })
    expect(mockFn).toBeCalledTimes(1) // Ensure the function was called
    expect(localResult.test).toBe('payload')

    // Try calling from main process to ensure it's not accessible
    await expect(
      mainProcess.executeCommand('_app.test.command', {
        test: 'payload',
      }),
    ).rejects.toThrow('Command "_app.test.command" not found')
  })

  it('emits an event to all processes only once', async () => {
    const eventId = 'test.event'
    const mainMockFn = vi.fn()
    mainProcess.addEventListener(eventId, mainMockFn)
    const workerMockFn = vi.fn()
    workerProcess.addEventListener(eventId, workerMockFn)
    const appMockFn = vi.fn()
    appProcess.addEventListener(eventId, appMockFn)
    const childMockFn = vi.fn()
    childProcess.addEventListener(eventId, childMockFn)

    // Emit an event from child process
    childProcess.emitEvent(eventId, { test: 'payload' })

    // Give time for messages to be sent
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(mainMockFn).toBeCalledTimes(1)
    expect(workerMockFn).toBeCalledTimes(1)
    expect(appMockFn).toBeCalledTimes(1)
    expect(childMockFn).toBeCalledTimes(1)
  })

  it('a new process should be setup correctly', async () => {
    // Setup the channel between the new process and main
    const { port1: newMainPort1, port2: newMainPort2 } = new MessageChannel()
    mainProcess.registerChannel(new MessagePortChannel(ChannelIDs.NEW, newMainPort1))
    newProcess.registerChannel(new MessagePortChannel(ChannelIDs.MAIN, newMainPort2))
    // Setup the channel between the new process and worker
    const { port1: newWorkerPort1, port2: newWorkerPort2 } = new MessageChannel()
    newProcess.registerChannel(new MessagePortChannel(ChannelIDs.WORKER, newWorkerPort1))
    workerProcess.registerChannel(new MessagePortChannel(ChannelIDs.NEW, newWorkerPort2))

    // Give time for messages to be sent
    await new Promise((resolve) => setTimeout(resolve, 300))

    const commands: string[] = newProcess.listCommands().map((cmd) => cmd.id)
    expect(commands).toHaveLength(2)
    expect(commands).toContain('main.test.command')
    expect(commands).toContain('worker.test.command')

    // Test 1: Call existing commands with type safety
    const remoteResult = await newProcess.executeCommand('worker.test.command', {
      test: 'payload',
    })
    expect(remoteResult.test).toBe('payload')

    // Test 2: Register a typed command with specific payload/response types
    const typedCommandMock = vi.fn(async (req: { message: string; count: number }) => ({
      success: true,
      result: `${req.message} - ${req.count}`,
    }))
    await newProcess.registerCommand('typed.command', typedCommandMock)

    // Execute the typed command with correct payload
    const typedResult = await newProcess.executeCommand('typed.command', {
      message: 'hello',
      count: 42,
    })
    expect(typedResult.success).toBe(true)
    expect(typedResult.result).toBe('hello - 42')

    // Test 3: Register and execute command with void request
    const noPayloadMock = vi.fn(async () => ({ status: 'ok' as const }))
    await newProcess.registerCommand('no.payload.command', noPayloadMock)

    // Execute without payload (void request)
    const noPayloadResult = await newProcess.executeCommand('no.payload.command')
    expect(noPayloadResult.status).toBe('ok')

    // Test 4: Test typed events
    const typedEventMock = vi.fn()
    newProcess.addEventListener('typed.event', typedEventMock)

    // Emit typed event from untyped process
    mainProcess.emitEvent('typed.event', { value: 123, message: 'test' })

    // Give time for event to propagate
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(typedEventMock).toHaveBeenCalledTimes(1)
    expect(typedEventMock).toHaveBeenCalledWith({ value: 123, message: 'test' })

    // Test 5: Emit event from typed process
    const simpleEventMock = vi.fn()
    mainProcess.addEventListener('simple.event', simpleEventMock)

    // Emit void event (no payload required)
    newProcess.emitEvent('simple.event')

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(simpleEventMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * Test multi-level tree routing (grandchild processes) with peer connections
 *
 * Tree structure (routerChannel relationships):
 *   MAIN (root)
 *   ├── SANDBOX (routerChannel: main)
 *   │   └── SUB_WORKER (routerChannel: sandbox)
 *   ├── WORKER_2 (routerChannel: main)
 *   └── WORKER3 (routerChannel: main)
 *
 * Additional peer connection:
 *   SANDBOX <──────> WORKER3 (direct link for high-throughput)
 *
 * WORKER3 is a direct child of MAIN (routes through main) but also has
 * a direct peer connection to SANDBOX for faster communication.
 */
describe('CommandRegistry Multi-Level Tree', () => {
  // Setup tree with peer connections
  const mainRegistry = new CommandRegistry({
    id: 'main',
    logger: TestLogger,
  })
  const sandboxRegistry = new CommandRegistry({
    id: 'sandbox',
    logger: TestLogger,
    routerChannel: 'main',
  })
  const subWorkerRegistry = new CommandRegistry({
    id: 'sub-worker',
    logger: TestLogger,
    routerChannel: 'sandbox',
  })
  const worker2Registry = new CommandRegistry({
    id: 'worker2',
    logger: TestLogger,
    routerChannel: 'main',
  })
  // Worker3 routes through main but has direct peer connection to sandbox
  const worker3Registry = new CommandRegistry({
    id: 'worker3',
    logger: TestLogger,
    routerChannel: 'main',
  })

  // Connect main <-> sandbox
  const { port1: mainSandboxPort1, port2: mainSandboxPort2 } = new MessageChannel()
  mainRegistry.registerChannel(new MessagePortChannel('sandbox', mainSandboxPort1))
  sandboxRegistry.registerChannel(new MessagePortChannel('main', mainSandboxPort2))

  // Connect sandbox <-> sub-worker
  const { port1: sandboxSubPort1, port2: sandboxSubPort2 } = new MessageChannel()
  sandboxRegistry.registerChannel(new MessagePortChannel('sub-worker', sandboxSubPort1))
  subWorkerRegistry.registerChannel(new MessagePortChannel('sandbox', sandboxSubPort2))

  // Connect main <-> worker2
  const { port1: mainWorker2Port1, port2: mainWorker2Port2 } = new MessageChannel()
  mainRegistry.registerChannel(new MessagePortChannel('worker2', mainWorker2Port1))
  worker2Registry.registerChannel(new MessagePortChannel('main', mainWorker2Port2))

  // Connect main <-> worker3
  const { port1: mainWorker3Port1, port2: mainWorker3Port2 } = new MessageChannel()
  mainRegistry.registerChannel(new MessagePortChannel('worker3', mainWorker3Port1))
  worker3Registry.registerChannel(new MessagePortChannel('main', mainWorker3Port2))

  // Direct peer connection: sandbox <-> worker3 (for high-throughput)
  const { port1: sandboxWorker3Port1, port2: sandboxWorker3Port2 } = new MessageChannel()
  sandboxRegistry.registerChannel(new MessagePortChannel('worker3', sandboxWorker3Port1))
  worker3Registry.registerChannel(new MessagePortChannel('sandbox', sandboxWorker3Port2))

  it('grandchild command should be registered up to root', async () => {
    const mockFn = vi.fn(async (payload: { value: number }) => ({ result: payload.value * 2 }))
    await subWorkerRegistry.registerCommand('sub.double', mockFn)

    // No timeout needed - registerCommand awaits confirmation from root

    // Command should be in sub-worker's local registry
    const subWorkerCommands = subWorkerRegistry.listCommands().map((c) => c.id)
    expect(subWorkerCommands).toContain('sub.double')

    // Command should be registered in sandbox (next hop)
    const sandboxCommands = sandboxRegistry.listCommands().map((c) => c.id)
    expect(sandboxCommands).toContain('sub.double')

    // Command should be registered in main (root)
    const mainCommands = mainRegistry.listCommands().map((c) => c.id)
    expect(mainCommands).toContain('sub.double')
  })

  it('root should execute command on grandchild (2-hop routing)', async () => {
    const result = await mainRegistry.executeCommand('sub.double', { value: 21 })
    expect(result).toEqual({ result: 42 })
  })

  it('sibling branch should execute command on grandchild through root', async () => {
    // worker2 -> main -> sandbox -> sub-worker
    const result = await worker2Registry.executeCommand('sub.double', { value: 10 })
    expect(result).toEqual({ result: 20 })
  })

  it('grandchild should execute command on sibling branch through parent chain', async () => {
    // Register command on worker2
    const mockFn = vi.fn(async () => ({ status: 'ok' }))
    await worker2Registry.registerCommand('worker2.status', mockFn)

    // sub-worker -> sandbox -> main -> worker2
    const result = await subWorkerRegistry.executeCommand('worker2.status')
    expect(result).toEqual({ status: 'ok' })
    expect(mockFn).toHaveBeenCalledTimes(1)
  })

  it('duplicate command registration should fail across tree', async () => {
    // Try to register the same command from worker2
    await expect(
      worker2Registry.registerCommand('sub.double', async () => ({ result: 0 })),
    ).rejects.toThrow()
  })

  it('events should propagate through multi-level tree with peer connections', async () => {
    const eventId = 'tree.event'
    const mainMock = vi.fn()
    const sandboxMock = vi.fn()
    const subWorkerMock = vi.fn()
    const worker2Mock = vi.fn()
    const worker3Mock = vi.fn()

    mainRegistry.addEventListener(eventId, mainMock)
    sandboxRegistry.addEventListener(eventId, sandboxMock)
    subWorkerRegistry.addEventListener(eventId, subWorkerMock)
    worker2Registry.addEventListener(eventId, worker2Mock)
    worker3Registry.addEventListener(eventId, worker3Mock)

    // Emit from grandchild
    subWorkerRegistry.emitEvent(eventId, { source: 'sub-worker' })

    // Give time for event propagation
    await new Promise((resolve) => setTimeout(resolve, 100))

    // All processes should receive the event exactly once (deduplication works)
    expect(mainMock).toHaveBeenCalledTimes(1)
    expect(sandboxMock).toHaveBeenCalledTimes(1)
    expect(subWorkerMock).toHaveBeenCalledTimes(1)
    expect(worker2Mock).toHaveBeenCalledTimes(1)
    expect(worker3Mock).toHaveBeenCalledTimes(1)

    // Verify payload
    expect(mainMock).toHaveBeenCalledWith({ source: 'sub-worker' })
  })

  it('worker3 can execute grandchild command via direct peer connection', async () => {
    // worker3 is directly connected to sandbox, which knows about sub.double
    // So worker3 should route: worker3 -> sandbox -> sub-worker (not via main)
    const result = await worker3Registry.executeCommand('sub.double', { value: 5 })
    expect(result).toEqual({ result: 10 })
  })

  it('worker3 can register command and grandchild can execute it', async () => {
    const mockFn = vi.fn(async (payload: { msg: string }) => ({ echo: payload.msg }))
    await worker3Registry.registerCommand('worker3.echo', mockFn)

    // sub-worker -> sandbox -> main -> worker3
    const result = await subWorkerRegistry.executeCommand('worker3.echo', { msg: 'hello' })
    expect(result).toEqual({ echo: 'hello' })
    expect(mockFn).toHaveBeenCalledTimes(1)
  })

  it('events from worker3 reach all processes exactly once', async () => {
    const eventId = 'worker3.event'
    const mainMock = vi.fn()
    const sandboxMock = vi.fn()
    const subWorkerMock = vi.fn()
    const worker2Mock = vi.fn()
    const worker3Mock = vi.fn()

    mainRegistry.addEventListener(eventId, mainMock)
    sandboxRegistry.addEventListener(eventId, sandboxMock)
    subWorkerRegistry.addEventListener(eventId, subWorkerMock)
    worker2Registry.addEventListener(eventId, worker2Mock)
    worker3Registry.addEventListener(eventId, worker3Mock)

    // Emit from worker3 (which has both main and sandbox connections)
    worker3Registry.emitEvent(eventId, { from: 'worker3' })

    // Give time for event propagation
    await new Promise((resolve) => setTimeout(resolve, 100))

    // All processes should receive the event exactly once despite worker3
    // sending to both main and sandbox (deduplication handles this)
    expect(mainMock).toHaveBeenCalledTimes(1)
    expect(sandboxMock).toHaveBeenCalledTimes(1)
    expect(subWorkerMock).toHaveBeenCalledTimes(1)
    expect(worker2Mock).toHaveBeenCalledTimes(1)
    expect(worker3Mock).toHaveBeenCalledTimes(1)
  })

  it('should handle command not found at root', async () => {
    await expect(mainRegistry.executeCommand('nonexistent.command')).rejects.toThrow(
      'Command "nonexistent.command" not found',
    )
  })

  it('should handle command not found and escalate from grandchild', async () => {
    await expect(subWorkerRegistry.executeCommand('nonexistent.command')).rejects.toThrow(
      'Command "nonexistent.command" not found',
    )
  })
})
