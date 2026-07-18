#!/usr/bin/env bash
set -euo pipefail
PORT="${OVERLAY_PORT:-3010}"
curl --fail --silent "http://127.0.0.1:${PORT}/api/health"
printf '\n'
