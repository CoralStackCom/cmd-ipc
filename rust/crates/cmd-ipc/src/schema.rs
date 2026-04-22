//! Utilities for normalizing JSON Schema values produced by the
//! `#[command]` macro into language-agnostic JSON Schema suitable for
//! MCP tool schemas and remote `GET /cmd.json`-style consumers.
//!
//! The Rust `schemars` crate emits several Rust/OpenAPI-flavored fields
//! that are NOT part of the JSON Schema standard and that generic
//! consumers — including the TypeScript implementation — do not expect:
//!
//! - `$schema` — the draft URL. Informational only; dropped.
//! - `title` — defaults to the Rust type name (e.g. `"BinaryOpReq"`,
//!   `"int64"`). Dropped so the wire payload is free of Rust
//!   identifiers.
//! - `format` on numeric types (`int64`, `int32`, `uint64`, `float`,
//!   `double`, etc.) — these are OpenAPI extensions, not standard
//!   JSON Schema format values. `format` is only meaningful on
//!   `type: "string"` (e.g. `"date-time"`, `"email"`, `"uri"`,
//!   `"uuid"`), so we strip it everywhere except on string schemas.
//!
//! The normalizer also adds `additionalProperties: false` to any
//! object-typed schema that doesn't already specify one, so the
//! advertised schema reflects the fact that every request/response
//! type in Rust is strict by construction (extra JSON fields would
//! fail at `serde_json::from_value` regardless).
//!
//! Recursion walks every nested schema — including `properties`,
//! `items`, `definitions` / `$defs`, and `oneOf` / `anyOf` / `allOf` —
//! so the transformation is applied uniformly.
//!
//! Users who hand-implement [`Command::schema`](crate::Command::schema)
//! can call [`normalize_schema`] on their manual output to get the
//! same shape the macro produces.

use serde_json::Value;

use crate::message::CommandSchema;

/// Rewrites a JSON Schema value in place: strips `title` and `$schema`
/// recursively, drops `format` on non-string schemas, and adds
/// `additionalProperties: false` to every object schema that doesn't
/// already declare one.
///
/// The transformation is idempotent — running it twice produces the
/// same result — so it's safe for the library to apply defensively
/// even if the caller already normalized.
pub fn normalize_schema(mut v: Value) -> Value {
    normalize_in_place(&mut v);
    v
}

/// Normalizes both slots of a [`CommandSchema`]. Used internally by
/// [`CommandRegistry::register`](crate::CommandRegistry::register) and
/// on remote schema ingest so every schema reachable through the
/// registry has the same, language-agnostic shape.
pub(crate) fn normalize_command_schema(cs: CommandSchema) -> CommandSchema {
    CommandSchema {
        request: cs.request.map(normalize_schema),
        response: cs.response.map(normalize_schema),
    }
}

fn normalize_in_place(v: &mut Value) {
    match v {
        Value::Object(map) => {
            // Strip metadata not present in the TS-emitted schemas.
            map.remove("title");
            map.remove("$schema");

            // JSON Schema `format` is only standard on `type: "string"`
            // (date-time, email, uri, uuid, …). Numeric formats such as
            // `int64`, `int32`, `uint32`, `float`, `double` are OpenAPI
            // extensions that MCP and generic JSON Schema consumers
            // don't understand. Drop `format` unless this schema node's
            // type is `"string"`.
            let is_string = matches!(map.get("type"), Some(Value::String(t)) if t == "string");
            if !is_string {
                map.remove("format");
            }

            // Add additionalProperties: false on object schemas.
            // Only when `type` is the scalar "object" (skip the rare
            // `type: ["object", "null"]` form — keep behavior conservative).
            if matches!(map.get("type"), Some(Value::String(t)) if t == "object")
                && !map.contains_key("additionalProperties")
            {
                map.insert("additionalProperties".into(), Value::Bool(false));
            }

            // Recurse into every sub-value so nested schemas (fields,
            // items, $defs entries, union branches) are normalized too.
            for (_, child) in map.iter_mut() {
                normalize_in_place(child);
            }
        }
        Value::Array(arr) => {
            for child in arr.iter_mut() {
                normalize_in_place(child);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_title_schema_and_numeric_format_and_adds_additional_properties_false() {
        let input = json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "BinaryOpReq",
            "type": "object",
            "properties": {
                "a": { "title": "int64", "type": "integer", "format": "int64" },
                "b": { "title": "int64", "type": "integer", "format": "int64" }
            },
            "required": ["a", "b"]
        });
        let got = normalize_schema(input);
        assert_eq!(
            got,
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "a": { "type": "integer" },
                    "b": { "type": "integer" }
                },
                "required": ["a", "b"]
            })
        );
    }

    #[test]
    fn preserves_format_on_string_schemas() {
        // date-time / email / uri / uuid are standard JSON Schema string formats.
        let input = json!({
            "type": "object",
            "properties": {
                "created": { "type": "string", "format": "date-time" },
                "email":   { "type": "string", "format": "email" },
                "id":      { "type": "string", "format": "uuid" }
            },
            "required": ["created", "email", "id"]
        });
        let got = normalize_schema(input);
        assert_eq!(got["properties"]["created"]["format"], "date-time");
        assert_eq!(got["properties"]["email"]["format"], "email");
        assert_eq!(got["properties"]["id"]["format"], "uuid");
    }

    #[test]
    fn strips_openapi_numeric_formats() {
        // schemars emits these for the corresponding Rust integer widths.
        // None are part of the JSON Schema standard.
        for fmt in [
            "int32", "int64", "uint8", "uint32", "uint64", "float", "double",
        ] {
            let input = json!({ "type": "integer", "format": fmt });
            let got = normalize_schema(input);
            assert!(
                got.get("format").is_none(),
                "format `{fmt}` should have been stripped on non-string schema"
            );
        }
    }

    #[test]
    fn leaves_existing_additional_properties_alone() {
        let input = json!({
            "type": "object",
            "additionalProperties": true,
            "properties": { "x": { "type": "string" } }
        });
        let got = normalize_schema(input);
        assert_eq!(got["additionalProperties"], Value::Bool(true));
    }

    #[test]
    fn normalizes_non_object_root_schemas() {
        let input = json!({
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "String",
            "type": "string"
        });
        let got = normalize_schema(input);
        assert_eq!(got, json!({ "type": "string" }));
    }

    #[test]
    fn recurses_into_definitions_and_oneof() {
        let input = json!({
            "title": "Outer",
            "type": "object",
            "properties": {
                "choice": {
                    "oneOf": [
                        { "title": "A", "type": "object", "properties": { "a": { "type": "integer" } } },
                        { "title": "B", "type": "object", "properties": { "b": { "type": "integer" } } }
                    ]
                }
            },
            "$defs": {
                "Inner": {
                    "title": "Inner",
                    "type": "object",
                    "properties": { "n": { "type": "integer" } }
                }
            }
        });
        let got = normalize_schema(input);
        // Root object has additionalProperties: false, no title
        assert_eq!(got["additionalProperties"], Value::Bool(false));
        assert!(got.get("title").is_none());
        // oneOf branches each become additionalProperties: false, no title
        let branches = got["properties"]["choice"]["oneOf"].as_array().unwrap();
        for b in branches {
            assert!(b.get("title").is_none());
            assert_eq!(b["additionalProperties"], Value::Bool(false));
        }
        // $defs entry normalized
        assert!(got["$defs"]["Inner"].get("title").is_none());
        assert_eq!(
            got["$defs"]["Inner"]["additionalProperties"],
            Value::Bool(false)
        );
    }
}
