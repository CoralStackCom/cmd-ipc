//! End-to-end smoke tests for `McpServerChannel`.
//!
//! Uses `tokio::io::duplex` to wire a local rmcp client to an in-process
//! `McpServerChannel` registered on a [`CommandRegistry`]. No real stdio
//! or network involved.

use std::sync::Arc;
use std::time::Duration;

use coralstack_cmd_ipc::prelude::*;
use coralstack_cmd_ipc::Config;
use coralstack_cmd_ipc_mcp::McpServerChannel;
use rmcp::model::{CallToolRequestParams, ClientInfo};
use rmcp::{ClientHandler, ServiceExt};
use serde_json::{json, Map, Value};

// ---------- helpers ----------

#[derive(Debug, Clone, Default)]
struct TestClient;

impl ClientHandler for TestClient {
    fn get_info(&self) -> ClientInfo {
        ClientInfo::default()
    }
}

fn registry_with_two_commands() -> CommandRegistry {
    let reg = CommandRegistry::new(Config {
        id: Some("mcp-test".into()),
        request_ttl: Duration::from_secs(5),
        ..Default::default()
    });

    futures::executor::block_on(async {
        // math.add — takes {a,b}, returns a+b
        let add = DynCommand::new("math.add", |req: Value| async move {
            let a = req.get("a").and_then(Value::as_i64).unwrap_or(0);
            let b = req.get("b").and_then(Value::as_i64).unwrap_or(0);
            Ok(json!(a + b))
        })
        .description("Add two integers")
        .schema(CommandSchema {
            request: Some(json!({
                "type": "object",
                "properties": {
                    "a": { "type": "integer" },
                    "b": { "type": "integer" }
                },
                "required": ["a", "b"]
            })),
            response: Some(json!({ "type": "integer" })),
        });
        reg.register_command(add).await.unwrap();

        // greet.hello — scalar string in/out
        let greet = DynCommand::new("greet.hello", |req: Value| async move {
            let name = req.as_str().unwrap_or("world");
            Ok(Value::String(format!("hello, {name}")))
        })
        .description("Greet someone by name")
        .schema(CommandSchema {
            request: Some(json!({ "type": "string" })),
            response: Some(json!({ "type": "string" })),
        });
        reg.register_command(greet).await.unwrap();

        // Private — must NOT be exposed as an MCP tool.
        reg.register_command(DynCommand::new(
            "_internal.ping",
            |_req: Value| async move { Ok(json!("pong")) },
        ))
        .await
        .unwrap();

        // boom — always errors with internal_error + a custom message.
        reg.register_command(
            DynCommand::new("boom", |_req: Value| async move {
                Err::<Value, _>(CommandError::Internal {
                    command_id: "boom".into(),
                    message: "deliberate failure for tests".into(),
                })
            })
            .description("Always fails"),
        )
        .await
        .unwrap();
    });

    reg
}

/// Registers an `McpServerChannel` on `registry` and wires its rmcp
/// handler to one end of an in-memory duplex stream. Returns the
/// connected rmcp client plus a join handle for the server task.
async fn connect_client(
    registry: CommandRegistry,
) -> (
    rmcp::service::RunningService<rmcp::service::RoleClient, TestClient>,
    tokio::task::JoinHandle<()>,
) {
    let (server_transport, client_transport) = tokio::io::duplex(4096);

    let mcp = Arc::new(McpServerChannel::new("mcp"));
    let driver = registry
        .register_channel(mcp.clone())
        .await
        .expect("register mcp channel");
    tokio::spawn(driver);

    let server_handle = tokio::spawn(async move {
        let svc = mcp
            .into_handler()
            .serve(server_transport)
            .await
            .expect("server initialize should succeed");
        let _ = svc.waiting().await;
    });

    let client = TestClient
        .serve(client_transport)
        .await
        .expect("client connect");

    (client, server_handle)
}

// ---------- tests ----------

