//! MCP server adapter that exposes a [`CommandRegistry`](coralstack_cmd_ipc::CommandRegistry)
//! as Model Context Protocol tools.
//!
//! Plug this into a registry when you want a local MCP agent (Claude
//! Desktop, Cursor, etc.) to see every command the registry advertises
//! as a callable tool. Every non-private command is exposed; private
//! commands (id prefixed with `_`) are never surfaced.
//!
//! Example (stdio transport, the usual way local agents spawn servers):
//!
//! ```no_run
//! use coralstack_cmd_ipc::prelude::*;
//! use coralstack_cmd_ipc_mcp::McpServerChannel;
//!
//! # async fn run() -> Result<(), Box<dyn std::error::Error>> {
//! let registry = CommandRegistry::new(Config::default());
//! // ... registry.register_command(...) etc ...
//!
//! let mcp = McpServerChannel::new(registry);
//! mcp.serve_stdio().await?;
//! # Ok(()) }
//! ```
//!
//! The adapter holds a clone of the registry (cheap — the registry is
//! internally `Arc`). `tools/list` reads [`CommandRegistry::list_commands`]
//! at call time, so commands registered or unregistered after the server
//! starts show up in the next list request. `tools/call` forwards to
//! [`CommandRegistry::execute_command`] — the call goes through the
//! registry's full routing machinery (local, remote via channel, or
//! escalation to a router), just like any other caller.

mod server;
mod translate;

pub use server::{McpServerChannel, McpServerError};
