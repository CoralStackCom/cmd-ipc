# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Command IPC is an Inter-Process Communication (IPC) library for running typed Commands across multiple processes and services. Primary use cases include multi-process applications (Electron.js, Node.js fork, Web Workers), plugin/extension frameworks, MCP tool exposure to AI agents, and cloud-seamless applications.

This is a polyglot monorepo with a TypeScript implementation and a Rust implementation of the same IPC protocol. The canonical protocol definition lives in `spec/`.

Top-level layout:

- **`spec/`** — protocol source of truth (message types, JSON Schemas, conformance vectors). Both implementations MUST conform.
- **`ts/`** — TypeScript monorepo (Yarn 4 workspaces). Packages:
  - **`@coralstack/cmd-ipc`** (`ts/packages/cmd-ipc/`) - Core IPC library
  - **`@coralstack/cmd-ipc-mcp`** (`ts/packages/cmd-ipc-mcp/`) - MCP channel implementation using the official `@modelcontextprotocol/sdk`
- **`rust/`** — Rust monorepo (Cargo workspace). Crates under `rust/crates/`.
- **`docs/`** — unified Astro docs site covering both languages.

## Build & Development Commands

Top-level orchestration is via `make` from the repo root. `.nvmrc` lives at the root — run `nvm use` (or `fnm`/`asdf` equivalent) once in the repo before running make targets; every TS target runs a `check-node` guard that fails fast if the active Node doesn't match.

```bash
make install                 # Install all deps (TS + docs)
make build                   # Build TS + Rust
make test                    # Run all tests + conformance
make ready                   # Pre-commit gate: format/lint/typecheck/test for both languages

# TypeScript
make ts-setup                # Install all TS workspace deps
make ts-build                # Build all TS packages
make ts-ready                # TS pre-commit gate (auto-fixes formatting + fixable lint)
make ts-test                 # Run TS tests headless
make ts-test UI=1            # Run TS tests with vitest web UI
make ts-release              # Run the TS release script
make ts-start-example web-workers   # or electron, agent-mcp, cf-worker

# Rust
make rust-build
make rust-test
make rust-lint               # clippy -D warnings
make rust-format
make rs-ready                # Rust pre-commit gate (fmt/clippy/test) — parallel to ts-ready
make rs-start-example multi-service

# Both languages
make ready                   # Combined pre-commit gate: ts-ready + rs-ready

# Docs
make docs-dev                # Run docs site locally
make docs-build
```

Per-language commands still work inside each subdir (`cd ts && yarn ...`, `cd rust && cargo ...`).

## Release tagging

- `ts-v<x.y.z>` — publishes npm packages
- `rust-v<x.y.z>` — publishes crates
- `spec-v<N>` — protocol version bump

## Architecture

### Core Components (`ts/packages/cmd-ipc/`)

1. **CommandRegistry** (`src/registry/command-registry.ts`) - Central hub managing commands and channels. Handles routing, message dispatching, and event broadcasting. Supports **Loose Mode** (flexible, any command) and **Strict Mode** (schema-validated with full TypeScript type safety). Uses a Hybrid Tree-Mesh architecture with optional `routerChannel` for command escalation.

2. **ICommandChannel** (`src/channels/command-channel-interface.ts`) - Abstract interface for any communication channel (MessagePort, WebSocket, etc.).

3. **MessagePortChannel** (`src/channels/message-port/message-port-channel.ts`) - Concrete implementation using Web MessagePort API for worker_threads, Web Workers, and MessageChannel.

4. **HTTPChannel** (`src/channels/http/http-channel.ts`) - HTTP channel using streaming NDJSON for client/server communication.

5. **@Command Decorator** (`src/commands/command-decorator.ts`) - Decorator to register class methods as commands. Use `registerCommands()` for batch registration.

6. **Schema System** (`src/schemas/`) - Uses Valibot for runtime validation and JSON Schema generation. `CommandSchemaMap` maps command IDs to request/response schemas; `EventSchemaMap` maps event IDs to payload schemas.

7. **TTLMap** (`src/utils/ttl-map.ts`) - Generic Map with TTL-based cleanup for request handlers, event deduplication, and route handlers.

