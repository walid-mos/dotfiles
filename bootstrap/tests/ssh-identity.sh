#!/bin/zsh
# The pairing key is named after the machine (macbook-pro, mac-studio) and ssh
# only offers such a key to a host named in ~/.ssh/config. Three ways this
# silently breaks the pairing: generating a second key next to a legacy
# id_ed25519 (the peer no longer trusts the material), regenerating over an
# existing key, and renaming without pinning the key in the config.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin"

# LocalHostName is what the key is named after - the real one belongs to the
# machine running the tests, so pin it.
cat > "$fixture_dir/bin/scutil" <<'EOF'
#!/bin/zsh
set -eu
[[ "$1" == --get && "$2" == LocalHostName ]] && print -r -- "$FIXTURE_LOCAL_HOSTNAME"
exit 0
EOF

cat > "$fixture_dir/bin/ssh-keygen" <<'EOF'
#!/bin/zsh
set -eu
print -r -- 'ssh-keygen' >> "$KEYGEN_CALLS"
path=''
while (( $# )); do
    [[ "$1" == -f ]] && path=$2
    shift
done
print -r -- 'PRIVATE' > "$path"
print -r -- 'ssh-ed25519 AAAA...generated' > "$path.pub"
EOF
chmod +x "$fixture_dir/bin/scutil" "$fixture_dir/bin/ssh-keygen"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/configure.sh'
ensure_ssh_key
ensure_ssh_config_host "\$CONFIG_HOST" "\$CONFIG_IDENTITY"
EOF

# run <home> <local-hostname> <config-host> <config-identity>
run() {
    HOME="$1" FIXTURE_LOCAL_HOSTNAME="$2" CONFIG_HOST="$3" CONFIG_IDENTITY="$4" \
        PATH="$fixture_dir/bin:/bin:/usr/bin" KEYGEN_CALLS="$fixture_dir/keygen-calls" \
        zsh -f "$fixture_dir/run.zsh" > /dev/null
}

fail() { print -u2 "FAIL ($1): $2"; exit 1; }

# 1. Nothing yet: one key, named after the machine, no id_ed25519 left behind.
fresh="$fixture_dir/fresh"
: > "$fixture_dir/keygen-calls"
run "$fresh" MacBook-Pro mac-studio '~/.ssh/macbook-pro'
[[ -f "$fresh/.ssh/macbook-pro.pub" ]] || fail fresh "no ~/.ssh/macbook-pro.pub was created"
[[ ! -e "$fresh/.ssh/id_ed25519" ]] || fail fresh "a default id_ed25519 was also created"
[[ "$(grep -c ssh-keygen "$fixture_dir/keygen-calls" || true)" == 1 ]] || fail fresh "expected one ssh-keygen run"
grep -qs "Host mac-studio" "$fresh/.ssh/config" || fail fresh "~/.ssh/config has no Host mac-studio block"
grep -qs "IdentityFile ~/.ssh/macbook-pro" "$fresh/.ssh/config" || fail fresh "the key is not pinned in ~/.ssh/config"
grep -qs "IdentitiesOnly yes" "$fresh/.ssh/config" || fail fresh "IdentitiesOnly is missing (other keys would be offered)"

# 2. Legacy default key: renamed, never regenerated - its material is already in
#    the peer's authorized_keys.
legacy="$fixture_dir/legacy"
mkdir -p "$legacy/.ssh"
print -r -- 'PRIVATE-LEGACY' > "$legacy/.ssh/id_ed25519"
print -r -- 'ssh-ed25519 AAAA...legacy' > "$legacy/.ssh/id_ed25519.pub"
: > "$fixture_dir/keygen-calls"
run "$legacy" Mac-Studio macbook-pro '~/.ssh/mac-studio'
[[ -f "$legacy/.ssh/mac-studio" ]] || fail legacy "the legacy key was not renamed"
[[ "$(cat "$legacy/.ssh/mac-studio")" == 'PRIVATE-LEGACY' ]] || fail legacy "the renamed key material changed"
[[ "$(cat "$legacy/.ssh/mac-studio.pub")" == 'ssh-ed25519 AAAA...legacy' ]] || fail legacy "the renamed public key changed"
[[ ! -e "$legacy/.ssh/id_ed25519" ]] || fail legacy "the default key is still there"
[[ "$(grep -c ssh-keygen "$fixture_dir/keygen-calls" || true)" == 0 ]] || fail legacy "a new key was generated instead of reusing the trusted one"

# 3. Already correctly named: untouched, and a second run adds no duplicate block.
: > "$fixture_dir/keygen-calls"
run "$legacy" Mac-Studio macbook-pro '~/.ssh/mac-studio'
[[ "$(grep -c ssh-keygen "$fixture_dir/keygen-calls" || true)" == 0 ]] || fail named "the existing key was regenerated"
[[ "$(grep -c "Host macbook-pro" "$legacy/.ssh/config" || true)" == 1 ]] || fail named "the Host block was appended twice"

print 'PASS: pairing keys carry the machine name, survive a rename and are pinned per host'
