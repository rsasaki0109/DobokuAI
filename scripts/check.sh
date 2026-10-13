#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/run-cargo.sh fmt --all --check
python3 tests/reference_cases.py --check
python3 tests/irregular_reference.py --check
python3 tests/dam_reference.py --check
python3 tests/grading_reference.py --check
python3 tests/backups.py
python3 tests/test_ncro_inspection.py
python3 tests/test_hec_inspection.py
python3 tests/test_review_audit.py
bash scripts/run-cargo.sh clippy --workspace --all-targets --locked -j 4 -- -D warnings
bash scripts/run-cargo.sh test --workspace --locked -j 4
npm run build --prefix apps/web
if command -v chromium >/dev/null 2>&1; then export CHROMIUM_PATH="$(command -v chromium)"; fi
npm run test:e2e --prefix apps/web
