#!/bin/zsh
# ensure_remote_login must read systemsetup's answer and only touch the setting
# when sshd is actually off - a wrong parse would disable or re-enable it on
# every run.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

systemsetup_calls="$fixture_dir/systemsetup-calls"
mkdir -p "$fixture_dir/bin"

cat > "$fixture_dir/bin/sudo" <<'EOF'
#!/bin/zsh
set -eu
# argv[0] is this script, so $@ already holds the wrapped command.
exec "$@"
EOF

cat > "$fixture_dir/bin/systemsetup" <<'EOF'
#!/bin/zsh
set -eu
print -r -- "$*" >> "$SYSTEMSETUP_CALLS"
if [[ "$1" == -getremotelogin ]]; then
    print -r -- "Remote Login: $REMOTE_LOGIN_STATE"
fi
EOF
chmod +x "$fixture_dir/bin/sudo" "$fixture_dir/bin/systemsetup"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/configure.sh'
ensure_remote_login
EOF

run_case() {  # <On|Off> - prints the systemsetup set-calls that were made
    : > "$systemsetup_calls"
    PATH="$fixture_dir/bin:/bin:/usr/bin" SYSTEMSETUP_CALLS="$systemsetup_calls" \
        REMOTE_LOGIN_STATE="$1" zsh -f "$fixture_dir/run.zsh" > /dev/null
    grep -- '-setremotelogin' "$systemsetup_calls" || true
}

enabled_calls=$(run_case On)
if [[ -n "$enabled_calls" ]]; then
    print -u2 "FAIL: sshd already on, but the setting was touched: '$enabled_calls'"
    exit 1
fi

disabled_calls=$(run_case Off)
if [[ "$disabled_calls" != "-setremotelogin on" ]]; then
    print -u2 "FAIL: expected sshd to be turned on, got: '$disabled_calls'"
    exit 1
fi

print 'PASS: Remote Login is enabled only when it is off'
