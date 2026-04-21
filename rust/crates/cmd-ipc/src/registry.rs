//! The [`CommandRegistry`] — core routing and execution hub.
//!
//! Mirrors the TypeScript `CommandRegistry` in
//! `packages/cmd-ipc/src/registry/command-registry.ts`: it owns a local
//! command table, a remote command table (command → owning channel), a
//! set of connected channels, and a handful of [`TtlMap`]s correlating
//! in-flight requests, forwarded routes, and recently-seen events.
//!
//! # Topology
//!
//! * **Root** registries have no `router_channel`. Unknown commands
//!   produce `NotFound` errors.
//! * **Child** registries set `router_channel = Some(peer_id)`. Unknown
//!   commands, and new local registrations, are escalated upstream.
//! * Events fan out across every connected channel; dedup by message
//!   id prevents echo loops in meshes.
//!
//! Private commands/events (identifiers starting with `_`) stay local
//! — never escalated, never advertised, never broadcast.

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::channel::oneshot;
use futures::future::BoxFuture;
use futures::FutureExt;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::channel::CommandChannel;
use crate::command::Command;
use crate::error::{ChannelError, CommandError, ExecuteErrorCode, RegisterErrorCode};
use crate::event::Event;
use crate::message::{
    CommandDef, ExecuteError, ExecuteResult, False, Message, MessageId, RegisterResult, True,
};
use crate::ttl_map::TtlMap;

/// Configuration for a [`CommandRegistry`].
pub struct Config {
    /// Registry identifier used in log messages. Defaults to a random
    /// UUID.
    pub id: Option<String>,
    /// Channel id to escalate unknown commands and new registrations
    /// to. Leave `None` for a root registry.
    pub router_channel: Option<String>,
    /// How long a pending `execute` / `register` reply can wait before
    /// being rejected with [`CommandError::Timeout`]. Zero disables
    /// the TTL check (request hangs until the channel closes).
    pub request_ttl: Duration,
    /// How long a seen event id is remembered for dedup purposes.
    pub event_ttl: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            id: None,
            router_channel: None,
            request_ttl: Duration::from_secs(30),
            event_ttl: Duration::from_secs(5),
        }
    }
}

type HandlerFn = dyn Fn(Value) -> BoxFuture<'static, Result<Value, ExecuteError>> + Send + Sync;
type EventListener = Arc<dyn Fn(Value) + Send + Sync>;

struct LocalEntry {
    handler: Arc<HandlerFn>,
    def: CommandDef,
    is_private: bool,
}

struct PendingExecute {
    tx: oneshot::Sender<ExecuteResult>,
    target_channel: String,
}

struct PendingRegister {
    tx: oneshot::Sender<RegisterResult>,
    target_channel: String,
}

struct RouteEntry {
    origin_channel: String,
    target_channel: String,
}

/// Shared state behind the [`CommandRegistry`] Arc.
struct Inner {
    id: String,
    router_channel: Option<String>,
    local: Mutex<HashMap<String, LocalEntry>>,
    /// command id -> owning channel id
    remote: Mutex<HashMap<String, String>>,
    /// command id -> advertised definition (description + schema)
    /// kept parallel to `remote` so `list_commands` can render
    /// the same richness for remote entries as for local ones.
    remote_defs: Mutex<HashMap<String, CommandDef>>,
    channels: Mutex<HashMap<String, Arc<dyn CommandChannel>>>,
    execute_replies: TtlMap<MessageId, PendingExecute>,
    register_replies: TtlMap<MessageId, PendingRegister>,
    routes: TtlMap<MessageId, RouteEntry>,
    seen_events: TtlMap<MessageId, ()>,
    /// Event listeners keyed by event id then by a monotonic token, so
    /// `add_event_listener` can return an unsubscribe closure that
    /// removes just that one listener. `BTreeMap` preserves insertion
    /// order (tokens are monotonically increasing) for dispatch.
    event_listeners: Mutex<HashMap<String, BTreeMap<u64, EventListener>>>,
    /// Monotonically-increasing token used to key event listeners.
    next_listener_token: AtomicU64,
}

/// The main entry point of the crate.
///
/// A registry is cheap to clone: internally it's an `Arc<Inner>`.
#[derive(Clone)]
pub struct CommandRegistry {
    inner: Arc<Inner>,
}

