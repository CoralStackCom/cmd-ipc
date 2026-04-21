//! Conformance harness for the cmd-ipc protocol.
//!
//! Loads the shared vectors under `spec/conformance/` and drives them
//! against the Rust [`CommandRegistry`]. The same vectors are executed
//! by the TypeScript harness at `ts/packages/cmd-ipc/tests/conformance/` —
//! passing both is the contract.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use coralstack_cmd_ipc::{
    ChannelError, CommandChannel, CommandDef, CommandRegistry, Config, ExecuteError, Message,
};
use futures::channel::mpsc::{unbounded, UnboundedReceiver, UnboundedSender};
use futures::channel::oneshot;
use futures::executor::{block_on, ThreadPool};
use futures::future::{BoxFuture, Shared};
use futures::task::SpawnExt;
use futures::{FutureExt, StreamExt};
use serde_json::{json, Value};

// ---------- spec-path discovery ----------

fn spec_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR = rust/crates/cmd-ipc. spec/ is three levels up.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut dir = manifest.clone();
    for _ in 0..6 {
        let candidate = dir.join("spec");
        if candidate.join("conformance").is_dir() {
            return candidate;
        }
        if !dir.pop() {
            break;
        }
    }
    panic!(
        "could not locate spec/ directory above {}",
        manifest.display()
    );
}

fn list_vectors(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
        .collect();
    out.sort();
    out
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

// ---------- matchers ----------

type CaptureBag = HashMap<String, Value>;

/// Match `actual` against `expected`, recognising `$match`, `$capture`,
/// `$ref`, and `$unordered` patterns. Returns `Err` with a diagnostic path
/// on mismatch; mutates `captures` on `$capture` success.
fn match_value(
    expected: &Value,
    actual: &Value,
    captures: &mut CaptureBag,
    path: &str,
) -> Result<(), String> {
    // Pattern objects.
    if let Some(obj) = expected.as_object() {
        if let Some(kind) = obj.get("$match") {
            return match kind.as_str() {
                Some("uuid") => {
                    let s = actual
                        .as_str()
                        .ok_or_else(|| format!("{path}: expected UUID string, got {actual}"))?;
                    if uuid::Uuid::parse_str(s).is_ok() {
                        Ok(())
                    } else {
                        Err(format!("{path}: expected UUID, got {s:?}"))
                    }
                }
                Some("any-string") => {
                    let s = actual.as_str().ok_or_else(|| {
                        format!("{path}: expected non-empty string, got {actual}")
                    })?;
                    if s.is_empty() {
                        Err(format!("{path}: expected non-empty string"))
                    } else {
                        Ok(())
                    }
                }
                other => Err(format!("{path}: unknown $match kind {other:?}")),
            };
        }
        if let Some(name) = obj.get("$capture").and_then(Value::as_str) {
            captures.insert(name.to_string(), actual.clone());
            return Ok(());
        }
        if let Some(name) = obj.get("$ref").and_then(Value::as_str) {
            let prev = captures
                .get(name)
                .ok_or_else(|| format!("{path}: $ref to unknown capture {name:?}"))?;
            if prev == actual {
                return Ok(());
            }
            return Err(format!(
                "{path}: $ref {name}: expected {prev}, got {actual}"
            ));
        }
        if let Some(Value::Array(items)) = obj.get("$unordered") {
            let actual_arr = actual
                .as_array()
                .ok_or_else(|| format!("{path}: $unordered needs array actual"))?;
            if items.len() != actual_arr.len() {
                return Err(format!(
                    "{path}: $unordered length mismatch: expected {}, got {}",
                    items.len(),
                    actual_arr.len()
                ));
            }
            let mut remaining: Vec<&Value> = actual_arr.iter().collect();
            for (i, exp) in items.iter().enumerate() {
                let mut found = None;
                for (j, cand) in remaining.iter().enumerate() {
                    let mut snapshot = captures.clone();
                    if match_value(exp, cand, &mut snapshot, &format!("{path}[{i}]")).is_ok() {
                        *captures = snapshot;
                        found = Some(j);
                        break;
                    }
                }
                match found {
                    Some(j) => {
                        remaining.remove(j);
                    }
                    None => {
                        return Err(format!(
                            "{path}: $unordered: no actual element matches expected[{i}] = {exp}"
                        ))
                    }
                }
            }
            return Ok(());
        }

        // Plain object — every key in expected must match; extra actual keys allowed.
        let actual_obj = actual
            .as_object()
            .ok_or_else(|| format!("{path}: expected object, got {actual}"))?;
        for (k, v) in obj {
            let a = actual_obj
                .get(k)
                .ok_or_else(|| format!("{path}.{k}: missing key"))?;
            match_value(v, a, captures, &format!("{path}.{k}"))?;
        }
        return Ok(());
    }

    if let Some(arr) = expected.as_array() {
        let actual_arr = actual
            .as_array()
            .ok_or_else(|| format!("{path}: expected array, got {actual}"))?;
        if arr.len() != actual_arr.len() {
            return Err(format!(
                "{path}: array length mismatch: expected {}, got {}",
                arr.len(),
                actual_arr.len()
            ));
        }
        for (i, (e, a)) in arr.iter().zip(actual_arr.iter()).enumerate() {
            match_value(e, a, captures, &format!("{path}[{i}]"))?;
        }
        return Ok(());
    }

    if expected == actual {
        Ok(())
    } else {
        Err(format!("{path}: expected {expected}, got {actual}"))
    }
}

/// Walk a value replacing `{ "$ref": "name" }` with the captured value.
/// Used on inbound messages so vectors can reference IDs emitted earlier.
fn resolve_refs(value: &Value, captures: &CaptureBag) -> Result<Value, String> {
    match value {
        Value::Object(obj) => {
            if let Some(name) = obj.get("$ref").and_then(Value::as_str) {
                return captures
                    .get(name)
                    .cloned()
                    .ok_or_else(|| format!("inbound $ref to unknown capture {name:?}"));
            }
            let mut out = serde_json::Map::new();
            for (k, v) in obj {
                out.insert(k.clone(), resolve_refs(v, captures)?);
            }
            Ok(Value::Object(out))
        }
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(resolve_refs(item, captures)?);
            }
            Ok(Value::Array(out))
        }
        other => Ok(other.clone()),
    }
}

