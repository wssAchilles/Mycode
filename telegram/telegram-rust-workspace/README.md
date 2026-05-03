# Telegram Rust Workspace Transition

Status: transitional plan, no Cargo build impact yet.

This directory records the long-term Rust workspace boundary without moving
existing services in one step.

Current Rust service crates:

- `../telegram-rust-recommendation`
- `../telegram-rust-gateway`

Not included in this transition:

- `../telegram-clone-frontend/src/core/wasm/chat_wasm`

## Current Decision

Do not create a root Cargo workspace yet.

Both Rust services currently own separate `Cargo.lock` files and can be built
or tested independently. A root workspace would change lockfile ownership and
dependency resolution, so the first step is to make the target crate boundaries
explicit before moving packages.

## Target Shared Crates

Planned extraction order:

1. `telegram-recommendation-contracts`
2. `telegram-rust-http-types`
3. `telegram-recommendation-fixtures`
4. `telegram-ranking-primitives`

Extraction rules:

- Recommendation algorithm contracts move before runtime code.
- Replay fixtures move before shared scorer primitives.
- Gateway-facing HTTP types move only after recommendation contracts stabilize.
- No shared crate should depend on `ml-services/**` or `telegram-light-jobs/**`.

## Migration Gate

Create a real Cargo workspace only when:

- shared contract types are ready to move out of a single service,
- both Rust services can consume them without duplicating definitions,
- lockfile ownership has been explicitly accepted,
- CI/build commands have been updated to run from the workspace root.
