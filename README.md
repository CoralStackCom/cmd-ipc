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
| [`ts/`](./ts) | TypeScript implementation (Yarn 4 workspaces) |
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
| [`coralstack-cmd-ipc`](./rust/crates/cmd-ipc) | Core IPC crate — registry, channels, commands, schemas |
| [`coralstack-cmd-ipc-macros`](./rust/crates/cmd-ipc-macros) | Proc-macros (Rust equivalent of `@Command`) |
| [`coralstack-cmd-ipc-mcp`](./rust/crates/cmd-ipc-mcp) | MCP server adapter — exposes a `CommandRegistry` as MCP tools via `rmcp` |

## Quick Start

### TypeScript

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

### Rust

```bash
cargo add coralstack-cmd-ipc
```

```rust
use coralstack_cmd_ipc::prelude::*;

#[payload]
struct GreetReq { name: String }

struct Greeter;

#[command_service]
impl Greeter {
    #[command("hello.world")]
    async fn hello(&self, req: GreetReq) -> Result<String, CommandError> {
        Ok(format!("Hello {}", req.name))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let registry = CommandRegistry::new(Config::default());
    Greeter.register(&registry).await?;

    let msg = registry
        .execute::<greeter::Hello>(GreetReq { name: "World".into() })
        .await?;
    println!("{msg}"); // "Hello World"
    Ok(())
}
```

See the [Quick Start Guide](https://coralstack.com/cmd-ipc/getting-started/quick-start/) for more.

## Examples

### TypeScript

| Example | Description | Run |
| --- | --- | --- |
| [Web Workers](https://coralstack.com/cmd-ipc/examples/web-workers/) | Background computation with Web Workers | `make ts-start-example web-workers` |
| [Electron](https://coralstack.com/cmd-ipc/examples/electron/) | Multi-process Electron.js architecture | `make ts-start-example electron` |
| [Cloudflare Workers](https://coralstack.com/cmd-ipc/examples/cloudflare-workers/) | HTTP commands at the edge | `make ts-start-example cf-worker` |
| [AI Agent MCP](https://coralstack.com/cmd-ipc/examples/mcp-agent/) | Expose commands as AI agent tools | `make ts-start-example agent-mcp` |

### Rust

| Example | Description | Run |
| --- | --- | --- |
| [`multi-service`](./rust/examples/multi-service) | Two registries wired by an in-memory channel with a REPL that routes commands across them and fans out events | `make rs-start-example multi-service` |
| [`dynamic-plugin`](./rust/examples/dynamic-plugin) | Plugin-host channel that advertises commands at runtime and auto-cleans them up when the channel closes | `make rs-start-example dynamic-plugin` |

## Development

### Prerequisites

- Node.js >= 20.18.2 (see `.nvmrc`) — use `nvm use` / `fnm` / `asdf` at the repo root
- Yarn 4.6.0 (via Corepack: `corepack enable`)
- Rust stable (for `rust/`)
- `make`

### Top-level orchestration

```bash
make install      # Install TS + docs deps
make build        # Build TS + Rust
make test         # Run TS + Rust tests + conformance
make ready        # Pre-commit gate: ts-ready + rs-ready + spec-check-format
make clean        # Remove node_modules, dist, cargo target, docs build
make docs-dev     # Run docs site locally
make help         # List every make target with its description
```

### Per-language

```bash
# TypeScript
make ts-setup                        # yarn install
make ts-build                        # yarn build
make ts-test                         # headless vitest
make ts-test UI=1                    # vitest web UI
make ts-ready                        # prettier + lint + typecheck + tests (auto-fixes formatting)

# Rust
make rust-build                      # cargo build --workspace
make rust-test                       # cargo test --workspace
make rust-lint                       # clippy -D warnings
make rust-format                     # cargo fmt --all
make rs-ready                        # fmt + clippy + tests
```

Per-language commands also work directly: `cd ts && yarn …` / `cd rust && cargo …`.

## CI / Release

### Pull requests

| Workflow | Triggers | What it runs |
| --- | --- | --- |
| [`ts.yml`](./.github/workflows/ts.yml) | PRs touching `ts/**` or `spec/**` | build, typecheck, lint, prettier check, tests, TS conformance |
| [`rust.yml`](./.github/workflows/rust.yml) | PRs touching `rust/**` or `spec/**` | fmt check, clippy `-D warnings`, build, tests, Rust conformance |

### Release tagging

Each implementation releases independently; publishing is tag-gated:

| Tag | Workflow | Publishes to |
| --- | --- | --- |
| `ts-v<x.y.z>` | [`publish-ts.yml`](./.github/workflows/publish-ts.yml) | npm (`@coralstack/cmd-ipc`, `@coralstack/cmd-ipc-mcp`) |
| `rust-v<x.y.z>` | [`publish-rust.yml`](./.github/workflows/publish-rust.yml) | crates.io (`coralstack-cmd-ipc-macros`, `coralstack-cmd-ipc`, `coralstack-cmd-ipc-mcp`) |
| `spec-v<N>` | — | Protocol version marker (no publish) |

The Rust publish runs `cargo publish` in dependency order (`macros` → `cmd-ipc` → `cmd-ipc-mcp`); `cargo publish` blocks until the uploaded crate is resolvable on the index before the next step runs.

## License

MIT