impl CommandRegistry {
    pub fn new(cfg: Config) -> Self {
        let inner = Arc::new(Inner {
            id: cfg.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            router_channel: cfg.router_channel,
            local: Mutex::new(HashMap::new()),
            remote: Mutex::new(HashMap::new()),
            remote_defs: Mutex::new(HashMap::new()),
            channels: Mutex::new(HashMap::new()),
            execute_replies: TtlMap::new(cfg.request_ttl),
            register_replies: TtlMap::new(cfg.request_ttl),
            routes: TtlMap::new(cfg.request_ttl),
            seen_events: TtlMap::new(cfg.event_ttl),
            event_listeners: Mutex::new(HashMap::new()),
            next_listener_token: AtomicU64::new(0),
        });
        Self { inner }
    }

    /// Returns this registry's identifier.
    pub fn id(&self) -> &str {
        &self.inner.id
    }

    /// Returns the ids of every currently-registered channel, sorted.
    ///
    /// Mirrors the TypeScript library's `listChannels()` method.
    pub fn list_channels(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.inner.channels.lock().keys().cloned().collect();
        ids.sort();
        ids
    }

    /// Returns the full [`CommandDef`] (id + description + schema) for
    /// every reachable command — local (non-private) and remote. Remote
    /// defs are those advertised via `register.command.request` or
    /// `list.commands.response` on the channel.
    ///
    /// Mirrors the TypeScript library's `listCommands()` method.
    /// Results are sorted by id. A command id is only included once even
    /// if both a local and remote entry exist (local wins).
    pub fn list_commands(&self) -> Vec<CommandDef> {
        let mut out: HashMap<String, CommandDef> = HashMap::new();
        for (id, entry) in self.inner.local.lock().iter() {
            if !entry.is_private {
                out.insert(id.clone(), entry.def.clone());
            }
        }
        for (id, def) in self.inner.remote_defs.lock().iter() {
            out.entry(id.clone()).or_insert_with(|| def.clone());
        }
        let mut v: Vec<CommandDef> = out.into_values().collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    /// Register a command on this registry.
    ///
    /// The single registration entry point, covering both compile-time
    /// and runtime commands:
    ///
    /// - **Compile-time**: pass an instance of a type that implements
    ///   [`Command`]. The `#[command]` / `#[command_service]` macros
    ///   generate such types from a plain `async fn`.
    /// - **Runtime**: pass a [`DynCommand`] carrying owned id /
    ///   description / schema and a closure handler.
    ///
    /// Mirrors the TypeScript library's `registerCommand`.
    ///
    /// - Commands whose id starts with `_` stay local: they are never
    ///   escalated to a `router_channel` and never advertised to peers
    ///   via `list.commands.response`.
    /// - Non-private commands are escalated upstream if this registry
    ///   has a `router_channel`; the local entry is only committed
    ///   after the router acks.
    /// - The advertised schema is normalized via
    ///   [`crate::schema::normalize_schema`] on the way in, so every
    ///   schema leaving the registry is language-agnostic JSON Schema
    ///   regardless of how the caller built it.
    pub async fn register_command<C: Command>(&self, cmd: C) -> Result<(), CommandError> {
        let id = cmd.id().to_string();
        let description = cmd.description().map(str::to_string);
        let schema = cmd.schema().map(crate::schema::normalize_command_schema);
        let is_private = id.starts_with('_');
        let def = CommandDef {
            id: id.clone(),
            description,
            schema,
        };
        let handler: Arc<HandlerFn> = Arc::new({
            let cmd = Arc::new(cmd);
            move |value: Value| {
                let cmd = cmd.clone();
                async move {
                    let req: C::Request =
                        serde_json::from_value(value).map_err(|e| ExecuteError {
                            code: ExecuteErrorCode::InvalidRequest,
                            message: e.to_string(),
                        })?;
                    let res = cmd
                        .handle(req)
                        .await
                        .map_err(|e| command_error_to_execute(&e, cmd.id()))?;
                    serde_json::to_value(res).map_err(|e| ExecuteError {
                        code: ExecuteErrorCode::InternalError,
                        message: e.to_string(),
                    })
                }
                .boxed()
            }
        });
        self.register_inner(id, handler, def, is_private).await
    }

    async fn register_inner(
        &self,
        id: String,
        handler: Arc<HandlerFn>,
        def: CommandDef,
        is_private: bool,
    ) -> Result<(), CommandError> {
        // Duplicate check against the local table.
        if self.inner.local.lock().contains_key(&id) {
            return Err(CommandError::DuplicateCommand(id));
        }

        // Non-private commands escalate to the router before being added.
        if !is_private {
            if let Some(router_id) = self.inner.router_channel.clone() {
                let router_ch = self.inner.channels.lock().get(&router_id).cloned();
                if let Some(router_ch) = router_ch {
                    let req_id = MessageId::new_v4();
                    let (tx, rx) = oneshot::channel();
                    self.inner.register_replies.insert(
                        req_id,
                        PendingRegister {
                            tx,
                            target_channel: router_id.clone(),
                        },
                    );
                    router_ch
                        .send(Message::RegisterCommandRequest {
                            id: req_id,
                            command: def.clone(),
                        })
                        .map_err(|_| CommandError::ChannelDisconnected)?;
                    match rx.await {
                        Ok(RegisterResult::Ok { .. }) => {}
                        Ok(RegisterResult::Err { error, .. }) => {
                            return Err(match error {
                                RegisterErrorCode::DuplicateCommand => {
                                    CommandError::DuplicateCommand(id)
                                }
                            });
                        }
                        Err(_) => return Err(CommandError::ChannelDisconnected),
                    }
                }
            }
        }

        self.inner.local.lock().insert(
            id,
            LocalEntry {
                handler,
                def,
                is_private,
            },
        );
        Ok(())
    }

    /// Connects a [`CommandChannel`] to this registry.
    ///
    /// Returns a driver future which must be polled by the caller's
    /// executor (via `tokio::spawn`, `smol::spawn`,
    /// `futures::executor::block_on`, …) for the registry to exchange
    /// messages with the peer. The future completes when the channel
    /// closes.
    pub async fn register_channel(
        &self,
        channel: Arc<dyn CommandChannel>,
    ) -> Result<impl Future<Output = ()> + Send + 'static, ChannelError> {
        let id = channel.id().to_string();
        {
            let mut chans = self.inner.channels.lock();
            if chans.contains_key(&id) {
                return Err(ChannelError::Other(format!(
                    "channel with id `{id}` already registered"
                )));
            }
            chans.insert(id.clone(), channel.clone());
        }

        channel.start().await?;

        // Ask the peer for its command list. The response is handled
        // by the driver loop, which will register each entry as remote.
        if let Err(e) = channel.send(Message::ListCommandsRequest {
            id: MessageId::new_v4(),
        }) {
            self.inner.channels.lock().remove(&id);
            return Err(e);
        }

        let inner = self.inner.clone();
        let ch = channel;
        Ok(async move {
            while let Some(msg) = ch.recv().await {
                Inner::handle_message(inner.clone(), ch.clone(), msg).await;
            }
            Inner::handle_channel_close(&inner, ch.id());
        })
    }