// ---------- MockChannel ----------

/// Single-ended test double: `send()` (called by the registry) pushes to
/// an outbound queue the harness can drain; `recv()` reads from an inbound
/// queue the harness feeds via `deliver()`.
struct MockChannel {
    id: String,
    outbound: Mutex<VecDeque<Message>>,
    inbound_tx: UnboundedSender<Message>,
    inbound_rx: futures::lock::Mutex<Option<UnboundedReceiver<Message>>>,
    close_tx: Mutex<Option<oneshot::Sender<()>>>,
    close_rx: Shared<oneshot::Receiver<()>>,
    closed: AtomicBool,
}

impl MockChannel {
    fn new(id: &str) -> Arc<Self> {
        let (tx, rx) = unbounded();
        let (ctx, crx) = oneshot::channel();
        Arc::new(Self {
            id: id.to_string(),
            outbound: Mutex::new(VecDeque::new()),
            inbound_tx: tx,
            inbound_rx: futures::lock::Mutex::new(Some(rx)),
            close_tx: Mutex::new(Some(ctx)),
            close_rx: crx.shared(),
            closed: AtomicBool::new(false),
        })
    }

    fn deliver(&self, msg: Message) {
        let _ = self.inbound_tx.unbounded_send(msg);
    }

    fn take_outbound(&self) -> Option<Message> {
        self.outbound.lock().unwrap().pop_front()
    }

    fn outbound_len(&self) -> usize {
        self.outbound.lock().unwrap().len()
    }

    fn outbound_snapshot(&self) -> Vec<Message> {
        self.outbound.lock().unwrap().iter().cloned().collect()
    }

