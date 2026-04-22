//! [`McpServerChannel`] — a [`CommandChannel`] that translates between
//! MCP requests and cmd-ipc wire messages.
//!
//! The channel is a pure translation layer. It speaks cmd-ipc on one
//! side ([`send`](CommandChannel::send) / [`recv`](CommandChannel::recv))
//! and MCP on the other (via an internal rmcp `ServerHandler`). No
//! registry handle is held — it plugs into any registry the same way
//! [`InMemoryChannel`](coralstack_cmd_ipc::InMemoryChannel) does.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use coralstack_cmd_ipc::{
    ChannelError, CommandChannel, CommandDef, ExecuteResult, Message, MessageId,
};
use futures::channel::mpsc::{unbounded, UnboundedReceiver, UnboundedSender};
use futures::channel::oneshot;
use futures::future::BoxFuture;
use futures::lock::Mutex as AsyncMutex;
use futures::StreamExt;
use rmcp::handler::server::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, Implementation, ListToolsResult, PaginatedRequestParams,
    ServerCapabilities, ServerInfo,
};
use rmcp::service::RequestContext;
use rmcp::transport::IntoTransport;
use rmcp::{ErrorData as McpError, RoleServer, ServiceExt};
use serde_json::Value;

use crate::translate::{
    command_to_tool, execute_error_to_call_result, is_tool_not_found, mcp_error_for_unknown_tool,
    success_to_call_result,
};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Errors raised by [`McpServerChannel`].
#[derive(Debug, thiserror::Error)]
pub enum McpServerError {
    #[error("MCP transport error: {0}")]
    Transport(String),
    #[error("MCP protocol error: {0}")]
    Protocol(String),
}

/// A [`CommandChannel`] that exposes a [`CommandRegistry`](coralstack_cmd_ipc::CommandRegistry)
/// as an MCP server.
///
/// ```ignore
/// let mcp = Arc::new(McpServerChannel::new("mcp"));
/// let driver = registry.register_channel(mcp.clone()).await?;
/// tokio::spawn(driver);
///
/// // Drive the MCP protocol; completes when the MCP client disconnects.
/// mcp.serve_stdio().await?;
/// ```
///
/// When the MCP client sends `tools/list` or `tools/call`, the channel
/// emits the corresponding cmd-ipc `ListCommandsRequest` /
/// `ExecuteCommandRequest` on its `recv()` side. The registry processes
/// the message with its normal routing and returns the response via
/// `send()`, which the channel correlates back to the waiting MCP call
/// by `thid`.
pub struct McpServerChannel {
    id: String,
    impl_name: Mutex<String>,
    impl_version: Mutex<String>,
    instructions: Mutex<Option<String>>,
    timeout: Mutex<Duration>,

    // Outbound to the registry: MCP handler pushes, registry polls via recv().
    tx: UnboundedSender<Message>,
    rx: AsyncMutex<Option<UnboundedReceiver<Message>>>,

    // Pending MCP-originated requests, keyed by the message id we minted.
    pending_lists: Mutex<HashMap<MessageId, oneshot::Sender<Vec<CommandDef>>>>,
    pending_calls: Mutex<HashMap<MessageId, oneshot::Sender<ExecuteResult>>>,

    closed: AtomicBool,
}

impl McpServerChannel {
    /// Creates a new channel with the given id. Advertises a default
    /// implementation name (`cmd-ipc-mcp`) and the cmd-ipc-mcp crate
    /// version; override with [`with_implementation`](Self::with_implementation).
    pub fn new(id: impl Into<String>) -> Self {
        let (tx, rx) = unbounded();
        Self {
            id: id.into(),
            impl_name: Mutex::new("cmd-ipc-mcp".into()),
            impl_version: Mutex::new(env!("CARGO_PKG_VERSION").into()),
            instructions: Mutex::new(None),
            timeout: Mutex::new(DEFAULT_TIMEOUT),
            tx,
            rx: AsyncMutex::new(Some(rx)),
            pending_lists: Mutex::new(HashMap::new()),
            pending_calls: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
        }
    }

    /// Overrides the implementation name and version reported to MCP
    /// clients on `initialize`.
    pub fn with_implementation(self, name: impl Into<String>, version: impl Into<String>) -> Self {
        *self.impl_name.lock().unwrap() = name.into();
        *self.impl_version.lock().unwrap() = version.into();
        self
    }

