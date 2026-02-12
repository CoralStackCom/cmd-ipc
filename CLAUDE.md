# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Command IPC is an Inter-Process Communication (IPC) library for running typed Commands across multiple processes and services. Primary use cases include multi-process applications (Electron.js, Node.js fork, Web Workers), plugin/extension frameworks, MCP tool exposure to AI agents, and cloud-seamless applications.

This is a monorepo with two main packages:

- **`@coralstack/cmd-ipc`** (`packages/cmd-ipc/`) - Core IPC library
- **`@coralstack/cmd-ipc-mcp`** (`packages/cmd-ipc-mcp/`) - MCP (Model Context Protocol) channel implementation using the official `@modelcontextprotocol/sdk`

## Build & Development Commands

```bash
yarn                    # Install dependencies
yarn build              # Build all packages (topological order)
yarn typecheck          # TypeScript type checking for all workspaces
yarn typecheck:all      # Same as typecheck
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

### Core Components (`packages/cmd-ipc/`)

1. **CommandRegistry** (`src/registry/command-registry.ts`) - Central hub managing commands and channels. Handles routing, message dispatching, and event broadcasting. Supports **Loose Mode** (flexible, any command) and **Strict Mode** (schema-validated with full TypeScript type safety). Uses a Hybrid Tree-Mesh architecture with optional `routerChannel` for command escalation.

2. **ICommandChannel** (`src/channels/command-channel-interface.ts`) - Abstract interface for any communication channel (MessagePort, WebSocket, etc.).

3. **MessagePortChannel** (`src/channels/message-port/message-port-channel.ts`) - Concrete implementation using Web MessagePort API for worker_threads, Web Workers, and MessageChannel.

4. **HTTPChannel** (`src/channels/http/http-channel.ts`) - HTTP channel using streaming NDJSON for client/server communication.

5. **@Command Decorator** (`src/commands/command-decorator.ts`) - Decorator to register class methods as commands. Use `registerCommands()` for batch registration.

6. **Schema System** (`src/schemas/`) - Uses Valibot for runtime validation and JSON Schema generation. `CommandSchemaMap` maps command IDs to request/response schemas; `EventSchemaMap` maps event IDs to payload schemas.

7. **TTLMap** (`src/utils/ttl-map.ts`) - Generic Map with TTL-based cleanup for request handlers, event deduplication, and route handlers.

### MCP Components (`packages/cmd-ipc-mcp/`)

1. **MCPClientChannel** (`src/client/mcp-client-channel.ts`) - Connects to remote MCP servers, exposes their tools as cmd-ipc commands. Uses the official `@modelcontextprotocol/sdk` `Client`.

2. **MCPServerChannel** (`src/server/mcp-server-channel.ts`) - Exposes cmd-ipc commands as MCP tools. Uses the official `@modelcontextprotocol/sdk` `McpServer`.

### Message Protocol

Seven message types defined in `MessageType` enum (`packages/cmd-ipc/src/registry/command-message-schemas.ts`):

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
packages/
├── cmd-ipc/                    # Core IPC library (@coralstack/cmd-ipc)
│   └── src/
│       ├── channels/           # ICommandChannel interface, HTTP, MessagePort
│       ├── commands/           # @Command decorator and registration
│       ├── registry/           # CommandRegistry core, message types, events
│       ├── schemas/            # CommandSchemaMap, EventSchemaMap, Valibot utilities
│       ├── utils/              # TTLMap and other utilities
│       ├── cli/                # CLI tools (generate-schema)
│       └── testing/            # Test utilities including TestLogger
├── cmd-ipc-mcp/                # MCP channel library (@coralstack/cmd-ipc-mcp)
│   └── src/
│       ├── client/             # MCPClientChannel (connects to MCP servers)
│       └── server/             # MCPServerChannel (exposes commands as MCP tools)
examples/
├── agent-mcp/                  # AI agent with MCP server connections
├── web-workers/                # Web Workers example
├── electron/                   # Electron multi-process example
└── cf-worker/                  # Cloudflare Worker example
```

## Configuration Notes

- TypeScript uses `experimentalDecorators` and `emitDecoratorMetadata` for the @Command decorator
- tsup builds both ESM and CJS with source maps and declarations
- Yarn 4.6.0 workspaces with node-modules linker (not PnP)
- Node.js >= 20.18.2 required
- MCP package uses `@modelcontextprotocol/sdk` as a runtime dependency and `@coralstack/cmd-ipc` as a peer dependency
