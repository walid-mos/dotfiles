#!/bin/zsh
# pi installs its user-scoped npm packages on its first run, and the layout it
# leaves depends on the managed ~/.pi/agent/npm/pnpm-workspace.yaml - so the
# setup installs them itself and refuses to end on a tree pi cannot load.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

home_dir="$fixture_dir/home"
agent_dir="$home_dir/.pi/agent"
node_modules="$agent_dir/npm/node_modules"
pi_calls="$fixture_dir/pi-calls"
mkdir -p "$node_modules" "$fixture_dir/bin"

cat > "$fixture_dir/bin/pi" <<EOF
#!/bin/zsh
set -eu
print -r -- "\$*" >> "$pi_calls"
if [[ "\${PI_STATE}" == broken ]]; then
    mkdir -p "$node_modules/pi-web-access"
    print -r -- '{"dependencies":{"p-limit":"^6.0.0"}}' > "$node_modules/pi-web-access/package.json"
else
    rm -rf "$node_modules/pi-web-access" "$node_modules/p-limit"
    mkdir -p "$node_modules/pi-web-access" "$node_modules/p-limit"
    print -r -- '{"dependencies":{"p-limit":"^6.0.0"}}' > "$node_modules/pi-web-access/package.json"
fi
exit "\${PI_EXIT:-0}"
EOF
chmod +x "$fixture_dir/bin/pi"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/packages.sh'
[[ -n "\${DRY_RUN_TEST:-}" ]] && DRY_RUN=1
install_pi_extensions
EOF

write_installed_tree() { # the layout pi's loader needs: real dirs, deps as siblings
    mkdir -p "$node_modules/pi-web-access" "$node_modules/p-limit"
    print -r -- '{"dependencies":{"p-limit":"^6.0.0"}}' > "$node_modules/pi-web-access/package.json"
}

run_case() { # <pre-state> <pi-state> <pi-exit> [dry-run] -> $run_status $output $calls
    local pre_state="$1" pi_state="$2" pi_exit="$3" dry_run="${4:-}"
    rm -rf "$agent_dir" "$fixture_dir/store"
    mkdir -p "$node_modules"
    print -r -- '{"packages":["npm:pi-web-access","/some/local/tool"]}' > "$agent_dir/settings.json"
    case "$pre_state" in
        installed) write_installed_tree ;;
        symlinked)
            mkdir -p "$fixture_dir/store/pi-web-access"
            print -r -- '{"dependencies":{"p-limit":"^6.0.0"}}' > "$fixture_dir/store/pi-web-access/package.json"
            ln -s "$fixture_dir/store/pi-web-access" "$node_modules/pi-web-access"
            ;;
        undeclared) print -r -- '{"packages":["/some/local/tool"]}' > "$agent_dir/settings.json" ;;
    esac
    : > "$pi_calls"
    set +e
    output=$(PATH="$fixture_dir/bin:$PATH" HOME="$home_dir" PI_CALLS="$pi_calls" \
        PI_STATE="$pi_state" PI_EXIT="$pi_exit" DRY_RUN_TEST="$dry_run" \
        zsh -f "$fixture_dir/run.zsh" 2>&1)
    run_status=$?
    set -e
    calls=$(cat "$pi_calls")
}

fail() { print -u2 "FAIL: $1"; exit 1 }
assert_status() { [[ "$run_status" == "$1" ]] || fail "$2: expected exit $1, got $run_status: $output" }
assert_contains() { [[ "$output" == *"$1"* ]] || fail "$2: output lacks '$1': $output" }
assert_calls() { [[ "$calls" == "$1" ]] || fail "$2: expected pi calls '$1', got '$calls'" }

# an already usable tree is left alone
run_case installed good 0
assert_status 0 "usable tree"
assert_calls "" "usable tree"
assert_contains "already usable" "usable tree"

# a package that is not installed yet is installed during the setup
run_case empty good 0
assert_status 0 "missing package"
assert_calls "update --extensions" "missing package"
assert_contains "pi extensions installed" "missing package"

# the pnpm store layout (a symlink instead of a real directory) is repaired
run_case symlinked good 0
assert_status 0 "store symlink"
assert_contains "pnpm store symlink" "store symlink"
assert_contains "pi extensions installed" "store symlink"

# a tree that stays unusable after the install fails the setup
run_case empty broken 0
assert_status 1 "unresolvable dependency"
assert_contains "unresolvable dependencies" "unresolvable dependency"

# pi failing on the local-path packages must not abort the setup when the
# npm-scoped packages are fine
run_case empty good 1
assert_status 0 "pi update failure"
assert_contains "pi update --extensions failed" "pi update failure"
assert_contains "pi extensions installed" "pi update failure"

# nothing declared, nothing to do
run_case undeclared good 0
assert_status 0 "no npm package"
assert_calls "" "no npm package"
assert_contains "already usable" "no npm package"

# dry-run plans the install without running pi
run_case empty good 0 dry
assert_status 0 "dry run"
assert_calls "" "dry run"
assert_contains "would: install pi extensions" "dry run"

print 'PASS: pi extensions are installed and validated during setup'