    /// Executes a command identified by a compile-time [`Command`] type
    /// — the **strict** form, giving the same compile-time type safety
    /// that TypeScript's strict-mode `executeCommand<K>` gives via the
    /// `CommandSchemaMap` type parameter.
    ///
    /// The command id comes from `C::ID`, the request type is pinned to
    /// `C::Request`, and the response type is pinned to `C::Response`,
    /// so the compiler rejects mismatches at the call site:
    ///
    /// ```ignore
    /// let sum: i64 = registry.execute::<MathAdd>(AddReq { a: 2, b: 3 }).await?;
    /// ```
    ///
    /// For commands whose id or payload shape is only known at runtime
    /// (scripting hosts, FFI, plugins that advertise their own schema),
    /// use [`execute_dyn`](Self::execute_dyn).
    pub async fn execute<C: Command>(
        &self,
        request: C::Request,
    ) -> Result<C::Response, CommandError>
    where
        C::Request: Serialize,
        C::Response: serde::de::DeserializeOwned,
    {
        let req_value = value_from_request(&request)?;
        let result = self.execute_raw_impl(C::ID.to_string(), req_value).await?;
        let deserialized = serde_json::from_value(result.unwrap_or(Value::Null))?;
        Ok(deserialized)
    }

    /// Executes a command whose id is only known at runtime — the
    /// **loose** form, mirroring the TypeScript library's
    /// `executeCommand(id, args)` in loose mode.
    ///
    /// Request and response are raw [`serde_json::Value`]s, so this is
    /// the canonical entry point for plugin hosts, scripting runtimes,
    /// FFI bridges, and any code where the schema is discovered via
    /// [`list_commands`](Self::list_commands) rather than declared at
    /// compile time.
    ///
    /// For statically-known commands, prefer [`execute`](Self::execute)
    /// — it pins both types via the [`Command`] trait.
    pub async fn execute_dyn(
        &self,
        command_id: &str,
        request: Value,
    ) -> Result<Value, CommandError> {
        let result = self
            .execute_raw_impl(command_id.to_string(), request)
            .await?;
        Ok(result.unwrap_or(Value::Null))
    }

