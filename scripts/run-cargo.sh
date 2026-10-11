#!/usr/bin/env bash
set -euo pipefail
if ! command -v cargo >/dev/null 2>&1 && [[ -x /workspace/.toolchains/cargo/bin/cargo ]]; then
  export CARGO_HOME=/workspace/.toolchains/cargo
  export RUSTUP_HOME=/workspace/.toolchains/rustup
  export PATH="$CARGO_HOME/bin:$PATH"
fi
exec cargo "$@"
