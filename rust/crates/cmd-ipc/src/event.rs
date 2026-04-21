//! The [`Event`] trait and the [`DynEvent`] helper.
//!
//! An `Event` is a fire-and-forget broadcast identified by a string
//! id. Unlike [`Command`](crate::command::Command), events have no
//! handler — consumers subscribe via
//! [`CommandRegistry::on`](crate::registry::CommandRegistry::on) and
//! receive the deserialized payload.
//!
//! For compile-time events, the `#[event]` attribute macro generates
//! the trait impl from a payload struct. For runtime-constructed
//! events (plugin runtimes, FFI, scripting hosts), [`DynEvent`] lets
//! you build an `Event` whose id is owned at runtime.

use serde::Serialize;
use serde_json::Value;

/// A typed event payload.
///
/// Implementations pair a compile-time string id with a `Serialize`
/// payload. The struct itself *is* the payload — `serde_json::to_value`
/// on an instance produces what goes on the wire.
///
/// # Compile-time vs runtime events
///
/// - **Compile-time**: `const ID` / `const DESCRIPTION` and the
///   `#[event]` macro. The defaults for [`id`](Self::id) and
///   [`description`](Self::description) read these constants.
/// - **Runtime**: use [`DynEvent`] to supply an owned `String` id,
///   description, and payload. `DynEvent` implements `Event` by
///   overriding the instance-level methods.
///
/// Both paths emit through the same
/// [`emit`](crate::registry::CommandRegistry::emit) entry point.
pub trait Event: Serialize + Send + Sync + 'static {
    /// Compile-time event identifier. Ignored when a value overrides
    /// [`id`](Self::id) to return a runtime string (as [`DynEvent`]
    /// does).
    ///
    /// Identifiers prefixed with `_` are treated as private: they
    /// fire only to local listeners and are never broadcast to
    /// connected channels.
    const ID: &'static str;

    /// Instance-level id. Defaults to [`ID`](Self::ID);
    /// [`DynEvent`] overrides this to return a runtime-owned id.
    fn id(&self) -> &str {
        Self::ID
    }

    /// Wire-level JSON Schema for the payload, if one is available.
    /// The `#[event]` macro overrides this with a schema derived
    /// from `schemars`.
    fn schema(&self) -> Option<Value> {
        None
    }
}

/// A runtime-constructed [`Event`]. Use this when the event id or
/// payload shape is only known at runtime (plugin runtimes, FFI,
/// scripting hosts).
///
/// ```ignore
/// use coralstack_cmd_ipc::prelude::*;
/// use serde_json::json;
///
/// registry.emit(DynEvent::new(
///     "plugin.say_hi",
///     json!({ "greeting": "hello" }),
/// ))?;
/// ```
pub struct DynEvent {
    id: String,
    schema: Option<Value>,
    payload: Value,
}

impl DynEvent {
    /// Build a new dynamic event with a runtime id and a JSON payload.
    pub fn new(id: impl Into<String>, payload: Value) -> Self {
        Self {
            id: id.into(),
            schema: None,
            payload,
        }
    }

    /// Attach a JSON Schema advertising the payload shape.
    pub fn schema(mut self, schema: Value) -> Self {
        self.schema = Some(schema);
        self
    }
}

impl Serialize for DynEvent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // The wire payload is the inner `Value` — `DynEvent`'s own
        // fields (id, description, schema) are metadata consumed by
        // the registry, not serialized into the event's payload.
        self.payload.serialize(serializer)
    }
}

impl Event for DynEvent {
    // Sentinel — registry always uses `id(&self)` for DynEvent.
    const ID: &'static str = "";

    fn id(&self) -> &str {
        &self.id
    }

    fn schema(&self) -> Option<Value> {
        self.schema.clone()
    }
}