    async fn execute_raw_impl(
        &self,
        command_id: String,
        request: Value,
    ) -> Result<Option<Value>, CommandError> {
        // 1) Local handler wins.
        let local_handler = self
            .inner
            .local
            .lock()
            .get(&command_id)
            .map(|entry| entry.handler.clone());
        if let Some(handler) = local_handler {
            return handler(request)
                .await
                .map(Some)
                .map_err(|e| e.into_command_error(&command_id));
        }

        // 2) Known remote command.
        let remote_target = self.inner.remote.lock().get(&command_id).cloned();
        let target = match remote_target {
            Some(t) => Some(t),
            None => self.inner.router_channel.clone(),
        };

        let Some(target_id) = target else {
            return Err(CommandError::NotFound(command_id));
        };

        let channel = self.inner.channels.lock().get(&target_id).cloned();
        let Some(channel) = channel else {
            return Err(CommandError::ChannelDisconnected);
        };

        self.forward_execute(command_id, request, &channel, target_id)
            .await
    }

    async fn forward_execute(
        &self,
        command_id: String,
        request: Value,
        channel: &Arc<dyn CommandChannel>,
        target_id: String,
    ) -> Result<Option<Value>, CommandError> {
        let req_id = MessageId::new_v4();
        let (tx, rx) = oneshot::channel();
        self.inner.execute_replies.insert(
            req_id,
            PendingExecute {
                tx,
                target_channel: target_id,
            },
        );
        channel
            .send(Message::ExecuteCommandRequest {
                id: req_id,
                command_id: command_id.clone(),
                // Void requests are elided from the wire (Null → None)
                // so peers expecting an absent `request` field (per the
                // JSON Schema spec) don't see `"request": null`.
                request: value_to_wire(request),
            })
            .map_err(|_| CommandError::ChannelDisconnected)?;

        match rx.await {
            Ok(ExecuteResult::Ok { result, .. }) => Ok(result),
            Ok(ExecuteResult::Err { error, .. }) => Err(error_to_command_error(error, &command_id)),
            Err(_) => {
                self.inner.execute_replies.remove(&req_id);
                Err(CommandError::ChannelDisconnected)
            }
        }
    }

    /// Emit an event. Dispatches to local listeners and — unless the
    /// event id is private (starts with `_`) — broadcasts to every
    /// connected channel.
    ///
    /// Works for both compile-time events (`#[event]`-annotated
    /// structs) and runtime events ([`DynEvent`](crate::command::Command)
    /// — actually [`DynEvent`](crate::event::DynEvent)). Id, description,
    /// and schema are all read off the event instance.
    pub fn emit<E: Event>(&self, event: E) -> Result<(), CommandError> {
        let event_id = event.id().to_string();
        let payload_value = serde_json::to_value(&event)?;
        let msg_id = MessageId::new_v4();
        self.inner.seen_events.insert(msg_id, ());

        self.dispatch_event_locally(&event_id, &payload_value);

        if !event_id.starts_with('_') {
            let channels: Vec<Arc<dyn CommandChannel>> =
                self.inner.channels.lock().values().cloned().collect();
            // Void payloads (serde `()` → `Value::Null`) are elided
            // from the wire per the event schema (`payload` is optional).
            let wire_payload = value_to_wire(payload_value);
            for ch in channels {
                let _ = ch.send(Message::Event {
                    id: msg_id,
                    event_id: event_id.clone(),
                    payload: wire_payload.clone(),
                });
            }
        }
        Ok(())
    }

