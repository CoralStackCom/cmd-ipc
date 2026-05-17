//! Tests for the per-channel pump's concurrent handler dispatch.
//!
//! Pre-0.2.1 the pump awaited each handler future inline, so a single
//! slow handler stalled every subsequent message on the same channel.
//! These tests pin the post-fix behavior: handler futures are
//! cooperatively interleaved with `recv`, ordering of responses follows
//! handler completion (not arrival), and `Config::max_in_flight_per_channel`
//! applies backpressure without dropping messages.

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use coralstack_cmd_ipc::{
    Command, CommandChannel, CommandError, CommandRegistry, Config, DynEvent, InMemoryChannel,
};
use futures::channel::oneshot;
use futures::executor::{block_on, ThreadPool};
use futures::future::join_all;
use futures::lock::Mutex as AsyncMutex;
use futures::task::SpawnExt;
use futures::FutureExt;
use serde::{Deserialize, Serialize};
use serde_json::json;

// ---------- shared helpers ----------

fn sleep_ms(ms: u64) -> impl Future<Output = ()> {
    let (tx, rx) = oneshot::channel();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        let _ = tx.send(());
    });
    async move {
        let _ = rx.await;
    }
}

fn config(id: &str, router: Option<&str>) -> Config {
    Config {
        id: Some(id.into()),
        router_channel: router.map(String::from),
        request_ttl: Duration::from_secs(10),
        event_ttl: Duration::from_secs(2),
        max_in_flight_per_channel: 256,
    }
}

fn config_with_cap(id: &str, router: Option<&str>, cap: usize) -> Config {
    let mut c = config(id, router);
    c.max_in_flight_per_channel = cap;
    c
}

/// Wires two registries together (root `a` ↔ child `b` with router `a`),
/// spawning each pump driver on the supplied thread pool. The returned
/// channels are kept alive by the caller so the drivers don't shut down
/// prematurely.
fn wire(
    cfg_a: Config,
    cfg_b: Config,
    pool: &ThreadPool,
) -> (
    CommandRegistry,
    CommandRegistry,
    Arc<dyn CommandChannel>,
    Arc<dyn CommandChannel>,
) {
    let a_id = cfg_a.id.clone().unwrap();
    let b_id = cfg_b.id.clone().unwrap();
    let (ch_for_a, ch_for_b) = InMemoryChannel::pair(b_id.clone(), a_id.clone());
    let ch_for_a: Arc<dyn CommandChannel> = ch_for_a;
    let ch_for_b: Arc<dyn CommandChannel> = ch_for_b;
    let reg_a = CommandRegistry::new(cfg_a);
    let reg_b = CommandRegistry::new(cfg_b);
    block_on(async {
        let drv_a = reg_a.register_channel(ch_for_a.clone()).await.unwrap();
        let drv_b = reg_b.register_channel(ch_for_b.clone()).await.unwrap();
        pool.spawn(drv_a).unwrap();
        pool.spawn(drv_b).unwrap();
    });
    (reg_a, reg_b, ch_for_a, ch_for_b)
}

// ---------- test commands ----------

struct SlowCmd;

#[derive(Deserialize, Serialize)]
struct SleepReq {
    ms: u64,
    tag: String,
}

#[derive(Deserialize, Serialize, Debug, PartialEq)]
struct TaggedResp {
    tag: String,
    finished_at_ms: u64,
}

impl Command for SlowCmd {
    const ID: &'static str = "slow";
    type Request = SleepReq;
    type Response = TaggedResp;

    async fn handle(&self, req: SleepReq) -> Result<TaggedResp, CommandError> {
        let start = Instant::now();
        sleep_ms(req.ms).await;
        Ok(TaggedResp {
            tag: req.tag,
            finished_at_ms: start.elapsed().as_millis() as u64,
        })
    }
}

struct FastCmd;

impl Command for FastCmd {
    const ID: &'static str = "fast";
    type Request = String;
    type Response = String;

    async fn handle(&self, req: String) -> Result<String, CommandError> {
        Ok(format!("got:{req}"))
    }
}

/// Handler whose entry/exit is observable, and which blocks until a
/// shared barrier oneshot fires. Used to drive the backpressure test
/// deterministically.
struct BarrierCmd {
    counter: Arc<AtomicUsize>,
    high_water: Arc<AtomicUsize>,
    release: Arc<AsyncMutex<Option<futures::future::Shared<oneshot::Receiver<()>>>>>,
}

impl Command for BarrierCmd {
    const ID: &'static str = "barrier";
    type Request = ();
    type Response = ();

    async fn handle(&self, _req: ()) -> Result<(), CommandError> {
        let now = self.counter.fetch_add(1, Ordering::SeqCst) + 1;
        // Track high-water mark of concurrent handlers.
        let mut prev = self.high_water.load(Ordering::SeqCst);
        while now > prev {
            match self
                .high_water
                .compare_exchange(prev, now, Ordering::SeqCst, Ordering::SeqCst)
            {
                Ok(_) => break,
                Err(cur) => prev = cur,
            }
        }
        // Wait on the shared release signal.
        let rx = self.release.lock().await.as_ref().cloned();
        if let Some(rx) = rx {
            let _ = rx.await;
        }
        self.counter.fetch_sub(1, Ordering::SeqCst);
        Ok(())
    }
}

