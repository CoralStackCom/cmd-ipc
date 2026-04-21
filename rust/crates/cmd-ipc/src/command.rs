//! The [`Command`] trait and the [`DynCommand`] helper.
//!
//! A `Command` pairs a string identifier with a typed request/response
//! pair and an async handler. For compile-time commands, the
//! `#[command]` attribute macro generates the trait impl; for
//! runtime-constructed commands (plugin runtimes, FFI, scripting
//! hosts), [`DynCommand`] lets you build a `Command` instance whose
//! id / description / schema are owned at runtime.

use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;

use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

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
/// # Compile-time vs runtime commands
///
/// - **Compile-time**: `const ID` / `const DESCRIPTION` and the
///   `#[command]` macro. The defaults for [`id`](Self::id) and
///   [`description`](Self::description) read these constants.
/// - **Runtime**: use [`DynCommand`] to supply an owned `String` id,
///   description, and schema. `DynCommand` implements `Command` by
///   overriding the instance-level methods.
///
/// Both paths register through the same
/// [`register_command`](crate::registry::CommandRegistry::register_command)
/// entry point.
pub trait Command: Send + Sync + 'static {
    /// Compile-time identifier for typed commands. Ignored when a
    /// command overrides [`id`](Self::id) to return a runtime string
    /// (as [`DynCommand`] does).
    ///
    /// Identifiers prefixed with `_` are treated as private: they are
    /// never escalated to a router channel and never advertised to
    /// peers via `list.commands.response`.
    const ID: &'static str;

    /// Optional compile-time description. Ignored when
    /// [`description`](Self::description) is overridden.
    const DESCRIPTION: Option<&'static str> = None;

    type Request: DeserializeOwned + Send + 'static;
    type Response: Serialize + Send + 'static;

    /// Instance-level identifier. Defaults to [`ID`](Self::ID).
    /// [`DynCommand`] overrides this to return a runtime-owned id.
    fn id(&self) -> &str {
        Self::ID
    }

    /// Instance-level description. Defaults to
    /// [`DESCRIPTION`](Self::DESCRIPTION).
    fn description(&self) -> Option<&str> {
        Self::DESCRIPTION
    }

    /// Wire-level JSON Schema for this command. Defaults to `None`.
    /// The `#[command]` macro overrides this with a schema generated
    /// from [`Request`](Self::Request) and [`Response`](Self::Response)
    /// via `schemars`.
    fn schema(&self) -> Option<CommandSchema> {
        None
    }

    /// Handles a single invocation.
    fn handle(
        &self,
        request: Self::Request,
    ) -> impl Future<Output = Result<Self::Response, CommandError>> + Send;
}

/// A runtime-constructed [`Command`]. Use this when the command id
/// or schema is only known at runtime (plugin runtimes, FFI,
/// scripting hosts).
///
/// # Example — dynamic id with `Value` payloads
///
/// ```ignore
/// use coralstack_cmd_ipc::prelude::*;
/// use serde_json::{json, Value};
///
/// let cmd = DynCommand::new("plugin.say_hi", |_req: Value| async move {
///     Ok(json!({ "greeting": "hello" }))
/// });
/// registry.register_command(cmd).await?;
/// ```
///
/// # Example — dynamic id with typed payloads
///
/// ```ignore
/// #[derive(serde::Deserialize)]
/// struct AddReq { a: i64, b: i64 }
///
/// let cmd = DynCommand::new(runtime_id, |req: AddReq| async move {
///     Ok(req.a + req.b)
/// })
/// .description("Runtime-registered adder");
/// registry.register_command(cmd).await?;
/// ```
pub struct DynCommand<Req, Res, F> {
    id: String,
    description: Option<String>,
    schema: Option<CommandSchema>,
    handler: F,
    _pd: PhantomData<fn(Req) -> Res>,
}