    /// Subscribe a typed listener. The callback receives a
    /// deserialized `E` every time an event with id `E::ID` fires,
    /// whether emitted locally or received from a connected channel.
    ///
    /// Returns an unsubscribe closure — call it (and drop it) to
    /// remove just this listener. Ignoring the return value is fine;
    /// the listener then lives for the life of the registry.
    ///
    /// Listeners for the same event fire in insertion order. Payloads
    /// that fail to deserialize into `E` are silently dropped for
    /// this listener — they still flow to any typed-for-Value
    /// listeners registered via [`on_dyn`](Self::on_dyn).
    pub fn on<E: Event + serde::de::DeserializeOwned>(
        &self,
        listener: impl Fn(E) + Send + Sync + 'static,
    ) -> impl FnOnce() + Send + Sync + 'static {
        self.install_listener(E::ID, move |value| {
            if let Ok(typed) = serde_json::from_value::<E>(value) {
                listener(typed);
            }
        })
    }

    /// Subscribe a dynamic listener by runtime id. The callback
    /// receives the raw JSON payload. Use this when the event id is
    /// only known at runtime (plugin runtimes, FFI, scripting hosts);
    /// prefer [`on`](Self::on) whenever you have a compile-time
    /// [`Event`] type.
    ///
    /// Same unsubscribe semantics as [`on`](Self::on).
    pub fn on_dyn<F>(
        &self,
        event_id: impl Into<String>,
        listener: F,
    ) -> impl FnOnce() + Send + Sync + 'static
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        self.install_listener(&event_id.into(), listener)
    }

    fn install_listener<F>(
        &self,
        event_id: &str,
        listener: F,
    ) -> impl FnOnce() + Send + Sync + 'static
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        let token = self
            .inner
            .next_listener_token
            .fetch_add(1, Ordering::Relaxed);
        self.inner
            .event_listeners
            .lock()
            .entry(event_id.to_string())
            .or_default()
            .insert(token, Arc::new(listener));

        let inner = Arc::clone(&self.inner);
        let event_id = event_id.to_string();
        move || {
            let mut map = inner.event_listeners.lock();
            if let Some(slot) = map.get_mut(&event_id) {
                slot.remove(&token);
                if slot.is_empty() {
                    map.remove(&event_id);
                }
            }
        }
    }

    fn dispatch_event_locally(&self, event_id: &str, payload: &Value) {
        let listeners: Vec<EventListener> = self
            .inner
            .event_listeners
            .lock()
            .get(event_id)
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        for l in listeners {
            l(payload.clone());
        }
    }

    /// Tears down the registry: awaits `close()` on every connected
    /// channel, drops every local and remote command, and clears all
    /// event listeners. In-flight executes and register requests fail
    /// with [`CommandError::ChannelDisconnected`] via the existing
    /// channel-close path.
    ///
    /// Mirrors the TypeScript library's `dispose()`, but async so that
    /// transports doing real teardown work (HTTP flush, MCP goodbye,
    /// plugin sandbox shutdown) complete before this returns.
    ///
    /// Callers normally don't need this — dropping the last
    /// `CommandRegistry` clone releases the inner state automatically
    /// via `Drop`. Use `dispose` when a *shared* registry (held through
    /// multiple clones) needs to be forcibly torn down, or in tests.
    pub async fn dispose(&self) {
        // Snapshot channel arcs so we can call `close` without holding
        // the channels lock for the duration.
        let channels: Vec<Arc<dyn CommandChannel>> = {
            let mut locked = self.inner.channels.lock();
            let out: Vec<_> = locked.values().cloned().collect();
            locked.clear();
            out
        };

        // Await each channel's close sequentially. Channels define
        // their own close semantics (InMemoryChannel is effectively
        // synchronous; MCPServerChannel flushes the transport; Flow's
        // SourceChannel tears down its QuickJS VM), so we let every
        // implementation finish its teardown before returning.
        for ch in channels {
            ch.close().await;
        }

        self.inner.local.lock().clear();
        self.inner.remote.lock().clear();
        self.inner.remote_defs.lock().clear();
        self.inner.event_listeners.lock().clear();
    }
}

impl Inner {
    fn local_command_defs(&self) -> Vec<CommandDef> {
        self.local
            .lock()
            .values()
            .filter(|e| !e.is_private)
            .map(|e| e.def.clone())
            .collect()
    }

    /// Central dispatcher invoked by each channel's driver loop.
    async fn handle_message(inner: Arc<Self>, channel: Arc<dyn CommandChannel>, msg: Message) {
        match msg {
            Message::RegisterCommandRequest { id, command } => {
                Self::handle_register_request(inner, channel, id, command).await;
            }
            Message::RegisterCommandResponse { thid, response, .. } => {
                if let Some(pending) = inner.register_replies.remove(&thid) {
                    let _ = pending.tx.send(response);
                }
            }
            Message::ListCommandsRequest { id } => {
                let commands = inner.local_command_defs();
                let _ = channel.send(Message::ListCommandsResponse {
                    id: MessageId::new_v4(),
                    thid: id,
                    commands,
                });
            }
            Message::ListCommandsResponse { commands, .. } => {
                let channel_id = channel.id().to_string();
                let mut remote = inner.remote.lock();
                let mut remote_defs = inner.remote_defs.lock();
                for cmd in commands {
                    // Normalize ingested schemas so the local cache
                    // matches what register() produces.
                    let cmd = CommandDef {
                        id: cmd.id,
                        description: cmd.description,
                        schema: cmd.schema.map(crate::schema::normalize_command_schema),
                    };
                    let entry_is_new = !remote.contains_key(&cmd.id);
                    if entry_is_new {
                        remote.insert(cmd.id.clone(), channel_id.clone());
                    }
                    // Always refresh the def (the latest advertisement wins).
                    remote_defs.insert(cmd.id.clone(), cmd);
                }
            }
            Message::ExecuteCommandRequest {
                id,
                command_id,
                request,
            } => {
                Self::handle_execute_request(
                    inner,
                    channel,
                    id,
                    command_id,
                    request.unwrap_or(Value::Null),
                )
                .await;
            }
            Message::ExecuteCommandResponse { thid, response, .. } => {
                Self::handle_execute_response(&inner, thid, response);
            }
            Message::Event {
                id,
                event_id,
                payload,
            } => {
                Self::handle_event(&inner, channel, id, event_id, payload);
            }
        }
    }

