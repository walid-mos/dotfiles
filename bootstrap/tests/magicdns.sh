#!/bin/zsh
# discover_laptop_magicdns feeds `herdr machine add <user>@<name>` on the Studio.
# Matching the whole '"DNSName": "..."' pair and trimming quotes left the key
# glued to the value, so the Studio tried to save a machine called
# 'DNSName": "macbook-pro' and herdr refused it as "hostname contains invalid
# characters". The first DNSName in the status output is this node's own.
set -eu

repo_root=${0:A:h:h:h}
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir -p "$fixture_dir/bin"

cat > "$fixture_dir/bin/tailscale" <<'EOF'
#!/bin/zsh
set -eu
[[ -n "${FIXTURE_FAIL:-}" ]] && exit 1
cat <<'JSON'
{
  "Version": "1.90.0",
  "TUN": true,
  "BackendState": "Running",
  "Self": {
    "ID": "nodekey:self",
    "HostName": "macbook-pro",
    "DNSName": "macbook-pro.tail4df91e.ts.net.",
    "OS": "macOS"
  },
  "Peer": {
    "nodekey:peer": {
      "HostName": "mac-studio",
      "DNSName": "mac-studio.tail4df91e.ts.net.",
      "OS": "macOS"
    }
  }
}
JSON
EOF
chmod +x "$fixture_dir/bin/tailscale"

cat > "$fixture_dir/run.zsh" <<EOF
source '$repo_root/bootstrap/lib.sh'
source '$repo_root/bootstrap/configure.sh'
if name=\$(discover_laptop_magicdns); then
    print -r -- "NAME:\$name"
else
    print -r -- 'NO_NAME'
fi
EOF

result=$(PATH="$fixture_dir/bin:/bin:/usr/bin" zsh -f "$fixture_dir/run.zsh")
[[ "$result" == 'NAME:macbook-pro' ]] || {
    print -u2 "FAIL: expected 'NAME:macbook-pro', got '$result'"
    exit 1
}

signed_out=$(PATH="$fixture_dir/bin:/bin:/usr/bin" FIXTURE_FAIL=1 zsh -f "$fixture_dir/run.zsh")
[[ "$signed_out" == 'NO_NAME' ]] || {
    print -u2 "FAIL: a failed status call must report no name, got '$signed_out'"
    exit 1
}

print 'PASS: the MagicDNS name is the bare short name of this node'