impl<Req, Res, F, Fut> DynCommand<Req, Res, F>
where
    Req: DeserializeOwned + Send + 'static,
    Res: Serialize + Send + 'static,
    F: Fn(Req) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<Res, CommandError>> + Send + 'static,
{
    /// Build a new dynamic command. The request/response types are
    /// inferred from the handler's signature; annotate them if type
    /// inference needs help (commonly `|req: Value|` for fully
    /// dynamic payloads).
    pub fn new(id: impl Into<String>, handler: F) -> Self {
        Self {
            id: id.into(),
            description: None,
            schema: None,
            handler,
            _pd: PhantomData,
        }
    }

    /// Attach a human-readable description, surfaced via
    /// [`Command::description`] and forwarded to MCP/tooling consumers.
    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Attach a full [`CommandSchema`] (both request + response slots)
    /// advertised on the wire via `register.command.request`. Omit to
    /// register without a schema (peers will fall back to permissive
    /// validation).
    pub fn schema(mut self, schema: CommandSchema) -> Self {
        self.schema = Some(schema);
        self
    }

    /// Attach only the request schema. Convenient when your runtime
    /// introspection knows the argument shape but not the return.
    pub fn request_schema(mut self, schema: Value) -> Self {
        let mut s = self.schema.take().unwrap_or(CommandSchema {
            request: None,
            response: None,
        });
        s.request = Some(schema);
        self.schema = Some(s);
        self
    }

    /// Attach only the response schema.
    pub fn response_schema(mut self, schema: Value) -> Self {
        let mut s = self.schema.take().unwrap_or(CommandSchema {
            request: None,
            response: None,
        });
        s.response = Some(schema);
        self.schema = Some(s);
        self
    }
}

impl<Req, Res, F, Fut> Command for DynCommand<Req, Res, F>
where
    Req: DeserializeOwned + Send + Sync + 'static,
    Res: Serialize + Send + Sync + 'static,
    F: Fn(Req) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<Res, CommandError>> + Send + 'static,
{
    // Sentinel — registry always uses `id(&self)` for DynCommand.
    const ID: &'static str = "";
    type Request = Req;
    type Response = Res;

    fn id(&self) -> &str {
        &self.id
    }

    fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    fn schema(&self) -> Option<CommandSchema> {
        self.schema.clone()
    }

    fn handle(&self, request: Req) -> impl Future<Output = Result<Res, CommandError>> + Send {
        (self.handler)(request)
    }
}

// -----------------------------------------------------------------------------
// Boxed dynamic-command form — the canonical "store heterogeneous dynamic
// commands in a Vec" shape. Used by Flow's `SourceChannel` and any plugin
// host that holds a runtime table of `Value → Value` commands.
// -----------------------------------------------------------------------------

/// Type-erased async handler for a [`BoxedDynCommand`]: takes and
/// returns raw JSON `Value`s.
pub type BoxedHandler = Box<
    dyn Fn(Value) -> Pin<Box<dyn Future<Output = Result<Value, CommandError>> + Send>>
        + Send
        + Sync,
>;

/// A [`DynCommand`] with fully erased handler types — request and
/// response are `serde_json::Value`, the handler is a boxed async
/// closure. Use when you need to store a heterogeneous collection of
/// runtime commands (e.g. `Vec<BoxedDynCommand>` inside a plugin host).
pub type BoxedDynCommand = DynCommand<Value, Value, BoxedHandler>;

impl DynCommand<Value, Value, BoxedHandler> {
    /// Construct a [`BoxedDynCommand`] from any async closure producing
    /// a `Result<Value, CommandError>`. The handler's future is boxed so
    /// the resulting command has a single concrete type, making it
    /// suitable for heterogeneous collections.
    ///
    /// ```ignore
    /// use coralstack_cmd_ipc::prelude::*;
    /// use coralstack_cmd_ipc::BoxedDynCommand;
    /// use serde_json::{json, Value};
    ///
    /// let cmd: BoxedDynCommand = DynCommand::boxed("plugin.hello", |req| async move {
    ///     Ok(json!({ "you_sent": req }))
    /// });
    /// registry.register_command(cmd).await?;
    /// ```
    pub fn boxed<F, Fut>(id: impl Into<String>, handler: F) -> BoxedDynCommand
    where
        F: Fn(Value) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value, CommandError>> + Send + 'static,
    {
        let handler: BoxedHandler = Box::new(move |v: Value| Box::pin(handler(v)));
        DynCommand {
            id: id.into(),
            description: None,
            schema: None,
            handler,
            _pd: PhantomData,
        }
    }
}

// The `Fn(Value) -> BoxFuture` closure type satisfies the `Command` blanket
// impl above because `BoxedHandler` is `Fn(Value) -> Pin<Box<dyn Future<...>>>`
// and `Pin<Box<dyn Future>>` impls `Future`. No extra impl needed.
