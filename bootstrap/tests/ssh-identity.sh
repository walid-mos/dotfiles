#!/bin/zsh
# Both ends of the Studio pairing use the default ed25519 key, and the
# bootstrap's reverse-pairing step fetches ~/.ssh/id_ed25519.pub from the
# Studio. On a Studio that never had one, that fetch returns an empty file and
# the laptop is left unpaired with "Permission denied (publickey)" - so the
# key must be created when missing and never regenerated over.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin"

cat > "$fixture_dir/bin/ssh-keygen" <<'EOF'
#!/bin/zsh
set -eu
print -r -- 'ssh-keygen' >> "$KEYGEN_CALLS"
path=''
while (( $# )); do
    [[ "$1" == -f ]] && path=$2
    shift
done
: > "$path"
print -r -- 'ssh-ed25519 AAAA...fixture' > "$path.pub"
EOF
chmod +x "$fixture_dir/bin/ssh-keygen"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/configure.sh'
ensure_ssh_key
EOF

check() {  # <label> <home> <expected keygen count>
    local label=$1 home=$2 expected_generations=$3 calls generated expected
    calls="$fixture_dir/keygen-calls-$label"
    : > "$calls"

    HOME="$home" PATH="$fixture_dir/bin:/bin:/usr/bin" KEYGEN_CALLS="$calls" \
        zsh -f "$fixture_dir/run.zsh" > /dev/null
    generated=$(grep -c ssh-keygen "$calls" || true)

    if [[ "$generated" != "$expected_generations" ]]; then
        print -u2 "FAIL ($label): expected $expected_generations generation(s), saw $generated"
        return 1
    fi
    if [[ "$expected_generations" == 1 && ! -f "$home/.ssh/id_ed25519.pub" ]]; then
        print -u2 "FAIL ($label): ssh-keygen ran but no public key exists"
        return 1
    fi
}

# No identity yet (the Studio's actual state): create one.
check missing "$fixture_dir/missing" 1

# Identity already there: keep it, do not rotate the key other machines trust.
mkdir -p "$fixture_dir/present/.ssh"
print -r -- 'ssh-ed25519 AAAA...existing' > "$fixture_dir/present/.ssh/id_ed25519.pub"
check present "$fixture_dir/present" 0
keep=$(cat "$fixture_dir/present/.ssh/id_ed25519.pub")
if [[ "$keep" != 'ssh-ed25519 AAAA...existing' ]]; then
    print -u2 "FAIL (present): the existing key was overwritten"
    exit 1
fi

print 'PASS: ensure_ssh_key creates a missing identity and never overwrites one'
