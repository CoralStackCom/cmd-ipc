# dynamic-plugin

A generic template for plugin-host channels: a custom `CommandChannel`
that advertises its commands at runtime, dispatches requests into a
sandboxed handler, and automatically cleans up every command it owns
when the channel closes.

Typical use cases include scripting runtimes (JS, Lua, WASM), FFI
bridges, or any host that needs to hot-reload a bundle of commands as
a group. In this example the "sandbox" is a plain `HashMap<String,
Fn>` so it runs with no extra dependency.

## What this demonstrates

1. **Dynamic command advertisement.** `PluginChannel::start` sends one
   `register.command.request` per plugin-exported function. The schema
   is built at runtime (no compile-time `Command` types).
2. **Runtime dispatch.** Incoming `execute.command.request` messages
   are routed into the sandbox handler map and responded to with
   `execute.command.response`.
3. **Automatic cleanup on unload.** `plugin.close().await` causes the
   registry's driver loop to observe EOF and run its channel-close
   cleanup, removing every command owned by the channel. No manual
   `unregister_command` — the API doesn't have one.
4. **Loose-mode invocation.** `registry.execute_dyn(id, json!({...}))`
   is the natural entry point for talking to runtime commands.
5. **Permissive schemas.** `CommandSchema::permissive()` is used for
   `plugin.echo`, the realistic fallback when the exported function's
   signature is `any → any`.

## Run

```bash
make rs-start-example dynamic-plugin
# or
cargo run -p dynamic-plugin
```

## Expected output

```
─── advertising plugin commands ──────────────────────────────
  plugin.echo — Echo the request payload back, wrapped
  plugin.greet — Greet someone by name

─── calling plugin commands via execute_dyn ──────────────────
  plugin.greet {name:"Ada"}   => {"greeting":"hello, Ada"}
  plugin.echo  {x:1, y:[…]}     => {"you_sent":{"x":1,"y":[true,false]}}
  plugin.echo  null               => err: invalid request for command plugin.echo: expected a non-null payload

─── closing the plugin channel (unloads the plugin) ──────────
  commands visible to root after close:
    (none — cleanup worked)

─── attempting to call a command after close ─────────────────
  plugin.greet => err: command not found: plugin.greet
```

## Porting to a real runtime

For a real plugin host (QuickJS / `rquickjs`, Lua, WASM, or anything
else that loads code dynamically):

- Replace `Sandbox` + `PluginHandler` with your runtime's context
  (a VM, interpreter state, WASM instance, `dlopen`ed library, …).
- In `start()`, introspect the plugin's exports to build `CommandDef`s.
  Use `CommandSchema::permissive()` when the exported function's shape
  isn't introspectable; otherwise translate the runtime's type info
  into JSON Schema and pass via `.with_request(..)` / `.with_response(..)`.
- In `dispatch()`, invoke the plugin function inside the sandbox,
  capture its return value (or thrown error), and map to
  `ExecuteResult`.
- On `close()`, tear down the runtime context so resources are
  released before the channel goes away. Call `plugin.close().await`
  from your unload path so the runtime is gone before the caller
  observes the plugin as removed; the registry will then clean up the
  command entries on its own.

## Notes

- Set `request_ttl` on the registry higher than the slowest
  plugin-side handler execution time. A response arriving after the
  TTL fires is silently dropped by the registry, which is correct per
  spec but easy to miss when debugging.
- Commands with ids prefixed by `_` stay local to this channel's peer
  (they aren't advertised to a router). Useful when a plugin wants an
  "internal" helper that shouldn't show up in the global registry.
