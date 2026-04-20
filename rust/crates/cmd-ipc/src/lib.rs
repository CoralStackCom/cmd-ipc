//! Rust port of [`@coralstack/cmd-ipc`](https://github.com/CoralStack/cmd-ipc).
//!
//! The wire protocol is byte-identical to the TypeScript library, so Rust
//! and Node.js processes can exchange commands over any channel that
//! carries JSON.
//!
//! This crate is runtime-agnostic: it depends on the `futures` primitives
//! only, and does not pull in tokio, async-std, or smol. Users drive the
//! per-channel pump future returned by `CommandRegistry::register_channel`
//! with the executor of their choice.
//!
//! See [`message`] for the wire format and [`ttl_map`] for the storage
//! primitive shared by the registry's reply, route, and event-dedup
//! tables. The registry, channel trait, and `#[command]` macro land in
//! subsequent phases.

pub mod channel;
pub mod command;
pub mod error;
pub mod message;
pub mod registry;
pub mod ttl_map;

pub use channel::{CommandChannel, InMemoryChannel};
pub use command::Command;
pub use error::{ChannelError, CommandError, ExecuteErrorCode, RegisterErrorCode};
pub use message::{
    CommandDef, CommandSchema, ExecuteError, ExecuteResult, False, Message, MessageId,
    RegisterResult, True,
};
pub use registry::{CommandRegistry, Config};
pub use ttl_map::TtlMap;
