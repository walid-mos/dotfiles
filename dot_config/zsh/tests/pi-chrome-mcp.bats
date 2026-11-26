#!/usr/bin/env bats
# Tests of `pi-chrome-mcp`, the launcher of chrome-devtools-mcp on the shared Chromium. The launcher is copied into a
# temporary bin beside a fake pi-chromium that records any call; the server is a fake chrome-devtools-mcp in a
# throwaway tooling tree that writes its arguments as JSON. Nothing starts a browser or a real server.
#
# Run: bats ~/.config/zsh/tests/pi-chrome-mcp.bats
# Needs: node.
bats_require_minimum_version 1.5.0

setup() {
  BIN="$BATS_TEST_TMPDIR/bin"
  export PI_WEB_TOOLS_DIR="$BATS_TEST_TMPDIR/tools"
  export SERVER_ARGS="$BATS_TEST_TMPDIR/server-args.json"
  export OWNER_CALLS="$BATS_TEST_TMPDIR/owner-calls"
  mkdir -p "$BIN" "$PI_WEB_TOOLS_DIR/node_modules/.bin"
  cp "${PI_CHROME_MCP:-$HOME/.local/bin/pi-chrome-mcp}" "$BIN/pi-chrome-mcp"
  printf '#!/bin/sh\necho "$*" >> "$OWNER_CALLS"\necho http://127.0.0.1:9322\n' > "$BIN/pi-chromium"
  printf '#!/usr/bin/env node\nrequire("fs").writeFileSync(process.env.SERVER_ARGS, JSON.stringify(process.argv.slice(2)));\n' \
    > "$PI_WEB_TOOLS_DIR/node_modules/.bin/chrome-devtools-mcp"
  chmod +x "$BIN/pi-chrome-mcp" "$BIN/pi-chromium" "$PI_WEB_TOOLS_DIR/node_modules/.bin/chrome-devtools-mcp"
}

@test "with no browser running, it starts the server on the shared Chromium's endpoint, then the extra arguments in order" {
  run --separate-stderr "$BIN/pi-chrome-mcp" --no-usage-statistics --memoryDebugging
  [ "$status" -eq 0 ]
  [ "$(cat "$SERVER_ARGS")" = '["--browserUrl","http://127.0.0.1:9322","--no-usage-statistics","--memoryDebugging"]' ]
}

@test "the port follows PI_CHROMIUM_PORT, as pi-chromium's does" {
  PI_CHROMIUM_PORT=9555 run "$BIN/pi-chrome-mcp"
  [ "$status" -eq 0 ]
  [ "$(cat "$SERVER_ARGS")" = '["--browserUrl","http://127.0.0.1:9555"]' ]
}

@test "it never calls pi-chromium, so it can never start a browser" {
  run "$BIN/pi-chrome-mcp" --no-usage-statistics
  [ "$status" -eq 0 ]
  [ ! -e "$OWNER_CALLS" ]
}

@test "the server is given no browser of its own: no executablePath, isolated or headless" {
  run "$BIN/pi-chrome-mcp"
  [[ "$(cat "$SERVER_ARGS")" != *executablePath* ]] || false
  [[ "$(cat "$SERVER_ARGS")" != *isolated* ]] || false
  [[ "$(cat "$SERVER_ARGS")" != *headless* ]] || false
}

@test "without chrome-devtools-mcp in the tooling tree, it fails naming chezmoi apply and starts nothing" {
  rm "$PI_WEB_TOOLS_DIR/node_modules/.bin/chrome-devtools-mcp"
  run --separate-stderr "$BIN/pi-chrome-mcp"
  [ "$status" -ne 0 ]
  [[ "$stderr" == *"chezmoi apply"* ]] || false
  [ ! -e "$SERVER_ARGS" ]
}