    async fn handle_register_request(
        inner: Arc<Self>,
        channel: Arc<dyn CommandChannel>,
        req_id: MessageId,
        command: CommandDef,
    ) {
        // Normalize ingested schemas so our cached copy is guaranteed
        // to be language-agnostic JSON Schema, even if the peer didn't
        // normalize on its side.
        let command = CommandDef {
            id: command.id,
            description: command.description,
            schema: command.schema.map(crate::schema::normalize_command_schema),
        };
        let channel_id = channel.id().to_string();
        let command_id = command.id.clone();

        // Duplicate against local?
        let dup = inner.local.lock().contains_key(&command_id);
        if dup {
            let _ = channel.send(Message::RegisterCommandResponse {
                id: MessageId::new_v4(),
                thid: req_id,
                response: RegisterResult::Err {
                    ok: False,
                    error: RegisterErrorCode::DuplicateCommand,
                },
            });
            return;
        }

        // Already known in the remote table (from another channel)?
        let dup_remote = inner
            .remote
            .lock()
            .get(&command_id)
            .map(|existing| existing != &channel_id)
            .unwrap_or(false);
        if dup_remote {
            let _ = channel.send(Message::RegisterCommandResponse {
                id: MessageId::new_v4(),
                thid: req_id,
                response: RegisterResult::Err {
                    ok: False,
                    error: RegisterErrorCode::DuplicateCommand,
                },
            });
            return;
        }

        // Escalate upstream if we have a router.
        if let Some(router_id) = inner.router_channel.clone() {
            if router_id != channel_id {
                let router_ch = inner.channels.lock().get(&router_id).cloned();
                if let Some(router_ch) = router_ch {
                    let up_id = MessageId::new_v4();
                    let (tx, rx) = oneshot::channel();
                    inner.register_replies.insert(
                        up_id,
                        PendingRegister {
                            tx,
                            target_channel: router_id,
                        },
                    );
                    if router_ch
                        .send(Message::RegisterCommandRequest {
                            id: up_id,
                            command: command.clone(),
                        })
                        .is_ok()
                    {
                        let up = rx.await;
                        match up {
                            Ok(RegisterResult::Ok { .. }) => {}
                            Ok(RegisterResult::Err { error, .. }) => {
                                let _ = channel.send(Message::RegisterCommandResponse {
                                    id: MessageId::new_v4(),
                                    thid: req_id,
                                    response: RegisterResult::Err { ok: False, error },
                                });
                                return;
                            }
                            Err(_) => {
                                let _ = channel.send(Message::RegisterCommandResponse {
                                    id: MessageId::new_v4(),
                                    thid: req_id,
                                    response: RegisterResult::Err {
                                        ok: False,
                                        error: RegisterErrorCode::DuplicateCommand,
                                    },
                                });
                                return;
                            }
                        }
                    }
                }
            }
        }

        inner.remote.lock().insert(command_id.clone(), channel_id);
        inner.remote_defs.lock().insert(command_id, command);
        let _ = channel.send(Message::RegisterCommandResponse {
            id: MessageId::new_v4(),
            thid: req_id,
            response: RegisterResult::Ok { ok: True },
        });
    }

