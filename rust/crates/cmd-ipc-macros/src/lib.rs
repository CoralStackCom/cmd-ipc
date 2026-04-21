//! Procedural macros for [`coralstack-cmd-ipc`].
//!
//! This crate provides two attribute macros that let you register typed
//! commands next to the function/method that holds the handler code — no
//! separate schema map, no manual `Command` trait impl.
//!
//! - [`macro@command`] — mark one async fn/method as a command.
//! - [`macro@command_service`] — mark an `impl` block; every method
//!   inside tagged with `#[command("id")]` becomes a registered command
//!   and the block gains a generated `register(self, &registry)`
//!   helper that installs every command in one call.
//!
//! See the `coralstack-cmd-ipc` crate docs for usage examples and
//! end-to-end integration tests.

mod attr_args;
mod command_attr;
mod commands_attr;

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
