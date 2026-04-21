//! End-to-end tests for the `#[command]` / `#[commands]` macros.
//!
//! Wires two registries via `InMemoryChannel::pair` and exercises:
//!   - the impl-block shape (`#[commands] impl Service { #[command(..)] async fn ... }`)
//!   - the free-fn shape (`#[command("id")] async fn ...`)
//!   - schema population on generated Command impls
//!   - private-prefix commands never escalating to the router
//!   - cross-registry routing for commands registered via the macro

use std::sync::Arc;
use std::time::Duration;

use coralstack_cmd_ipc::prelude::*;
use coralstack_cmd_ipc::Config;
use futures::executor::{block_on, ThreadPool};
use futures::task::SpawnExt;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ---------- service under test (impl-block shape) ----------

#[derive(Deserialize, Serialize, JsonSchema)]
struct AddReq {
    a: i64,
    b: i64,
}

#[derive(Deserialize, Serialize, JsonSchema)]
struct SubReq {
    a: i64,
    b: i64,
}

struct MathService;

#[commands]
impl MathService {
    #[command("math.add", description = "Add two integers")]
    async fn add(&self, req: AddReq) -> Result<i64, CommandError> {
        Ok(req.a + req.b)
    }

    #[command("math.sub")]
    async fn sub(&self, req: SubReq) -> Result<i64, CommandError> {
        Ok(req.a - req.b)
    }

    /// Private command — MUST stay local; never advertised to router.
    #[command("_internal.ping")]
    async fn ping(&self, _: ()) -> Result<String, CommandError> {
        Ok("pong".into())
    }
}

// ---------- free-fn shape ----------

#[command("greet")]
async fn greet(name: String) -> Result<String, CommandError> {
    Ok(format!("hello, {name}"))
}

// ---------- helpers (copied from registry_integration to avoid crate gymnastics) ----------

fn config(id: &str, router: Option<&str>) -> Config {
    Config {
        id: Some(id.into()),
        router_channel: router.map(String::from),
        request_ttl: Duration::from_secs(5),
        event_ttl: Duration::from_secs(5),
    }
}

fn wire_pair(
    a_id: &str,
    b_id: &str,
    a_router: Option<&str>,
    b_router: Option<&str>,
) -> (CommandRegistry, CommandRegistry, ThreadPool) {
    let (ch_for_a, ch_for_b) = InMemoryChannel::pair(b_id, a_id);
    let ch_for_a: Arc<dyn CommandChannel> = ch_for_a;
    let ch_for_b: Arc<dyn CommandChannel> = ch_for_b;

    let reg_a = CommandRegistry::new(config(a_id, a_router));
    let reg_b = CommandRegistry::new(config(b_id, b_router));
    let pool = ThreadPool::new().unwrap();

    block_on(async {
        let driver_a = reg_a.register_channel(ch_for_a).await.unwrap();
        let driver_b = reg_b.register_channel(ch_for_b).await.unwrap();
        pool.spawn(driver_a).unwrap();
        pool.spawn(driver_b).unwrap();
    });

    (reg_a, reg_b, pool)
}

// ---------- tests ----------

#[test]
fn impl_block_macro_registers_and_executes_across_channel() {
    let (reg_a, reg_b, _pool) = wire_pair("root", "worker", None, Some("root"));

    block_on(async {
        // Register everything on the worker; commands propagate to root via router.
        MathService.register_all(&reg_b).await.unwrap();

        // Root calls add — routes to worker.
        let sum: i64 = reg_a
            .execute_command("math.add", AddReq { a: 2, b: 3 })
            .await
            .unwrap();
        assert_eq!(sum, 5);

        // And sub.
        let diff: i64 = reg_a
            .execute_command("math.sub", SubReq { a: 10, b: 4 })
            .await
            .unwrap();
        assert_eq!(diff, 6);
    });
}

#[test]
fn free_fn_macro_registers_via_factory() {
    let (reg_a, _reg_b, _pool) = wire_pair("root", "worker", None, Some("root"));

    block_on(async {
        register_greet(&reg_a).await.unwrap();

        let hello: String = reg_a
            .execute_command("greet", "world".to_string())
            .await
            .unwrap();
        assert_eq!(hello, "hello, world");
    });
}

