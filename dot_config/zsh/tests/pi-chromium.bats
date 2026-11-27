#!/usr/bin/env bats
# Tests of `pi-chromium`, the owner of the shared Chromium: its states, its transitions and its idle stop.
# The browser is tests/pi-chromium/fake-browser.py, reached through a fake tooling tree whose fake playwright-core
# names it; each test has its own state directory and a free port. Nothing starts a real Chromium.
#
# Run: bats ~/.config/zsh/tests/pi-chromium.bats
# Needs: python3, node, jq, curl, lsof.
bats_require_minimum_version 1.5.0

PI_CHROMIUM="${PI_CHROMIUM:-$HOME/.local/bin/pi-chromium}"

setup() {
  export PI_CHROMIUM_STATE="$BATS_TEST_TMPDIR/state"
  export PI_CHROMIUM_PORT; PI_CHROMIUM_PORT=$(free_port)
  export PI_WEB_TOOLS_DIR="$BATS_TEST_TMPDIR/tools"
  export FAKE_BROWSER_ARGS="$BATS_TEST_TMPDIR/browser-args"
  export FAKE_BROWSER_LIST="$BATS_TEST_TMPDIR/list.json"
  # A short poll in every test: the `sleep` of a watcher outlives the watcher that teardown kills and holds the output
  # bats waits on, so with the script's own poll a run would end up to one full poll after its last test.
  export PI_CHROMIUM_IDLE_POLL_S=0.2
  ENDPOINT="http://127.0.0.1:$PI_CHROMIUM_PORT"
  PROFILE="$PI_CHROMIUM_STATE/profile"
  LOG="$PI_CHROMIUM_STATE/chromium.log"
  : > "$FAKE_BROWSER_ARGS"
  make_tools
}

teardown() {
  for f in "$PI_CHROMIUM_STATE/pid" "$PI_CHROMIUM_STATE/watcher.pid" "$BATS_TEST_TMPDIR"/extra-*.pid; do
    [ -f "$f" ] && kill_if_alive "$(cat "$f")"
  done
  local pid
  for pid in $(pgrep -f -- "--user-data-dir=$PROFILE" || true); do kill_if_alive "$pid"; done
}

kill_if_alive() { if kill -0 "$1" 2>/dev/null; then kill -9 "$1"; fi; }

free_port() { python3 -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }

# A tooling tree as the dotfiles install it, whose playwright-core names the fake browser.
make_tools() {
  local nm="$PI_WEB_TOOLS_DIR/node_modules" bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$nm/@e2e-dev/web" "$nm/playwright-core" "$bin"
  printf 'e2e start page\n' > "$PI_WEB_TOOLS_DIR/start-page-title.txt"
  printf '{"name":"@e2e-dev/web","version":"0.0.0","main":"index.js"}\n' > "$nm/@e2e-dev/web/package.json"
  printf '{"name":"playwright-core","version":"0.0.0","main":"index.js"}\n' > "$nm/playwright-core/package.json"
  printf 'module.exports = { chromium: { executablePath: () => %s } };\n' "\"$bin/chromium\"" > "$nm/playwright-core/index.js"
  printf '#!/bin/bash\nexec python3 -I %q "$@"\n' "$BATS_TEST_DIRNAME/pi-chromium/fake-browser.py" > "$bin/chromium"
  chmod +x "$bin/chromium"
}

starts()     { grep -c -- "--remote-debugging-port=$PI_CHROMIUM_PORT" "$FAKE_BROWSER_ARGS" || true; }
browser_pid() { cat "$PI_CHROMIUM_STATE/pid"; }
profile_procs() { pgrep -f -- "--user-data-dir=$PROFILE" | wc -l | tr -d ' '; }
list()       { printf '%s\n' "$1" > "$FAKE_BROWSER_LIST"; }

# wait_until <seconds> <command...>: true as soon as the command succeeds, false after the delay.
wait_until() {
  local limit=$1; shift
  local end=$((SECONDS + limit))
  while [ "$SECONDS" -le "$end" ]; do "$@" && return 0; sleep 0.2; done
  return 1
}

stopped_now() { [ "$(profile_procs)" = 0 ] && [ ! -f "$PI_CHROMIUM_STATE/pid" ]; }

# A process of the test that holds the port, as another program would.
hold_port() {
  python3 -I -c 'import http.server, sys; http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), http.server.BaseHTTPRequestHandler).serve_forever()' "$PI_CHROMIUM_PORT" &
  echo $! > "$BATS_TEST_TMPDIR/extra-port.pid"
  wait_until 5 lsof -nP -iTCP:"$PI_CHROMIUM_PORT" -sTCP:LISTEN -t
}

