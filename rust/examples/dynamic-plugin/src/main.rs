//! `dynamic-plugin` — a generic template for plugin-host channels.
//!
//! A `PluginChannel` stands in for any plugin host — a scripting
//! runtime (JS, Lua, WASM), an FFI bridge, anything that loads a
//! bundle of commands as a unit. Here the "sandbox" is a plain
//! `HashMap<String, Fn>` so the example runs with no extra dependency.
//! The channel:
//!
//!   1. On `start()`, advertises the plugin's commands to the registry
//!      by sending one `register.command.request` per command. The
//!      schema is constructed at runtime — no compile-time types.
//!   2. On `recv()`, pulls `execute.command.request` messages off the
//!      registry-facing queue, dispatches them into the sandbox's
//!      handler map, and sends `execute.command.response` back.
//!   3. On `close()`, drains its queues. The registry notices EOF on
//!      its driver loop and automatically removes every command owned
//!      by this channel — no manual `unregister_command` needed.
//!
//! Run this example with:
//!
//! ```bash
//! make rs-start-example dynamic-plugin
//! # or
//! cargo run -p dynamic-plugin
//! ```
//!
//! Expected output walks through (a) advertising two plugin commands,
//! (b) invoking each via `execute_dyn`, (c) closing the plugin and
//! confirming `list_commands` drops back to empty.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use coralstack_cmd_ipc::prelude::*;
use coralstack_cmd_ipc::{
    CommandDef, ExecuteError, ExecuteErrorCode, ExecuteResult, False, Message, MessageId, True,
};
use futures::channel::mpsc::{unbounded, UnboundedReceiver, UnboundedSender};
use futures::channel::oneshot;
use futures::executor::{block_on, ThreadPool};
use futures::future::{BoxFuture, Shared};
use futures::lock::Mutex as AsyncMutex;
use futures::task::SpawnExt;
use futures::{FutureExt, StreamExt};
use parking_lot::Mutex;
use serde_json::{json, Value};

// ---------- sandbox plumbing ----------

/// Signature of a single "plugin" handler. Takes the full JSON request
/// payload, returns a JSON response (or an error).
type PluginHandler =
    Arc<dyn Fn(Value) -> BoxFuture<'static, Result<Value, ExecuteError>> + Send + Sync>;

/// A stand-in plugin host: a map of command id → handler. A real
/// plugin runtime would introspect its loaded module's exports to
/// build this list; for the demo we populate it in `demo_plugin()`.
struct Sandbox {
    commands: HashMap<String, (CommandDef, PluginHandler)>,
}

impl Sandbox {
    fn new() -> Self {
        Self {
            commands: HashMap::new(),
        }
    }

    fn define(
        &mut self,
        def: CommandDef,
        handler: impl Fn(Value) -> BoxFuture<'static, Result<Value, ExecuteError>>
            + Send
            + Sync
            + 'static,
    ) {
        self.commands
            .insert(def.id.clone(), (def, Arc::new(handler)));
    }
}

fn demo_plugin() -> Sandbox {
    let mut sb = Sandbox::new();

    sb.define(
        CommandDef {
            id: "plugin.greet".into(),
            description: Some("Greet someone by name".into()),
            schema: Some(
                CommandSchema::empty()
                    .with_request(json!({
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" }
                        },
                        "required": ["name"]
                    }))
                    .with_response(json!({
                        "type": "object",
                        "properties": {
                            "greeting": { "type": "string" }
                        },
                        "required": ["greeting"]
                    })),
            ),
        },
        |req| {
            let name = req
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("world")
                .to_string();
            async move {
                Ok(json!({
                    "greeting": format!("hello, {name}"),
                }))
            }
            .boxed()
        },
    );

    sb.define(
        CommandDef {
            id: "plugin.echo".into(),
            description: Some("Echo the request payload back, wrapped".into()),
            // Schema advertised as permissive any→any — a realistic
            // fallback for plugin functions whose arg/return shape
            // isn't introspectable.
            schema: Some(CommandSchema::permissive()),
        },
        |req| {
            async move {
                if req.is_null() {
                    return Err(ExecuteError {
                        code: ExecuteErrorCode::InvalidRequest,
                        message: "expected a non-null payload".into(),
                    });
                }
                Ok(json!({ "you_sent": req }))
            }
            .boxed()
        },
    );

    sb
}

// ---------- PluginChannel ----------

