#!/usr/bin/env bats
# Tests of `awsc`: CLI contract, session check, the Allow click, the guard rail and the sign-in hand-off.
# `aws` is replaced by tests/awsc/bin/aws and the SSO portal by tests/awsc/fake-sso.mjs; the browser is the real
# Chromium of awsc, pointed at the fake portal through AWSC_TEST_HOST_RULES. Nothing reaches AWS.
#
# Run: bats ~/.config/zsh/tests/awsc.bats
# Needs: node, and the Chromium of awsc (installed by chezmoi apply). One test opens a Chromium window for a few seconds.
bats_require_minimum_version 1.5.0

AWSC="${BATS_TEST_DIRNAME}/../bin/awsc"

setup() {
  export AWSC_STATE_DIR="$BATS_TEST_TMPDIR/state"
  export FAKE_AWS_DIR="$BATS_TEST_TMPDIR/aws"
  export AWSC_TEST_HOST_RULES='MAP *.awsapps.com 127.0.0.1, MAP *.test 127.0.0.1'
  export PATH="$BATS_TEST_DIRNAME/awsc/bin:$PATH"
  mkdir -p "$FAKE_AWS_DIR"
  SSO_LOG="$BATS_TEST_TMPDIR/sso.log"
  : > "$SSO_LOG"
}

teardown() {
  # 143: the fake portal ended by our SIGTERM, which is the expected end.
  if [ -n "${SSO_PID-}" ]; then kill "$SSO_PID"; wait "$SSO_PID" 2>/dev/null || [ $? -eq 143 ]; fi
}

start_sso() {
  node "$BATS_TEST_DIRNAME/awsc/fake-sso.mjs" "$1" "$SSO_LOG" > "$BATS_TEST_TMPDIR/sso.port" &
  SSO_PID=$!
  for _ in $(seq 50); do [ -s "$BATS_TEST_TMPDIR/sso.port" ] && break; sleep 0.1; done
  export FAKE_SSO_URL="http://d-test.awsapps.com:$(cat "$BATS_TEST_TMPDIR/sso.port")"
}

session_alive() { touch "$FAKE_AWS_DIR/session-dev"; }
logins()        { if [ -f "$FAKE_AWS_DIR/logins" ]; then wc -l < "$FAKE_AWS_DIR/logins" | tr -d ' '; else echo 0; fi; }
login_alive()   { [ -f "$FAKE_AWS_DIR/login.pid" ] && kill -0 "$(cat "$FAKE_AWS_DIR/login.pid")" 2>/dev/null; }

# --- CLI contract

@test "no argument: usage on stderr, exit 2" {
  run --separate-stderr "$AWSC"
  [ "$status" -eq 2 ]
  [[ "$stderr" == usage:* ]] || false
  [ -z "$output" ]
}

@test "unknown option or extra argument: usage, exit 2, aws never called" {
  run --separate-stderr "$AWSC" dev --chek
  [ "$status" -eq 2 ]
  [[ "$stderr" == usage:* ]] || false
  run --separate-stderr "$AWSC" dev --check extra
  [ "$status" -eq 2 ]
  [ ! -f "$FAKE_AWS_DIR/calls" ]
}

# --- --check never logs in

@test "--check with a live session: silent, exit 0" {
  session_alive
  run --separate-stderr "$AWSC" dev --check
  [ "$status" -eq 0 ]
  [ -z "$output$stderr" ]
  [ "$(logins)" -eq 0 ]
}

@test "--check with a dead session: exit 3, says to run awsc, never logs in" {
  run --separate-stderr "$AWSC" dev --check
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"awsc dev"* ]] || false
  [ "$(logins)" -eq 0 ]
}

# --- Login

@test "live session: nothing to do, silent, no login" {
  session_alive
  run --separate-stderr "$AWSC" dev
  [ "$status" -eq 0 ]
  [ -z "$output$stderr" ]
  [ "$(logins)" -eq 0 ]
}

@test "--headless, SSO signed in: clicks Allow once, silent, the session works afterwards" {
  start_sso allow
  run --separate-stderr "$AWSC" dev --headless
  [ "$status" -eq 0 ]
  [ -z "$output$stderr" ]
  [ "$(grep -c '^allow d-test.awsapps.com$' "$SSO_LOG")" -eq 1 ]
  ! grep -q '^deny' "$SSO_LOG"
  run "$AWSC" dev --check
  [ "$status" -eq 0 ]
}

@test "the login never prints the approval URL" {
  start_sso allow
  run "$AWSC" dev --headless
  [ "$status" -eq 0 ]
  [[ "$output" != *authorize* && "$output" != *fake-state-value* ]] || false
}

@test "--headless, SSO signed out: exit 4, says to sign in, no click, no aws left running" {
  start_sso signin
  run --separate-stderr "$AWSC" dev --headless
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"sign in"* && "$stderr" == *"awsc dev"* ]] || false
  ! grep -q '^allow' "$SSO_LOG"
  ! login_alive
}

@test "guard rail: an Allow button outside AWS is never clicked" {
  start_sso foreign
  run --separate-stderr "$AWSC" dev --headless
  [ "$status" -eq 4 ]
  [[ "$stderr" == *portal.evil.test* ]] || false
  ! grep -q '^allow' "$SSO_LOG"
  ! login_alive
}

@test "an AWS page without an Allow button: exit 1 after AWSC_TIMEOUT, names the page, no aws left running" {
  start_sso nobutton
  SECONDS=0
  AWSC_TIMEOUT=3 run --separate-stderr "$AWSC" dev --headless
  [ "$status" -eq 1 ]
  [ "$SECONDS" -lt 20 ]
  [[ "$stderr" == *d-test.awsapps.com* && "$stderr" == *"Authorization requested"* ]] || false
  ! login_alive
}

@test "aws sso login fails: exit 1 with the CLI's message" {
  FAKE_AWS_LOGIN=fail run --separate-stderr "$AWSC" dev --headless
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"not configured"* ]] || false
}

@test "SSO signed out, window allowed: the user signs in, then Allow is clicked" {
  start_sso signin-auto
  run --separate-stderr "$AWSC" dev
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"sign in"* ]] || false
  grep -q '^login$' "$SSO_LOG"
  [ "$(grep -c '^allow d-test.awsapps.com$' "$SSO_LOG")" -eq 1 ]
}

@test "window allowed, the user never signs in: exit 1 after AWSC_SIGNIN_TIMEOUT, says the sign-in did not happen" {
  start_sso signin
  AWSC_SIGNIN_TIMEOUT=3 run --separate-stderr "$AWSC" dev
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"no sign-in within 3 s"* ]] || false
  [[ "$stderr" != *"no Allow button"* ]] || false
  ! login_alive
}

@test "two runs at once: one login, both succeed" {
  start_sso allow
  "$AWSC" dev --headless & first=$!
  "$AWSC" dev --headless & second=$!
  wait "$first"
  wait "$second"
  [ "$(logins)" -eq 1 ]
}

@test "the browser profile directory is private (0700)" {
  start_sso allow
  run "$AWSC" dev --headless
  [ "$status" -eq 0 ]
  [ "$(stat -f %Lp "$AWSC_STATE_DIR" 2>/dev/null || stat -c %a "$AWSC_STATE_DIR")" = 700 ]
}
