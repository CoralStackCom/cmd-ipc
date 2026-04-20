# Command IPC

A type-safe Inter-Process Communication (IPC) protocol and set of reference implementations for running commands across processes, languages, and machines.

**[Full Documentation](https://coralstack.com/cmd-ipc/)**

## Overview

cmd-ipc defines a wire protocol for registering and executing typed commands across process boundaries, with automatic routing, schema-backed validation, and support for local and remote transports.

**Use cases:**

- Multi-process applications (Electron.js, Node.js `fork`, Web Workers)
- Plugin/extension frameworks
- Cross-language services (TypeScript ↔ Rust via Unix socket, stdio, WebSocket, …)
- MCP tool exposure to AI agents
- Cloud-seamless applications

## Repository layout

| Directory | Purpose |
| --- | --- |
| [`spec/`](./spec) | Protocol source of truth: message types, JSON Schemas, conformance vectors |
| [`ts/`](./ts) | TypeScript implementation (Yarn workspaces) |
| [`rust/`](./rust) | Rust implementation (Cargo workspace) |
| [`docs/`](./docs) | Unified Astro docs site covering both languages |

### TypeScript packages

| Package | Description |
| --- | --- |
| [`@coralstack/cmd-ipc`](./ts/packages/cmd-ipc) | Core IPC library — registry, channels, commands, schemas |
| [`@coralstack/cmd-ipc-mcp`](./ts/packages/cmd-ipc-mcp) | MCP channel — connect to and expose MCP servers |

### Rust crates

| Crate | Description |
| --- | --- |
| [`cmd-ipc`](./rust/crates/cmd-ipc) | Core IPC crate |
| [`cmd-ipc-macros`](./rust/crates/cmd-ipc-macros) | Proc-macros (Rust equivalent of `@Command`) |

## Quick Start (TypeScript)

```bash
npm install @coralstack/cmd-ipc
```

```typescript
import { CommandRegistry } from '@coralstack/cmd-ipc'

const registry = new CommandRegistry()

await registry.registerCommand('hello.world', async ({ name }) => {
  return { message: `Hello ${name}` }
})

const response = await registry.executeCommand('hello.world', { name: 'World' })
console.log(response.message) // "Hello World"
```

See the [Quick Start Guide](https://coralstack.com/cmd-ipc/getting-started/quick-start/) for more.

## Examples

| Example | Description | Run |
| --- | --- | --- |
| [Web Workers](https://coralstack.com/cmd-ipc/examples/web-workers/) | Background computation with Web Workers | `cd ts && yarn start:examples-web-workers` |
| [Electron](https://coralstack.com/cmd-ipc/examples/electron/) | Multi-process Electron.js architecture | `cd ts && yarn start:examples-electron` |
| [Cloudflare Workers](https://coralstack.com/cmd-ipc/examples/cloudflare-workers/) | HTTP commands at the edge | `cd ts && yarn start:examples-cf-worker` |
| [AI Agent MCP](https://coralstack.com/cmd-ipc/examples/mcp-agent/) | Expose commands as AI agent tools | `cd ts && yarn start:examples-agent-mcp` |

## Development

### Prerequisites

- Node.js >= 20.18.2 (see `ts/.nvmrc`)
- Yarn 4.6.0 (via Corepack)
- Rust stable (for `rust/`)
- `make`

### Top-level orchestration

```bash
make install      # Install TS + docs deps
make build        # Build TS + Rust
make test         # Run all tests + conformance
make lint         # Lint both languages
make format       # Format both languages
make typecheck    # Type-check TS
make docs-dev     # Run docs site locally
```

### Per-language

```bash
cd ts && yarn && yarn build && yarn test:run
cd rust && cargo build --workspace && cargo test --workspace
```

### Release tagging

Each implementation releases independently:

- `ts-v<x.y.z>` — publishes npm packages via `.github/workflows/publish.yml`
- `rust-v<x.y.z>` — publishes crates
- `spec-v<N>` — protocol version bump

## License

MIT
