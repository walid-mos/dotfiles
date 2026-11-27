#!/usr/bin/env bats
# Tests of `agent-bw`, the agent's reader and writer of its Bitwarden collection. The script runs in a temporary home
# beside a fake `infisical` (tests/agent-bw/fake-infisical.sh) that sets the three credentials to sentinels, and a fake
# `bw` (tests/agent-bw/fake-bw.sh) that answers from fixture JSON and records every call, and a `jq` that records its
# arguments before running the real one. Nothing reaches Bitwarden.
#
# Run: bats ~/.config/zsh/tests/agent-bw.bats
# Needs: jq.
bats_require_minimum_version 1.5.0

SECRETS=(SESSION-SENTINEL VAULT-PASSWORD-SENTINEL CLIENTSECRET-SENTINEL GENERATED-PW-SENTINEL)

setup() {
  local script="${AGENT_BW:-$HOME/.local/bin/agent-bw}"
  export REAL_JQ
  REAL_JQ=$(command -v jq)
  export HOME="$BATS_TEST_TMPDIR/home"
  BIN="$HOME/.local/bin"
  export PATH="$BIN:$PATH"
  export FAKE_BW="$BATS_TEST_TMPDIR/bw"
  mkdir -p "$BIN" "$FAKE_BW" "$HOME/.config/infisical"
  cp "$script" "$BIN/agent-bw"
  cp "$BATS_TEST_DIRNAME/agent-bw/fake-bw.sh" "$BIN/bw"
  cp "$BATS_TEST_DIRNAME/agent-bw/fake-infisical.sh" "$BIN/infisical"
  printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "$FAKE_BW/jq-args"\nexec "$REAL_JQ" "$@"\n' > "$BIN/jq"
  chmod +x "$BIN/agent-bw" "$BIN/bw" "$BIN/infisical" "$BIN/jq"
  printf 'INFISICAL_DOMAIN=https://infisical.example.test\nINFISICAL_CORE_ID=core-id-fixture\n' > "$HOME/.config/infisical/core.env"
  printf 'https://vault.bitwarden.eu' > "$FAKE_BW/server"
  echo locked > "$FAKE_BW/status"
  : > "$FAKE_BW/calls"
  echo '[{"object":"organization","id":"org-agents","name":"Agents"},{"object":"organization","id":"org-other","name":"Other"}]' > "$FAKE_BW/orgs.json"
  echo '[{"object":"collection","id":"col-agents","organizationId":"org-agents","name":"Agents Vault"},{"object":"collection","id":"col-other","organizationId":"org-other","name":"Other"}]' > "$FAKE_BW/collections.json"
  jq -n '
    def item($id; $name; $user; $pw; $history; $state; $cols; $org; $totp):
      {object: "item", id: $id, organizationId: $org, collectionIds: $cols, type: 1, name: $name, notes: null,
       login: {username: $user, password: $pw, totp: $totp, uris: [{match: null, uri: "https://shop.example.test/"}]},
       passwordHistory: $history,
       fields: (if $state then [{name: "agent-state", value: $state, type: 0, linkedId: null}] else [] end)};
    [ item("item-verified"; "Example Shop"; "agent@example.test"; "CURRENT-PW-FIXTURE"; [{lastUsedDate: "x", password: "OLD-PW-FIXTURE"}]; "verified"; ["col-agents"]; "org-agents"; null),
      item("item-hand"; "Hand Made"; "hand@example.test"; "HAND-PW-FIXTURE"; null; null; ["col-agents"]; "org-agents"; "TOTP-SEED-FIXTURE"),
      item("item-rotation"; "Rotating"; "rot@example.test"; "NEW-PW-FIXTURE"; [{lastUsedDate: "x", password: "PREVIOUS-PW-FIXTURE"}, {lastUsedDate: "y", password: "OLDER-PW-FIXTURE"}]; "unverified-rotation"; ["col-agents"]; "org-agents"; null),
      item("item-new"; "Fresh Account"; "new@example.test"; "NEWACCOUNT-PW-FIXTURE"; null; "unverified-new"; ["col-agents"]; "org-agents"; null),
      item("item-both"; "Shared Twice"; "both@example.test"; "BOTH-PW-FIXTURE"; null; "verified"; ["col-agents", "col-other"]; "org-agents"; null),
      item("item-other"; "Elsewhere"; "other@example.test"; "OTHER-PW-FIXTURE"; null; "verified"; ["col-other"]; "org-other"; null) ]' > "$FAKE_BW/items.json"
}

