#!/bin/zsh
# A fresh Mac has no pnpm at all, and the installer writes its binary under
# $PNPM_HOME/bin. If install_pnpm leaves $PNPM_HOME itself on PATH, the very
# next step (install_node) dies with "command not found: pnpm".
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin"

# Replace only the transport: emit the file layout the real installer creates.
cat > "$fixture_dir/bin/curl" <<'EOF'
#!/bin/zsh
set -eu
print -r -- 'mkdir -p "$HOME/Library/pnpm/bin"'
print -r -- ': > "$HOME/Library/pnpm/bin/pnpm"'
print -r -- 'chmod +x "$HOME/Library/pnpm/bin/pnpm"'
EOF
chmod +x "$fixture_dir/bin/curl"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/packages.sh'
install_pnpm
rehash
print -r -- "RESOLVED:\$(command -v pnpm || true)"
EOF

resolved=$(HOME="$fixture_dir" PATH="$fixture_dir/bin:/bin:/usr/bin" \
    zsh -f "$fixture_dir/run.zsh" | tail -1)

expected="RESOLVED:$fixture_dir/Library/pnpm/bin/pnpm"
if [[ "$resolved" != "$expected" ]]; then
    print -u2 "FAIL: after install_pnpm, expected '$expected', got '$resolved'"
    exit 1
fi
print 'PASS: install_pnpm leaves the installed pnpm binary on PATH'
