//! The [`Command`] trait.
//!
//! A `Command` pairs a string identifier with a typed request/response
//! pair and an async handler. In Phase 3 users implement this trait
//! manually; in Phase 4 the `#[command]` attribute macro will synthesize
//! it from a bare `async fn`.

use std::future::Future;

use serde::{de::DeserializeOwned, Serialize};

use crate::error::CommandError;
use crate::message::CommandSchema;

/// A typed command handler registered with a
/// [`CommandRegistry`](crate::registry::CommandRegistry).
///
/// Implementations are zero-cost at registration time: the registry
/// wraps the typed handler in a dynamically-dispatched closure that
/// decodes the incoming `request` JSON into [`Request`](Self::Request),
/// runs [`handle`](Self::handle), and re-encodes the result.
///
/// The `Request` and `Response` associated types must be serde
/// round-trippable. In Phase 4, the `#[command]` macro will
/// additionally require `schemars::JsonSchema` so it can populate the
/// [`CommandSchema`] advertised on the wire.
pub trait Command: Send + Sync + 'static {
    /// Stable dotted identifier used on the wire (e.g. `"math.add"`).
    ///
    /// Identifiers prefixed with `_` are treated as private: they are
    /// never escalated to a router channel and never advertised to
    /// peers via `list.commands.response`.
    const ID: &'static str;

    /// Optional human-readable description surfaced in
    /// [`CommandSchema`] for MCP/tooling consumers.
    const DESCRIPTION: Option<&'static str> = None;

    type Request: DeserializeOwned + Send + 'static;
    type Response: Serialize + Send + 'static;

    /// Handles a single invocation.
    fn handle(
        &self,
        request: Self::Request,
    ) -> impl Future<Output = Result<Self::Response, CommandError>> + Send;

    /// Returns the wire-level JSON Schema for this command, if one is
    /// available. The macro in Phase 4 overrides this with a generated
    /// schema; manual impls may return `None` (the default) to omit
    /// schema advertising.
    fn schema() -> Option<CommandSchema> {
        None
    }
}