### MCP Components (`ts/packages/cmd-ipc-mcp/`)

1. **MCPClientChannel** (`src/client/mcp-client-channel.ts`) - Connects to remote MCP servers, exposes their tools as cmd-ipc commands. Uses the official `@modelcontextprotocol/sdk` `Client`.

2. **MCPServerChannel** (`src/server/mcp-server-channel.ts`) - Exposes cmd-ipc commands as MCP tools. Uses the official `@modelcontextprotocol/sdk` `McpServer`.

### Core Components (`rust/crates/cmd-ipc/`)

The Rust port mirrors the TypeScript library's protocol and routing semantics with a strict, statically-typed API (no Loose mode — Rust types ARE the schema).

1. **`CommandRegistry`** (`src/registry.rs`) — same routing model as TS: local / remote / router_channel escalation, private-prefix isolation, event fan-out with dedup, TTL-tracked in-flight requests. Public methods align with the TypeScript library:
   Public API (aligned 1:1 with the TypeScript reference, plus one Rust-only strict-mode method):
   - `register_command<C: Command>(cmd: C)` — the single registration entry point. Takes any `Command` trait instance: a typed `#[command]`-generated struct for compile-time commands, or a `DynCommand` built at runtime. Id, description, schema, and handler all flow off the instance. Mirrors TS `registerCommand(command, handler)` with a registry constructed using a `CommandSchemaMap`.
   - `register_channel(channel)` — attach a peer. **Commands owned by a channel are cleaned up automatically when the channel closes** (same as the TypeScript reference — no `unregister` method). For dynamic lifecycle-scoped command groups (e.g. Flow plugin sources), implement a custom `CommandChannel` that advertises its commands on connect; closing the channel drops them all.
   - `execute_command::<Req, Res>(id, req)` — **loose mode**; mirrors TS loose `executeCommand(id, args)`. For purely dynamic dispatch use `execute_command::<Value, Value>(id, payload)`.
   - `execute::<C: Command>(req)` — **strict mode**; mirrors TS `executeCommand<K>` with `CommandSchemaMap`. The compile-time `Command` trait pins both request and response types.
   - `emit<E: Event>(event)` — single entry point for both typed `#[event]` structs and runtime `DynEvent` instances. Mirrors TS `emitEvent`.
   - `on<E: Event + DeserializeOwned>(cb)` — typed event listener; the callback receives a deserialized `E`. Mirrors TS strict `addEventListener`.
   - `on_dyn(id, cb)` — dynamic event listener by runtime id; the callback receives raw `Value`. Used for FFI/scripting hosts. Both variants return `impl FnOnce()` unsubscribe closures.
   - `list_commands()` → `Vec<CommandDef>` (mirrors TS `listCommands()`).
   - `list_channels()` → connected channel ids (mirrors TS `listChannels()`).
   - `dispose()` — closes all channels, drops commands, clears listeners. Mirrors TS `dispose()`.
   - `id()` — registry identifier.

   Intentional Rust-only divergences from the TS reference (forced by the language):
   - `register_channel` returns a driver future the caller spawns (vs TS's Promise<void>); Rust is runtime-agnostic.
   - `add_event_listener` returns `impl FnOnce()` (vs TS's `() => void`); same semantics, different syntactic shape.
   - `emit_event` returns `Result` (vs TS's `void`); serde errors on payload are surfaced at the call site.
2. **`CommandChannel` trait + `InMemoryChannel`** (`src/channel.rs`) — pluggable transport interface plus an in-memory pair for same-process tests and examples.
3. **`Command` trait** (`src/command.rs`) — typed `Request`/`Response` associated types and an `async fn handle`. `schema()` returns the JSON Schema advertised on the wire.
4. **Wire messages** (`src/message.rs`) — the seven `Message` variants, byte-identical to the TS union.

### Macros: `#[command]` / `#[commands]` (`rust/crates/cmd-ipc-macros/`)

Parallels the TS `@Command` decorator + `registerCommands([instance], registry)` pattern. Two shapes:

```rust
use coralstack_cmd_ipc::prelude::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// Impl-block shape (primary, matches TS class-method decorator)
#[derive(Deserialize, Serialize, JsonSchema)]
struct AddReq { a: i64, b: i64 }

struct MathService;

#[commands]
impl MathService {
    #[command("math.add", description = "Add two integers")]
    async fn add(&self, req: AddReq) -> Result<i64, CommandError> { Ok(req.a + req.b) }

    #[command("_internal.ping")] // private; leading underscore stays local
    async fn ping(&self, _: ()) -> Result<String, CommandError> { Ok("pong".into()) }
}

MathService.register(&registry).await?;

// Free-fn shape (one-offs). The macro emits `register_<fn>(&registry)`
// as the registration entry point.
#[command("greet")]
async fn greet(name: String) -> Result<String, CommandError> { Ok(format!("hello, {name}")) }

register_greet(&registry).await?;
```

`coralstack-cmd-ipc` re-exports both attributes, so user crates list only one dependency. Generated code auto-derives `Command::schema()` via `schemars::schema_for!`.

### MCP server adapter: `rust/crates/cmd-ipc-mcp/`

Exposes a `CommandRegistry` as an MCP server via `rmcp`. Public commands in the registry appear as MCP tools to any local agent that connects; `tools/list` / `tools/call` route through the registry's normal dispatch. Private (`_`-prefixed) commands are never exposed. Primary consumer is the Flow plugin runtime.

```rust
use coralstack_cmd_ipc::prelude::*;
use coralstack_cmd_ipc_mcp::McpServerChannel;

let registry = CommandRegistry::new(Config::default());
// ... registry.register_command(MyCmd).await? or MyService.register(&registry) as needed ...
McpServerChannel::new(registry).serve_stdio().await?;
```

### Worked example: `rust/examples/multi-service/`

Two registries (`root` and `worker`) wired by `InMemoryChannel::pair`, a REPL on the root that can call commands on either. Run via `make rs-start-example multi-service`. Demonstrates: macro registration, cross-registry routing, event fan-out — the Rust equivalent of the TS `web-workers` example but entirely in one process.

### Message Protocol

Seven message types defined in `MessageType` enum (`ts/packages/cmd-ipc/src/registry/command-message-schemas.ts`):

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
spec/                           # Protocol source of truth
├── README.md
├── messages.md                 # Seven MessageType definitions
├── schemas/                    # Canonical JSON Schemas
└── conformance/                # Shared test vectors

ts/                             # TypeScript monorepo (Yarn workspaces)
├── packages/
│   ├── cmd-ipc/                # Core IPC library (@coralstack/cmd-ipc)
│   │   └── src/
│   │       ├── channels/       # ICommandChannel interface, HTTP, MessagePort
│   │       ├── commands/       # @Command decorator and registration
│   │       ├── registry/       # CommandRegistry core, message types, events
│   │       ├── schemas/        # CommandSchemaMap, EventSchemaMap, Valibot utilities
│   │       ├── utils/          # TTLMap and other utilities
│   │       ├── cli/            # CLI tools (generate-schema)
│   │       └── testing/        # Test utilities including TestLogger
│   └── cmd-ipc-mcp/            # MCP channel library (@coralstack/cmd-ipc-mcp)
│       └── src/
│           ├── client/         # MCPClientChannel
│           └── server/         # MCPServerChannel
└── examples/
    ├── agent-mcp/              # AI agent with MCP server connections
    ├── web-workers/            # Web Workers example
    ├── electron/               # Electron multi-process example
    └── cf-worker/              # Cloudflare Worker example

rust/                           # Rust monorepo (Cargo workspace)
└── crates/
    ├── cmd-ipc/                # Core crate (mirrors @coralstack/cmd-ipc)
    └── cmd-ipc-macros/         # Proc-macros for the @Command equivalent

docs/                           # Unified Astro docs site (both languages)
```

## Configuration Notes

- TypeScript uses `experimentalDecorators` and `emitDecoratorMetadata` for the @Command decorator
- tsup builds both ESM and CJS with source maps and declarations
- Yarn 4.6.0 workspaces with node-modules linker (not PnP)
- Node.js >= 20.18.2 required
- MCP package uses `@modelcontextprotocol/sdk` as a runtime dependency and `@coralstack/cmd-ipc` as a peer dependency