    /// Attaches an `instructions` string surfaced to MCP clients on
    /// `initialize`. Useful for orienting agents to what the registered
    /// commands are for.
    pub fn with_instructions(self, instructions: impl Into<String>) -> Self {
        *self.instructions.lock().unwrap() = Some(instructions.into());
        self
    }

    /// Sets the timeout for MCP-originated requests waiting on a registry
    /// response. Defaults to 30 seconds.
    pub fn with_timeout(self, timeout: Duration) -> Self {
        *self.timeout.lock().unwrap() = timeout;
        self
    }

    /// Drives the MCP protocol over `transport`. Accepts any rmcp
    /// transport — stdio (shipped out of the box), a
    /// `(AsyncRead, AsyncWrite)` pair, a TCP stream,
    /// `tokio::io::duplex`, and so on. Completes when the MCP client
    /// disconnects.
    ///
    /// ```ignore
    /// // Stdio — for local agents spawning the server as a child process.
    /// mcp.clone().serve(rmcp::transport::io::stdio()).await?;
    ///
    /// // TCP socket (enable rmcp's `transport-async-rw` feature).
    /// let stream = tokio::net::TcpStream::connect("127.0.0.1:4000").await?;
    /// mcp.clone().serve(stream).await?;
    /// ```
    ///
    /// For multi-session HTTP the MCP spec requires one handler per
    /// session, which doesn't fit a single-transport `serve`. Build your
    /// own HTTP integration (axum, actix, warp, …) using
    /// [`into_handler`](Self::into_handler) as the per-session factory.
    pub async fn serve<T, E, A>(self: Arc<Self>, transport: T) -> Result<(), McpServerError>
    where
        T: IntoTransport<RoleServer, E, A>,
        E: std::error::Error + Send + Sync + 'static,
    {
        let handler = McpHandler { channel: self };
        let service = handler
            .serve(transport)
            .await
            .map_err(|e| McpServerError::Transport(e.to_string()))?;
        service
            .waiting()
            .await
            .map_err(|e| McpServerError::Protocol(e.to_string()))?;
        Ok(())
    }

    /// Convenience wrapper: `serve(rmcp::transport::io::stdio())`.
    pub async fn serve_stdio(self: Arc<Self>) -> Result<(), McpServerError> {
        self.serve(rmcp::transport::io::stdio()).await
    }

    /// Returns an rmcp [`ServerHandler`] backed by this channel. Use
    /// this to plug the channel into any HTTP framework (axum, actix,
    /// warp, …) as a per-session handler factory, since the MCP HTTP
    /// spec requires one handler per session.
    ///
    /// `Arc::clone` is cheap, so a session manager can mint a fresh
    /// handler per incoming HTTP session while all of them share one
    /// channel and its underlying registry.
    pub fn into_handler(self: Arc<Self>) -> impl ServerHandler + Clone {
        McpHandler { channel: self }
    }

    fn server_info(&self) -> ServerInfo {
        let capabilities = ServerCapabilities::builder().enable_tools().build();
        let implementation = Implementation::new(
            self.impl_name.lock().unwrap().clone(),
            self.impl_version.lock().unwrap().clone(),
        );
        let mut info = ServerInfo::new(capabilities).with_server_info(implementation);
        if let Some(ref s) = *self.instructions.lock().unwrap() {
            info = info.with_instructions(s.clone());
        }
        info
    }

    fn timeout_duration(&self) -> Duration {
        *self.timeout.lock().unwrap()
    }
}

impl CommandChannel for McpServerChannel {
    fn id(&self) -> &str {
        &self.id
    }