calls() { jq -r '.args | join(" ")' "$FAKE_BW/calls"; }
item() { jq --arg i "$1" '.[] | select(.id == $i)' "$FAKE_BW/items.json"; }
# The decoded stdin of the last `bw <command> item` call.
sent() { jq -r --arg c "$1" 'select(.args[0] == $c and .args[1] == "item") | .stdin' "$FAKE_BW/calls" | tail -1 | base64 -d; }
no_secret_in() { local s; for s in "${SECRETS[@]}"; do [[ "$1" != *"$s"* ]] || { echo "found $s"; return 1; }; done; }

# --- every call ---

@test "an unknown command or a wrong number of arguments is refused, and nothing is called" {
  run agent-bw frobnicate
  [ "$status" -eq 2 ]
  run agent-bw password
  [ "$status" -eq 2 ]
  run agent-bw create only-a-name
  [ "$status" -eq 2 ]
  [ ! -s "$FAKE_BW/calls" ]
  [ ! -e "$FAKE_BW/infisical-args" ]
}

@test "it runs inside infisical run on the core vault's /tools/bitwarden of main" {
  run agent-bw list
  [ "$status" -eq 0 ]
  grep -qx -- '--projectId' "$FAKE_BW/infisical-args"
  grep -qx -- 'core-id-fixture' "$FAKE_BW/infisical-args"
  grep -qx -- '/tools/bitwarden' "$FAKE_BW/infisical-args"
  grep -qx -- 'main' "$FAKE_BW/infisical-args"
}

@test "every bw call uses the one fixed data directory, created with mode 0700" {
  run agent-bw list
  [ "$status" -eq 0 ]
  [ "$(jq -r .dir "$FAKE_BW/calls" | sort -u)" = "$HOME/.local/state/agent-bw" ]
  [ "$(stat -f %Lp "$HOME/.local/state/agent-bw")" = 700 ]
}

@test "a call ends with lock and never logs out" {
  run agent-bw list
  [ "$status" -eq 0 ]
  [ "$(calls | tail -1)" = lock ]
  ! calls | grep -q '^logout'
}

@test "logged in and locked: no login, only unlock" {
  run agent-bw list
  [ "$status" -eq 0 ]
  ! calls | grep -q '^login'
  calls | grep -qx 'unlock --passwordenv BW_PASSWORD --raw'
}

