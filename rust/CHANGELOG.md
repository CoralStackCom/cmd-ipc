# Changelog

## coralstack-cmd-ipc 0.2.0

### Fixes

- **Concurrent handler dispatch (head-of-line blocking fix).** The
  per-channel pump in `CommandRegistry::register_channel` previously
  awaited each handler future inline before reading the next message,
  which meant a single slow handler (e.g. one awaiting a multi-minute
  external sync) would stall every subsequent message on that channel —
  including unrelated commands, forwarded responses, and events. The
  pump now pushes each handler future into a `FuturesUnordered` and
  cooperatively interleaves it with the next `recv`, so awaits inside a
  handler no longer block other messages.

  The fix is runtime-agnostic: no `tokio::spawn`, no new dependency,
  no API break. The user's existing executor still drives the single
  pump task. For true multi-thread parallelism, wrap handler bodies
  in your runtime's `spawn` yourself.

- **Preserve the wire error message on `NotFound`.**
  `error_to_command_error` previously substituted the local command id
  into `CommandError::NotFound`, discarding the message the remote
  peer sent (e.g. the full `Command "x" not found` text). It now
  propagates the wire message verbatim, so callers see what the peer
  actually reported. Paired with the TypeScript fix that stops
  labelling every handler exception as `NOT_FOUND` and now defaults
  handler runtime failures to `INTERNAL_ERROR`, the Rust client no
  longer surfaces misleading "not found" errors for handlers that
  simply threw.

### Added

- **`Config::max_in_flight_per_channel`** (default `256`, set by
  `Config::default()`). Caps the number of handler futures the pump
  will let run concurrently on one channel. When the cap is reached
  the pump applies backpressure to the channel rather than dropping
  messages. Set to `0` to disable the cap.

  Optional in practice — code using `Config::default()` or
  `..Default::default()` picks up the `256` default automatically.
  The field only needs an explicit value when you construct
  `Config { … }` field-by-field, because Rust struct literals must
  name every field.
