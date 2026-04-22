# @coralstack/cmd-ipc-mcp

MCP ([Model Context Protocol](https://modelcontextprotocol.io/)) channel implementation for `@coralstack/cmd-ipc`. Bridges MCP servers and clients with the Command IPC registry.

**[Full Documentation](https://coralstack.com/cmd-ipc/)**

## Features

- **MCPClientChannel** - Connect to any MCP server and expose its tools as commands in your registry
- **MCPServerChannel** - Expose your registry's commands as MCP tools to AI agents and other MCP clients
- **Built on the Official SDK** - Uses `@modelcontextprotocol/sdk` for protocol handling, transport, and authentication
- **Any Transport** - Works with Streamable HTTP, stdio, WebSocket, SSE, or custom transports

## Installation

```bash
npm install @coralstack/cmd-ipc @coralstack/cmd-ipc-mcp
```

## Usage

### Connect to an MCP Server (Client)

```typescript
import { CommandRegistry } from '@coralstack/cmd-ipc'
import { MCPClientChannel } from '@coralstack/cmd-ipc-mcp'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const registry = new CommandRegistry()

const transport = new StreamableHTTPClientTransport(new URL('https://my-mcp-server.com/mcp'))

const channel = new MCPClientChannel({
  id: 'my-server',
  transport,
  commandPrefix: 'my-server', // Commands registered as "my-server.toolName"
})

registry.registerChannel(channel)
await channel.start()

// MCP tools are now available as commands
const result = await registry.executeCommand('my-server.search', { query: 'hello' })
```

### Expose Commands as MCP Tools (Server)

```typescript
import { CommandRegistry } from '@coralstack/cmd-ipc'
import { MCPServerChannel } from '@coralstack/cmd-ipc-mcp'

const registry = new CommandRegistry()

await registry.registerCommand('math.add', async ({ a, b }) => {
  return { result: a + b }
})

const channel = new MCPServerChannel({
  id: 'my-mcp-server',
  serverInfo: { name: 'My MCP Server', version: '1.0.0' },
})

registry.registerChannel(channel)

// Connect a transport (e.g., from an HTTP framework)
await channel.connectTransport(transport)
```

## API

### MCPClientChannel

Connects to an MCP server and registers its tools as commands.

```typescript
interface MCPClientChannelConfig {
  id: string // Channel identifier
  transport: Transport // SDK transport instance
  commandPrefix?: string // Prefix for registered command IDs
  timeout?: number // Request timeout in ms
  clientInfo?: Implementation // Client name/version sent to server
}
```

### MCPServerChannel

Exposes registry commands as MCP tools to connected clients.

```typescript
interface MCPServerChannelConfig {
  id: string // Channel identifier
  transport: Transport // SDK transport instance
  serverInfo?: Implementation // Server name/version
  instructions?: string // Server instructions for clients
  timeout?: number // Request timeout in ms
}
```

## Development

```bash
yarn build       # Build with tsup (ESM + CJS)
yarn typecheck   # TypeScript type checking
yarn test        # Run tests
```

## License

MIT
