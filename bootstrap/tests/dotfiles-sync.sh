#!/bin/zsh
# A file edited live must never be copied back into the checkout automatically.
# On the MacBook Pro the pnpm installer wrote its own block into ~/.zshrc before
# the dotfiles step, and the old "live ahead -> chezmoi re-add" rule replaced
# dot_zshrc with that block - so every later apply handed out a ~/.zshrc with no
# conf.d, no aliases and no prompt. The repo wins; deliberate edits are absorbed
# by hand.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin" "$fixture_dir/home/.local/share/chezmoi/.git"

cat > "$fixture_dir/bin/chezmoi" <<'EOF'
#!/bin/zsh
set -eu
print -r -- "chezmoi $*" >> "$CHEZMOI_CALLS"
if [[ "$1" == status ]]; then
    print -r -- "$FIXTURE_STATUS"
fi
EOF

# Only the two calls apply_dotfiles makes on the checkout are needed.
cat > "$fixture_dir/bin/git" <<'EOF'
#!/bin/zsh
set -eu
print -r -- "git $*" >> "$CHEZMOI_CALLS"
if [[ "$*" == *"status --porcelain"* ]]; then
    print -r -- "$FIXTURE_GIT_STATUS"
fi
EOF
chmod +x "$fixture_dir/bin/chezmoi" "$fixture_dir/bin/git"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/configure.sh'
apply_dotfiles
EOF

# run <label> <chezmoi status fixture> <checkout git status fixture>
run() {
    local label=$1
    CALLS="$fixture_dir/calls-$label"
    : > "$CALLS"
    HOME="$fixture_dir/home" PATH="$fixture_dir/bin:/bin:/usr/bin" \
        CHEZMOI_CALLS="$CALLS" FIXTURE_STATUS="$2" FIXTURE_GIT_STATUS="$3" \
        zsh -f "$fixture_dir/run.zsh" > "$fixture_dir/out-$label" 2>&1
}

fail() { print -u2 "FAIL ($1): $2"; exit 1; }
calls() { cat "$fixture_dir/calls-$1"; }
out() { cat "$fixture_dir/out-$1"; }

# 1. Edited live, checkout clean: report it, apply it away, never re-add.
run live ' M .zshrc' ''
calls live | grep -q 'chezmoi re-add' && fail live "the live edit was copied back into the checkout"
calls live | grep -q 'chezmoi apply --force' || fail live "the dotfiles were not applied"
out live | grep -q '.zshrc' || fail live "the differing file was not reported"
out live | grep -q 'repo version wins' || fail live "the user was not told which side wins"

# 2. Checkout edited locally: that content is what every machine would get, so
#    say so before applying it.
run dirty '' ' M dot_zshrc'
out dirty | grep -q 'checkout has local edits' || fail dirty "a locally edited checkout was applied silently"
out dirty | grep -q 'dot_zshrc' || fail dirty "the edited checkout file was not named"
out dirty | grep -q 'checkout -- .' || fail dirty "no way to discard the edit was suggested"

# 3. Nothing anywhere: quiet, and still applied.
run clean '' ''
out clean | grep -q 'local edits' && fail clean "a clean checkout was reported as edited"
out clean | grep -q 'were edited live' && fail clean "a clean live side was reported as edited"
calls clean | grep -q 'chezmoi apply --force' || fail clean "the dotfiles were not applied"

print 'PASS: live edits are reported but never copied back into the checkout'