// ---------- tests ----------

/// Test 1 — Concurrent dispatch: a fast command issued after a slow
/// one returns first. Pre-fix the fast call waited for the slow one.
#[test]
fn fast_command_does_not_wait_for_slow_one() {
    let pool = ThreadPool::new().unwrap();
    let (reg_a, reg_b, _ca, _cb) = wire(config("a", None), config("b", Some("a")), &pool);

    block_on(async {
        reg_a.register_command(SlowCmd).await.unwrap();
        reg_a.register_command(FastCmd).await.unwrap();

        // Kick off slow first, then fast. From b's pov both are remote.
        let slow_fut = reg_b.execute::<SlowCmd>(SleepReq {
            ms: 300,
            tag: "slow".into(),
        });
        // Yield once so the slow request gets onto the wire first.
        sleep_ms(20).await;
        let fast_fut = reg_b.execute::<FastCmd>("hi".to_string());

        let started = Instant::now();
        let fast = fast_fut.await.unwrap();
        let fast_elapsed = started.elapsed();
        assert_eq!(fast, "got:hi");
        // Fast must complete well before the slow handler's sleep
        // elapses. Be generous: 200ms cushion under the 300ms sleep.
        assert!(
            fast_elapsed < Duration::from_millis(250),
            "fast call took {fast_elapsed:?}, head-of-line blocked by slow handler"
        );

        let slow = slow_fut.await.unwrap();
        assert_eq!(slow.tag, "slow");
    });
}

/// Test 2 — Backpressure cap. With `max_in_flight_per_channel = 4`,
/// firing 10 long-running requests must produce at most 4 concurrent
/// handlers at the high-water mark; all 10 complete once released.
#[test]
fn backpressure_cap_limits_concurrent_handlers() {
    let pool = ThreadPool::new().unwrap();
    // Root caps in-flight handlers at 4. Child is unbounded.
    let (reg_a, reg_b, _ca, _cb) =
        wire(config_with_cap("a", None, 4), config("b", Some("a")), &pool);

    let counter = Arc::new(AtomicUsize::new(0));
    let high_water = Arc::new(AtomicUsize::new(0));
    let (release_tx, release_rx) = oneshot::channel::<()>();
    let release_shared = release_rx.shared();
    let release_slot = Arc::new(AsyncMutex::new(Some(release_shared)));

    block_on(async {
        reg_a
            .register_command(BarrierCmd {
                counter: counter.clone(),
                high_water: high_water.clone(),
                release: release_slot,
            })
            .await
            .unwrap();

        // Fire 10 in parallel — must spawn so futures actually get
        // polled while we observe the high-water mark.
        let mut handles = Vec::new();
        for _ in 0..10 {
            let reg = reg_b.clone();
            let h = pool
                .spawn_with_handle(async move { reg.execute_dyn("barrier", json!(null)).await })
                .unwrap();
            handles.push(h);
        }

        // Give the registry a chance to start dispatching and saturate
        // the in-flight cap.
        sleep_ms(300).await;
        let hw = high_water.load(Ordering::SeqCst);
        assert!(hw > 0, "no handler ever started");
        assert!(hw <= 4, "high water {hw} exceeds cap of 4");

        // Release the barrier and let them all finish.
        let _ = release_tx.send(());
        let results = join_all(handles).await;
        for r in results {
            r.unwrap();
        }
        assert_eq!(counter.load(Ordering::SeqCst), 0);
    });
}

/// Test 3 — Response correlation by `thid`. Mixed slow/fast requests
/// must each receive their own response, regardless of completion
/// order.
#[test]
fn responses_match_originating_requests() {
    let pool = ThreadPool::new().unwrap();
    let (reg_a, reg_b, _ca, _cb) = wire(config("a", None), config("b", Some("a")), &pool);

    block_on(async {
        reg_a.register_command(SlowCmd).await.unwrap();

        // Mix sleeps so responses arrive out-of-order.
        let pattern: Vec<(u64, &'static str)> = vec![
            (200, "A"),
            (10, "B"),
            (150, "C"),
            (5, "D"),
            (80, "E"),
            (40, "F"),
            (20, "G"),
            (120, "H"),
            (1, "I"),
            (60, "J"),
        ];
        let futs: Vec<_> = pattern
            .iter()
            .map(|(ms, tag)| {
                reg_b.execute::<SlowCmd>(SleepReq {
                    ms: *ms,
                    tag: (*tag).to_string(),
                })
            })
            .collect();
        let results = join_all(futs).await;
        for ((_, expected_tag), res) in pattern.iter().zip(results.iter()) {
            let r = res.as_ref().unwrap();
            assert_eq!(&r.tag, *expected_tag, "thid correlation failed");
        }
    });
}

