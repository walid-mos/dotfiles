#!/bin/bash
set -euo pipefail
socat "UNIX-LISTEN:$WT_APPLICATION_SOCKET,fork,unlink-early,mode=0600" "TCP:127.0.0.1:$WT_APPLICATION_PORT" &
relay_pid=$!
bash -lc "$1" &
application_pid=$!
trap 'kill "$relay_pid" "$application_pid" 2>/dev/null || true; wait || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait -n "$relay_pid" "$application_pid"
