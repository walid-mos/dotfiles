# Partagé par fbx.bats et reseau.bats (chargé via `load helpers`)
bats_require_minimum_version 1.5.0

FBX="${BATS_TEST_DIRNAME}/../bin/fbx"

gateway() { route -n get default | awk '/gateway:/{print $2}'; }
iface()   { route -n get default | awk '/interface:/{print $2}'; }
my_mac()  { ifconfig "$(iface)" | awk '/ether/{print toupper($2)}'; }
my_ip()   { ipconfig getifaddr "$(iface)"; }
