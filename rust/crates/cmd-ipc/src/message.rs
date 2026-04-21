//! Wire protocol for the command registry.
//!
//! This module defines the seven [`Message`] variants exchanged between
//! registries. The JSON representation is byte-identical to the TypeScript
//! implementation's `CommandMessage` union (see
//! `packages/cmd-ipc/src/registry/command-message-schemas.ts`) so that a
//! Rust process and a Node.js process can talk to each other over any
//! channel that carries JSON.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use uuid::Uuid;

use crate::error::{ExecuteErrorCode, RegisterErrorCode};

/// A unique message identifier.
///
/// Matches the TypeScript type alias `MessageID = string` — UUIDs are
/// serialized as hyphenated strings.
pub type MessageId = Uuid;

/// Description of a command as advertised across a channel.
///
/// Mirrors `CommandDefinitionBaseSchema` in the TypeScript protocol.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CommandDef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<CommandSchema>,
}

/// A request/response JSON-Schema pair attached to a [`CommandDef`].
///
/// Both slots are optional; absent means "no payload expected" (the
/// TypeScript equivalent is `v.void()`). When populated the value is a
/// raw JSON Schema; the registry normalizes incoming schemas so wire
/// representations remain language-agnostic.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CommandSchema {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<Value>,
}

impl CommandSchema {
    /// Empty schema — both slots unset. Equivalent to advertising a
    /// command with `request: None, response: None` (the void/void
    /// shape). Use when the command takes no payload and returns none.
    pub fn empty() -> Self {
        Self {
            request: None,
            response: None,
        }
    }

    /// Maximally permissive schema — both request and response declared
    /// as open objects with `additionalProperties: true`. Useful for
    /// runtime plugins whose payload shape isn't known at advertise
    /// time (e.g. Flow's QuickJS `SourceChannel` when a plugin exports
    /// an `any → any` function).
    ///
    /// Prefer a real schema when you can produce one — consumers use it
    /// for validation, MCP tool schemas, and generated TS clients.
    pub fn permissive() -> Self {
        Self {
            request: Some(serde_json::json!({
                "type": "object",
                "additionalProperties": true,
            })),
            response: Some(serde_json::json!({
                "type": "object",
                "additionalProperties": true,
            })),
        }
    }

    /// Builder: set only the request schema (leaves response unset).
    pub fn with_request(mut self, schema: Value) -> Self {
        self.request = Some(schema);
        self
    }

    /// Builder: set only the response schema (leaves request unset).
    pub fn with_response(mut self, schema: Value) -> Self {
        self.response = Some(schema);
        self
    }
}

/// Body of an execute-command error response.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ExecuteError {
    pub code: ExecuteErrorCode,
    pub message: String,
}

/// Zero-sized marker that (de)serializes as the JSON literal `true`.
///
/// Used to distinguish the `ok: true` / `ok: false` variants of
/// [`RegisterResult`] and [`ExecuteResult`] while keeping them as proper
/// Rust enums rather than structs with nullable fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct True;

impl Serialize for True {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(true)
    }
}

impl<'de> Deserialize<'de> for True {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match bool::deserialize(d)? {
            true => Ok(True),
            false => Err(serde::de::Error::custom("expected literal `true`")),
        }
    }
}

/// Zero-sized marker that (de)serializes as the JSON literal `false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct False;

impl Serialize for False {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(false)
    }
}

impl<'de> Deserialize<'de> for False {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match bool::deserialize(d)? {
            false => Ok(False),
            true => Err(serde::de::Error::custom("expected literal `false`")),
        }
    }
}

/// Body of a `register.command.response` message.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(untagged)]
pub enum RegisterResult {
    Ok { ok: True },
    Err { ok: False, error: RegisterErrorCode },
}

/// Body of an `execute.command.response` message.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(untagged)]
pub enum ExecuteResult {
    Ok {
        ok: True,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
    },
    Err {
        ok: False,
        error: ExecuteError,
    },
}

/// Discriminated union of every message type carried on a channel.
///
/// The `type` tag strings are the same dotted identifiers used by the
/// TypeScript `MessageType` enum.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type")]
pub enum Message {
    #[serde(rename = "register.command.request")]
    RegisterCommandRequest { id: MessageId, command: CommandDef },

    #[serde(rename = "register.command.response")]
    RegisterCommandResponse {
        id: MessageId,
        thid: MessageId,
        response: RegisterResult,
    },

