#!/usr/bin/env bash
# Repeatable cloud onboarding: pinned tools, verified downloads, lockfiles unchanged.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v cargo >/dev/null 2>&1; then
  export CARGO_HOME=/workspace/.toolchains/cargo
  export RUSTUP_HOME=/workspace/.toolchains/rustup
  export PATH="$CARGO_HOME/bin:$PATH"
  if [[ ! -x "$CARGO_HOME/bin/cargo" ]]; then
    mkdir -p /workspace/.toolchains/downloads
    (
      cd /workspace/.toolchains/downloads
      curl -fsSL https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init -o rustup-init
      curl -fsSL https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init.sha256 -o rustup-init.sha256
      sha256sum -c rustup-init.sha256
      chmod +x rustup-init
      ./rustup-init -y --no-modify-path --profile minimal --default-toolchain 1.90.0 --component rustfmt --component clippy
    )
  fi
fi
bash scripts/run-cargo.sh build --workspace --locked -j 4
npm ci --prefix apps/web --no-audit --no-fund
npm run build --prefix apps/web
