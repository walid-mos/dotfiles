#!/bin/bash
# Fake `bw` for agent-bw.bats. State lives in $FAKE_BW: server, status, orgs.json, collections.json, items.json.
# Every call appends one JSON line to $FAKE_BW/calls: its arguments, its stdin (encode, create, edit), the data
# directory and the session it saw. `create` and `edit` also save a `ps` snapshot ($FAKE_BW/ps.<n>), taken while the
# password is in flight. FAKE_BW_FAIL=<command> makes that command fail.
set -u
F=$FAKE_BW
# The real jq: the one first on PATH is the test's recorder of agent-bw's jq calls.
jq() { "$REAL_JQ" "$@"; }
stdin=""
case "${1:-} ${2:-}" in "encode "|"create item"|"edit item") stdin=$(cat) ;; esac
# The arguments go through stdin: jq would read one such as --apikey as its own option.
args=$(printf '%s\n' "$@" | jq -R . | jq -sc .)
jq -cn --argjson args "$args" --arg stdin "$stdin" --arg dir "${BITWARDENCLI_APPDATA_DIR:-}" --arg session "${BW_SESSION:-}" \
	'{args: $args, stdin: $stdin, dir: $dir, session: $session}' >>"$F/calls"

[ "${FAKE_BW_FAIL:-}" = "$1" ] && { echo "fake bw: $1 failed" >&2; exit 1; }
need_session() { [ "${BW_SESSION:-}" = SESSION-SENTINEL ] || { echo "Vault is locked." >&2; exit 1; }; }
snapshot() { n=$(ls "$F" | grep -c '^ps\.'); ps -axww -o args= >"$F/ps.$n"; }
items() { cat "$F/items.json"; }
put_items() { cat >"$F/items.new" && mv "$F/items.new" "$F/items.json"; }

case "$1" in
config)
	if [ $# -eq 2 ]; then cat "$F/server"; else printf '%s' "$3" >"$F/server"; echo "Saved setting \`config\`."; fi ;;
status)
	jq -cn --arg s "$(cat "$F/status")" --arg u "$(cat "$F/server")" '{serverUrl: $u, status: $s}' ;;
login)
	[ "${BW_CLIENTID:-}" = CLIENTID-SENTINEL ] && [ "${BW_CLIENTSECRET:-}" = CLIENTSECRET-SENTINEL ] ||
		{ echo "client_id or client_secret is incorrect." >&2; exit 1; }
	echo locked >"$F/status"; echo "You are logged in!" ;;
unlock)
	[ "$2" = --passwordenv ] && [ "${!3:-}" = VAULT-PASSWORD-SENTINEL ] || { echo "Invalid master password." >&2; exit 1; }
	printf 'SESSION-SENTINEL' ;;
lock) echo "Your vault is locked." ;;
logout) echo unauthenticated >"$F/status"; echo "You have logged out." ;;
sync) need_session; echo "Syncing complete." ;;
generate) printf 'GENERATED-PW-SENTINEL' ;;
encode) printf '%s' "$stdin" | base64 ;;
list)
	need_session
	case "$2" in
	organizations) cat "$F/orgs.json" ;;
	collections) cat "$F/collections.json" ;;
	items) [ "$3" = --collectionid ] || exit 1; items | jq --arg c "$4" '[.[] | select(.collectionIds | index($c))]' ;;
	*) exit 1 ;;
	esac ;;
get)
	need_session
	case "$2" in
	template) jq -n '{organizationId: null, collectionIds: null, folderId: null, type: 1, name: "Item name", notes: "Some notes here", favorite: false, fields: [], login: null, secureNote: null, card: null, identity: null, reprompt: 0}' ;;
	item) items | jq -e --arg i "$3" '.[] | select(.id == $i)' || { echo "Not found." >&2; exit 1; } ;;
	totp) items | jq -e -r --arg i "$3" '.[] | select(.id == $i and .login.totp != null) | "123456"' || { echo "No TOTP available for this login." >&2; exit 1; } ;;
	*) exit 1 ;;
	esac ;;
create)
	need_session; snapshot
	item=$(printf '%s' "$stdin" | base64 -d | jq '.id = "new-item-id"')
	items | jq --argjson it "$item" '. + [$it]' | put_items
	printf '%s' "$item" ;;
edit)
	need_session; snapshot
	new=$(printf '%s' "$stdin" | base64 -d)
	# As Bitwarden's clients do: a changed password moves the old one to the front of the history.
	items | jq --arg i "$3" --argjson new "$new" 'map(if .id == $i then
		(if .login.password != $new.login.password then $new + {passwordHistory: ([{lastUsedDate: "2026-11-27T00:00:00.000Z", password: .login.password}] + (.passwordHistory // []))} else $new end)
		else . end)' | put_items
	items | jq --arg i "$3" '.[] | select(.id == $i)' ;;
delete)
	need_session
	items | jq --arg i "$3" 'map(select(.id != $i))' | put_items ;;
*)
	echo "fake bw: unknown command $*" >&2; exit 1 ;;
esac
