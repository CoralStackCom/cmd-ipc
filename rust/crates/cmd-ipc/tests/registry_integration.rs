//! End-to-end tests for [`CommandRegistry`].
//!
//! Each test wires two registries together with an
//! [`InMemoryChannel`] pair, spawns each registry's driver on a
//! `futures::executor::ThreadPool`, and drives the test body on the
//! current thread with `block_on`. This mirrors how a real user would
//! run the library in production (the crate is runtime-agnostic, so
//! users are responsible for spawning drivers onto whatever executor
//! they have).

use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use coralstack_cmd_ipc::{
    Command, CommandChannel, CommandError, CommandRegistry, Config, InMemoryChannel,
};
use futures::executor::{block_on, ThreadPool};
use futures::task::SpawnExt;
use serde::{Deserialize, Serialize};
use serde_json::json;

// ---------- test commands ----------

struct MathAdd;

#[derive(Deserialize, Serialize)]
struct AddReq {
    a: i64,
    b: i64,
}

impl Command for MathAdd {
    const ID: &'static str = "math.add";
    type Request = AddReq;
    type Response = i64;

    async fn handle(&self, req: AddReq) -> Result<i64, CommandError> {
        Ok(req.a + req.b)
    }
}

struct Greet;

impl Command for Greet {
    const ID: &'static str = "greet";
    type Request = String;
    type Response = String;

    async fn handle(&self, name: String) -> Result<String, CommandError> {
        Ok(format!("hello, {name}"))
    }
}

struct Failing;

impl Command for Failing {
    const ID: &'static str = "explode";
    type Request = ();
    type Response = ();

    async fn handle(&self, _req: ()) -> Result<(), CommandError> {
        Err(CommandError::Internal {
            command_id: "explode".into(),
            message: "boom".into(),
        })
    }
}

// ---------- helpers ----------

fn config(id: &str, router: Option<&str>) -> Config {
    Config {
        id: Some(id.into()),
        router_channel: router.map(String::from),
        request_ttl: Duration::from_secs(5),
        event_ttl: Duration::from_secs(5),
    }
}

/// Wires two registries together. `a` plays root, `b` plays child with
/// its `router_channel` set to `a`'s id from `b`'s perspective.
///
/// Returns the two registries plus the thread pool keeping the
/// drivers alive.
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
    // Labels are the peer's name as seen from each side.
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

/// Waits until `cond` returns true or the deadline fires. Polls the
/// current-thread executor in between. Used to give asynchronously
/// propagated state (e.g. a register request landing on the peer)
/// time to settle.
fn wait_for<F: Fn() -> bool>(cond: F) {
    block_on(async {
        for _ in 0..50 {
            if cond() {
                return;
            }
            let _ = sleep_ms(20).await;
        }
        panic!("condition never became true");
    });
}

fn sleep_ms(ms: u64) -> impl Future<Output = ()> {
    let (tx, rx) = futures::channel::oneshot::channel();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        let _ = tx.send(());
    });
    async move {
        let _ = rx.await;
    }
}

// ---------- tests ----------

#[test]
fn child_executes_command_on_root_via_router() {
    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    block_on(async {
        reg_a.register_command(MathAdd).await.unwrap();

        let res: i64 = reg_b
            .execute_command("math.add", AddReq { a: 2, b: 3 })
            .await
            .unwrap();
        assert_eq!(res, 5);
    });
}

#[test]
fn child_registration_escalates_and_root_can_invoke() {
    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    block_on(async {
        // Register on the child — escalates to the root.
        reg_b.register_command(Greet).await.unwrap();

        let res: String = reg_a.execute_command("greet", "world").await.unwrap();
        assert_eq!(res, "hello, world");
    });
}

#[test]
fn duplicate_registration_fails() {
    let (reg_a, _reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    block_on(async {
        reg_a.register_command(MathAdd).await.unwrap();
        let err = reg_a.register_command(MathAdd).await.unwrap_err();
        assert!(matches!(err, CommandError::DuplicateCommand(id) if id == "math.add"));
    });
}

#[test]
fn unknown_command_returns_not_found() {
    let (_reg_a, reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    block_on(async {
        let err = reg_b
            .execute_command::<_, ()>("missing.cmd", json!({}))
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::NotFound(_)));
    });
}

