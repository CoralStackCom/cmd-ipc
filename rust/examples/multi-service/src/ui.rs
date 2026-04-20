//! Terminal UI helpers for the multi-service example.
//!
//! Responsibilities:
//! - Color primitives (bold / dim / cyan / green / red), gated on the
//!   `NO_COLOR` convention and a `-t` style TTY check. Cyan is used
//!   for responses so it reads cleanly on both light and dark
//!   backgrounds.
//! - Log lines (`log`) go to stderr so they don't interleave with
//!   response output if the session is piped.
//! - The `list` command's table renderer.
//! - Schema-driven prompting used by the `call` command to walk a
//!   command's JSON Schema and build a request payload one field at
//!   a time.

use std::io::{self, BufRead, IsTerminal, Write};
use std::sync::OnceLock;

use coralstack_cmd_ipc::CommandDef;
use serde_json::{Map, Value};

// ---------- color ----------

fn colors_enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("NO_COLOR").is_none() && io::stdout().is_terminal())
}

fn wrap(code: &str, s: &str) -> String {
    if colors_enabled() {
        format!("\x1b[{code}m{s}\x1b[0m")
    } else {
        s.to_string()
    }
}

pub fn bold(s: &str) -> String {
    wrap("1", s)
}
pub fn dim(s: &str) -> String {
    wrap("2", s)
}
pub fn cyan(s: &str) -> String {
    wrap("36", s)
}
pub fn green(s: &str) -> String {
    wrap("32", s)
}
pub fn red(s: &str) -> String {
    wrap("31", s)
}

/// Cyan + bold. Works on light and dark backgrounds.
pub fn response(s: &str) {
    println!("{}", bold(&cyan(s)));
}

pub fn error(s: &str) {
    eprintln!("{}", bold(&red(s)));
}

/// Writes a dim, bracketed log line to stderr. Callers pass a short
/// scope tag (`cli`, `worker`, etc.) so the session log reads like:
///
/// ```text
/// [cli] call math.add payload={"a":2,"b":3}
/// [cli] math.add -> 5 (0.4ms)
/// ```
pub fn log(scope: &str, msg: impl AsRef<str>) {
    eprintln!("{} {}", dim(&format!("[{scope}]")), dim(msg.as_ref()));
}

// ---------- list table ----------

pub fn print_command_table(defs: &[CommandDef]) {
    const HEADERS: [&str; 4] = ["ID", "Description", "Request Schema", "Response Schema"];
    const MAX_WIDTHS: [usize; 4] = [22, 28, 44, 44];

    let rows: Vec<[Vec<String>; 4]> = defs
        .iter()
        .map(|d| {
            [
                vec![d.id.clone()],
                split_into_lines(d.description.as_deref().unwrap_or("-")),
                schema_lines(d.schema.as_ref().and_then(|s| s.request.as_ref())),
                schema_lines(d.schema.as_ref().and_then(|s| s.response.as_ref())),
            ]
        })
        .collect();

    let mut widths = [0usize; 4];
    for (i, h) in HEADERS.iter().enumerate() {
        widths[i] = h.chars().count();
    }
    for row in &rows {
        for (i, cell) in row.iter().enumerate() {
            for line in cell {
                widths[i] = widths[i].max(line.chars().count());
            }
        }
    }
    for (i, w) in widths.iter_mut().enumerate() {
        *w = (*w).min(MAX_WIDTHS[i]);
    }

    let sep = format!(
        "+{}+",
        widths
            .iter()
            .map(|w| "-".repeat(w + 2))
            .collect::<Vec<_>>()
            .join("+")
    );

    println!("{sep}");
    print_row_multiline(&HEADERS.map(|s| vec![s.to_string()]), &widths);
    println!("{sep}");
    for row in &rows {
        print_row_multiline(row, &widths);
        println!("{sep}");
    }
}

