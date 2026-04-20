//! `multi-service` — a single-process Rust example demonstrating
//! cross-registry command routing with the `#[commands]` macro.
//!
//! Topology:
//!
//! ```text
//!     ┌───────────┐     InMemoryChannel     ┌─────────────┐
//!     │   root    │ ◄─────────────────────► │   worker    │
//!     │           │                         │             │
//!     │ GreetSvc  │                         │  MathSvc    │
//!     └───────────┘                         └─────────────┘
//! ```

mod greet_service;
mod math_service;
mod ui;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use coralstack_cmd_ipc::prelude::*;
use coralstack_cmd_ipc::{CommandDef, Config};
use futures::executor::{block_on, ThreadPool};
use futures::task::SpawnExt;
use serde_json::Value;

use greet_service::GreetService;
use math_service::MathService;

fn main() {
    let (root, worker, _pool) = setup();
    print_banner(&root);
    repl(&root, &worker);
}

/// Wires two registries with an in-memory channel, spawns their driver
/// futures on a thread pool, and registers the two services.
fn setup() -> (CommandRegistry, CommandRegistry, ThreadPool) {
    let root_cfg = Config {
        id: Some("root".into()),
        router_channel: None,
        request_ttl: Duration::from_secs(30),
        event_ttl: Duration::from_secs(5),
    };
    let worker_cfg = Config {
        id: Some("worker".into()),
        router_channel: Some("root".into()),
        request_ttl: Duration::from_secs(30),
        event_ttl: Duration::from_secs(5),
    };

    let (ch_for_root, ch_for_worker) = InMemoryChannel::pair("worker", "root");
    let ch_for_root: Arc<dyn CommandChannel> = ch_for_root;
    let ch_for_worker: Arc<dyn CommandChannel> = ch_for_worker;

    let root = CommandRegistry::new(root_cfg);
    let worker = CommandRegistry::new(worker_cfg);

    let pool = ThreadPool::new().expect("failed to build thread pool");

    block_on(async {
        let driver_root = root.register_channel(ch_for_root).await.unwrap();
        let driver_worker = worker.register_channel(ch_for_worker).await.unwrap();
        pool.spawn(driver_root).unwrap();
        pool.spawn(driver_worker).unwrap();

        GreetService.register_all(&root).await.unwrap();
        MathService.register_all(&worker).await.unwrap();

        futures_sleep(50).await;
    });

    (root, worker, pool)
}

fn print_banner(root: &CommandRegistry) {
    println!("{}", ui::bold("cmd-ipc multi-service example"));
    println!("{}", ui::dim(&format!("registry id: {}", root.id())));
    println!("{}", ui::dim("type `help` for commands, `quit` to exit"));
    println!();
}

