#!/bin/bash
set -euo pipefail
pnpm --filter @fitapp/api exec wrangler dev --config wrangler.dev.jsonc \
  --ip 0.0.0.0 --port 8787 --var "SITE_URL:$WT_URL" &
api_pid=$!
# The workspace owner, not Astro's cross-reboot PID cache, owns this foreground server.
pnpm --filter @fitapp/front exec astro dev --host 0.0.0.0 --port 4321 --ignore-lock &
front_pid=$!
trap 'kill "$api_pid" "$front_pid" 2>/dev/null || true; wait || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait -n "$api_pid" "$front_pid"
