//! Error types for the command registry.
//!
//! Mirrors the error hierarchy in
//! `packages/cmd-ipc/src/registry/command-errors.ts` so the wire-level
//! error codes stay byte-identical across the Rust and TypeScript
//! implementations.

use serde::{Deserialize, Serialize};

/// Error codes returned when registering a command fails.
///
/// Matches the TypeScript `CommandRegisterErrorCode` enum.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegisterErrorCode {
    DuplicateCommand,
}

/// Error codes returned when executing a command fails.
///
/// Matches the TypeScript `ExecuteCommandResponseErrorCode` enum.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteErrorCode {
    NotFound,
    InvalidRequest,
    InternalError,
    Timeout,
    ChannelDisconnected,
}

/// Errors raised by the command registry on the Rust side.
#[derive(thiserror::Error, Debug)]
pub enum CommandError {
    #[error("invalid message: {0}")]
    InvalidMessage(String),

    #[error("duplicate command registration: {0}")]
    DuplicateCommand(String),

    #[error("command not found: {0}")]
    NotFound(String),

    #[error("invalid request for command {command_id}: {message}")]
    InvalidRequest { command_id: String, message: String },

    #[error("internal error executing command {command_id}: {message}")]
    Internal { command_id: String, message: String },

    #[error("request timed out")]
    Timeout,

    #[error("channel disconnected")]
    ChannelDisconnected,

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Errors raised by a [`CommandChannel`](crate::channel::CommandChannel).
#[derive(thiserror::Error, Debug)]
pub enum ChannelError {
    #[error("channel already closed")]
    Closed,

    #[error("channel send failed: {0}")]
    Send(String),

    #[error("channel error: {0}")]
    Other(String),
}