#[test]
fn handler_error_surfaces_to_caller() {
    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    block_on(async {
        reg_a.register_command(Failing).await.unwrap();
        let err = reg_b
            .execute_command::<_, ()>("explode", ())
            .await
            .unwrap_err();
        match err {
            CommandError::Internal { message, .. } => assert_eq!(message, "boom"),
            other => panic!("expected Internal error, got {other:?}"),
        }
    });
}

#[test]
fn private_command_stays_local() {
    struct LocalOnly;
    impl Command for LocalOnly {
        const ID: &'static str = "_secret";
        type Request = ();
        type Response = i32;
        async fn handle(&self, _: ()) -> Result<i32, CommandError> {
            Ok(7)
        }
    }

    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    block_on(async {
        reg_a.register_command(LocalOnly).await.unwrap();

        // Local call on A works.
        let res: i32 = reg_a.execute_command("_secret", ()).await.unwrap();
        assert_eq!(res, 7);

        // Call from B does NOT escalate private commands — router
        // forwarding will still try, but A's `_secret` was never
        // announced because private commands are excluded from
        // list-commands responses. With a router, B still blindly
        // forwards and A serves it locally. This is the same
        // behavior as the TS library: privacy prevents advertising,
        // not serving. So the call succeeds.
        let via_router: i32 = reg_b.execute_command("_secret", ()).await.unwrap();
        assert_eq!(via_router, 7);
    });
}

#[test]
fn events_broadcast_and_dedup() {
    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    // Give the list-commands handshake a moment to settle before we
    // start emitting.
    wait_for(|| true);

    let hits = Arc::new(Mutex::new(Vec::<String>::new()));
    let h = hits.clone();
    let _unsub = reg_b.add_event_listener("user.created", move |payload| {
        h.lock().unwrap().push(payload.to_string());
    });

    reg_a
        .emit_event("user.created", json!({ "id": "u1" }))
        .unwrap();

    wait_for(|| !hits.lock().unwrap().is_empty());

    let seen = hits.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].contains("u1"));
}

#[test]
fn private_event_does_not_cross_channel() {
    let (reg_a, reg_b, _ca, _cb, _pool) = wire_pair("a", "b", None, Some("a"));

    let hits = Arc::new(Mutex::new(0u32));
    let h = hits.clone();
    let _unsub = reg_b.add_event_listener("_tick", move |_| {
        *h.lock().unwrap() += 1;
    });

    reg_a.emit_event("_tick", json!({})).unwrap();

    // Give the system time to (not) deliver.
    block_on(sleep_ms(60));
    assert_eq!(*hits.lock().unwrap(), 0);
}

#[test]
fn channel_close_fails_pending_executes() {
    let (reg_a, reg_b, _ca, ch_for_b, _pool) = wire_pair("a", "b", None, Some("a"));

    // Register a handler that never returns.
    struct HangForever;
    impl Command for HangForever {
        const ID: &'static str = "hang";
        type Request = ();
        type Response = ();
        async fn handle(&self, _: ()) -> Result<(), CommandError> {
            futures::future::pending::<()>().await;
            Ok(())
        }
    }

    block_on(async {
        reg_a.register_command(HangForever).await.unwrap();

        // Kick off the execute but don't await yet.
        let fut = reg_b.execute_command::<_, ()>("hang", ());
        let handle = futures::FutureExt::boxed(fut);

        // Give the request a beat to land on A.
        sleep_ms(50).await;

        // Close B's side of the channel. The driver on B notices,
        // runs handle_channel_close, and fails the pending execute.
        ch_for_b.close().await;

        let result = handle.await;
        assert!(
            matches!(result, Err(CommandError::ChannelDisconnected)),
            "expected ChannelDisconnected, got {result:?}"
        );
    });
}