/// Test 4 — Event fan-out is not blocked by an in-flight slow handler.
#[test]
fn events_flow_while_slow_handler_in_flight() {
    let pool = ThreadPool::new().unwrap();
    let (reg_a, reg_b, _ca, _cb) = wire(config("a", None), config("b", Some("a")), &pool);

    let received = Arc::new(AtomicUsize::new(0));
    {
        let received = received.clone();
        // Listen on reg_a; events emit from reg_b and cross the channel.
        std::mem::forget(reg_a.on_dyn("tick", move |_| {
            received.fetch_add(1, Ordering::SeqCst);
        }));
    }

    block_on(async {
        reg_a.register_command(SlowCmd).await.unwrap();
        // Start a slow handler; don't await yet.
        let slow_fut = reg_b.execute::<SlowCmd>(SleepReq {
            ms: 400,
            tag: "slow".into(),
        });

        // While the handler is running on reg_a, emit 100 events from
        // reg_b. The listener on reg_a should see them all without
        // waiting for the handler.
        sleep_ms(30).await;
        for _ in 0..100 {
            reg_b.emit(DynEvent::new("tick", json!(null))).unwrap();
        }

        // Wait briefly for delivery — well under the slow handler's sleep.
        for _ in 0..20 {
            if received.load(Ordering::SeqCst) == 100 {
                break;
            }
            sleep_ms(10).await;
        }
        let count = received.load(Ordering::SeqCst);
        assert_eq!(
            count, 100,
            "events stalled behind handler: only {count}/100"
        );

        // Finish the slow handler cleanly.
        let _ = slow_fut.await.unwrap();
    });
}

/// Test 5 — Channel close while a slow handler is running: no panics,
/// no orphan messages. The slow handler's response either lands before
/// close or is silently dropped when send hits a closed channel.
#[test]
fn channel_close_during_slow_handler_is_clean() {
    let pool = ThreadPool::new().unwrap();
    let (reg_a, reg_b, _ca, cb) = wire(config("a", None), config("b", Some("a")), &pool);

    block_on(async {
        reg_a.register_command(SlowCmd).await.unwrap();

        let slow_fut = reg_b.execute::<SlowCmd>(SleepReq {
            ms: 300,
            tag: "slow".into(),
        });

        // Give the handler a moment to start, then close the child's
        // side of the channel.
        sleep_ms(50).await;
        cb.close().await;

        // The pending execute must resolve to ChannelDisconnected (the
        // pump's close path fires Err on every in-flight execute_reply).
        let err = slow_fut.await.unwrap_err();
        assert!(
            matches!(err, CommandError::ChannelDisconnected),
            "expected ChannelDisconnected, got {err:?}"
        );

        // Let the slow handler finish on the other side. Its `origin.send`
        // will hit a closed channel and return Err — silently swallowed.
        sleep_ms(400).await;
    });
}

/// Test 6 — Regression for forward_execute: a forwarded slow remote
/// command must not block a forwarded fast one issued just after it.
#[test]
fn forward_execute_does_not_serialize_remote_calls() {
    let pool = ThreadPool::new().unwrap();
    // Three-node setup: root `a`, child `b` (router=a), child `c` (router=a).
    // Slow command lives on `a`; both `b` and `c` invoke it.
    let (ch_b_for_a, ch_a_for_b) = InMemoryChannel::pair("b", "a");
    let (ch_c_for_a, ch_a_for_c) = InMemoryChannel::pair("c", "a");
    let ch_b_for_a: Arc<dyn CommandChannel> = ch_b_for_a;
    let ch_a_for_b: Arc<dyn CommandChannel> = ch_a_for_b;
    let ch_c_for_a: Arc<dyn CommandChannel> = ch_c_for_a;
    let ch_a_for_c: Arc<dyn CommandChannel> = ch_a_for_c;

    let reg_a = CommandRegistry::new(config("a", None));
    let reg_b = CommandRegistry::new(config("b", Some("a")));
    let reg_c = CommandRegistry::new(config("c", Some("a")));

    block_on(async {
        let drv = reg_a.register_channel(ch_b_for_a.clone()).await.unwrap();
        pool.spawn(drv).unwrap();
        let drv = reg_a.register_channel(ch_c_for_a.clone()).await.unwrap();
        pool.spawn(drv).unwrap();
        let drv = reg_b.register_channel(ch_a_for_b.clone()).await.unwrap();
        pool.spawn(drv).unwrap();
        let drv = reg_c.register_channel(ch_a_for_c.clone()).await.unwrap();
        pool.spawn(drv).unwrap();

        reg_a.register_command(SlowCmd).await.unwrap();

        // Allow command advertisement to propagate.
        sleep_ms(100).await;

        let slow = reg_b.execute::<SlowCmd>(SleepReq {
            ms: 300,
            tag: "slow".into(),
        });
        sleep_ms(20).await;
        let started = Instant::now();
        let fast = reg_c
            .execute::<SlowCmd>(SleepReq {
                ms: 10,
                tag: "fast".into(),
            })
            .await
            .unwrap();
        let fast_elapsed = started.elapsed();
        assert_eq!(fast.tag, "fast");
        assert!(
            fast_elapsed < Duration::from_millis(250),
            "fast forwarded call took {fast_elapsed:?}, blocked by slow forwarded call"
        );
        let _ = slow.await.unwrap();
    });
}