    async fn handle_execute_request(
        inner: Arc<Self>,
        origin: Arc<dyn CommandChannel>,
        req_id: MessageId,
        command_id: String,
        request: Value,
    ) {
        // Local handler?
        let handler = inner
            .local
            .lock()
            .get(&command_id)
            .map(|e| e.handler.clone());
        if let Some(handler) = handler {
            let result = handler(request).await;
            let response = match result {
                Ok(v) => ExecuteResult::Ok {
                    ok: True,
                    // Void responses (`() → Value::Null`) are elided from
                    // the wire per the response schema (`result` optional).
                    result: value_to_wire(v),
                },
                Err(error) => ExecuteResult::Err { ok: False, error },
            };
            let _ = origin.send(Message::ExecuteCommandResponse {
                id: MessageId::new_v4(),
                thid: req_id,
                response,
            });
            return;
        }

        // Forward?
        let target_id = inner
            .remote
            .lock()
            .get(&command_id)
            .cloned()
            .or_else(|| inner.router_channel.clone());

        let origin_id = origin.id().to_string();
        let Some(target_id) = target_id else {
            let _ = origin.send(Message::ExecuteCommandResponse {
                id: MessageId::new_v4(),
                thid: req_id,
                response: ExecuteResult::Err {
                    ok: False,
                    error: ExecuteError {
                        code: ExecuteErrorCode::NotFound,
                        message: format!("command not found: {command_id}"),
                    },
                },
            });
            return;
        };

        if target_id == origin_id {
            // Would loop; treat as not found.
            let _ = origin.send(Message::ExecuteCommandResponse {
                id: MessageId::new_v4(),
                thid: req_id,
                response: ExecuteResult::Err {
                    ok: False,
                    error: ExecuteError {
                        code: ExecuteErrorCode::NotFound,
                        message: format!("command not found: {command_id}"),
                    },
                },
            });
            return;
        }

        let target = inner.channels.lock().get(&target_id).cloned();
        let Some(target) = target else {
            let _ = origin.send(Message::ExecuteCommandResponse {
                id: MessageId::new_v4(),
                thid: req_id,
                response: ExecuteResult::Err {
                    ok: False,
                    error: ExecuteError {
                        code: ExecuteErrorCode::ChannelDisconnected,
                        message: "target channel disconnected".into(),
                    },
                },
            });
            return;
        };

        inner.routes.insert(
            req_id,
            RouteEntry {
                origin_channel: origin_id,
                target_channel: target_id,
            },
        );
        let _ = target.send(Message::ExecuteCommandRequest {
            id: req_id,
            command_id,
            request: value_to_wire(request),
        });
    }

    fn handle_execute_response(inner: &Arc<Self>, thid: MessageId, response: ExecuteResult) {
        // Either this is a reply to a local call…
        if let Some(pending) = inner.execute_replies.remove(&thid) {
            let _ = pending.tx.send(response);
            return;
        }

        // …or we forwarded this request and need to route the reply.
        if let Some(route) = inner.routes.remove(&thid) {
            let origin = inner.channels.lock().get(&route.origin_channel).cloned();
            if let Some(origin) = origin {
                let _ = origin.send(Message::ExecuteCommandResponse {
                    id: MessageId::new_v4(),
                    thid,
                    response,
                });
            }
        }
    }

    fn handle_event(
        inner: &Arc<Self>,
        origin: Arc<dyn CommandChannel>,
        msg_id: MessageId,
        event_id: String,
        payload: Option<Value>,
    ) {
        if inner.seen_events.contains_key(&msg_id) {
            return;
        }
        inner.seen_events.insert(msg_id, ());

        let payload_value = payload.clone().unwrap_or(Value::Null);
        let listeners: Vec<EventListener> = inner
            .event_listeners
            .lock()
            .get(&event_id)
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        for l in listeners {
            l(payload_value.clone());
        }

        if event_id.starts_with('_') {
            return;
        }

        let channels: Vec<Arc<dyn CommandChannel>> = inner
            .channels
            .lock()
            .iter()
            .filter(|(k, _)| k.as_str() != origin.id())
            .map(|(_, v)| v.clone())
            .collect();
        for ch in channels {
            let _ = ch.send(Message::Event {
                id: msg_id,
                event_id: event_id.clone(),
                payload: payload.clone(),
            });
        }
    }

