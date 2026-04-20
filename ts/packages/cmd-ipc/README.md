# @coralstack/cmd-ipc

A type-safe Inter-Process Communication (IPC) library for running commands across multiple processes and services.

**[Full Documentation](https://coralstack.com/cmd-ipc/)**

## Features

- **Command Registry** - Central hub for registering and executing commands with automatic routing across processes
- **Type Safety** - Strict mode with full TypeScript inference via Valibot schemas, or flexible loose mode
- **Channel Architecture** - Pluggable communication channels (MessagePort, HTTP, WebSocket, etc.)
- **@Command Decorator** - Register class methods as commands with decorators
- **Event System** - Broadcast events across processes with optional schema validation
- **Multi-Process Routing** - Hybrid Tree-Mesh architecture with automatic command escalation

## Installation

```bash
npm install @coralstack/cmd-ipc
```

## Quick Start

```typescript
import { CommandRegistry } from '@coralstack/cmd-ipc'

const registry = new CommandRegistry()

// Register a command
await registry.registerCommand('hello.world', async ({ name }) => {
  return { message: `Hello ${name}` }
})

// Execute the command
const response = await registry.executeCommand('hello.world', { name: 'World' })
console.log(response.message) // "Hello World"
```

### With Schemas (Strict Mode)

```typescript
import { CommandRegistry, type CommandSchemaMap } from '@coralstack/cmd-ipc'
import * as v from 'valibot'

const commandSchemaMap = {
  'math.add': {
    request: v.object({ a: v.number(), b: v.number() }),
    response: v.number(),
  },
} satisfies CommandSchemaMap

const registry = new CommandRegistry({ commandSchemaMap })

const result = await registry.executeCommand('math.add', { a: 1, b: 2 })
// result is typed as number
```

### With Decorators

```typescript
import { Command, registerCommands, CommandRegistry } from '@coralstack/cmd-ipc'

class MathCommands {
  @Command('math.add')
  add({ a, b }: { a: number; b: number }): number {
    return a + b
  }
}

const registry = new CommandRegistry()
registerCommands([new MathCommands()], registry)
```

### Multi-Process Communication

```typescript
import { CommandRegistry, MessagePortChannel } from '@coralstack/cmd-ipc'

// Main process
const mainRegistry = new CommandRegistry({ id: 'main' })
const { port1, port2 } = new MessageChannel()
const channel = new MessagePortChannel('worker', port1)
mainRegistry.registerChannel(channel)

// Worker process (routes unknown commands to main)
const workerRegistry = new CommandRegistry({
  id: 'worker',
  routerChannel: 'main',
})
```

## Exports

| Export                        | Description                                          |
| ----------------------------- | ---------------------------------------------------- |
| `@coralstack/cmd-ipc`         | Core library - registry, channels, commands, schemas |
| `@coralstack/cmd-ipc/testing` | Test utilities including `TestLogger`                |

## Development

```bash
yarn build       # Build with tsup (ESM + CJS)
yarn typecheck   # TypeScript type checking
yarn test        # Run tests
```

## License

MIT