    fn drain_list_commands_request(&self) {
        self.outbound
            .lock()
            .unwrap()
            .retain(|m| !matches!(m, Message::ListCommandsRequest { .. }));
    }
}

impl CommandChannel for MockChannel {
    fn id(&self) -> &str {
        &self.id
    }

    fn start(&self) -> BoxFuture<'_, Result<(), ChannelError>> {
        Box::pin(async { Ok(()) })
    }

    fn close(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            self.closed.store(true, Ordering::SeqCst);
            if let Some(tx) = self.close_tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
        })
    }

    fn send(&self, msg: Message) -> Result<(), ChannelError> {
        self.outbound.lock().unwrap().push_back(msg);
        Ok(())
    }

    fn recv(&self) -> BoxFuture<'_, Option<Message>> {
        Box::pin(async move {
            if self.closed.load(Ordering::SeqCst) {
                return None;
            }
            let mut guard = self.inbound_rx.lock().await;
            let rx = guard.as_mut()?;
            let close_fut = self.close_rx.clone();
            futures::select_biased! {
                msg = rx.next().fuse() => msg,
                _ = close_fut.fuse() => None,
            }
        })
    }
}

// ---------- encoding vectors ----------

fn run_encoding_vector(file: &Path) -> Result<(), String> {
    let vector = read_json(file);
    let description = vector["description"].as_str().unwrap_or("");
    let message_json = &vector["message"];
    let schema_file = vector["schema"].as_str().ok_or("missing `schema` field")?;
    let canonical_json = vector["json"].as_str().ok_or("missing `json` field")?;

    // 1. Schema validity via typed deserialization through Message.
    let parsed: Message = serde_json::from_value(message_json.clone())
        .map_err(|e| format!("schema validation failed: {e}"))?;

    // 1b. The parsed variant must match the schema filename.
    let expected_type = schema_file_to_type(schema_file)
        .ok_or_else(|| format!("unknown schema reference: {schema_file}"))?;
    let actual_type = message_json["type"].as_str().unwrap_or("");
    if actual_type != expected_type {
        return Err(format!(
            "vector claims schema {schema_file:?} but message.type is {actual_type:?}"
        ));
    }

    // 2. JSON decode matches message.
    let decoded: Value = serde_json::from_str(canonical_json)
        .map_err(|e| format!("JSON parse of canonical string failed: {e}"))?;
    if decoded != *message_json {
        return Err(format!(
            "JSON.parse(json) != message:\n  parsed : {decoded}\n  message: {message_json}"
        ));
    }

    // 3. JSON round-trip via Message (stronger than raw Value round-trip —
    //    exercises serde impls).
    let reserialized =
        serde_json::to_value(&parsed).map_err(|e| format!("serialize roundtrip failed: {e}"))?;
    if reserialized != *message_json {
        return Err(format!(
            "JSON round-trip mismatch:\n  re-serialized: {reserialized}\n  expected     : {message_json}"
        ));
    }

    let _ = description;
    Ok(())
}

fn schema_file_to_type(schema: &str) -> Option<&'static str> {
    Some(match schema {
        "register.command.request.json" => "register.command.request",
        "register.command.response.json" => "register.command.response",
        "list.commands.request.json" => "list.commands.request",
        "list.commands.response.json" => "list.commands.response",
        "execute.command.request.json" => "execute.command.request",
        "execute.command.response.json" => "execute.command.response",
        "event.json" => "event",
        _ => return None,
    })
}

// ---------- behavior vectors ----------

struct ListenerTrace {
    invocations: u32,
    last_payload: Option<Value>,
}

/// Normalised error shape for local-call results so we can assert on a
/// single `code` string that matches the wire-level error code enum used
/// in both languages (`not_found`, `internal_error`, `invalid_request`,
/// `timeout`, `channel_disconnected`, `duplicate_command`, …).
struct LocalCallErr {
    code: String,
    message: String,
}