/// A `CommandChannel` backed by an in-process handler map. On `start`,
/// it advertises every command the sandbox exposes by sending a
/// `register.command.request` to the registry. On `recv`, it yields
/// `execute.command.response` messages built from invoking the
/// sandbox.
///
/// The registry talks to this channel the same way it talks to an
/// `InMemoryChannel` or an MCP channel — via the four trait methods.
/// It doesn't know or care that the commands come from a plugin
/// sandbox; all the plugin-specific logic lives in `recv()` and
/// `dispatch()`.
struct PluginChannel {
    id: String,
    sandbox: Arc<Sandbox>,

    // Outbound: produced by PluginChannel, consumed by the registry
    // driver loop via `recv()`.
    outbound_tx: UnboundedSender<Message>,
    outbound_rx: AsyncMutex<Option<UnboundedReceiver<Message>>>,

    // Close signal — fires when the plugin is unloaded.
    close_tx: Mutex<Option<oneshot::Sender<()>>>,
    close_rx: Shared<oneshot::Receiver<()>>,
    closed: AtomicBool,
}

impl PluginChannel {
    fn new(id: impl Into<String>, sandbox: Sandbox) -> Arc<Self> {
        let (outbound_tx, outbound_rx) = unbounded();
        let (close_tx, close_rx) = oneshot::channel::<()>();
        Arc::new(Self {
            id: id.into(),
            sandbox: Arc::new(sandbox),
            outbound_tx,
            outbound_rx: AsyncMutex::new(Some(outbound_rx)),
            close_tx: Mutex::new(Some(close_tx)),
            close_rx: close_rx.shared(),
            closed: AtomicBool::new(false),
        })
    }
}

impl CommandChannel for PluginChannel {
    fn id(&self) -> &str {
        &self.id
    }

    fn start(&self) -> BoxFuture<'_, Result<(), ChannelError>> {
        // Advertise every plugin command to the registry by pushing a
        // `register.command.request` onto the outbound queue. The
        // registry's driver loop will pick them up via recv(), record
        // each as a remote command owned by this channel, and reply.
        async move {
            for (_, (def, _)) in self.sandbox.commands.iter() {
                self.outbound_tx
                    .unbounded_send(Message::RegisterCommandRequest {
                        id: MessageId::new_v4(),
                        command: def.clone(),
                    })
                    .map_err(|e| ChannelError::Send(e.to_string()))?;
            }
            Ok(())
        }
        .boxed()
    }

    fn close(&self) -> BoxFuture<'_, ()> {
        async move {
            self.closed.store(true, Ordering::SeqCst);
            self.outbound_tx.close_channel();
            if let Some(tx) = self.close_tx.lock().take() {
                let _ = tx.send(());
            }
        }
        .boxed()
    }

    fn send(&self, msg: Message) -> Result<(), ChannelError> {
        // The registry sends us messages intended for the plugin:
        // - `execute.command.request` we need to dispatch into the
        //   sandbox and reply.
        // - `register.command.response` acks for our advertisements
        //   (we don't really care about the body; log for visibility).
        // - `list.commands.request` from the initial handshake — we
        //   reply with the plugin's full command list.
        // - Events are informational; ignore.
        if self.closed.load(Ordering::SeqCst) {
            return Err(ChannelError::Closed);
        }

        match msg {
            Message::ExecuteCommandRequest {
                id,
                command_id,
                request,
            } => {
                let response = self.dispatch(command_id.clone(), request.unwrap_or(Value::Null));
                let tx = self.outbound_tx.clone();
                // Fire-and-forget: drive the sandbox handler on a
                // detached task so `send` stays non-blocking. In a real
                // host this is where you'd hand off to the plugin's
                // own event loop.
                std::thread::spawn(move || {
                    let response = block_on(response);
                    let _ = tx.unbounded_send(Message::ExecuteCommandResponse {
                        id: MessageId::new_v4(),
                        thid: id,
                        response,
                    });
                });
            }
            Message::ListCommandsRequest { id } => {
                let commands = self
                    .sandbox
                    .commands
                    .values()
                    .map(|(def, _)| def.clone())
                    .collect();
                self.outbound_tx
                    .unbounded_send(Message::ListCommandsResponse {
                        id: MessageId::new_v4(),
                        thid: id,
                        commands,
                    })
                    .map_err(|e| ChannelError::Send(e.to_string()))?;
            }
            Message::RegisterCommandResponse { .. } => {
                // The registry acked our advertisement. Fine.
            }
            _ => {
                // Ignore other traffic — events, stray responses, etc.
            }
        }

        Ok(())
    }

    fn recv(&self) -> BoxFuture<'_, Option<Message>> {
        async move {
            if self.closed.load(Ordering::SeqCst) {
                return None;
            }
            let mut guard = self.outbound_rx.lock().await;
            let rx = guard.as_mut()?;
            let close_fut = self.close_rx.clone();
            futures::select_biased! {
                msg = rx.next().fuse() => msg,
                _ = close_fut.fuse() => None,
            }
        }
        .boxed()
    }
}