    #[serde(rename = "list.commands.request")]
    ListCommandsRequest { id: MessageId },

    #[serde(rename = "list.commands.response")]
    ListCommandsResponse {
        id: MessageId,
        thid: MessageId,
        commands: Vec<CommandDef>,
    },

    #[serde(rename = "execute.command.request")]
    ExecuteCommandRequest {
        id: MessageId,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        request: Option<Value>,
    },

    #[serde(rename = "execute.command.response")]
    ExecuteCommandResponse {
        id: MessageId,
        thid: MessageId,
        response: ExecuteResult,
    },

    #[serde(rename = "event")]
    Event {
        id: MessageId,
        #[serde(rename = "eventId")]
        event_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
    },
}

impl Message {
    /// Returns the message's `id` field.
    pub fn id(&self) -> MessageId {
        match self {
            Self::RegisterCommandRequest { id, .. }
            | Self::RegisterCommandResponse { id, .. }
            | Self::ListCommandsRequest { id, .. }
            | Self::ListCommandsResponse { id, .. }
            | Self::ExecuteCommandRequest { id, .. }
            | Self::ExecuteCommandResponse { id, .. }
            | Self::Event { id, .. } => *id,
        }
    }

    /// Returns the `thid` field for messages that carry one.
    pub fn thid(&self) -> Option<MessageId> {
        match self {
            Self::RegisterCommandResponse { thid, .. }
            | Self::ListCommandsResponse { thid, .. }
            | Self::ExecuteCommandResponse { thid, .. } => Some(*thid),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn uid(s: &str) -> Uuid {
        Uuid::parse_str(s).unwrap()
    }

    /// Every fixture below is paired JSON that the TypeScript library
    /// produces (or accepts). Round-tripping through `Message` must leave
    /// the semantic JSON tree unchanged.
    fn check_roundtrip(msg: &Message, expected: Value) {
        let serialized = serde_json::to_value(msg).unwrap();
        assert_eq!(
            serialized, expected,
            "serialized form does not match fixture"
        );
        let parsed: Message = serde_json::from_value(expected.clone()).unwrap();
        assert_eq!(&parsed, msg, "fixture did not deserialize back to input");
    }

    #[test]
    fn register_command_request_roundtrip() {
        let msg = Message::RegisterCommandRequest {
            id: uid("11111111-1111-1111-1111-111111111111"),
            command: CommandDef {
                id: "math.add".to_string(),
                description: Some("Adds two numbers".to_string()),
                schema: Some(CommandSchema {
                    request: Some(json!({
                        "type": "object",
                        "properties": { "a": { "type": "number" }, "b": { "type": "number" } },
                        "required": ["a", "b"]
                    })),
                    response: Some(json!({ "type": "number" })),
                }),
            },
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "register.command.request",
                "id": "11111111-1111-1111-1111-111111111111",
                "command": {
                    "id": "math.add",
                    "description": "Adds two numbers",
                    "schema": {
                        "request": {
                            "type": "object",
                            "properties": { "a": { "type": "number" }, "b": { "type": "number" } },
                            "required": ["a", "b"]
                        },
                        "response": { "type": "number" }
                    }
                }
            }),
        );
    }