fn command_error_to_local_err(e: &coralstack_cmd_ipc::CommandError) -> LocalCallErr {
    use coralstack_cmd_ipc::CommandError;
    let (code, message) = match e {
        CommandError::NotFound(_) => ("not_found", e.to_string()),
        CommandError::InvalidRequest { message, .. } => ("invalid_request", message.clone()),
        CommandError::Internal { message, .. } => ("internal_error", message.clone()),
        CommandError::Timeout => ("timeout", e.to_string()),
        CommandError::ChannelDisconnected => ("channel_disconnected", e.to_string()),
        CommandError::DuplicateCommand(_) => ("duplicate_command", e.to_string()),
        CommandError::InvalidMessage(_) => ("invalid_message", e.to_string()),
        CommandError::Serde(_) => ("internal_error", e.to_string()),
    };
    LocalCallErr {
        code: code.into(),
        message,
    }
}

/// Expression evaluator for `returns.$expr` — the same tiny grammar the TS
/// harness accepts (`request.<ident>` or numeric literal, combined with `+`,
/// `-`, `*`).
fn eval_expr(expr: &str, request: &Value) -> Value {
    let mut acc: Option<f64> = None;
    let mut op = '+';
    let tokens: Vec<&str> = expr
        .split(|c: char| c.is_whitespace())
        .filter(|t| !t.is_empty())
        .collect();
    for tok in tokens {
        match tok {
            "+" | "-" | "*" => op = tok.chars().next().unwrap(),
            _ => {
                let val: f64 = if let Some(rest) = tok.strip_prefix("request.") {
                    request
                        .get(rest)
                        .and_then(Value::as_f64)
                        .unwrap_or(f64::NAN)
                } else {
                    tok.parse::<f64>().unwrap_or(f64::NAN)
                };
                acc = Some(match acc {
                    None => val,
                    Some(a) => match op {
                        '+' => a + val,
                        '-' => a - val,
                        '*' => a * val,
                        _ => f64::NAN,
                    },
                });
            }
        }
    }
    // Represent whole-number results as integers to match TS JSON serialization.
    match acc {
        Some(n) if (n.fract() == 0.0) && (n.abs() < (i64::MAX as f64)) => json!(n as i64),
        Some(n) => json!(n),
        None => Value::Null,
    }
}

fn make_local_handler(
    spec: &Value,
) -> impl Fn(Value) -> BoxFuture<'static, Result<Value, ExecuteError>> + Send + Sync + 'static {
    let returns = spec.get("returns").cloned().unwrap_or(Value::Null);
    move |req: Value| {
        let returns = returns.clone();
        async move {
            let out = match &returns {
                Value::Object(o) if o.contains_key("$expr") => {
                    let expr = o.get("$expr").and_then(Value::as_str).unwrap_or("");
                    eval_expr(expr, &req)
                }
                other => other.clone(),
            };
            Ok(out)
        }
        .boxed()
    }
}

/// Poll for `cond` to become true, or `timeout` elapses.
fn wait_until<F: Fn() -> bool>(cond: F, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    cond()
}

