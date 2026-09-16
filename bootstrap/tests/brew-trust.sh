#!/bin/zsh
# ensure_brew_trust must trust third-party casks and nothing else: the cask
# names decide, so no official cask is ever handed to `brew trust`.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

brew_calls="$fixture_dir/brew-calls"
mkdir -p "$fixture_dir/bin"
cat > "$fixture_dir/bin/brew" <<'EOF'
#!/bin/zsh
set -eu
print -r -- "$*" >> "$BREW_CALLS"
if [[ "$1" == trust && "$2" == --json ]]; then
    print -r -- "$BREW_TRUST_STATE"
fi
EOF
chmod +x "$fixture_dir/bin/brew"

# brew_trust_calls <trust-state> - run ensure_brew_trust against a fake brew
# and print the casks it asked to trust.
brew_trust_calls() {
    : > "$brew_calls"
    PATH="$fixture_dir/bin:$PATH" BREW_CALLS="$brew_calls" BREW_TRUST_STATE="$1" \
        zsh -c "
            source '$repo_root/bootstrap/lib.sh'
            source '$repo_root/bootstrap/packages.sh'
            BREW_CASKS=(ghostty brave-browser anomalyco/tap/hex)
            LAPTOP_CASKS=(tailscale-app)
            ensure_brew_trust" > /dev/null
    grep 'trust --cask' "$brew_calls" || true
}

empty_state='{"taps":[],"formulae":[],"casks":[],"commands":[]}'
trusted_state='{"taps":[],"formulae":[],"casks":["anomalyco/tap/hex"],"commands":[]}'

trusted_calls=$(brew_trust_calls "$empty_state")
if [[ "$trusted_calls" != "trust --cask anomalyco/tap/hex" ]]; then
    print -u2 "FAIL: expected exactly the third-party cask trusted, got: '$trusted_calls'"
    exit 1
fi

already_trusted_calls=$(brew_trust_calls "$trusted_state")
if [[ -n "$already_trusted_calls" ]]; then
    print -u2 "FAIL: trusted cask asked again: '$already_trusted_calls'"
    exit 1
fi

print 'PASS: only third-party casks are trusted, and only once'
