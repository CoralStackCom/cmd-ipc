# coralstack-cmd-ipc-mcp

MCP server adapter that exposes a [`coralstack-cmd-ipc`](../cmd-ipc)
`CommandRegistry` as a Model Context Protocol server. Every public
command in the registry becomes an MCP tool; `tools/list` and
`tools/call` are wired through the registry's normal dispatch, so
handlers registered by the cmd-ipc `#[command]` macro or by
`register_command` are callable by any local agent that speaks MCP.

## Use case

Built primarily for the [Flow](https://github.com/CoralStack/flow)
runtime, where plugins dynamically register commands via a QuickJS
host API and those commands should become available to the user's
local agent (Claude Desktop, Cursor, etc.) as MCP tools — without
hand-rolling a separate MCP server per plugin.

## Usage

```rust
use coralstack_cmd_ipc::prelude::*;
use coralstack_cmd_ipc_mcp::McpServerChannel;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let registry = CommandRegistry::new(Config::default());

    // Register commands — either a `#[command]`-annotated function /
    // method, or a runtime-built `DynCommand` for dynamic ids. Every
    // public command is reflected as an MCP tool. Private commands
    // (id starts with `_`) are never exposed.
    registry
        .register_command(
            DynCommand::new("plugin.say_hi", |_req: serde_json::Value| async move {
                Ok(serde_json::json!("hi"))
            })
            .description("Greet someone"),
        )
        .await?;

    // Serve over stdio — the transport local agents use when they
    // spawn the server as a child process.
    McpServerChannel::new(registry).serve_stdio().await?;
    Ok(())
}
```

`tools/list` reads `CommandRegistry::list_commands()` at call time, so
commands registered after the server starts show up on the next list.
`tools/call` forwards to `CommandRegistry::execute_command::<Value, Value>`,
which routes through the registry's full local/remote/router pipeline.

## Feature flags

Defaults enable `server` and `transport-io` on `rmcp`, which is all
that's needed for stdio serving. HTTP / WebSocket transports are a
follow-up.

## Testing

`make rs-ready` (from the repo root) runs fmt + clippy + the end-to-end
smoke tests in `tests/server_smoke.rs`.