    #[test]
    fn register_command_response_ok_roundtrip() {
        let msg = Message::RegisterCommandResponse {
            id: uid("22222222-2222-2222-2222-222222222222"),
            thid: uid("11111111-1111-1111-1111-111111111111"),
            response: RegisterResult::Ok { ok: True },
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "register.command.response",
                "id": "22222222-2222-2222-2222-222222222222",
                "thid": "11111111-1111-1111-1111-111111111111",
                "response": { "ok": true }
            }),
        );
    }

    #[test]
    fn register_command_response_err_roundtrip() {
        let msg = Message::RegisterCommandResponse {
            id: uid("22222222-2222-2222-2222-222222222222"),
            thid: uid("11111111-1111-1111-1111-111111111111"),
            response: RegisterResult::Err {
                ok: False,
                error: RegisterErrorCode::DuplicateCommand,
            },
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "register.command.response",
                "id": "22222222-2222-2222-2222-222222222222",
                "thid": "11111111-1111-1111-1111-111111111111",
                "response": { "ok": false, "error": "duplicate_command" }
            }),
        );
    }

    #[test]
    fn list_commands_request_roundtrip() {
        let msg = Message::ListCommandsRequest {
            id: uid("33333333-3333-3333-3333-333333333333"),
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "list.commands.request",
                "id": "33333333-3333-3333-3333-333333333333"
            }),
        );
    }

    #[test]
    fn list_commands_response_roundtrip() {
        let msg = Message::ListCommandsResponse {
            id: uid("44444444-4444-4444-4444-444444444444"),
            thid: uid("33333333-3333-3333-3333-333333333333"),
            commands: vec![CommandDef {
                id: "user.create".to_string(),
                description: None,
                schema: None,
            }],
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "list.commands.response",
                "id": "44444444-4444-4444-4444-444444444444",
                "thid": "33333333-3333-3333-3333-333333333333",
                "commands": [{ "id": "user.create" }]
            }),
        );
    }

    #[test]
    fn execute_command_request_roundtrip() {
        let msg = Message::ExecuteCommandRequest {
            id: uid("55555555-5555-5555-5555-555555555555"),
            command_id: "math.add".to_string(),
            request: Some(json!({ "a": 1, "b": 2 })),
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "execute.command.request",
                "id": "55555555-5555-5555-5555-555555555555",
                "commandId": "math.add",
                "request": { "a": 1, "b": 2 }
            }),
        );
    }

    #[test]
    fn execute_command_request_no_payload() {
        let msg = Message::ExecuteCommandRequest {
            id: uid("55555555-5555-5555-5555-555555555555"),
            command_id: "system.ping".to_string(),
            request: None,
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "execute.command.request",
                "id": "55555555-5555-5555-5555-555555555555",
                "commandId": "system.ping"
            }),
        );
    }

    #[test]
    fn execute_command_response_ok_roundtrip() {
        let msg = Message::ExecuteCommandResponse {
            id: uid("66666666-6666-6666-6666-666666666666"),
            thid: uid("55555555-5555-5555-5555-555555555555"),
            response: ExecuteResult::Ok {
                ok: True,
                result: Some(json!(3)),
            },
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "execute.command.response",
                "id": "66666666-6666-6666-6666-666666666666",
                "thid": "55555555-5555-5555-5555-555555555555",
                "response": { "ok": true, "result": 3 }
            }),
        );
    }

    #[test]
    fn execute_command_response_err_roundtrip() {
        let msg = Message::ExecuteCommandResponse {
            id: uid("66666666-6666-6666-6666-666666666666"),
            thid: uid("55555555-5555-5555-5555-555555555555"),
            response: ExecuteResult::Err {
                ok: False,
                error: ExecuteError {
                    code: ExecuteErrorCode::NotFound,
                    message: "no such command".to_string(),
                },
            },
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "execute.command.response",
                "id": "66666666-6666-6666-6666-666666666666",
                "thid": "55555555-5555-5555-5555-555555555555",
                "response": {
                    "ok": false,
                    "error": { "code": "not_found", "message": "no such command" }
                }
            }),
        );
    }

    #[test]
    fn event_roundtrip() {
        let msg = Message::Event {
            id: uid("77777777-7777-7777-7777-777777777777"),
            event_id: "user.created".to_string(),
            payload: Some(json!({ "userId": "u1" })),
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "event",
                "id": "77777777-7777-7777-7777-777777777777",
                "eventId": "user.created",
                "payload": { "userId": "u1" }
            }),
        );
    }

    #[test]
    fn event_private_prefix_preserved() {
        // Private events (leading underscore) are still valid wire-level;
        // privacy is enforced by the registry, not the message schema.
        let msg = Message::Event {
            id: uid("77777777-7777-7777-7777-777777777777"),
            event_id: "_internal.tick".to_string(),
            payload: None,
        };
        check_roundtrip(
            &msg,
            json!({
                "type": "event",
                "id": "77777777-7777-7777-7777-777777777777",
                "eventId": "_internal.tick"
            }),
        );
    }

    #[test]
    fn unknown_type_rejected() {
        let bad =
            json!({ "type": "not.a.real.type", "id": "00000000-0000-0000-0000-000000000000" });
        assert!(serde_json::from_value::<Message>(bad).is_err());
    }

    #[test]
    fn register_result_err_requires_ok_false() {
        // `ok: true` with an `error` field must not parse as Err.
        let bad = json!({ "ok": true, "error": "duplicate_command" });
        let parsed: RegisterResult = serde_json::from_value(bad).unwrap();
        assert!(matches!(parsed, RegisterResult::Ok { .. }));
    }
}