impl PluginChannel {
    /// Invoke a plugin command inside the sandbox and package the result
    /// as an `ExecuteResult`. A real host would `await` its runtime's
    /// event loop here; we just call the stub handler.
    fn dispatch(&self, command_id: String, request: Value) -> BoxFuture<'static, ExecuteResult> {
        let entry = self
            .sandbox
            .commands
            .get(&command_id)
            .map(|(_, h)| h.clone());
        async move {
            let Some(handler) = entry else {
                return ExecuteResult::Err {
                    ok: False,
                    error: ExecuteError {
                        code: ExecuteErrorCode::NotFound,
                        message: format!("plugin does not export `{command_id}`"),
                    },
                };
            };
            match handler(request).await {
                Ok(v) => ExecuteResult::Ok {
                    ok: True,
                    result: if v.is_null() { None } else { Some(v) },
                },
                Err(error) => ExecuteResult::Err { ok: False, error },
            }
        }
        .boxed()
    }
}

// ---------- demo ----------

fn main() {
    let pool = ThreadPool::new().expect("thread pool");
    let root = CommandRegistry::new(Config {
        id: Some("root".into()),
        router_channel: None,
        request_ttl: Duration::from_secs(5),
        event_ttl: Duration::from_secs(5),
    });

    // Create the plugin channel and wire it into the registry. The
    // channel id doubles as the plugin id; every command advertised
    // through it becomes a remote command owned by that id.
    let plugin = PluginChannel::new("demo-plugin", demo_plugin());
    let plugin_arc: Arc<dyn CommandChannel> = plugin.clone();

    println!("─── advertising plugin commands ──────────────────────────────");
    block_on(async {
        let driver = root
            .register_channel(plugin_arc)
            .await
            .expect("register channel");
        pool.spawn(driver).expect("spawn driver");

        // Give the register/list handshake a few ms to settle.
        sleep(40).await;

        for def in root.list_commands() {
            println!(
                "  {} — {}",
                def.id,
                def.description.as_deref().unwrap_or("")
            );
        }
    });

    println!("\n─── calling plugin commands via execute_dyn ──────────────────");
    block_on(async {
        let greeting = root
            .execute_dyn("plugin.greet", json!({ "name": "Ada" }))
            .await
            .expect("greet");
        println!(
            "  plugin.greet {{name:\"Ada\"}}   => {}",
            serde_json::to_string(&greeting).unwrap()
        );

        let echoed = root
            .execute_dyn("plugin.echo", json!({ "x": 1, "y": [true, false] }))
            .await
            .expect("echo");
        println!(
            "  plugin.echo  {{x:1, y:[…]}}     => {}",
            serde_json::to_string(&echoed).unwrap()
        );

        // Error path: plugin.echo rejects a null payload.
        let err = root
            .execute_dyn("plugin.echo", Value::Null)
            .await
            .unwrap_err();
        println!("  plugin.echo  null               => err: {err}");
    });

    println!("\n─── closing the plugin channel (unloads the plugin) ──────────");
    block_on(async {
        // The channel's close drains our outbound queue. The registry's
        // driver loop sees EOF on recv() and runs
        // `handle_channel_close`, which drops every remote command
        // owned by this channel.
        plugin.close().await;
        sleep(60).await;
    });

    println!("  commands visible to root after close:");
    let remaining = root.list_commands();
    if remaining.is_empty() {
        println!("    (none — cleanup worked)");
    } else {
        for def in remaining {
            println!("    leaked: {}", def.id);
        }
    }

    println!("\n─── attempting to call a command after close ─────────────────");
    let err = block_on(root.execute_dyn("plugin.greet", json!({ "name": "Ada" }))).unwrap_err();
    println!("  plugin.greet => err: {err}");

    // Dispose the registry so the demo exits cleanly (awaits all
    // channel.close() futures).
    block_on(root.dispose());
}

/// Tiny sleep helper: the futures::executor used here has no timer, so
/// we fake one with a thread + oneshot.
async fn sleep(ms: u64) {
    let (tx, rx) = oneshot::channel();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        let _ = tx.send(());
    });
    let _ = rx.await;
}