#[tokio::test]
async fn lists_registered_commands_as_tools() {
    let (client, server) = connect_client(registry_with_two_commands()).await;

    let tools = client.list_all_tools().await.expect("tools/list");
    let names: Vec<String> = tools.iter().map(|t| t.name.to_string()).collect();

    // Public commands only: math.add, greet.hello, boom. Private
    // `_internal.ping` must be filtered out by the registry.
    assert!(names.contains(&"math.add".to_string()));
    assert!(names.contains(&"greet.hello".to_string()));
    assert!(names.contains(&"boom".to_string()));
    assert!(
        !names.iter().any(|n| n.starts_with('_')),
        "private command leaked into tools/list: {names:?}"
    );

    // math.add schema has the expected properties.
    let add = tools.iter().find(|t| t.name == "math.add").unwrap();
    assert_eq!(add.description.as_deref(), Some("Add two integers"));
    let schema = &*add.input_schema;
    assert_eq!(schema.get("type"), Some(&json!("object")));
    let props = schema.get("properties").and_then(Value::as_object).unwrap();
    assert!(props.contains_key("a"));
    assert!(props.contains_key("b"));

    client.cancel().await.ok();
    server.await.ok();
}

#[tokio::test]
async fn tools_call_routes_to_handler() {
    let (client, server) = connect_client(registry_with_two_commands()).await;

    let mut args = Map::new();
    args.insert("a".into(), json!(7));
    args.insert("b".into(), json!(11));
    let result = client
        .call_tool(CallToolRequestParams::new("math.add").with_arguments(args))
        .await
        .expect("tools/call");

    assert_eq!(result.is_error, Some(false));
    // Structured content carries the integer response.
    assert_eq!(result.structured_content, Some(json!(18)));

    client.cancel().await.ok();
    server.await.ok();
}

#[tokio::test]
async fn string_command_returns_clean_text() {
    let (client, server) = connect_client(registry_with_two_commands()).await;

    let result = client
        .call_tool(CallToolRequestParams::new("greet.hello"))
        .await
        .unwrap();

    // When the command takes a string and no arguments were sent, payload
    // becomes null; the handler's `as_str()` returns None and falls back
    // to "world". So we expect "hello, world".
    let text = result
        .content
        .first()
        .and_then(|c| c.raw.as_text())
        .map(|t| t.text.as_str())
        .expect("text content");
    assert_eq!(text, "hello, world");

    client.cancel().await.ok();
    server.await.ok();
}

#[tokio::test]
async fn private_commands_not_exposed() {
    let (client, server) = connect_client(registry_with_two_commands()).await;

    // Direct call should fail — private commands are unreachable via MCP.
    let err = client
        .call_tool(CallToolRequestParams::new("_internal.ping"))
        .await
        .expect_err("private command must not be callable as MCP tool");
    // Either the server refuses with INVALID_PARAMS (not_found mapping)
    // or the registry returns NotFound; both paths produce an MCP error.
    let msg = format!("{err:?}");
    assert!(
        msg.contains("unknown tool") || msg.contains("not") || msg.contains("_internal"),
        "unexpected error: {msg}"
    );

    client.cancel().await.ok();
    server.await.ok();
}

#[tokio::test]
async fn handler_error_surfaces_to_mcp() {
    let (client, server) = connect_client(registry_with_two_commands()).await;

    let result = client
        .call_tool(CallToolRequestParams::new("boom"))
        .await
        .expect("tools/call returns a CallToolResult even for tool-level failures");

    assert_eq!(result.is_error, Some(true));
    let structured = result.structured_content.expect("structured_content");
    assert_eq!(structured["code"], "internal_error");
    assert!(
        structured["message"]
            .as_str()
            .unwrap_or_default()
            .contains("deliberate failure"),
        "unexpected structured error: {structured}"
    );

    client.cancel().await.ok();
    server.await.ok();
}
