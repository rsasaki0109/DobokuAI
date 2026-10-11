#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${BUILD_CA_FILE:-}" ]]; then
  # BuildKit secret: public CA bundle supplied by the execution environment.
  # JSON is valid YAML; quote paths structurally rather than interpolating shell text.
  mkdir -p .local
  python3 - <<'PY'
import json, os
from pathlib import Path
ca = Path(os.environ['BUILD_CA_FILE']).resolve(strict=True)
override = {'services': {name: {'build': {'secrets': ['build_ca']}} for name in ['api','web']}, 'secrets': {'build_ca': {'file': str(ca)}}}
override['services']['api'].update({'volumes': [{'type': 'bind', 'source': str(ca), 'target': '/run/proxy-ca-bundle.pem', 'read_only': True}], 'environment': {'SSL_CERT_FILE': '/run/proxy-ca-bundle.pem', 'CURL_CA_BUNDLE': '/run/proxy-ca-bundle.pem'}})
Path('.local/compose-ca.json').write_text(json.dumps(override))
PY
  exec docker compose -f docker-compose.yml -f .local/compose-ca.json "$@"
fi
exec docker compose "$@"
