#!/bin/zsh
# The herdr installer drops its binary in ~/.local/bin, which is not on PATH
# in a fresh bootstrap shell. If install_herdr does not add it, every later
# herdr command in the same run (the Studio pairing) fails as "command not
# found" and the machine silently ends up unpaired.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin"

# Replace only the transport: emit the file layout the real installer creates.
cat > "$fixture_dir/bin/curl" <<'EOF'
#!/bin/zsh
set -eu
print -r -- 'mkdir -p "$HOME/.local/bin"'
print -r -- ': > "$HOME/.local/bin/herdr"'
print -r -- 'chmod +x "$HOME/.local/bin/herdr"'
EOF
chmod +x "$fixture_dir/bin/curl"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/packages.sh'
install_herdr
rehash
print -r -- "RESOLVED:\$(command -v herdr || true)"
EOF

resolved=$(HOME="$fixture_dir" PATH="$fixture_dir/bin:/bin:/usr/bin" \
    zsh -f "$fixture_dir/run.zsh" | tail -1)

expected="RESOLVED:$fixture_dir/.local/bin/herdr"
if [[ "$resolved" != "$expected" ]]; then
    print -u2 "FAIL: after install_herdr, expected '$expected', got '$resolved'"
    exit 1
fi
print 'PASS: install_herdr leaves the installed herdr binary on PATH'
