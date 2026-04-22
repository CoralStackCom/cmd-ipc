//! cmd-ipc CommandDef ↔ MCP Tool / CallToolResult translation helpers.

use std::sync::Arc;

use coralstack_cmd_ipc::{CommandDef, ExecuteError, ExecuteErrorCode};
use rmcp::model::{CallToolResult, Content, ErrorCode, Tool};
use rmcp::ErrorData as McpError;
use serde_json::{Map, Value};

/// Converts a cmd-ipc [`CommandDef`] into an MCP `Tool` descriptor.
///
/// The request schema (if present) becomes `inputSchema`. When no schema
/// was advertised, fall back to a permissive `{"type":"object"}` so MCP
/// clients that strictly validate can still send calls.
pub fn command_to_tool(def: &CommandDef) -> Tool {
    let input_schema = def
        .schema
        .as_ref()
        .and_then(|s| s.request.as_ref())
        .and_then(value_as_object)
        .unwrap_or_else(permissive_object_schema);

    let description = def.description.clone().unwrap_or_default();
    // rmcp's Tool::new takes name + description + inputSchema. outputSchema
    // is typed-builder (requires a Rust type implementing JsonSchema) so
    // isn't usable with a runtime JSON Value here; we surface only
    // inputSchema for now. MCP clients treat outputSchema as optional.
    Tool::new(def.id.clone(), description, Arc::new(input_schema))
}

/// Translates a successful handler response into an MCP `CallToolResult`.
///
/// Scalar and object results are serialized as JSON text content; strings
/// pass through verbatim so agents see clean text rather than a quoted
/// JSON string. `None` (command returned `()`) becomes an empty OK result.
pub fn success_to_call_result(result: Option<Value>) -> CallToolResult {
    match result {
        None => CallToolResult::success(vec![]),
        Some(Value::String(s)) => CallToolResult::success(vec![Content::text(s)]),
        Some(other) => CallToolResult::structured(other),
    }
}

/// Translates an [`ExecuteError`] into an MCP `CallToolResult` with
/// `isError: true`. The `code` from cmd-ipc is preserved in the
/// structured content so MCP clients that care about it can inspect
/// without parsing the human-readable message.
pub fn execute_error_to_call_result(err: ExecuteError) -> CallToolResult {
    let code_str = execute_error_code_str(err.code);
    CallToolResult::structured_error(serde_json::json!({
        "code": code_str,
        "message": err.message,
    }))
}

/// Translates a cmd-ipc `ExecuteErrorCode::NotFound` into an MCP
/// protocol-level error. All other execute errors are returned as
/// tool-call results with `isError: true` (they're tool failures, not
/// protocol failures).
pub fn is_tool_not_found(err: &ExecuteError) -> bool {
    matches!(err.code, ExecuteErrorCode::NotFound)
}

pub fn mcp_error_for_unknown_tool(name: &str) -> McpError {
    McpError::new(
        ErrorCode::INVALID_PARAMS,
        format!("unknown tool: {name}"),
        None,
    )
}

fn execute_error_code_str(code: ExecuteErrorCode) -> &'static str {
    match code {
        ExecuteErrorCode::NotFound => "not_found",
        ExecuteErrorCode::InvalidRequest => "invalid_request",
        ExecuteErrorCode::InternalError => "internal_error",
        ExecuteErrorCode::Timeout => "timeout",
        ExecuteErrorCode::ChannelDisconnected => "channel_disconnected",
    }
}

fn value_as_object(v: &Value) -> Option<Map<String, Value>> {
    v.as_object().cloned()
}

fn permissive_object_schema() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("type".into(), Value::String("object".into()));
    m.insert("additionalProperties".into(), Value::Bool(true));
    m
}
