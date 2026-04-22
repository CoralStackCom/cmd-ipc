# cmd-ipc Protocol Specification

This directory is the canonical source of truth for the cmd-ipc wire protocol. All language implementations (`ts/`, `rust/`) MUST conform to the definitions here.

## Layout

- `messages.md` — the seven message types (`register.command.request`, `execute.command.request`, `event`, …) and their semantics.
- `schemas/` — canonical JSON Schema definitions for every message payload.
- `conformance/` — shared test vectors that every implementation runs against. Pass these, you're compliant.

## Versioning

Protocol versions are tagged `spec-v<N>` in git. Breaking changes bump `N`.

- `spec-v1` — initial protocol.

Implementations advertise the spec version(s) they support in their `hello` handshake frame (see `handshake.md` once added). A channel only opens if both sides share at least one spec version.

## Relationship to implementations

- Implementations may add transports, encodings, or ergonomics on top, but MUST NOT alter message semantics defined here.
- New message types or fields require a spec change (PR against this directory) before any implementation ships them.
- `conformance/` vectors are copied/linked into each implementation's test suite — divergence there is a bug in the implementation, not the spec.
