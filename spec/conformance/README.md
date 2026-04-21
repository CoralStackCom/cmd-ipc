# Conformance Vectors

Every cmd-ipc implementation MUST pass these vectors. They are the executable complement to `../schemas/` — schemas define the *shape* of messages, vectors define the *behavior* of a conforming registry.

## Layout

```
conformance/
├── encoding/    # Wire-format round-trip vectors
└── behavior/    # End-to-end registry behavior vectors
```

## Encoding vectors

Each file under `encoding/` describes one message and its canonical JSON serialization:

```jsonc
{
  "description": "...",
  "schema":  "<file in ../schemas/ this message validates against>",
  "message": { /* the decoded object */ },
  "json":    "<canonical JSON string>"
}
```

### Harness contract — encoding

For each vector, the harness MUST assert:

1. **Schema validity.** `message` validates against `schemas/<schema>`.
2. **JSON decode.** `JSON.parse(json)` deep-equals `message`.
3. **JSON round-trip.** `JSON.parse(encode(message))` deep-equals `message`. (Byte-equality is NOT required — JSON allows whitespace/key-order variation.)

CBOR support is reserved for a future spec revision and is not currently asserted by the harness.

## Behavior vectors

Each file under `behavior/` describes one scenario: a registry setup plus a sequence of steps. The harness drives an in-memory registry through the steps and asserts outbound messages / local state.

### Step directions

| `direction` | Meaning |
| --- | --- |
| `inbound` | Deliver `message` to the registry as if received from channel `from`. |
| `outbound` | Assert that the registry emits a message matching `expected` to channel `to` (next message on that channel). |
| `assert-no-outbound` | Assert no pending message on channel `to`. |
| `local-call` | Invoke a registry API from within the same process (`trigger` names the API and args). |
| `local-result` | Assert the most recent `local-call` resolved to `expected`. |
| `assert-local-listener` | Assert a local event listener for `eventId` was invoked `invocations` times (optionally checking `lastPayload`). |

### Setup

```jsonc
{
  "registry": {
    "id": "main",                        // required
    "routerChannel": "main",             // optional: escalate unknown commands here
    "localCommands": [ /* ... */ ],      // optional: pre-registered local commands
    "localEventListeners": [ "evt.id" ]  // optional: pre-attached listeners
  },
  "peers": [
    { "channelId": "worker-1", "commandImplementations": [ ... ] }
  ]
}
```

A peer is a mock channel the harness can inject messages into (`inbound` with `from: <channelId>`) and inspect messages emitted to (`outbound` with `to: <channelId>`).

### Pattern matchers

Expected messages / payloads may use these special values anywhere a literal is allowed:

| Pattern | Meaning |
| --- | --- |
| `{ "$match": "uuid" }` | Any string parseable as a UUID. |
| `{ "$match": "any-string" }` | Any non-empty string (used for error messages, which are not normative). |
| `{ "$capture": "name" }` | Accept any value here and store it under `name` for later steps. |
| `{ "$ref": "name" }` | Use the value captured earlier under `name`. |
| `{ "$unordered": [...] }` | Match an array ignoring order. |
| `{ "$expr": "..." }` | (Setup only.) A tiny expression over `request` used to mock command return values. |

### Harness contract — behavior

For each vector, the harness MUST:

1. Construct a registry matching `setup.registry`.
2. Register mock channels for each entry in `setup.peers`.
3. Execute steps in order. Fail with `<vector-file>:<step-index>` on mismatch.
4. Fail if any outbound message remains unasserted at the end, unless the last step was `assert-no-outbound`.

## Running

From the repo root:

```bash
make conformance
```

TypeScript: `ts/packages/cmd-ipc/tests/conformance/` loads vectors and runs them under vitest.
Rust: `rust/crates/cmd-ipc/tests/conformance.rs` loads vectors via `include_dir!` and runs them under `cargo test`.

## Adding a vector

1. Write the `.json` file under the appropriate subdir.
2. Run both harnesses locally. Both MUST pass or the spec change isn't real.
3. Commit the vector + any implementation changes in the same PR.

Divergence between implementations is resolved by updating the implementation, not the vector — the vector represents what the protocol says.
