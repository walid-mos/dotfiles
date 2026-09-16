#!/bin/zsh
# The herdr installer drops its binary in ~/.local/bin, which is not on PATH in a
# fresh bootstrap shell. If install_herdr does not add it, every later herdr
# command in the same run (the Studio pairing) fails as "command not found" and
# the machine silently ends up unpaired - on a fresh install, and just as much on
# a re-run where herdr is already there: that skip path is how an already
# provisioned laptop gets re-run.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin"

# Replace only the transport: emit the file layout the real installer creates,
# and leave a trace so the test can tell an install from a skip.
cat > "$fixture_dir/bin/curl" <<'EOF'
#!/bin/zsh
set -eu
print -r -- 'curl' >> "$CURL_CALLS"
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

check() {  # <label> <home> <expected install count>
    local label=$1 home=$2 expected_installs=$3 resolved installs calls expected
    calls="$fixture_dir/curl-calls-$label"
    : > "$calls"

    resolved=$(HOME="$home" PATH="$fixture_dir/bin:/bin:/usr/bin" CURL_CALLS="$calls" \
        zsh -f "$fixture_dir/run.zsh" | tail -1)
    installs=$(grep -c curl "$calls" || true)
    expected="RESOLVED:$home/.local/bin/herdr"

    if [[ "$resolved" != "$expected" ]]; then
        print -u2 "FAIL ($label): expected '$expected', got '$resolved'"
        return 1
    fi
    if [[ "$installs" != "$expected_installs" ]]; then
        print -u2 "FAIL ($label): expected $expected_installs install(s), saw $installs"
        return 1
    fi
}

# herdr absent: install it, then have it on PATH.
check fresh "$fixture_dir/fresh" 1

# herdr already installed (re-run): nothing to install, still on PATH.
mkdir -p "$fixture_dir/ready/.local/bin"
print -r -- '#!/bin/sh' > "$fixture_dir/ready/.local/bin/herdr"
chmod +x "$fixture_dir/ready/.local/bin/herdr"
check already-installed "$fixture_dir/ready" 0

print 'PASS: install_herdr leaves herdr on PATH, installing it or not'