@test "logged out: it logs in with the API key, after setting the EU server when another is set" {
  echo unauthenticated > "$FAKE_BW/status"
  printf 'https://bitwarden.com' > "$FAKE_BW/server"
  run agent-bw list
  [ "$status" -eq 0 ]
  [ "$(calls | grep -E '^(config server https://vault.bitwarden.eu|login --apikey)$')" = "config server https://vault.bitwarden.eu
login --apikey" ]
}

@test "the server already set: it is not set again" {
  run agent-bw list
  [ "$status" -eq 0 ]
  ! calls | grep -q '^config server .'
}

@test "a failing unlock exits non-zero and prints nothing on stdout" {
  FAKE_BW_FAIL=unlock run --separate-stderr agent-bw password item-verified
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "a failing sync fails the call: nothing is read after it but the lock" {
  FAKE_BW_FAIL=sync run --separate-stderr agent-bw password item-verified
  [ "$status" -ne 0 ]
  [ -z "$output" ]
  [ "$(calls | sed -n '/^sync$/,$p')" = "sync
lock" ]
}

@test "sync runs before every get, create and edit" {
  run agent-bw create "Example Club" https://club.example.test/ agent@example.test
  [ "$status" -eq 0 ]
  run agent-bw rotate item-verified
  [ "$status" -eq 0 ]
  jq -s -e '[.[].args[0]] as $a | [range(0; $a | length) | select($a[.] == "get" or $a[.] == "create" or $a[.] == "edit")] as $writes
    | [range(0; $a | length) | select($a[.] == "unlock")] as $unlocks
    | ($writes | length) > 0 and all($writes[]; . as $w | [$unlocks[] | select(. < $w)] | max as $u | $u != null and ($a[$u:$w] | index("sync")) != null)' "$FAKE_BW/calls"
}

@test "no bw argument and no process argument holds the session, a credential or the new password" {
  sh -c 'sleep 30; :' control CONTROL-ARGV-MARKER &   # '; :' keeps sh from exec'ing sleep, which would drop the marker
  control=$!
  run agent-bw create "Example Club" https://club.example.test/ agent@example.test
  [ "$status" -eq 0 ]
  run agent-bw rotate item-verified
  kill "$control"
  [ "$status" -eq 0 ]
  no_secret_in "$(jq -r '.args | join(" ")' "$FAKE_BW/calls")"
  grep -q -- '--rawfile pw' "$FAKE_BW/jq-args"   # the recorder does see agent-bw's jq calls
  no_secret_in "$(cat "$FAKE_BW/jq-args")"
  for snapshot in "$FAKE_BW"/ps.*; do
    grep -q CONTROL-ARGV-MARKER "$snapshot"   # the snapshot does show other processes' arguments
    grep -q -E 'bw (create|edit) item' "$snapshot"
    no_secret_in "$(cat "$snapshot")"
  done
  [ "$(ls "$FAKE_BW" | grep -c '^ps\.')" -eq 2 ]
}

# --- collection ---

@test "the collection missing from the list is exit 1, naming it" {
  echo '[]' > "$FAKE_BW/collections.json"
  run --separate-stderr agent-bw list
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"Agents Vault"* ]] || false
}

@test "a collection of that name in another organization does not count" {
  echo '[{"object":"collection","id":"col-x","organizationId":"org-other","name":"Agents Vault"}]' > "$FAKE_BW/collections.json"
  run agent-bw list
  [ "$status" -eq 1 ]
}

# --- reads ---

@test "password, previous-password and totp print the item's values" {
  run --separate-stderr agent-bw password item-verified
  [ "$status" -eq 0 ]
  [ "$output" = CURRENT-PW-FIXTURE ]
  run --separate-stderr agent-bw previous-password item-rotation
  [ "$status" -eq 0 ]
  [ "$output" = PREVIOUS-PW-FIXTURE ]
  run --separate-stderr agent-bw totp item-hand
  [ "$status" -eq 0 ]
  [ "$output" = 123456 ]
}

@test "previous-password with an empty history fails" {
  run --separate-stderr agent-bw previous-password item-new
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "an item outside the collection is never read" {
  run --separate-stderr agent-bw password item-other
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "list gives one line per item of the collection, an item without agent-state is verified, and no password" {
  run --separate-stderr agent-bw list
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf '%s\t%s\t%s\t%s\t%s\n' \
    item-verified "Example Shop" verified agent@example.test no-totp \
    item-hand "Hand Made" verified hand@example.test totp \
    item-rotation Rotating unverified-rotation rot@example.test no-totp \
    item-new "Fresh Account" unverified-new new@example.test no-totp \
    item-both "Shared Twice" verified both@example.test no-totp)" ]
  [[ "$output" != *PW-FIXTURE* ]] || false
}

@test "sync writes the login index, mode 0600, with no password" {
  run --separate-stderr agent-bw sync
  [ "$status" -eq 0 ]
  index="$HOME/.local/state/e2e/logins.json"
  [ "$(stat -f %Lp "$index")" = 600 ]
  [ "$(jq -c '.logins[0]' "$index")" = '{"name":"example-shop","item":"item-verified","username":"agent@example.test","totp":false}' ]
  [ "$(jq -c '[.logins[] | select(.totp) | .name]' "$index")" = '["hand-made"]' ]
  [ "$(jq '.logins | length' "$index")" -eq 5 ]
  ! grep -q PW-FIXTURE "$index"
  [[ "$output" != *PW-FIXTURE* ]] || false
}

@test "two items giving one index name make sync fail, naming both, and leave the index as it was" {
  mkdir -p "$HOME/.local/state/e2e"
  echo '{"logins":[]}' > "$HOME/.local/state/e2e/logins.json"
  jq '.[1].name = "Example-Shop"' "$FAKE_BW/items.json" > "$FAKE_BW/i" && mv "$FAKE_BW/i" "$FAKE_BW/items.json"
  run --separate-stderr agent-bw sync
  [ "$status" -eq 1 ]
  [[ "$stderr" == *item-verified* && "$stderr" == *item-hand* ]] || false
  [ "$(cat "$HOME/.local/state/e2e/logins.json")" = '{"logins":[]}' ]
}

# --- writes ---

@test "create sends a login in the collection alone, with the generated password and unverified-new, and prints only its id" {
  run --separate-stderr agent-bw create "Example Club" https://club.example.test/ agent@example.test
  [ "$status" -eq 0 ]
  [ "$(sent create | jq -c '{organizationId, collectionIds, type, name, username: .login.username, password: .login.password, uris: [.login.uris[].uri], state: [.fields[] | select(.name == "agent-state") | .value]}')" = \
    '{"organizationId":"org-agents","collectionIds":["col-agents"],"type":1,"name":"Example Club","username":"agent@example.test","password":"GENERATED-PW-SENTINEL","uris":["https://club.example.test/"],"state":["unverified-new"]}' ]
  [ "$(echo "$output" | head -1)" = new-item-id ]
  no_secret_in "$output"
  jq -e '.logins | any(.item == "new-item-id" and .name == "example-club")' "$HOME/.local/state/e2e/logins.json"
}

@test "rotate on a verified item sends the generated password and unverified-rotation" {
  run --separate-stderr agent-bw rotate item-verified
  [ "$status" -eq 0 ]
  [ "$(sent edit | jq -c '{password: .login.password, state: [.fields[] | select(.name == "agent-state") | .value]}')" = '{"password":"GENERATED-PW-SENTINEL","state":["unverified-rotation"]}' ]
  no_secret_in "$output"
}

@test "rotate on a hand-made item (no agent-state) treats it as verified" {
  run agent-bw rotate item-hand
  [ "$status" -eq 0 ]
  [ "$(item item-hand | jq -r '.fields[] | select(.name == "agent-state") | .value')" = unverified-rotation ]
}

@test "a write refuses an item in another collection too, an item outside the collection, and a state that does not allow it, naming what is allowed" {
  for id in item-both item-other; do
    run agent-bw rotate "$id"
    [ "$status" -eq 1 ]
  done
  run --separate-stderr agent-bw rotate item-rotation
  [ "$status" -eq 1 ]
  [[ "$stderr" == *unverified-rotation* && "$stderr" == *"confirm, revert"* ]] || false
  run agent-bw discard item-verified
  [ "$status" -eq 1 ]
  ! calls | grep -q -E '^(edit|delete) '
}

@test "an unknown agent-state is refused" {
  jq '(.[] | select(.id == "item-verified") | .fields[0].value) = "weird"' "$FAKE_BW/items.json" > "$FAKE_BW/i" && mv "$FAKE_BW/i" "$FAKE_BW/items.json"
  run --separate-stderr agent-bw confirm item-verified
  [ "$status" -eq 1 ]
  [[ "$stderr" == *weird* ]] || false
  ! calls | grep -q '^edit '
}

@test "confirm changes only the state" {
  before=$(item item-rotation)
  run agent-bw confirm item-rotation
  [ "$status" -eq 0 ]
  [ "$(sent edit | jq -c 'del(.fields)')" = "$(jq -c 'del(.fields)' <<<"$before")" ]
  [ "$(sent edit | jq -c '[.fields[] | select(.name == "agent-state") | .value]')" = '["verified"]' ]
}

@test "revert puts back the newest password of the history and verified" {
  run agent-bw revert item-rotation
  [ "$status" -eq 0 ]
  [ "$(sent edit | jq -c '{password: .login.password, state: [.fields[] | select(.name == "agent-state") | .value]}')" = '{"password":"PREVIOUS-PW-FIXTURE","state":["verified"]}' ]
}

@test "discard deletes an unverified-new item and rewrites the index" {
  run agent-bw discard item-new
  [ "$status" -eq 0 ]
  calls | grep -qx 'delete item item-new'
  ! jq -e '.logins | any(.item == "item-new")' "$HOME/.local/state/e2e/logins.json"
}
