#!/bin/zsh
# Exercise the downloaded module set without network access or machine setup.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin"

# Replace only the transport: the entry point and downloaded modules are real.
cat > "$fixture_dir/bin/curl" <<'EOF'
#!/bin/zsh
set -eu
[[ "$1" = -fsSL && "$3" = -o ]]
cp "$BOOTSTRAP_SOURCE/${2:t}" "$4"
EOF
chmod +x "$fixture_dir/bin/curl"

# Invalid input must reach argument validation, before any setup operation.
if BOOTSTRAP_SOURCE="$repo_root/bootstrap" ZDOTDIR="$fixture_dir" \
    PATH="$fixture_dir/bin:$PATH" zsh -f "$repo_root/bootstrap.sh" \
    --bootstrap-test-invalid > "$fixture_dir/output" 2>&1; then
    printf 'FAIL: bootstrap accepted an invalid argument\n' >&2
    exit 1
fi
if ! grep -q "Unknown argument '--bootstrap-test-invalid'" "$fixture_dir/output"; then
    printf 'FAIL: downloaded bootstrap did not reach argument validation\n' >&2
    head -20 "$fixture_dir/output" >&2
    exit 1
fi
printf 'PASS: downloaded bootstrap loads its modules before validating arguments\n'
