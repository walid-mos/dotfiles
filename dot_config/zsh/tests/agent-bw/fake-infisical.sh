#!/bin/bash
# Fake `infisical` for agent-bw.bats: `infisical run <options> -- <command>` records its options in
# $FAKE_BW/infisical-args, then runs the command with the three Bitwarden credentials set to sentinels.
set -u
[ "${1:-}" = run ] || { echo "fake infisical: only run" >&2; exit 1; }
shift
options=()
while [ $# -gt 0 ] && [ "$1" != -- ]; do options+=("$1"); shift; done
[ "${1:-}" = -- ] || { echo "fake infisical: no --" >&2; exit 1; }
shift
printf '%s\n' "${options[@]}" >"$FAKE_BW/infisical-args"
export BW_CLIENTID=CLIENTID-SENTINEL BW_CLIENTSECRET=CLIENTSECRET-SENTINEL BW_PASSWORD=VAULT-PASSWORD-SENTINEL
exec "$@"
