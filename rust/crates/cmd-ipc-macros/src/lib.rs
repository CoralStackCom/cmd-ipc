//! Procedural macros for [`coralstack-cmd-ipc`].
//!
//! This crate provides four attribute macros that keep command and
//! event definitions concise and colocated with their handlers:
//!
//! - [`macro@command`] — mark one async fn/method as a command.
//! - [`macro@command_service`] — mark an `impl` block; every method
//!   inside tagged with `#[command("id")]` becomes a registered command
//!   and the block gains a generated `register(self, &registry)`
//!   helper that installs every command in one call.
//! - [`macro@event`] — mark a payload struct as a typed event; emits
//!   the `impl Event` and auto-derives `Serialize` / `Deserialize` /
//!   `JsonSchema`.
//! - [`macro@payload`] — mark any struct (typically command requests
//!   and responses) to auto-derive `Serialize` / `Deserialize` /
//!   `JsonSchema` without requiring the user crate to depend on
//!   `serde` / `schemars` directly.
//!
//! All four resolve their derives against the `serde` / `schemars`
//! re-exports published by `coralstack-cmd-ipc`, so user crates depend
//! on `coralstack-cmd-ipc` alone.
//!
//! See the `coralstack-cmd-ipc` crate docs for usage examples and
//! end-to-end integration tests.

mod attr_args;
mod command_attr;
mod commands_attr;
mod event_attr;
mod payload_attr;

use proc_macro::TokenStream;

/// Attach to an `async fn` (free-standing or inside a
/// `#[command_service] impl` block) to register it as a typed command.
///
/// Usage inside a `#[command_service] impl Service` block:
///
/// ```ignore
/// #[command_service]
/// impl Service {
///     #[command("math.add", description = "Add two numbers")]
///     async fn add(&self, req: AddReq) -> Result<i64, CommandError> { ... }
/// }
/// ```
///
/// Usage as a free function:
///
/// ```ignore
/// #[command("greet")]
/// async fn greet(name: String) -> Result<String, CommandError> { ... }
/// // Exposes `register_greet(&registry).await?` to install the command.
/// ```
#[proc_macro_attribute]
pub fn command(attr: TokenStream, item: TokenStream) -> TokenStream {
    command_attr::expand(attr.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}

/// Attach to an `impl` block whose methods are tagged with `#[command]`.
///
/// Rewrites the block so every `#[command("id")]` method becomes a typed
/// command wrapper struct implementing `Command`, and adds an inherent
/// `register` async method to the host type that installs every such
/// command on a `&CommandRegistry`.
///
/// ```ignore
/// #[command_service]
/// impl MathService {
///     #[command("math.add")]
///     async fn add(&self, req: AddReq) -> Result<i64, CommandError> { ... }
///
///     #[command("math.sub")]
///     async fn sub(&self, req: SubReq) -> Result<i64, CommandError> { ... }
/// }
///
/// // Registers both commands with one call:
/// MathService.register(&registry).await?;
/// ```
#[proc_macro_attribute]
pub fn command_service(attr: TokenStream, item: TokenStream) -> TokenStream {
    commands_attr::expand(attr.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}

/// Attach to a payload struct to register it as a typed event.
///
/// The macro auto-derives `Serialize`, `Deserialize`, and `JsonSchema`
/// against the `serde` / `schemars` re-exports from `coralstack-cmd-ipc`,
/// so user crates don't need to pull those dependencies into their own
/// `Cargo.toml`. It also emits the `impl Event` for the struct with the
/// id and wire-level schema.
///
/// Unit structs emit no payload on the wire — the natural way to declare
/// a void event.
///
/// ```ignore
/// /// Worker has finished initializing.
/// #[event("worker.ready")]
/// pub struct WorkerReady {
///     pub worker_id: String,
///     pub command_count: u32,
/// }
///
/// // Void event — no payload on the wire.
/// #[event("worker.tick")]
/// pub struct WorkerTick;
///
/// // Emit with full type safety:
/// registry.emit(WorkerReady { worker_id: "w1".into(), command_count: 2 })?;
/// registry.emit(WorkerTick)?;
///
/// // Subscribe — callback receives a deserialized `WorkerReady`:
/// let _unsub = registry.on::<WorkerReady>(|event| {
///     println!("{} ready", event.worker_id);
/// });
/// ```
#[proc_macro_attribute]
pub fn event(attr: TokenStream, item: TokenStream) -> TokenStream {
    event_attr::expand(attr.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}

/// Attach to a plain data struct to auto-derive `Serialize`,
/// `Deserialize`, and `JsonSchema`. Use for command request / response
/// types (and any other struct you want those traits on) so user crates
/// only need to depend on `coralstack-cmd-ipc`.
///
/// ```ignore
/// use coralstack_cmd_ipc::prelude::*;
///
/// #[payload]
/// struct AddReq { a: i64, b: i64 }
///
/// #[payload]
/// struct AddRes { sum: i64 }
/// ```
///
/// Users who need extra derives (`Clone`, `Debug`, `PartialEq`, custom
/// `#[serde(...)]` attributes) add them normally — `#[payload]` is
/// additive.
#[proc_macro_attribute]
pub fn payload(attr: TokenStream, item: TokenStream) -> TokenStream {
    payload_attr::expand(attr.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}
