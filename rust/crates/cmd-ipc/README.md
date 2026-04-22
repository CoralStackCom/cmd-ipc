# coralstack-cmd-ipc

Inter-Process Communication (IPC) library for running typed Commands
across processes and services. Rust port of
[`@coralstack/cmd-ipc`](https://www.npmjs.com/package/@coralstack/cmd-ipc),
conforming to the same wire protocol (see `spec/` in the repo).

## What it does

- Register commands as typed handlers and invoke them across channels
  (in-memory, stdio, HTTP, custom transports).
- Route unknown commands to a parent registry via an optional
  `router_channel`, yielding a hybrid tree-mesh topology.
- Fan out typed events to all connected peers with per-registry
  de-duplication.
- Strict-by-default API: the `Command` trait pins request/response
  types at compile time. A loose `execute_dyn` / `on_dyn` pair exists
  for FFI and scripting hosts.

## Quick start

```rust
use coralstack_cmd_ipc::prelude::*;

#[payload]
struct AddReq { a: i64, b: i64 }

struct MathService;

#[command_service]
impl MathService {
    #[command("math.add", description = "Add two integers")]
    async fn add(&self, req: AddReq) -> Result<i64, CommandError> {
        Ok(req.a + req.b)
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let registry = CommandRegistry::new(Config::default());
    MathService.register(&registry).await?;

    let sum = registry
        .execute::<math_service::Add>(AddReq { a: 2, b: 3 })
        .await?;
    assert_eq!(sum, 5);
    Ok(())
}
```

## Events

```rust
#[event("worker.ready")]
struct WorkerReady { worker_id: String }

registry.emit(WorkerReady { worker_id: "w1".into() })?;
let _unsub = registry.on::<WorkerReady>(|e| println!("{}", e.worker_id));
```

## Related crates

- [`coralstack-cmd-ipc-macros`](https://crates.io/crates/coralstack-cmd-ipc-macros)
  — the `#[command]` / `#[event]` / `#[payload]` proc-macros (re-exported
  from this crate's `prelude`).
- [`coralstack-cmd-ipc-mcp`](https://crates.io/crates/coralstack-cmd-ipc-mcp)
  — adapter that exposes a `CommandRegistry` as an MCP server.

## License

MIT. See the repository root for the full text.
