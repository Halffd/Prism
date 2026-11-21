#!/usr/bin/env bash
# Regenerate the wasm bridge used by the web studio and ai-core tests.
# Run from anywhere in the monorepo after changing prism-core or prism-wasm.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"

wasm=target/wasm32-unknown-unknown/release/prism_wasm.wasm

cargo build -p prism-wasm --target wasm32-unknown-unknown --release

wasm-bindgen --target web --out-dir apps/web/public/wasm-pkg-web "$wasm"

# Node hosts (Jest, the API, scripts) load the same bridge synchronously.
wasm-bindgen --target nodejs --out-dir libs/ai-core/src/wasm-pkg-node "$wasm"

echo "wrote apps/web/public/wasm-pkg-web and libs/ai-core/src/wasm-pkg-node"