fn repl(root: &CommandRegistry, worker: &CommandRegistry) {
    loop {
        let line = match ui::read_line(&format!("{} ", ui::bold("›"))) {
            Ok(l) => l,
            Err(e) => {
                ui::error(&format!("stdin: {e}"));
                break;
            }
        };
        if line.is_empty() {
            // EOF
            break;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match handle_line(root, worker, line) {
            ReplAction::Continue => {}
            ReplAction::Quit => {
                println!("{}", ui::dim("bye"));
                break;
            }
        }
    }
}

enum ReplAction {
    Continue,
    Quit,
}

fn handle_line(root: &CommandRegistry, worker: &CommandRegistry, line: &str) -> ReplAction {
    let (verb, rest) = split_verb(line);
    match verb {
        "help" => print_help(),
        "list" => {
            let defs = root.list_commands_detail();
            if defs.is_empty() {
                println!("{}", ui::dim("(no commands registered)"));
            } else {
                ui::print_command_table(&defs);
            }
        }
        "call" => {
            if let Err(e) = do_call(root) {
                ui::error(&format!("! {e}"));
            }
        }
        "emit" => {
            if let Err(e) = do_emit(root, worker, rest) {
                ui::error(&format!("! {e}"));
            }
        }
        "quit" | "exit" => return ReplAction::Quit,
        "" => {}
        other => ui::error(&format!("unknown verb `{other}`; try `help`")),
    }
    ReplAction::Continue
}

fn print_help() {
    println!(
        "  {}                             list reachable commands",
        ui::bold("list")
    );
    println!(
        "  {}                             pick a command, prompt for fields, execute it",
        ui::bold("call")
    );
    println!(
        "  {} <event-id> <json-payload>   broadcast an event",
        ui::bold("emit")
    );
    println!(
        "  {}                             this help",
        ui::bold("help")
    );
    println!("  {}                             exit", ui::bold("quit"));
}

// ---------- verbs ----------

/// Interactive call: list commands, pick one by number or id, walk the
/// request schema to collect field values, execute, print the response.
fn do_call(root: &CommandRegistry) -> Result<(), String> {
    let defs = root.list_commands_detail();
    if defs.is_empty() {
        return Err("no commands registered".into());
    }
    ui::show_call_banner();
    for (i, d) in defs.iter().enumerate() {
        let desc = d.description.as_deref().unwrap_or("");
        println!("  {:>2}) {}  {}", i + 1, ui::bold(&d.id), ui::dim(desc));
    }
    let choice = ui::read_line("pick (number or id): ")?;
    let choice = choice.trim();
    if choice.is_empty() {
        return Err("cancelled".into());
    }
    let def: &CommandDef = pick_def(&defs, choice)?;
    ui::log(
        "cli",
        format!("selected {} — prompting for request fields", def.id),
    );

    let request = ui::prompt_request(def.schema.as_ref().and_then(|s| s.request.as_ref()))?;

    ui::log(
        "cli",
        format!("call {} payload={}", def.id, ui::pretty(&request)),
    );
    let start = Instant::now();
    let result: Result<Value, _> = block_on(root.execute(&def.id, request.clone()));
    let elapsed = start.elapsed();
    match result {
        Ok(v) => {
            ui::log(
                "cli",
                format!("{} -> ok ({:.1}ms)", def.id, elapsed.as_secs_f64() * 1000.0),
            );
            ui::show_call_summary(&def.id, &request, &v);
            Ok(())
        }
        Err(e) => {
            ui::log(
                "cli",
                format!(
                    "{} -> err ({:.1}ms)",
                    def.id,
                    elapsed.as_secs_f64() * 1000.0
                ),
            );
            Err(format!("{e}"))
        }
    }
}

fn do_emit(root: &CommandRegistry, worker: &CommandRegistry, rest: &str) -> Result<(), String> {
    let (event_id, payload) = split_verb(rest);
    if event_id.is_empty() {
        return Err("usage: emit <event-id> <json-payload>".into());
    }
    let payload_value: Value = if payload.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(payload.trim()).map_err(|e| format!("invalid JSON payload: {e}"))?
    };

    // One-off listener on the worker so the user sees the event traverse
    // the channel.
    let got = Arc::new(Mutex::new(None::<Value>));
    let got_clone = Arc::clone(&got);
    worker.on_event(event_id, move |payload| {
        *got_clone.lock().unwrap() = Some(payload);
    });

    ui::log(
        "cli",
        format!("emit {} payload={}", event_id, ui::pretty(&payload_value),),
    );

    root.emit_event(event_id, payload_value)
        .map_err(|e| format!("emit failed: {e}"))?;

    block_on(futures_sleep(30));
    match got.lock().unwrap().take() {
        Some(v) => {
            ui::log(
                "worker",
                format!("event received: {} {}", event_id, ui::pretty(&v)),
            );
            ui::response("(delivered)");
        }
        None => ui::log(
            "cli",
            "event emitted; no listener observed it on the worker",
        ),
    }
    Ok(())
}

// ---------- helpers ----------

fn pick_def<'a>(defs: &'a [CommandDef], choice: &str) -> Result<&'a CommandDef, String> {
    if let Ok(n) = choice.parse::<usize>() {
        defs.get(n.checked_sub(1).ok_or("number must be >= 1")?)
            .ok_or_else(|| format!("no command at index {n}"))
    } else {
        defs.iter()
            .find(|d| d.id == choice)
            .ok_or_else(|| format!("no command with id `{choice}`"))
    }
}

fn split_verb(s: &str) -> (&str, &str) {
    match s.trim().find(char::is_whitespace) {
        Some(i) => (&s.trim()[..i], s.trim()[i..].trim()),
        None => (s.trim(), ""),
    }
}

fn futures_sleep(ms: u64) -> impl std::future::Future<Output = ()> {
    let (tx, rx) = futures::channel::oneshot::channel();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        let _ = tx.send(());
    });
    async move {
        let _ = rx.await;
    }
}
