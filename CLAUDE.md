# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Command IPC is an Inter-Process Communication (IPC) library for running typed Commands across multiple processes and services. Primary use cases include multi-process applications (Electron.js, Node.js fork, Web Workers), plugin/extension frameworks, MCP tool exposure to AI agents, and cloud-seamless applications.

## Build & Development Commands

```bash
yarn                    # Install dependencies
yarn build              # Build with tsup (ESM + CJS outputs)
yarn typecheck          # TypeScript type checking
yarn test               # Run vitest tests
yarn test:run           # One-time test run (no watch)
yarn test:ui            # Vitest UI
yarn format             # Format + lint fix
yarn lint               # ESLint
yarn prettify           # Prettier only
```

**Examples:**

```bash
yarn start:examples-electron       # Run Electron example
yarn start:examples-web-workers    # Run Web Workers example
yarn start:examples-agent-mcp      # Run Agent MCP example
```

## Architecture

### Core Components

1. **CommandRegistry** (`src/registry/command-registry.ts`) - Central hub managing commands and channels. Handles routing, message dispatching, and event broadcasting. Supports **Loose Mode** (flexible, any command) and **Strict Mode** (schema-validated with full TypeScript type safety). Uses a Hybrid Tree-Mesh architecture with optional `routerChannel` for command escalation.

2. **ICommandChannel** (`src/channels/command-channel-interface.ts`) - Abstract interface for any communication channel (MessagePort, WebSocket, etc.).

3. **MessagePortChannel** (`src/channels/message-port-channel.ts`) - Concrete implementation using Web MessagePort API for worker_threads, Web Workers, and MessageChannel.

4. **@Command Decorator** (`src/commands/command-decorator.ts`) - Decorator to register class methods as commands. Use `registerCommands()` for batch registration.

5. **Schema System** (`src/schemas/`) - Uses Valibot for runtime validation and JSON Schema generation. `CommandSchemaMap` maps command IDs to request/response schemas; `EventSchemaMap` maps event IDs to payload schemas.

6. **TTLMap** (`src/utils/ttl-map.ts`) - Generic Map with TTL-based cleanup for request handlers, event deduplication, and route handlers.

### Message Protocol

Seven message types defined in `MessageType` enum (`src/registry/command-messages-types.ts`):

- `register.command.request` / `register.command.response` - Register commands from other processes
- `list.commands.request` / `list.commands.response` - Query available commands
- `execute.command.request` / `execute.command.response` - Execute commands with request/response correlation via `thid` (thread ID)
- `event` - Broadcast events to clients

**Private commands/events** (prefixed with `_`) are not broadcast to other processes and stay local only.

### Type Safety Modes

- **Loose Mode**: Flexible, accepts any command ID and payload
- **Strict Mode**: Schema-validated with full TypeScript inference from defined schemas

## Key Patterns

### Defining Commands with Schemas

```typescript
const commandSchemaMap = {
  'math.add': {
    request: v.object({ a: v.number(), b: v.number() }),
    response: v.number(),
  },
} satisfies CommandSchemaMap
```

### Using @Command Decorator

```typescript
class MathCommands {
  @Command('math.add')
  add({ a, b }: { a: number; b: number }): number {
    return a + b
  }
}

registerCommands([new MathCommands()], registry)
```

### Creating a Channel

```typescript
const { port1, port2 } = new MessageChannel()
const channel = new MessagePortChannel('worker', port1)
registry.registerChannel(channel)
```

### Multi-Process Routing

```typescript
// Root process (no routerChannel)
const mainRegistry = new CommandRegistry({ id: 'main' })

// Child process (routes unknown commands to parent)
const workerRegistry = new CommandRegistry({
  id: 'worker',
  routerChannel: 'main',
})
```

## Project Structure

```
src/
├── channels/       # ICommandChannel interface and MessagePort implementation
├── commands/       # @Command decorator and registration utilities
├── registry/       # CommandRegistry core, message types, events
├── schemas/        # CommandSchemaMap, EventSchemaMap, Valibot utilities
├── utils/          # TTLMap and other utilities
└── testing/        # Test utilities including TestLogger
```

## Configuration Notes

- TypeScript uses `experimentalDecorators` and `emitDecoratorMetadata` for the @Command decorator
- tsup builds both ESM and CJS with source maps and declarations
- Yarn 4.6.0 workspaces with node-modules linker (not PnP)
- Node.js >= 20.18.2 required