fn print_row_multiline(cells: &[Vec<String>; 4], widths: &[usize; 4]) {
    let height = cells.iter().map(|c| c.len()).max().unwrap_or(1).max(1);
    for line_idx in 0..height {
        let parts: Vec<String> = cells
            .iter()
            .zip(widths.iter())
            .map(|(cell, w)| {
                let line = cell.get(line_idx).cloned().unwrap_or_default();
                format!(" {:<width$} ", truncate(&line, *w), width = *w)
            })
            .collect();
        println!("|{}|", parts.join("|"));
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else if max <= 1 {
        "…".to_string()
    } else {
        let take = max - 1;
        let head: String = s.chars().take(take).collect();
        format!("{head}…")
    }
}

fn schema_lines(schema: Option<&Value>) -> Vec<String> {
    match schema {
        None => vec!["-".into()],
        Some(v) => serde_json::to_string_pretty(v)
            .unwrap_or_else(|_| v.to_string())
            .split('\n')
            .map(str::to_string)
            .collect(),
    }
}

fn split_into_lines(s: &str) -> Vec<String> {
    if s.is_empty() {
        vec!["-".into()]
    } else {
        s.split('\n').map(str::to_string).collect()
    }
}

// ---------- schema-driven prompter (for the `call` command) ----------

/// Walks a JSON Schema value, prompting the user for each field, and
/// returns the assembled JSON request payload.
///
/// Supported top-level shapes:
///   - `object` with `properties` → prompts per field (honors
///     `required` for validation, skips blank optional fields)
///   - scalar (`string` / `integer` / `number` / `boolean`) → single
///     prompt with type hint
///   - missing / unknown → prompt for raw JSON
pub fn prompt_request(schema: Option<&Value>) -> Result<Value, String> {
    match schema {
        None => Ok(Value::Null),
        Some(s) => prompt_value_for_schema(s),
    }
}

fn prompt_value_for_schema(schema: &Value) -> Result<Value, String> {
    let Some(obj) = schema.as_object() else {
        // Unusual — schema isn't an object literal. Ask for raw JSON.
        return prompt_raw_json("value");
    };

    let ty = obj.get("type").and_then(Value::as_str).unwrap_or("");
    match ty {
        "object" => prompt_object(obj),
        "integer" | "number" | "string" | "boolean" => prompt_scalar(ty, "value"),
        "" => prompt_raw_json("value"),
        _ => prompt_raw_json("value"),
    }
}

fn prompt_object(obj: &Map<String, Value>) -> Result<Value, String> {
    let Some(props) = obj.get("properties").and_then(Value::as_object) else {
        return Ok(Value::Object(Map::new()));
    };
    let required: Vec<&str> = obj
        .get("required")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();

    let mut out = Map::new();
    for (name, prop_schema) in props {
        let ty = prop_schema
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("any");
        let is_required = required.contains(&name.as_str());
        let label = format!(
            "  {} ({}, {})",
            name,
            ty,
            if is_required { "required" } else { "optional" }
        );
        // Blank input -> skip optional / error on required.
        let line = read_line(&format!("{label}: "))?;
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed.is_empty() {
            if is_required {
                return Err(format!("`{name}` is required"));
            }
            continue;
        }
        let value = parse_scalar(ty, trimmed).or_else(|_| {
            // Last resort: treat as raw JSON literal.
            serde_json::from_str::<Value>(trimmed)
                .map_err(|e| format!("invalid value for `{name}`: {e}"))
        })?;
        out.insert(name.clone(), value);
    }
    Ok(Value::Object(out))
}

fn prompt_scalar(ty: &str, name: &str) -> Result<Value, String> {
    let line = read_line(&format!("  {name} ({ty}): "))?;
    parse_scalar(ty, line.trim())
}

fn parse_scalar(ty: &str, s: &str) -> Result<Value, String> {
    match ty {
        "integer" => s
            .parse::<i64>()
            .map(Value::from)
            .map_err(|e| format!("not an integer: {e}")),
        "number" => s
            .parse::<f64>()
            .map(|f| {
                serde_json::Number::from_f64(f)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            })
            .map_err(|e| format!("not a number: {e}")),
        "boolean" => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "t" | "y" | "yes" | "1" => Ok(Value::Bool(true)),
            "false" | "f" | "n" | "no" | "0" => Ok(Value::Bool(false)),
            _ => Err(format!("not a boolean: `{s}`")),
        },
        "string" => Ok(Value::String(s.to_string())),
        _ => serde_json::from_str::<Value>(s).map_err(|e| format!("invalid JSON: {e}")),
    }
}

fn prompt_raw_json(name: &str) -> Result<Value, String> {
    let line = read_line(&format!("  {name} (raw JSON): "))?;
    serde_json::from_str(line.trim()).map_err(|e| format!("invalid JSON: {e}"))
}

pub fn read_line(prompt: &str) -> Result<String, String> {
    print!("{prompt}");
    io::stdout().flush().ok();
    let mut buf = String::new();
    io::stdin()
        .lock()
        .read_line(&mut buf)
        .map_err(|e| format!("stdin error: {e}"))?;
    Ok(buf)
}

// ---------- pretty printing ----------

pub fn pretty(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| format!("{v:?}"))
}

pub fn pretty_many(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_else(|_| format!("{v:?}"))
}

/// Report the sent/received markers so the user sees the full loop.
pub fn show_call_summary(command: &str, request: &Value, response: &Value) {
    println!("{}", dim(&format!("request -> {}", pretty(request))));
    println!("{} {}", dim("response from"), bold(command));
    println!("{}", bold(&cyan(&pretty_many(response))));
    println!();
}

/// Banner for the interactive `call` chooser.
pub fn show_call_banner() {
    println!("{}", bold(&green("Call a command — pick by number or id.")));
}
