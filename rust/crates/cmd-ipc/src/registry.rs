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

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::channel::oneshot;
use futures::future::BoxFuture;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::channel::CommandChannel;
use crate::command::Command;
use crate::error::{ChannelError, CommandError, ExecuteErrorCode, RegisterErrorCode};
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

type HandlerFn =
    dyn Fn(Value) -> BoxFuture<'static, Result<Value, ExecuteError>> + Send + Sync;
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
    remote: Mutex<HashMap<String, String>>,
    channels: Mutex<HashMap<String, Arc<dyn CommandChannel>>>,
    execute_replies: TtlMap<MessageId, PendingExecute>,
    register_replies: TtlMap<MessageId, PendingRegister>,
    routes: TtlMap<MessageId, RouteEntry>,
    seen_events: TtlMap<MessageId, ()>,
    event_listeners: Mutex<HashMap<String, Vec<EventListener>>>,
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
            channels: Mutex::new(HashMap::new()),
            execute_replies: TtlMap::new(cfg.request_ttl),
            register_replies: TtlMap::new(cfg.request_ttl),
            routes: TtlMap::new(cfg.request_ttl),
            seen_events: TtlMap::new(cfg.event_ttl),
            event_listeners: Mutex::new(HashMap::new()),
        });
        Self { inner }
    }

    /// Returns this registry's identifier.
    pub fn id(&self) -> &str {
        &self.inner.id
    }

    /// Registers a typed [`Command`].
    ///
    /// If the registry has a `router_channel`, non-private commands are
    /// first escalated upstream; the local entry is only added after
    /// the router acks.
    pub async fn register<C: Command>(&self, cmd: C) -> Result<(), CommandError> {
        let id = C::ID.to_string();
        let is_private = id.starts_with('_');
        let def = CommandDef {
            id: id.clone(),
            description: C::DESCRIPTION.map(String::from),
            schema: C::schema(),
        };
        let handler = make_handler::<C>(Arc::new(cmd));
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
        if self.inner.local.lock().unwrap().contains_key(&id) {
            return Err(CommandError::DuplicateCommand(id));
        }

        // Non-private commands escalate to the router before being added.
        if !is_private {
            if let Some(router_id) = self.inner.router_channel.clone() {
                let router_ch =
                    self.inner.channels.lock().unwrap().get(&router_id).cloned();
                if let Some(router_ch) = router_ch {
                    let req_id = MessageId::new_v4();
                    let (tx, rx) = oneshot::channel();
                    self.inner.register_replies.insert(
                        req_id,
                        PendingRegister { tx, target_channel: router_id.clone() },
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

        self.inner
            .local
            .lock()
            .unwrap()
            .insert(id, LocalEntry { handler, def, is_private });
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
            let mut chans = self.inner.channels.lock().unwrap();
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
        if let Err(e) = channel.send(Message::ListCommandsRequest { id: MessageId::new_v4() }) {
            self.inner.channels.lock().unwrap().remove(&id);
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

    /// Executes a command. Looks up in local, then remote, then
    /// escalates to `router_channel`.
    pub async fn execute<Req, Res>(
        &self,
        command_id: &str,
        request: Req,
    ) -> Result<Res, CommandError>
    where
        Req: Serialize,
        Res: DeserializeOwned,
    {
        let req_value = serde_json::to_value(request)?;
        let result = self
            .execute_raw(command_id.to_string(), req_value)
            .await?;
        let deserialized = serde_json::from_value(result.unwrap_or(Value::Null))?;
        Ok(deserialized)
    }

    /// Executes a command with a pre-encoded request payload. Returns
    /// the raw response JSON (or `None` if the handler returned unit).
    pub async fn execute_raw(
        &self,
        command_id: String,
        request: Value,
    ) -> Result<Option<Value>, CommandError> {
        // 1) Local handler wins.
        let local_handler = self
            .inner
            .local
            .lock()
            .unwrap()
            .get(&command_id)
            .map(|entry| entry.handler.clone());
        if let Some(handler) = local_handler {
            return handler(request).await.map(Some).map_err(|e| e.into_command_error(&command_id));
        }

        // 2) Known remote command.
        let remote_target = self.inner.remote.lock().unwrap().get(&command_id).cloned();
        let target = match remote_target {
            Some(t) => Some(t),
            None => self.inner.router_channel.clone(),
        };

        let Some(target_id) = target else {
            return Err(CommandError::NotFound(command_id));
        };

        let channel =
            self.inner.channels.lock().unwrap().get(&target_id).cloned();
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
            PendingExecute { tx, target_channel: target_id },
        );
        channel
            .send(Message::ExecuteCommandRequest {
                id: req_id,
                command_id: command_id.clone(),
                request: Some(request),
            })
            .map_err(|_| CommandError::ChannelDisconnected)?;

        match rx.await {
            Ok(ExecuteResult::Ok { result, .. }) => Ok(result),
            Ok(ExecuteResult::Err { error, .. }) => {
                Err(error_to_command_error(error, &command_id))
            }
            Err(_) => {
                self.inner.execute_replies.remove(&req_id);
                Err(CommandError::ChannelDisconnected)
            }
        }
    }

    /// Emits an event to local listeners and (unless the event id is
    /// private, i.e. starts with `_`) broadcasts to every connected
    /// channel.
    pub fn emit_event<P: Serialize>(
        &self,
        event_id: &str,
        payload: P,
    ) -> Result<(), CommandError> {
        let payload_value = serde_json::to_value(payload)?;
        let msg_id = MessageId::new_v4();
        self.inner.seen_events.insert(msg_id, ());

        self.dispatch_event_locally(event_id, &payload_value);

        if !event_id.starts_with('_') {
            let channels: Vec<Arc<dyn CommandChannel>> = self
                .inner
                .channels
                .lock()
                .unwrap()
                .values()
                .cloned()
                .collect();
            for ch in channels {
                let _ = ch.send(Message::Event {
                    id: msg_id,
                    event_id: event_id.to_string(),
                    payload: Some(payload_value.clone()),
                });
            }
        }
        Ok(())
    }

    /// Subscribes a listener that fires whenever an event with the
    /// given id is emitted or received.
    pub fn on_event<F>(&self, event_id: &str, listener: F)
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        self.inner
            .event_listeners
            .lock()
            .unwrap()
            .entry(event_id.to_string())
            .or_default()
            .push(Arc::new(listener));
    }

    fn dispatch_event_locally(&self, event_id: &str, payload: &Value) {
        let listeners = self
            .inner
            .event_listeners
            .lock()
            .unwrap()
            .get(event_id)
            .cloned()
            .unwrap_or_default();
        for l in listeners {
            l(payload.clone());
        }
    }
}

impl Inner {
    fn local_command_defs(&self) -> Vec<CommandDef> {
        self.local
            .lock()
            .unwrap()
            .values()
            .filter(|e| !e.is_private)
            .map(|e| e.def.clone())
            .collect()
    }

    /// Central dispatcher invoked by each channel's driver loop.
    async fn handle_message(
        inner: Arc<Self>,
        channel: Arc<dyn CommandChannel>,
        msg: Message,
    ) {
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
                let mut remote = inner.remote.lock().unwrap();
                for cmd in commands {
                    remote.entry(cmd.id).or_insert_with(|| channel_id.clone());
                }
            }
            Message::ExecuteCommandRequest { id, command_id, request } => {
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
            Message::Event { id, event_id, payload } => {
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
        let channel_id = channel.id().to_string();
        let command_id = command.id.clone();

        // Duplicate against local?
        let dup = inner.local.lock().unwrap().contains_key(&command_id);
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
            .unwrap()
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
                let router_ch = inner.channels.lock().unwrap().get(&router_id).cloned();
                if let Some(router_ch) = router_ch {
                    let up_id = MessageId::new_v4();
                    let (tx, rx) = oneshot::channel();
                    inner.register_replies.insert(
                        up_id,
                        PendingRegister { tx, target_channel: router_id },
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

        inner
            .remote
            .lock()
            .unwrap()
            .insert(command_id, channel_id);
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
            .unwrap()
            .get(&command_id)
            .map(|e| e.handler.clone());
        if let Some(handler) = handler {
            let result = handler(request).await;
            let response = match result {
                Ok(v) => ExecuteResult::Ok { ok: True, result: Some(v) },
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
            .unwrap()
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

        let target = inner.channels.lock().unwrap().get(&target_id).cloned();
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
            RouteEntry { origin_channel: origin_id, target_channel: target_id },
        );
        let _ = target.send(Message::ExecuteCommandRequest {
            id: req_id,
            command_id,
            request: Some(request),
        });
    }

    fn handle_execute_response(
        inner: &Arc<Self>,
        thid: MessageId,
        response: ExecuteResult,
    ) {
        // Either this is a reply to a local call…
        if let Some(pending) = inner.execute_replies.remove(&thid) {
            let _ = pending.tx.send(response);
            return;
        }

        // …or we forwarded this request and need to route the reply.
        if let Some(route) = inner.routes.remove(&thid) {
            let origin = inner
                .channels
                .lock()
                .unwrap()
                .get(&route.origin_channel)
                .cloned();
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
        let listeners = inner
            .event_listeners
            .lock()
            .unwrap()
            .get(&event_id)
            .cloned()
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
            .unwrap()
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
        inner.channels.lock().unwrap().remove(channel_id);

        // Drop every remote command owned by this channel.
        inner
            .remote
            .lock()
            .unwrap()
            .retain(|_, owner| owner != channel_id);

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
                let origin = inner
                    .channels
                    .lock()
                    .unwrap()
                    .get(&route.origin_channel)
                    .cloned();
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

fn make_handler<C: Command>(cmd: Arc<C>) -> Arc<HandlerFn> {
    Arc::new(move |value: Value| {
        let cmd = cmd.clone();
        Box::pin(async move {
            let req: C::Request = serde_json::from_value(value).map_err(|e| ExecuteError {
                code: ExecuteErrorCode::InvalidRequest,
                message: e.to_string(),
            })?;
            let res = cmd.handle(req).await.map_err(|e| command_error_to_execute(&e, C::ID))?;
            serde_json::to_value(res).map_err(|e| ExecuteError {
                code: ExecuteErrorCode::InternalError,
                message: e.to_string(),
            })
        })
    })
}

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
