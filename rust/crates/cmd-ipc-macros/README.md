# coralstack-cmd-ipc-macros

Procedural macros for [`coralstack-cmd-ipc`](https://crates.io/crates/coralstack-cmd-ipc):
`#[command]`, `#[command_service]`, `#[event]`, and `#[payload]`.

You normally don't depend on this crate directly — the macros are
re-exported from `coralstack_cmd_ipc::prelude`. Depend on
`coralstack-cmd-ipc` and use:

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

#[event("worker.ready")]
struct WorkerReady { worker_id: String }
```

See the [`coralstack-cmd-ipc` README](https://crates.io/crates/coralstack-cmd-ipc)
for the full API and registration patterns.

## License

MIT. See the repository root for the full text.