#[test]
fn private_command_stays_local() {
    // Private commands MUST NOT be advertised to the router. Register on
    // the worker; attempting to call it from the root should fail with
    // NotFound (the router-registered commands will include math.*, but
    // _internal.ping must be filtered out).
    let (reg_a, reg_b, _pool) = wire_pair("root", "worker", None, Some("root"));

    block_on(async {
        MathService.register_all(&reg_b).await.unwrap();

        // Root cannot see the private command.
        let err = reg_a
            .execute_command::<_, String>("_internal.ping", ())
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::NotFound(_)));

        // But the worker itself can still call it locally.
        let got: String = reg_b.execute_command("_internal.ping", ()).await.unwrap();
        assert_eq!(got, "pong");
    });
}

#[test]
fn free_fn_macro_exposes_schema_after_registration() {
    // The free-fn macro emits a `register_<fn>` helper; after calling it,
    // the registry's list_commands() reflects the auto-derived schema.
    let reg = CommandRegistry::new(config("solo", None));
    block_on(async {
        register_greet(&reg).await.unwrap();
    });

    let def = reg
        .list_commands()
        .into_iter()
        .find(|d| d.id == "greet")
        .expect("greet should be registered");

    let schema = def.schema.expect("macro should populate schema");
    assert!(schema.request.is_some());
    assert!(schema.response.is_some());
    // Response schema for `String` should include "string".
    let resp = schema.response.unwrap().to_string();
    assert!(
        resp.contains("string"),
        "unexpected response schema: {resp}"
    );
}

/// Hand-implemented `Command` whose `schema()` returns an explicitly
/// unnormalized JSON Schema. After going through `register()` the
/// registry's cached def must contain the normalized form — this
/// proves the library enforces the invariant independently of the
/// macro.
struct UnnormalizedCommand;

impl Command for UnnormalizedCommand {
    const ID: &'static str = "hand.rolled";
    type Request = serde_json::Value;
    type Response = serde_json::Value;
    async fn handle(&self, _req: serde_json::Value) -> Result<serde_json::Value, CommandError> {
        Ok(serde_json::Value::Null)
    }
    fn schema() -> Option<coralstack_cmd_ipc::CommandSchema> {
        Some(coralstack_cmd_ipc::CommandSchema {
            request: Some(serde_json::json!({
                "$schema": "http://json-schema.org/draft-07/schema#",
                "title": "HandRolled",
                "type": "object",
                "properties": {
                    "n": { "title": "int64", "type": "integer", "format": "int64" }
                },
                "required": ["n"]
            })),
            response: Some(serde_json::json!({
                "title": "HandRolledOut",
                "type": "integer",
                "format": "int64"
            })),
        })
    }
}

#[test]
fn registry_normalizes_hand_written_schema() {
    use coralstack_cmd_ipc::CommandDef;
    use futures::executor::block_on;

    let reg = CommandRegistry::new(config("solo", None));
    block_on(async {
        let def = CommandDef {
            id: UnnormalizedCommand::ID.into(),
            description: UnnormalizedCommand::DESCRIPTION.map(String::from),
            schema: UnnormalizedCommand::schema(),
        };
        // Register via the closure form. Inline the same
        // deserialize/handle/serialize wrapper that `__handler_for_command`
        // provides — but expressed as a plain closure to avoid touching
        // the hidden macro-facing helper.
        reg.register_command(def, move |req| {
            let cmd = UnnormalizedCommand;
            async move {
                let typed: serde_json::Value = req;
                let _ = cmd
                    .handle(typed)
                    .await
                    .map_err(|e| coralstack_cmd_ipc::ExecuteError {
                        code: coralstack_cmd_ipc::ExecuteErrorCode::InternalError,
                        message: e.to_string(),
                    })?;
                Ok(serde_json::Value::Null)
            }
        })
        .await
        .unwrap();
    });

    let defs = reg.list_commands();
    let def = defs.iter().find(|d| d.id == "hand.rolled").unwrap();
    let req = def.schema.as_ref().unwrap().request.as_ref().unwrap();
    let resp = def.schema.as_ref().unwrap().response.as_ref().unwrap();

    // Stripped.
    assert!(req.get("title").is_none(), "title leaked: {req}");
    assert!(req.get("$schema").is_none(), "$schema leaked: {req}");
    assert!(resp.get("title").is_none(), "title leaked: {resp}");
    // additionalProperties: false added to object.
    assert_eq!(req["additionalProperties"], serde_json::Value::Bool(false));
    // int64 format stripped from non-string schemas.
    assert!(
        req["properties"]["n"].get("format").is_none(),
        "format leaked on property: {req}"
    );
    assert!(
        resp.get("format").is_none(),
        "format leaked on response: {resp}"
    );
}
