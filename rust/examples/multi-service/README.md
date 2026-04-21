# multi-service

A single-process Rust example demonstrating cross-registry command
routing with the `#[commands]` macro.

## Topology

Two `CommandRegistry` instances, `root` and `worker`, connected by an
`InMemoryChannel`. The worker is configured with `router_channel =
"root"`, so its registrations escalate upward and the root sees
`math.*` as remote commands.

- **root** — hosts `GreetService` (`greet.hello`, `greet.farewell`).
- **worker** — hosts `MathService` (`math.add`, `math.sub`, `math.mul`).

The REPL runs against the root. Local calls (`greet.*`) execute
directly; `math.*` calls route across the channel to the worker.

## Run

```bash
cargo run --example multi-service   # if configured as an example
# or from the rust/ workspace root:
cargo run -p multi-service
```

## Sample session

Output uses ANSI color: response lines are **cyan bold**, log lines
are **dim grey** on stderr, errors are **red bold**. Set
`NO_COLOR=1` or pipe stdout to disable.

```text
cmd-ipc multi-service example
registry id: root
type `help` for commands, `quit` to exit

› help
  list                             list reachable commands
  call                             pick a command, prompt for fields, execute it
  emit <event-id> <json-payload>   broadcast an event
  help                             this help
  quit                             exit

› list
+----------------+-----------------------+----------------------------------+----------------------+
| ID             | Description           | Request Schema                   | Response Schema      |
+----------------+-----------------------+----------------------------------+----------------------+
| greet.hello    | Greet someone by name | {                                | {                    |
|                |                       |   "type": "string"               |   "type": "string"   |
|                |                       | }                                | }                    |
+----------------+-----------------------+----------------------------------+----------------------+
| math.add       | Add two integers      | {                                | {                    |
|                |                       |   "additionalProperties": false, |   "format": "int64", |
|                |                       |   "properties": {                |   "type": "integer"  |
|                |                       |     "a": { ... },                | }                    |
|                |                       |     "b": { ... }                 |                      |
|                |                       |   },                             |                      |
|                |                       |   "required": ["a", "b"],        |                      |
|                |                       |   "type": "object"               |                      |
|                |                       | }                                |                      |
+----------------+-----------------------+----------------------------------+----------------------+
(greet.farewell, math.sub, math.mul elided)

› call
Call a command — pick by number or id.
   1) greet.farewell  Say goodbye
   2) greet.hello  Greet someone by name
   3) math.add  Add two integers
   4) math.mul  Multiply two integers
   5) math.sub  Subtract b from a
pick (number or id): 3
[cli] selected math.add — prompting for request fields
  a (integer, required): 7
  b (integer, required): 11
[cli] call math.add payload={"a":7,"b":11}
[cli] math.add -> ok (0.2ms)
request -> {"a":7,"b":11}
response from math.add
18

› emit user.updated {"id":42,"name":"Ada"}
[cli] emit user.updated payload={"id":42,"name":"Ada"}
[worker] event received: user.updated {"id":42,"name":"Ada"}
(delivered)

› quit
bye
```

The request/response schemas shown in the table are the exact JSON
Schema blobs the registry advertises on the wire — byte-compatible
with what the TypeScript implementation sends in
`register.command.request` / `list.commands.response` (see
`spec/schemas/command-definition.json` for the normative shape).

## What this example proves

- **`#[commands]` macro** registers methods as typed commands with a
  single `Service.register(&registry).await?` call, mirroring the
  TS `@Command` + `registerCommands()` UX.
- **Cross-registry routing** — `math.*` is handled on the worker yet
  callable from the root, exercising the same escalation path used by
  the TS package.
- **Event fan-out** — `emit` on the root is observed on the worker.
- **Schema-driven calls** — `call` walks the command's advertised
  JSON Schema and prompts for each required/optional field, then
  serializes the entered values into the correct request shape and
  executes. No hand-rolled JSON required.
- **Language-agnostic JSON Schema on the wire** — the schemas the
  registry advertises contain only standard keywords (`type`,
  `properties`, `required`, `additionalProperties`, string-only
  `format`). No Rust-specific `int64`/`title` leakage — suitable for
  MCP tools and remote `GET /cmd.json` consumers as-is.
