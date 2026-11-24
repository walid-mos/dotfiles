# Partagé par fbx.bats et reseau.bats (chargé via `load helpers`)
bats_require_minimum_version 1.5.0

FBX="${BATS_TEST_DIRNAME}/../bin/fbx"

# macOS (les Macs) ou Linux (LXC ops) : sources indépendantes de fbx
if [[ $OSTYPE == darwin* ]]; then
  gateway() { route -n get default | awk '/gateway:/{print $2}'; }
  iface()   { route -n get default | awk '/interface:/{print $2}'; }
  my_mac()  { ifconfig "$(iface)" | awk '/ether/{print toupper($2)}'; }
  my_ip()   { ipconfig getifaddr "$(iface)"; }
  fbx_token() { security find-generic-password -s freebox-api -a fr.local.fbx-cli -w; }
else
  gateway() { ip route show default | awk '{print $3; exit}'; }
  iface()   { ip route show default | awk '{print $5; exit}'; }
  my_mac()  { tr a-f A-F < "/sys/class/net/$(iface)/address"; }
  my_ip()   { ip -4 -o addr show dev "$(iface)" | awk '{sub(/\/.*/, "", $4); print $4; exit}'; }
  fbx_token() { printf '%s' "${FBX_APP_TOKEN:?}"; }
fi