    /// Invoked by the driver once the channel returns `None` from recv.
    fn handle_channel_close(inner: &Arc<Self>, channel_id: &str) {
        // Drop the channel from the lookup table.
        inner.channels.lock().remove(channel_id);

        // Drop every remote command owned by this channel, along with
        // its cached definition.
        let dropped_ids: Vec<String> = {
            let mut remote = inner.remote.lock();
            let to_drop: Vec<String> = remote
                .iter()
                .filter(|(_, owner)| *owner == channel_id)
                .map(|(id, _)| id.clone())
                .collect();
            for id in &to_drop {
                remote.remove(id);
            }
            to_drop
        };
        let mut remote_defs = inner.remote_defs.lock();
        for id in dropped_ids {
            remote_defs.remove(&id);
        }
        drop(remote_defs);

        // Reject any pending executes whose response was expected from
        // this channel.
        let exec_ids: Vec<MessageId> = inner
            .execute_replies
            .snapshot_keys_where(|v| v.target_channel == channel_id);
        for id in exec_ids {
            if let Some(pending) = inner.execute_replies.remove(&id) {
                let _ = pending.tx.send(ExecuteResult::Err {
                    ok: False,
                    error: ExecuteError {
                        code: ExecuteErrorCode::ChannelDisconnected,
                        message: "channel disconnected".into(),
                    },
                });
            }
        }

        let reg_ids: Vec<MessageId> = inner
            .register_replies
            .snapshot_keys_where(|v| v.target_channel == channel_id);
        for id in reg_ids {
            if let Some(pending) = inner.register_replies.remove(&id) {
                // The Err channel is a oneshot drop; we deliberately do
                // not synthesize a wire-level error here, since the
                // caller's await will see `Err(Canceled)` which our
                // register path maps to `ChannelDisconnected`.
                drop(pending);
            }
        }

        // For every route where either endpoint is the dead channel,
        // notify the origin (if it is still alive).
        let route_ids: Vec<MessageId> = inner.routes.snapshot_keys_where(|r| {
            r.origin_channel == channel_id || r.target_channel == channel_id
        });
        for id in route_ids {
            if let Some(route) = inner.routes.remove(&id) {
                if route.origin_channel == channel_id {
                    continue;
                }
                let origin = inner.channels.lock().get(&route.origin_channel).cloned();
                if let Some(origin) = origin {
                    let _ = origin.send(Message::ExecuteCommandResponse {
                        id: MessageId::new_v4(),
                        thid: id,
                        response: ExecuteResult::Err {
                            ok: False,
                            error: ExecuteError {
                                code: ExecuteErrorCode::ChannelDisconnected,
                                message: "target channel disconnected".into(),
                            },
                        },
                    });
                }
            }
        }
    }
}

// ------- helpers -----------------------------------------------------

fn command_error_to_execute(e: &CommandError, command_id: &str) -> ExecuteError {
    match e {
        CommandError::InvalidRequest { message, .. } => ExecuteError {
            code: ExecuteErrorCode::InvalidRequest,
            message: message.clone(),
        },
        CommandError::Internal { message, .. } => ExecuteError {
            code: ExecuteErrorCode::InternalError,
            message: message.clone(),
        },
        CommandError::Timeout => ExecuteError {
            code: ExecuteErrorCode::Timeout,
            message: "request timed out".into(),
        },
        CommandError::ChannelDisconnected => ExecuteError {
            code: ExecuteErrorCode::ChannelDisconnected,
            message: "channel disconnected".into(),
        },
        CommandError::NotFound(id) => ExecuteError {
            code: ExecuteErrorCode::NotFound,
            message: format!("command not found: {id}"),
        },
        _ => ExecuteError {
            code: ExecuteErrorCode::InternalError,
            message: format!("{e} [command {command_id}]"),
        },
    }
}

fn error_to_command_error(err: ExecuteError, command_id: &str) -> CommandError {
    match err.code {
        ExecuteErrorCode::NotFound => CommandError::NotFound(command_id.into()),
        ExecuteErrorCode::InvalidRequest => CommandError::InvalidRequest {
            command_id: command_id.into(),
            message: err.message,
        },
        ExecuteErrorCode::InternalError => CommandError::Internal {
            command_id: command_id.into(),
            message: err.message,
        },
        ExecuteErrorCode::Timeout => CommandError::Timeout,
        ExecuteErrorCode::ChannelDisconnected => CommandError::ChannelDisconnected,
    }
}

// Small convenience on ExecuteError.
impl ExecuteError {
    fn into_command_error(self, command_id: &str) -> CommandError {
        error_to_command_error(self, command_id)
    }
}

/// Collapse a serialized request/result/payload value to `None` when it
/// is JSON `null`. This is what makes void commands and events
/// spec-compliant on the wire: `request` / `result` / `payload` are all
/// optional fields in the JSON schemas, so an absent value must be
/// encoded by omitting the key, not by emitting `null`.
///
/// Used on every outgoing `execute.command.request`,
/// `execute.command.response` success, and `event` message.
fn value_to_wire(v: Value) -> Option<Value> {
    if v.is_null() {
        None
    } else {
        Some(v)
    }
}

/// Serialize a strict-mode request value to JSON. Wraps `serde_json`
/// with the right error type for the strict `execute::<C>` path.
fn value_from_request<T: Serialize>(v: &T) -> Result<Value, CommandError> {
    serde_json::to_value(v).map_err(CommandError::Serde)
}
