//! [`McpServerChannel`] — adapts a [`CommandRegistry`] into an rmcp
//! `ServerHandler`, serving cmd-ipc commands as MCP tools.

use coralstack_cmd_ipc::CommandRegistry;
use rmcp::handler::server::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, Implementation, ListToolsResult, PaginatedRequestParams,
    ServerCapabilities, ServerInfo,
};
use rmcp::service::RequestContext;
use rmcp::transport::io::stdio;
use rmcp::{ErrorData as McpError, RoleServer, ServiceExt};

use crate::translate::{
    command_to_tool, execute_error_to_call_result, is_tool_not_found, mcp_error_for_unknown_tool,
    success_to_call_result,
};

/// Errors raised by [`McpServerChannel`].
#[derive(Debug, thiserror::Error)]
pub enum McpServerError {
    #[error("MCP transport error: {0}")]
    Transport(String),
    #[error("MCP protocol error: {0}")]
    Protocol(String),
}

/// Adapter that exposes a [`CommandRegistry`] as an MCP server.
///
/// Holds a cheaply-cloned registry handle and an
/// [`Implementation`] descriptor advertised to MCP clients in
/// `initialize` responses.
#[derive(Clone)]
pub struct McpServerChannel {
    registry: CommandRegistry,
    impl_name: String,
    impl_version: String,
    instructions: Option<String>,
}

impl McpServerChannel {
    /// Creates a new adapter bound to `registry`. The adapter advertises
    /// a default implementation name (`cmd-ipc-mcp`) and the cmd-ipc-mcp
    /// crate version. Use [`with_implementation`](Self::with_implementation)
    /// to customize.
    pub fn new(registry: CommandRegistry) -> Self {
        Self {
            registry,
            impl_name: "cmd-ipc-mcp".into(),
            impl_version: env!("CARGO_PKG_VERSION").into(),
            instructions: None,
        }
    }

    /// Overrides the implementation name and version reported to MCP
    /// clients on initialize.
    pub fn with_implementation(
        mut self,
        name: impl Into<String>,
        version: impl Into<String>,
    ) -> Self {
        self.impl_name = name.into();
        self.impl_version = version.into();
        self
    }

    /// Attaches an `instructions` string surfaced to MCP clients on
    /// initialize. Useful for orienting agents to what the registered
    /// commands are for.
    pub fn with_instructions(mut self, instructions: impl Into<String>) -> Self {
        self.instructions = Some(instructions.into());
        self
    }

    /// Runs the server over stdin / stdout — the transport local agents
    /// use when they spawn the server as a child process. Future resolves
    /// when the client disconnects or the pipe closes.
    pub async fn serve_stdio(self) -> Result<(), McpServerError> {
        let service = self
            .serve(stdio())
            .await
            .map_err(|e| McpServerError::Transport(e.to_string()))?;
        service
            .waiting()
            .await
            .map_err(|e| McpServerError::Protocol(e.to_string()))?;
        Ok(())
    }
}

impl ServerHandler for McpServerChannel {
    fn get_info(&self) -> ServerInfo {
        let capabilities = ServerCapabilities::builder().enable_tools().build();
        let implementation = Implementation::new(self.impl_name.clone(), self.impl_version.clone());
        let mut info = ServerInfo::new(capabilities).with_server_info(implementation);
        if let Some(ref s) = self.instructions {
            info = info.with_instructions(s.clone());
        }
        info
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let defs = self.registry.list_commands();
        let tools = defs.iter().map(command_to_tool).collect();
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
        // Private commands (leading `_`) are never exposed as MCP tools,
        // so calling one by name is always a client error.
        if name.starts_with('_') {
            return Err(mcp_error_for_unknown_tool(&name));
        }
        let payload = request
            .arguments
            .map(serde_json::Value::Object)
            .unwrap_or(serde_json::Value::Null);
        match self
            .registry
            .execute_command::<serde_json::Value, serde_json::Value>(&name, payload)
            .await
        {
            Ok(serde_json::Value::Null) => Ok(success_to_call_result(None)),
            Ok(result) => Ok(success_to_call_result(Some(result))),
            Err(err) => {
                let exec_err = command_error_to_execute_error(err);
                if is_tool_not_found(&exec_err) {
                    Err(mcp_error_for_unknown_tool(&name))
                } else {
                    Ok(execute_error_to_call_result(exec_err))
                }
            }
        }
    }
}

fn command_error_to_execute_error(
    err: coralstack_cmd_ipc::CommandError,
) -> coralstack_cmd_ipc::ExecuteError {
    use coralstack_cmd_ipc::{CommandError as CE, ExecuteError, ExecuteErrorCode as Code};
    match err {
        CE::NotFound(id) => ExecuteError {
            code: Code::NotFound,
            message: format!("command `{id}` not registered"),
        },
        CE::DuplicateCommand(id) => ExecuteError {
            code: Code::InvalidRequest,
            message: format!("duplicate command `{id}`"),
        },
        CE::InvalidRequest {
            command_id,
            message,
        } => ExecuteError {
            code: Code::InvalidRequest,
            message: format!("{command_id}: {message}"),
        },
        CE::Internal {
            command_id,
            message,
        } => ExecuteError {
            code: Code::InternalError,
            message: format!("{command_id}: {message}"),
        },
        CE::Timeout => ExecuteError {
            code: Code::Timeout,
            message: "command timed out".into(),
        },
        CE::ChannelDisconnected => ExecuteError {
            code: Code::ChannelDisconnected,
            message: "channel disconnected".into(),
        },
        CE::Serde(e) => ExecuteError {
            code: Code::InvalidRequest,
            message: format!("serde error: {e}"),
        },
        CE::InvalidMessage(m) => ExecuteError {
            code: Code::InvalidRequest,
            message: format!("invalid message: {m}"),
        },
    }
}
