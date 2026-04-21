//! End-to-end tests for the dynamic registration API: `register_command`
//! with a runtime-string `CommandDef` and a plain async closure.
//!
//! These tests exercise the handler-as-closure path used by scripting
//! runtimes and FFI bridges. The `#[commands]` macro path is covered
//! by `macro_integration.rs`.
//!
//! The registry has no explicit `unregister` API: per the TypeScript
//! reference implementation, channel close is the mechanism for
//! removing commands owned by a peer. The
//! `channel_close_removes_its_commands` test at the bottom of this
//! file verifies that invariant.

use std::sync::Arc;
use std::time::Duration;

use coralstack_cmd_ipc::prelude::*;
use coralstack_cmd_ipc::{Config, ExecuteError};
use futures::executor::{block_on, ThreadPool};
use futures::task::SpawnExt;
use serde_json::{json, Value};

// ---------- harness ----------

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
) -> (
    CommandRegistry,
    CommandRegistry,
    Arc<dyn CommandChannel>,
    Arc<dyn CommandChannel>,
    ThreadPool,
) {
    let (ch_for_a, ch_for_b) = InMemoryChannel::pair(b_id, a_id);
    let ch_for_a: Arc<dyn CommandChannel> = ch_for_a;
    let ch_for_b: Arc<dyn CommandChannel> = ch_for_b;

    let reg_a = CommandRegistry::new(config(a_id, a_router));
    let reg_b = CommandRegistry::new(config(b_id, b_router));
    let pool = ThreadPool::new().unwrap();

    block_on(async {
        let driver_a = reg_a.register_channel(ch_for_a.clone()).await.unwrap();
        let driver_b = reg_b.register_channel(ch_for_b.clone()).await.unwrap();
        pool.spawn(driver_a).unwrap();
        pool.spawn(driver_b).unwrap();
    });

    (reg_a, reg_b, ch_for_a, ch_for_b, pool)
}

/// Convenience: build a minimal `CommandDef` with just an id.
fn def(id: &str) -> CommandDef {
    CommandDef {
        id: id.into(),
        description: None,
        schema: None,
    }
}

/// Wraps a sync closure in an async one for `register_command`.
fn sync_fn<F>(
    f: F,
) -> impl Fn(Value) -> futures::future::Ready<Result<Value, ExecuteError>> + Send + Sync + 'static
where
    F: Fn(Value) -> Result<Value, ExecuteError> + Send + Sync + 'static,
{
    move |req| futures::future::ready(f(req))
}

// ---------- tests ----------

#[test]
fn register_command_executes_locally() {
    let reg = CommandRegistry::new(config("solo", None));
    block_on(async {
        let d = CommandDef {
            id: "math.double".into(),
            description: Some("Double the input integer".into()),
            schema: None,
        };
        reg.register_command(
            d,
            sync_fn(|req| {
                let n = req.get("n").and_then(Value::as_i64).unwrap_or(0);
                Ok(json!(n * 2))
            }),
        )
        .await
        .unwrap();

        let got: i64 = reg
            .execute_command("math.double", json!({ "n": 21 }))
            .await
            .unwrap();
        assert_eq!(got, 42);
    });
}

#[test]
fn register_command_propagates_across_channel() {
    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("root", "worker", None, Some("root"));
    block_on(async {
        reg_b
            .register_command(def("work.echo"), sync_fn(Ok))
            .await
            .unwrap();

        let got: Value = reg_a
            .execute_command("work.echo", json!({ "hello": "world" }))
            .await
            .unwrap();
        assert_eq!(got, json!({ "hello": "world" }));
    });
}

#[test]
fn register_command_normalizes_schema() {
    let reg = CommandRegistry::new(config("solo", None));
    // Deliberately unnormalized schemars-style schema: has `title`,
    // `$schema`, and `format: "int64"` on a numeric field.
    let unnormalized = CommandSchema {
        request: Some(json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "HandRolled",
            "type": "object",
            "properties": {
                "n": { "title": "int64", "type": "integer", "format": "int64" }
            },
            "required": ["n"]
        })),
        response: Some(json!({
            "title": "int64",
            "type": "integer",
            "format": "int64"
        })),
    };
    block_on(async {
        let d = CommandDef {
            id: "hand.rolled".into(),
            description: None,
            schema: Some(unnormalized),
        };
        reg.register_command(d, sync_fn(|_req| Ok(Value::Null)))
            .await
            .unwrap();

        let def: &CommandDef = &reg.list_commands()[0];
        let req = def.schema.as_ref().unwrap().request.as_ref().unwrap();
        let resp = def.schema.as_ref().unwrap().response.as_ref().unwrap();
        assert!(req.get("title").is_none());
        assert!(req.get("$schema").is_none());
        assert_eq!(req["additionalProperties"], Value::Bool(false));
        assert!(req["properties"]["n"].get("format").is_none());
        assert!(resp.get("format").is_none());
    });
}

#[test]
fn register_command_private_prefix_stays_local() {
    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("root", "worker", None, Some("root"));
    block_on(async {
        reg_b
            .register_command(def("_secret.ping"), sync_fn(|_| Ok(json!("pong"))))
            .await
            .unwrap();

        // Worker can call it locally.
        let got: String = reg_b
            .execute_command("_secret.ping", Value::Null)
            .await
            .unwrap();
        assert_eq!(got, "pong");

        // Root cannot see it (never escalated).
        let err = reg_a
            .execute_command::<_, String>("_secret.ping", Value::Null)
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::NotFound(_)));
    });
}

/// Channel-scoped commands are cleaned up when the channel closes.
///
/// This is the TS-aligned replacement for an `unregister` API: Flow's
/// planned `SourceChannel` will register per-source commands on the
/// peer side of a channel; dropping the channel cleans up every
/// command the peer ever advertised, with no explicit unregister call.
#[test]
fn channel_close_removes_its_commands() {
    let (reg_a, reg_b, _ca, cb, _pool) = wire_pair("root", "worker", None, Some("root"));
    block_on(async {
        // Worker registers a command — `register_command` on a registry
        // with a `router_channel` escalates a `register.command.request`
        // up to the root.
        reg_b
            .register_command(def("work.ping"), sync_fn(|_| Ok(json!("pong"))))
            .await
            .unwrap();

        // Root sees it as a remote command.
        let got: String = reg_a
            .execute_command("work.ping", Value::Null)
            .await
            .unwrap();
        assert_eq!(got, "pong");
        assert!(reg_a.list_commands().iter().any(|d| d.id == "work.ping"));

        // Close the worker side of the channel. Both registries see the
        // close; the root's `handle_channel_close` removes the worker's
        // advertised commands from its remote tables.
        cb.close().await;

        // Cleanup happens asynchronously — give the driver a moment.
        for _ in 0..50 {
            if !reg_a.list_commands().iter().any(|d| d.id == "work.ping") {
                break;
            }
            // Yield to the thread-pool driver. Async sleep avoids
            // blocking the futures-executor current thread.
            let (tx, rx) = futures::channel::oneshot::channel();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(20));
                let _ = tx.send(());
            });
            let _ = rx.await;
        }

        assert!(
            !reg_a.list_commands().iter().any(|d| d.id == "work.ping"),
            "command should be cleaned up when its owning channel closes"
        );

        let err = reg_a
            .execute_command::<_, String>("work.ping", Value::Null)
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::NotFound(_)));
    });
}
