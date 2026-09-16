#!/bin/zsh
# pnpm >= 11 installs a Node runtime without npm, so a fresh Mac needs npm
# added separately - and only when it is actually missing.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

pnpm_calls="$fixture_dir/pnpm-calls"
mkdir -p "$fixture_dir/bin"
cat > "$fixture_dir/bin/pnpm" <<'EOF'
#!/bin/zsh
set -eu
print -r -- "$*" >> "$CALLS"
EOF
chmod +x "$fixture_dir/bin/pnpm"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/packages.sh'
install_npm
EOF

run_case() {  # <npm-present: yes|no> - prints the pnpm calls install_npm made
    if [[ "$1" == yes ]]; then
        printf '#!/bin/zsh\nexit 0\n' > "$fixture_dir/bin/npm"
        chmod +x "$fixture_dir/bin/npm"
    else
        rm -f "$fixture_dir/bin/npm"
    fi
    : > "$pnpm_calls"
    PATH="$fixture_dir/bin:/bin:/usr/bin" CALLS="$pnpm_calls" \
        zsh -f "$fixture_dir/run.zsh" > /dev/null
    cat "$pnpm_calls"
}

missing_calls=$(run_case no)
if [[ "$missing_calls" != "add -g npm" ]]; then
    print -u2 "FAIL: expected npm to be installed, got: '$missing_calls'"
    exit 1
fi

present_calls=$(run_case yes)
if [[ -n "$present_calls" ]]; then
    print -u2 "FAIL: npm was reinstalled although present: '$present_calls'"
    exit 1
fi

print 'PASS: npm is installed only when missing'
