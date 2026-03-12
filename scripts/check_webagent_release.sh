#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="quick"
if [[ "${1-}" == "--full" ]]; then
  MODE="full"
fi

cd "$ROOT_DIR"

echo "[webagent-release] mode=$MODE"
echo "[1/4] contract-check"
python3 server-py/scripts/verify_webagent_core_contract.py

echo "[2/4] python-compile"
python3 -m py_compile server-py/app/services/webagent_core/*.py

echo "[3/4] go-test"
(
  cd server-go
  go test ./...
)

if [[ "$MODE" == "full" ]]; then
  echo "[4/4] frontend-build"
  npm run build
else
  echo "[4/4] frontend-build (skipped in quick mode)"
fi

echo "[webagent-release] PASS"