# A mute fake started by the test with pi-chromium's arguments, and its pid file.
start_mute_browser() {
  mkdir -p "$PI_CHROMIUM_STATE"
  FAKE_BROWSER_MUTE=1 "$BATS_TEST_TMPDIR/bin/chromium" --remote-debugging-port="$PI_CHROMIUM_PORT" --user-data-dir="$PROFILE" &
  echo $! > "$PI_CHROMIUM_STATE/pid"
  wait_until 5 grep -q -- "--user-data-dir=$PROFILE" "$FAKE_BROWSER_ARGS"
}

# --- start and stop

@test "from stopped, ensure starts the browser headless on 127.0.0.1 with its own profile and prints the endpoint" {
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -eq 0 ]
  [ "$output" = "$ENDPOINT" ]
  grep -q -- "--remote-debugging-port=$PI_CHROMIUM_PORT" "$FAKE_BROWSER_ARGS"
  grep -q -- "--user-data-dir=$PROFILE" "$FAKE_BROWSER_ARGS"
  grep -q -- "--headless=new" "$FAKE_BROWSER_ARGS"
  grep -q -- " about:blank" "$FAKE_BROWSER_ARGS"
  [ "$(stat -f %Lp "$PROFILE")" = 700 ]
  run lsof -nP -iTCP:"$PI_CHROMIUM_PORT" -sTCP:LISTEN
  [[ "$output" == *"127.0.0.1:$PI_CHROMIUM_PORT"* ]] || false
  [[ "$output" != *"*:$PI_CHROMIUM_PORT"* ]] || false
}

@test "a second ensure reuses the browser: same endpoint, same pid, one start" {
  "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -eq 0 ]
  [ "$output" = "$ENDPOINT" ]
  [ "$(browser_pid)" = "$pid" ]
  [ "$(starts)" = 1 ]
}

@test "two ensure started together: one start, both print the endpoint and succeed" {
  "$PI_CHROMIUM" ensure > "$BATS_TEST_TMPDIR/a.out" & local a=$!
  "$PI_CHROMIUM" ensure > "$BATS_TEST_TMPDIR/b.out" & local b=$!
  wait "$a"; wait "$b"
  [ "$(cat "$BATS_TEST_TMPDIR/a.out")" = "$ENDPOINT" ]
  [ "$(cat "$BATS_TEST_TMPDIR/b.out")" = "$ENDPOINT" ]
  [ "$(starts)" = 1 ]
}

@test "stop leaves no process and no pid file; status then prints stopped, exit 3" {
  "$PI_CHROMIUM" ensure
  run "$PI_CHROMIUM" stop
  [ "$status" -eq 0 ]
  stopped_now
  run "$PI_CHROMIUM" status
  [ "$status" -eq 3 ]
  [ "$output" = stopped ]
}

@test "a pid file naming a dead pid: status prints stale (exit 4); ensure names the pid and starts" {
  mkdir -p "$PI_CHROMIUM_STATE"
  sleep 0 & local dead=$!; wait "$dead"
  echo "$dead" > "$PI_CHROMIUM_STATE/pid"
  run "$PI_CHROMIUM" status
  [ "$status" -eq 4 ]
  [[ "$output" == stale* ]] || false
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"$dead"* ]] || false
  [ "$(starts)" = 1 ]
}

@test "a pid file naming another live program: stale; stop removes the pid file and leaves the program alive" {
  mkdir -p "$PI_CHROMIUM_STATE"
  sleep 300 & local other=$!
  echo "$other" > "$BATS_TEST_TMPDIR/extra-sleep.pid"
  echo "$other" > "$PI_CHROMIUM_STATE/pid"
  run "$PI_CHROMIUM" status
  [[ "$output" == stale* ]] || false
  run "$PI_CHROMIUM" stop
  [ "$status" -eq 0 ]
  [ ! -f "$PI_CHROMIUM_STATE/pid" ]
  kill -0 "$other"
}

@test "another program on the port: status prints foreign (exit 6); ensure fails naming the port and starts nothing" {
  hold_port
  run "$PI_CHROMIUM" status
  [ "$status" -eq 6 ]
  [[ "$output" == foreign* ]] || false
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"port $PI_CHROMIUM_PORT"* ]] || false
  [ "$(starts)" = 0 ]
}

@test "a browser that never answers within the start timeout: ensure fails and leaves no process and no pid file" {
  # 3 s, not 1: the fake browser is a Python script, which can take over a second to start and record its arguments.
  FAKE_BROWSER_MUTE=1 PI_CHROMIUM_START_TIMEOUT_S=3 run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [ "$(starts)" = 1 ]
  wait_until 5 stopped_now
}

