# Command IPC

A type-safe Inter-Process Communication (IPC) library for running commands across multiple processes and services.

**[Full Documentation](https://coralstack.com/cmd-ipc/)**

## Overview

Command IPC allows you to register and execute commands across processes with automatic routing, type safety via Valibot schemas, and support for both local and remote execution.

**Use cases:**

- Multi-process applications (Electron.js, Node.js fork, Web Workers)
- Plugin/extension frameworks
- MCP tool exposure to AI agents
- Cloud-seamless applications

## Packages

| Package                                             | Description                                              |
| --------------------------------------------------- | -------------------------------------------------------- |
| [`@coralstack/cmd-ipc`](./packages/cmd-ipc)         | Core IPC library - registry, channels, commands, schemas |
| [`@coralstack/cmd-ipc-mcp`](./packages/cmd-ipc-mcp) | MCP channel - connect to and expose MCP servers          |

## Quick Start

```bash
npm install @coralstack/cmd-ipc
```

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

See the [Quick Start Guide](https://coralstack.com/cmd-ipc/getting-started/quick-start/) for more details.

## Examples

| Example                                                                           | Description                             | Run Command                       |
| --------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------- |
| [Web Workers](https://coralstack.com/cmd-ipc/examples/web-workers/)               | Background computation with Web Workers | `yarn start:examples-web-workers` |
| [Electron](https://coralstack.com/cmd-ipc/examples/electron/)                     | Multi-process Electron.js architecture  | `yarn start:examples-electron`    |
| [Cloudflare Workers](https://coralstack.com/cmd-ipc/examples/cloudflare-workers/) | HTTP-based commands at the edge         | `yarn start:examples-cf-worker`   |
| [AI Agent MCP](https://coralstack.com/cmd-ipc/examples/mcp-agent/)                | Expose commands as AI agent tools       | `yarn start:examples-agent-mcp`   |

## Development

### Prerequisites

- Node.js >= 20.18.2
- Yarn 4.6.0

### Setup

```bash
nvm use           # Use Node.js version from .nvmrc
yarn              # Install dependencies
yarn build        # Build library packages
```

### Testing

```bash
yarn test         # Run tests in watch mode
yarn test:run     # Run tests once
yarn test:ui      # Run tests with Vitest UI
```

### Publishing to NPM

A GitHub action publishes both packages to npm when a version tag is pushed:

```bash
yarn release 1.0.0          # Sets version in both packages, commits, and tags
git push && git push origin v1.0.0  # Triggers the publish workflow
```

### Other Commands

```bash
yarn typecheck            # TypeScript type checking for all workspaces
yarn format               # Format and lint code
yarn lint                 # ESLint only
yarn prettify             # Prettier only
yarn docs:dev             # Run docs site locally
```

## Project Structure

```
cmd-ipc/
├── packages/
│   ├── cmd-ipc/          # Core library (@coralstack/cmd-ipc)
│   └── cmd-ipc-mcp/      # MCP channel (@coralstack/cmd-ipc-mcp)
├── examples/
│   ├── web-workers/       # Web Workers example
│   ├── electron/          # Electron example
│   ├── agent-mcp/         # AI Agent MCP example
│   └── cf-worker/         # Cloudflare Workers example
├── docs/                  # Documentation site
└── scripts/               # Build and release scripts
```

## License

MIT
