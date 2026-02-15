# chat_wasm

Rust/WASM hot-path helpers for the Web IM worker.

## Build

From `telegram-clone-frontend`:

```sh
cd src/core/wasm/chat_wasm
wasm-pack build --release --target web --out-dir pkg --out-name chat_wasm
```

The generated `pkg/` output is committed to the repo to keep builds deterministic.