@test "a browser that exits before it answers: ensure fails saying so, and leaves no pid file" {
  printf '#!/bin/bash\necho "$*" >> "$FAKE_BROWSER_ARGS"\nexit 3\n' > "$BATS_TEST_TMPDIR/bin/chromium"
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [ "$(starts)" = 1 ]
  [[ "$stderr" == *"exited"* ]] || false
  stopped_now
}

@test "a browser of ours that does not answer: unresponsive (exit 5); ensure fails naming stop and kills nothing; stop ends it" {
  start_mute_browser
  local pid; pid=$(browser_pid)
  run "$PI_CHROMIUM" status
  [ "$status" -eq 5 ]
  [[ "$output" == unresponsive* ]] || false
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"pi-chromium stop"* ]] || false
  kill -0 "$pid"
  run "$PI_CHROMIUM" stop
  [ "$status" -eq 0 ]
  wait_until 12 stopped_now
}

@test "running headless, ensure --headed fails naming stop and restarts nothing; from stopped, --headed is not headless" {
  "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  run --separate-stderr "$PI_CHROMIUM" ensure --headed
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"pi-chromium stop"* ]] || false
  [ "$(browser_pid)" = "$pid" ]
  "$PI_CHROMIUM" stop
  : > "$FAKE_BROWSER_ARGS"
  "$PI_CHROMIUM" ensure --headed
  ! grep -q -- "--headless" "$FAKE_BROWSER_ARGS"
  run "$PI_CHROMIUM" status
  [[ "$output" == *"mode=headed"* ]] || false
}

@test "a lock left by a dead process is removed with a line naming it, and ensure succeeds" {
  mkdir -p "$PI_CHROMIUM_STATE/lock"
  sleep 0 & local dead=$!; wait "$dead"
  echo "$dead" > "$PI_CHROMIUM_STATE/lock/pid"
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"$dead"* ]] || false
}

@test "a lock whose holder's pid now belongs to another program is removed, and ensure succeeds" {
  mkdir -p "$PI_CHROMIUM_STATE/lock"
  sleep 300 & local other=$!
  echo "$other" > "$BATS_TEST_TMPDIR/extra-sleep.pid"
  echo "$other" > "$PI_CHROMIUM_STATE/lock/pid"
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"$other"* ]] || false
  kill -0 "$other"
}

@test "an ensure interrupted while the browser starts leaves no browser, no pid file and no lock" {
  FAKE_BROWSER_MUTE=1 "$PI_CHROMIUM" ensure & local ensure=$!
  wait_until 5 test -f "$PI_CHROMIUM_STATE/pid"
  kill -TERM "$ensure"
  wait "$ensure" || true
  wait_until 5 stopped_now
  [ ! -e "$PI_CHROMIUM_STATE/lock" ]
}

@test "without @e2e-dev/web in the tooling tree, ensure fails naming chezmoi apply" {
  rm -r "$PI_WEB_TOOLS_DIR/node_modules/@e2e-dev"
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"chezmoi apply"* ]] || false
  [ "$(starts)" = 0 ]
}

@test "a missing browser file names e2e-web install chromium" {
  rm "$BATS_TEST_TMPDIR/bin/chromium"
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"e2e-web install chromium"* ]] || false
}

@test "a tooling directory that does not exist: ensure fails naming it" {
  export PI_WEB_TOOLS_DIR="$BATS_TEST_TMPDIR/nowhere"
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"$BATS_TEST_TMPDIR/nowhere"* ]] || false
}

@test "without the start page's title file, ensure fails naming it and starts nothing" {
  rm "$PI_WEB_TOOLS_DIR/start-page-title.txt"
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"start-page-title.txt"* ]] || false
  [ "$(starts)" = 0 ]
}

# --- endpoint

@test "endpoint from stopped: exit 1, nothing on stdout, the message on stderr, nothing started" {
  run --separate-stderr "$PI_CHROMIUM" endpoint
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$stderr" == *"no shared browser: open a page with e2e first"* ]] || false
  [ "$(starts)" = 0 ]
}

@test "endpoint when running prints exactly the endpoint and changes nothing" {
  "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  run --separate-stderr "$PI_CHROMIUM" endpoint
  [ "$status" -eq 0 ]
  [ "$output" = "$ENDPOINT" ]
  [ "$(browser_pid)" = "$pid" ]
}

@test "endpoint when unresponsive: exit 1, naming the state" {
  start_mute_browser
  run --separate-stderr "$PI_CHROMIUM" endpoint
  [ "$status" -eq 1 ]
  [[ "$stderr" == *unresponsive* ]] || false
}

# --- the idle stop