fn run_behavior_vector(file: &Path, pool: &ThreadPool) -> Result<(), String> {
    let vector = read_json(file);
    let setup = &vector["setup"];
    let registry_cfg = &setup["registry"];
    let peers = setup["peers"].as_array().cloned().unwrap_or_default();
    let steps = vector["steps"].as_array().cloned().unwrap_or_default();

    let registry_id = registry_cfg["id"].as_str().unwrap_or("main").to_string();
    let router_channel = registry_cfg
        .get("routerChannel")
        .and_then(Value::as_str)
        .map(String::from);

    let registry = CommandRegistry::new(Config {
        id: Some(registry_id),
        router_channel,
        request_ttl: Duration::from_secs(5),
        event_ttl: Duration::from_secs(5),
    });

    // Pre-register local commands.
    if let Some(cmds) = registry_cfg.get("localCommands").and_then(Value::as_array) {
        for cmd in cmds {
            let id = cmd["id"].as_str().unwrap_or("").to_string();
            let def = CommandDef {
                id: id.clone(),
                description: None,
                schema: None,
            };
            let handler = make_local_handler(cmd);
            block_on(registry.register_command(def, handler))
                .map_err(|e| format!("registering {id}: {e}"))?;
        }
    }

    // Attach local event listeners.
    let mut listener_traces: HashMap<String, Arc<Mutex<ListenerTrace>>> = HashMap::new();
    if let Some(arr) = registry_cfg
        .get("localEventListeners")
        .and_then(Value::as_array)
    {
        for eid in arr {
            let eid = eid.as_str().unwrap_or("").to_string();
            let trace = Arc::new(Mutex::new(ListenerTrace {
                invocations: 0,
                last_payload: None,
            }));
            listener_traces.insert(eid.clone(), trace.clone());
            let trace_cb = trace.clone();
            // Keep the listener live for the lifetime of the test — we
            // deliberately ignore the unsubscribe closure.
            let _keep = registry.add_event_listener(&eid, move |payload| {
                let mut t = trace_cb.lock().unwrap();
                t.invocations += 1;
                t.last_payload = Some(payload);
            });
        }
    }

    // Register mock channels for each peer; spawn driver futures.
    let mut channels: HashMap<String, Arc<MockChannel>> = HashMap::new();
    for peer in &peers {
        let ch_id = peer["channelId"].as_str().unwrap_or("").to_string();
        let ch = MockChannel::new(&ch_id);
        let driver = block_on(registry.register_channel(ch.clone()))
            .map_err(|e| format!("register_channel({ch_id}): {e}"))?;
        pool.spawn(driver)
            .map_err(|e| format!("spawn driver: {e}"))?;
        // Drain the auto-sent list.commands.request emitted by register_channel.
        // Give the driver a moment to observe it first.
        let _ = wait_until(|| ch.outbound_len() > 0, Duration::from_millis(100));
        ch.drain_list_commands_request();
        channels.insert(ch_id, ch);
    }

    let mut captures: CaptureBag = HashMap::new();
    let mut pending_result: Option<oneshot::Receiver<Result<Value, LocalCallErr>>> = None;

    for (i, step) in steps.iter().enumerate() {
        let direction = step["direction"].as_str().unwrap_or("");
        let tag = format!("step[{i}] ({direction})");

        match direction {
            "inbound" => {
                let ch_id = step["from"].as_str().unwrap_or("");
                let ch = channels
                    .get(ch_id)
                    .ok_or_else(|| format!("{tag}: unknown channel {ch_id:?}"))?;
                let resolved = resolve_refs(&step["message"], &captures)?;
                let msg: Message = serde_json::from_value(resolved)
                    .map_err(|e| format!("{tag}: inbound deserialize: {e}"))?;
                ch.deliver(msg);
                std::thread::sleep(Duration::from_millis(15));
            }
            "outbound" => {
                let ch_id = step["to"].as_str().unwrap_or("");
                let ch = channels
                    .get(ch_id)
                    .ok_or_else(|| format!("{tag}: unknown channel {ch_id:?}"))?;
                let ch_poll = ch.clone();
                if !wait_until(|| ch_poll.outbound_len() > 0, Duration::from_millis(1000)) {
                    return Err(format!("{tag}: expected outbound on {ch_id}, got none"));
                }
                let actual = ch.take_outbound().unwrap();
                let actual_json = serde_json::to_value(&actual).unwrap();
                match_value(
                    &step["expected"],
                    &actual_json,
                    &mut captures,
                    &format!("$[{i}]"),
                )?;
            }
            "assert-no-outbound" => {
                let ch_id = step["to"].as_str().unwrap_or("");
                let ch = channels
                    .get(ch_id)
                    .ok_or_else(|| format!("{tag}: unknown channel {ch_id:?}"))?;
                std::thread::sleep(Duration::from_millis(30));
                if ch.outbound_len() != 0 {
                    return Err(format!(
                        "{tag}: expected no outbound, got {:?}",
                        ch.outbound_snapshot()
                    ));
                }
            }
            "local-call" => {
                let trigger = &step["trigger"];
                if let Some(args) = trigger.get("executeCommand").and_then(Value::as_array) {
                    let cmd = args
                        .first()
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let req = args.get(1).cloned().unwrap_or(Value::Null);
                    let (tx, rx) = oneshot::channel::<Result<Value, LocalCallErr>>();
                    let registry_clone = registry.clone();
                    pool.spawn(async move {
                        let result: Result<Value, _> =
                            registry_clone.execute_command(&cmd, req).await;
                        let _ = tx.send(result.map_err(|e| command_error_to_local_err(&e)));
                    })
                    .map_err(|e| format!("{tag}: spawn: {e}"))?;
                    pending_result = Some(rx);
                } else if let Some(args) = trigger.get("emitEvent").and_then(Value::as_array) {
                    let eid = args
                        .first()
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let payload = args.get(1).cloned().unwrap_or(Value::Null);
                    registry
                        .emit_event(&eid, payload)
                        .map_err(|e| format!("{tag}: emit_event: {e}"))?;
                } else if let Some(args) = trigger.get("registerCommand").and_then(Value::as_array)
                {
                    let id = args
                        .first()
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let def = CommandDef {
                        id: id.clone(),
                        description: None,
                        schema: None,
                    };
                    let (tx, rx) = oneshot::channel::<Result<Value, LocalCallErr>>();
                    let registry_clone = registry.clone();
                    pool.spawn(async move {
                        let result = registry_clone
                            .register_command(def, |_v: Value| async move {
                                Ok::<Value, ExecuteError>(Value::Null)
                            })
                            .await;
                        let _ = tx.send(
                            result
                                .map(|_| Value::Null)
                                .map_err(|e| command_error_to_local_err(&e)),
                        );
                    })
                    .map_err(|e| format!("{tag}: spawn: {e}"))?;
                    pending_result = Some(rx);
                } else if trigger.get("listCommands").is_some() {
                    let commands = registry.list_commands();
                    let value = serde_json::to_value(
                        commands
                            .into_iter()
                            .map(|c| serde_json::json!({ "id": c.id }))
                            .collect::<Vec<_>>(),
                    )
                    .unwrap();
                    let (tx, rx) = oneshot::channel::<Result<Value, LocalCallErr>>();
                    let _ = tx.send(Ok(value));
                    pending_result = Some(rx);
                } else {
                    return Err(format!("{tag}: unknown trigger"));
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            "local-result" => {
                let rx = pending_result
                    .take()
                    .ok_or_else(|| format!("{tag}: no pending local-call"))?;
                let result = block_on(async {
                    futures::select_biased! {
                        r = rx.fuse() => r.unwrap_or_else(|_| Err(LocalCallErr { code: "canceled".into(), message: "canceled".into() })),
                        _ = sleep_future(Duration::from_secs(2)).fuse() => Err(LocalCallErr { code: "timeout".into(), message: "timeout waiting for local-result".into() }),
                    }
                });
                if let Some(expected_err) = step.get("expectedError") {
                    match result {
                        Ok(v) => {
                            return Err(format!("{tag}: expected error but got ok value {v}"));
                        }
                        Err(e) => {
                            if let Some(code) = expected_err.get("code").and_then(Value::as_str) {
                                if e.code != code {
                                    return Err(format!(
                                        "{tag}: expected error code {code:?}, got {:?} ({})",
                                        e.code, e.message
                                    ));
                                }
                            }
                            if let Some(msg_pat) = expected_err.get("message") {
                                match_value(
                                    msg_pat,
                                    &Value::String(e.message.clone()),
                                    &mut captures,
                                    &format!("$[{i}].message"),
                                )?;
                            }
                        }
                    }
                } else {
                    let value = result.map_err(|e| {
                        format!("{tag}: local-call rejected: {} ({})", e.code, e.message)
                    })?;
                    if let Some(expected) = step.get("expected") {
                        match_value(expected, &value, &mut captures, &format!("$[{i}].result"))?;
                    }
                }
            }
            "close-channel" => {
                let ch_id = step["channel"].as_str().unwrap_or("");
                let ch = channels
                    .get(ch_id)
                    .ok_or_else(|| format!("{tag}: unknown channel {ch_id:?}"))?
                    .clone();
                block_on(ch.close());
                // Give the driver task time to observe EOF and run
                // handle_channel_close so remote commands are purged.
                std::thread::sleep(Duration::from_millis(60));
            }
            "assert-local-listener" => {
                let eid = step["eventId"].as_str().unwrap_or("");
                let trace = listener_traces
                    .get(eid)
                    .ok_or_else(|| format!("{tag}: no listener registered for {eid:?} — add it to setup.registry.localEventListeners"))?;
                std::thread::sleep(Duration::from_millis(15));
                let expected = step["invocations"].as_u64().unwrap_or(0) as u32;
                let t = trace.lock().unwrap();
                if t.invocations != expected {
                    return Err(format!(
                        "{tag}: expected {expected} invocations of {eid:?}, got {}",
                        t.invocations
                    ));
                }
                if let Some(last) = step.get("lastPayload") {
                    if !last.is_null() {
                        let actual = t.last_payload.clone().unwrap_or(Value::Null);
                        match_value(last, &actual, &mut captures, &format!("$[{i}].lastPayload"))?;
                    }
                }
            }
            other => return Err(format!("{tag}: unknown direction {other:?}")),
        }
    }

    // No unasserted outbound unless last step was assert-no-outbound.
    let last_dir = steps
        .last()
        .and_then(|s| s["direction"].as_str())
        .unwrap_or("");
    if last_dir != "assert-no-outbound" {
        for (id, ch) in &channels {
            std::thread::sleep(Duration::from_millis(10));
            if ch.outbound_len() > 0 {
                return Err(format!(
                    "unasserted outbound messages on channel {id:?}: {:?}",
                    ch.outbound_snapshot()
                ));
            }
        }
    }

    registry.dispose();
    Ok(())
}

fn sleep_future(d: Duration) -> impl std::future::Future<Output = ()> {
    let (tx, rx) = oneshot::channel();
    std::thread::spawn(move || {
        std::thread::sleep(d);
        let _ = tx.send(());
    });
    async move {
        let _ = rx.await;
    }
}

// ---------- top-level tests ----------

fn run_suite<F: Fn(&Path) -> Result<(), String>>(
    label: &str,
    files: Vec<PathBuf>,
    runner: F,
) -> Vec<(String, String)> {
    let mut failures = Vec::new();
    for file in files {
        let name = file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("<?>")
            .to_string();
        match runner(&file) {
            Ok(()) => eprintln!("  ✓ {label} {name}"),
            Err(e) => {
                eprintln!("  ✗ {label} {name}\n      {e}");
                failures.push((format!("{label} {name}"), e));
            }
        }
    }
    failures
}

#[test]
fn encoding_vectors() {
    let dir = spec_dir().join("conformance").join("encoding");
    let files = list_vectors(&dir);
    assert!(
        !files.is_empty(),
        "no encoding vectors in {}",
        dir.display()
    );
    let failures = run_suite("encoding", files, run_encoding_vector);
    if !failures.is_empty() {
        panic!("{} encoding vector(s) failed", failures.len());
    }
}

#[test]
fn behavior_vectors() {
    let dir = spec_dir().join("conformance").join("behavior");
    let files = list_vectors(&dir);
    assert!(
        !files.is_empty(),
        "no behavior vectors in {}",
        dir.display()
    );
    let pool = ThreadPool::new().expect("ThreadPool");
    let failures = run_suite("behavior", files, |f| run_behavior_vector(f, &pool));
    if !failures.is_empty() {
        panic!("{} behavior vector(s) failed", failures.len());
    }
}
