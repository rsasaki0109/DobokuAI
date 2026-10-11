#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
# Start both children in separate process groups, so Ctrl-C stops only this script's services.
setsid bash scripts/run-cargo.sh run --locked -p doboku-api >.local/api.log 2>&1 &
api_pid=$!
setsid npm run dev --prefix apps/web -- --port 5173 --strictPort >.local/web.log 2>&1 &
web_pid=$!
cleanup() { kill -- -"$api_pid" -"$web_pid" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM
for _ in $(seq 1 60); do
  kill -0 "$api_pid" 2>/dev/null || { cat .local/api.log; exit 1; }
  kill -0 "$web_pid" 2>/dev/null || { cat .local/web.log; exit 1; }
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>/dev/null && curl -fsS http://127.0.0.1:5173/api/sample >/dev/null 2>/dev/null; then
    python3 scripts/smoke.py
    echo 'DobokuAI ready: web port 5173; API port 3001; logs in .local/'
    wait -n "$api_pid" "$web_pid"
    exit 1
  fi
  sleep 1
done
echo 'Startup timed out; see .local/api.log and .local/web.log' >&2
exit 1
