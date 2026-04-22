//! MCP server adapter that exposes a [`CommandRegistry`](coralstack_cmd_ipc::CommandRegistry)
//! as Model Context Protocol tools.
//!
//! [`McpServerChannel`] implements [`CommandChannel`](coralstack_cmd_ipc::CommandChannel),
//! so it plugs into a registry the same way any other channel does:
//!
//! ```no_run
//! use std::sync::Arc;
//! use coralstack_cmd_ipc::prelude::*;
//! use coralstack_cmd_ipc_mcp::McpServerChannel;
//!
//! # async fn run() -> Result<(), Box<dyn std::error::Error>> {
//! let registry = CommandRegistry::new(Config::default());
//! // ... registry.register_command(...) etc ...
//!
//! // Register the MCP channel like any other channel.
//! let mcp = Arc::new(McpServerChannel::new("mcp"));
//! let driver = registry.register_channel(mcp.clone()).await?;
//! tokio::spawn(driver);
//!
//! // Drive the MCP protocol over stdio. Completes when the MCP client
//! // disconnects; the channel remains registered until explicitly closed.
//! mcp.serve_stdio().await?;
//! # Ok(()) }
//! ```
//!
//! Every non-private command in the registry is exposed to the MCP
//! client as a tool; private commands (id prefixed with `_`) are never
//! surfaced. `tools/list` and `tools/call` from the MCP client generate
//! `list.commands.request` / `execute.command.request` messages on the
//! cmd-ipc wire, so the registry's full routing machinery (local,
//! remote via channel, escalation to a router) applies just as for any
//! other caller.

mod server;
mod translate;

pub use server::{McpServerChannel, McpServerError};