    fn start(&self) -> BoxFuture<'_, Result<(), ChannelError>> {
        Box::pin(async { Ok(()) })
    }

    fn close(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            self.closed.store(true, Ordering::SeqCst);
            // Closing the outbound sender ends the registry's recv loop.
            self.tx.close_channel();
            // Drop any outstanding waiters; their oneshots will resolve
            // to Err so serve_* calls surface a clean error.
            self.pending_lists.lock().unwrap().clear();
            self.pending_calls.lock().unwrap().clear();
        })
    }

    /// Registry → channel: responses to MCP-originated requests.
    ///
    /// Only response messages are interesting here — everything else
    /// (the registration probe, events, unrelated requests) is safely
    /// dropped, because the MCP side doesn't advertise or care about
    /// them.
    fn send(&self, msg: Message) -> Result<(), ChannelError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(ChannelError::Closed);
        }
        match msg {
            Message::ListCommandsResponse { thid, commands, .. } => {
                if let Some(tx) = self.pending_lists.lock().unwrap().remove(&thid) {
                    let _ = tx.send(commands);
                }
            }
            Message::ExecuteCommandResponse { thid, response, .. } => {
                if let Some(tx) = self.pending_calls.lock().unwrap().remove(&thid) {
                    let _ = tx.send(response);
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// Channel → registry: messages minted by the MCP handler in
    /// response to incoming `tools/list` and `tools/call` calls.
    fn recv(&self) -> BoxFuture<'_, Option<Message>> {
        Box::pin(async move {
            let mut guard = self.rx.lock().await;
            let rx = guard.as_mut()?;
            rx.next().await
        })
    }
}

/// Cheap-to-clone rmcp handler. Holds an `Arc` of the channel so
/// multiple handlers (e.g. one per HTTP session) can share one channel.
#[derive(Clone)]
struct McpHandler {
    channel: Arc<McpServerChannel>,
}

impl McpHandler {
    /// Shared request/response round-trip: mint an id, register a
    /// oneshot waiter, push the request onto the registry's recv queue,
    /// and await the response (with timeout).
    async fn round_trip<T, F>(
        &self,
        build_request: impl FnOnce(MessageId) -> Message,
        register_pending: F,
    ) -> Result<T, McpError>
    where
        F: FnOnce(MessageId, oneshot::Sender<T>, &McpServerChannel),
    {
        let id = MessageId::new_v4();
        let (sender, receiver) = oneshot::channel();
        register_pending(id, sender, &self.channel);

        if let Err(e) = self.channel.tx.unbounded_send(build_request(id)) {
            return Err(McpError::internal_error(
                format!("cmd-ipc channel closed: {e}"),
                None,
            ));
        }

        match tokio::time::timeout(self.channel.timeout_duration(), receiver).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => Err(McpError::internal_error(
                "cmd-ipc channel closed before response".to_string(),
                None,
            )),
            Err(_) => Err(McpError::internal_error(
                "timed out waiting for cmd-ipc response".to_string(),
                None,
            )),
        }
    }
}

impl ServerHandler for McpHandler {
    fn get_info(&self) -> ServerInfo {
        self.channel.server_info()
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let defs = self
            .round_trip(
                |id| Message::ListCommandsRequest { id },
                |id, sender, ch| {
                    ch.pending_lists.lock().unwrap().insert(id, sender);
                },
            )
            .await?;
        // Filter private commands defensively — the registry already
        // strips them from `local_command_defs`, but this guards against
        // remote-advertised private commands leaking via a peer channel.
        let tools = defs
            .iter()
            .filter(|d| !d.id.starts_with('_'))
            .map(command_to_tool)
            .collect();
        Ok(ListToolsResult {
            tools,
            next_cursor: None,
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let name = request.name.to_string();
        if name.starts_with('_') {
            return Err(mcp_error_for_unknown_tool(&name));
        }
        let payload = request.arguments.map(Value::Object).unwrap_or(Value::Null);
        let request_payload = if payload.is_null() {
            None
        } else {
            Some(payload)
        };
        let command_id = name.clone();

        let response = self
            .round_trip(
                |id| Message::ExecuteCommandRequest {
                    id,
                    command_id: command_id.clone(),
                    request: request_payload.clone(),
                },
                |id, sender, ch| {
                    ch.pending_calls.lock().unwrap().insert(id, sender);
                },
            )
            .await?;

        match response {
            ExecuteResult::Ok {
                result: Some(Value::Null),
                ..
            }
            | ExecuteResult::Ok { result: None, .. } => Ok(success_to_call_result(None)),
            ExecuteResult::Ok {
                result: Some(value),
                ..
            } => Ok(success_to_call_result(Some(value))),
            ExecuteResult::Err { error, .. } => {
                if is_tool_not_found(&error) {
                    Err(mcp_error_for_unknown_tool(&name))
                } else {
                    Ok(execute_error_to_call_result(error))
                }
            }
        }
    }
}