idle_fast() { export PI_CHROMIUM_IDLE_STOP_S=2; }

@test "with only about:blank open, the browser stops by itself and says why" {
  idle_fast
  list '[{"type":"page","url":"about:blank","title":""}]'
  "$PI_CHROMIUM" ensure
  wait_until 10 stopped_now
  run "$PI_CHROMIUM" status
  [ "$output" = stopped ]
  grep -q "stopped: idle" "$LOG"
}

@test "an open page keeps the browser; once it is closed, the browser stops" {
  idle_fast
  list '[{"type":"page","url":"https://example.com/","title":"Example"}]'
  "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  sleep 5
  [ "$(browser_pid)" = "$pid" ]
  kill -0 "$pid"
  list '[{"type":"page","url":"about:blank","title":""}]'
  wait_until 10 stopped_now
}

@test "the start page is no page; its title on another site is one" {
  idle_fast
  list '[{"type":"page","url":"http://127.0.0.1:41234/","title":"e2e start page"}]'
  "$PI_CHROMIUM" ensure
  wait_until 10 stopped_now
  list '[{"type":"page","url":"https://example.com/","title":"e2e start page"}]'
  "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  sleep 5
  kill -0 "$pid"
}

@test "a service worker is no page" {
  idle_fast
  list '[{"type":"service_worker","url":"https://example.com/sw.js","title":""}]'
  "$PI_CHROMIUM" ensure
  wait_until 10 stopped_now
}

@test "an ensure every second restarts the idle clock" {
  # The idle clock counts whole seconds, so it can read one second more than the time really spent: a delay of 2 s
  # could be reached between two ensure one second apart.
  export PI_CHROMIUM_IDLE_STOP_S=3
  list '[]'
  "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  for _ in 1 2 3 4 5 6; do "$PI_CHROMIUM" ensure > /dev/null; sleep 1; done
  [ "$(browser_pid)" = "$pid" ]
  kill -0 "$pid"
}

@test "a /json/list that is not JSON stops nothing, and the log names the failure" {
  idle_fast
  FAKE_BROWSER_BAD_LIST=1 "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  sleep 5
  kill -0 "$pid"
  grep -q "/json/list" "$LOG"
}

@test "a start page title file that cannot be read stops nothing, and the log names it" {
  idle_fast
  list '[{"type":"page","url":"about:blank","title":""}]'
  "$PI_CHROMIUM" ensure
  local pid; pid=$(browser_pid)
  rm "$PI_WEB_TOOLS_DIR/start-page-title.txt"
  sleep 5
  kill -0 "$pid"
  grep -q "start-page-title.txt" "$LOG"
}

@test "after stop, the watcher ends within two polls" {
  idle_fast
  list '[{"type":"page","url":"https://example.com/","title":"Example"}]'
  "$PI_CHROMIUM" ensure
  local watcher; watcher=$(cat "$PI_CHROMIUM_STATE/watcher.pid")
  "$PI_CHROMIUM" stop
  wait_until 3 bash -c "! kill -0 $watcher 2>/dev/null"
}

@test "a killed watcher shows as missing; the next ensure restarts it, and the idle stop happens" {
  idle_fast
  list '[{"type":"page","url":"https://example.com/","title":"Example"}]'
  "$PI_CHROMIUM" ensure
  kill -9 "$(cat "$PI_CHROMIUM_STATE/watcher.pid")"
  run "$PI_CHROMIUM" status
  [[ "$output" == *"watcher=missing"* ]] || false
  run --separate-stderr "$PI_CHROMIUM" ensure
  [ "$status" -eq 0 ]
  [[ "$stderr" == *watcher* ]] || false
  list '[]'
  wait_until 10 stopped_now
}

@test "the browser and its watcher outlive the process group that asked for them, which Pi kills when it exits" {
  # Pi runs each MCP server in a process group of its own and kills those groups when it exits; ensure runs inside
  # the e2e server's group. Here ensure runs in a group of its own, then that whole group is killed.
  perl -MPOSIX -e 'defined setpgid(0, 0) or die "setpgid: $!"; exec @ARGV or die "exec: $!"' "$PI_CHROMIUM" ensure > "$BATS_TEST_TMPDIR/out" 2>&1 &
  local caller=$!
  wait "$caller"
  [ "$(cat "$BATS_TEST_TMPDIR/out")" = "$ENDPOINT" ]
  kill -KILL -- "-$caller" || echo "the caller's group is already empty"
  sleep 0.5
  run "$PI_CHROMIUM" status
  [ "$status" -eq 0 ]
  [[ "$output" == running* ]] || false
  kill -0 "$(cat "$PI_CHROMIUM_STATE/watcher.pid")"
}
