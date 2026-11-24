#!/usr/bin/env bats
# Contrôle de dérive du RÉSEAU : la box respecte-t-elle les règles décidées ?
# Aucune donnée d'appareil ici (pas de MAC, pas de nom) : la source de vérité des
# réservations, c'est la box elle-même. On vérifie des RÈGLES, en croisant deux
# sous-systèmes de la box (baux DHCP ↔ LAN observé) ou la box ↔ macOS.

load helpers

# Politique d'adressage (doc : ~/Desktop/pi/architecture/reseau.md). Des RÈGLES, pas des appareils.
DYN_START=192.168.1.160 DYN_END=192.168.1.249   # plage dynamique de la box
HOMELAB='64 127'                              # bloc homelab 192.168.1.64/26 : IP fixées dans Proxmox

leases() { "$FBX" get dhcp/static_lease/ | jq -c '[.result[] | {mac: (.mac|ascii_upcase), ip}]'; }

# --- Réservations DHCP : chaque appareil a une IP définitive

@test "chaque appareil connecté au réseau principal a une réservation" {
  # invités : Wi-Fi invité (wifiguest), hors périmètre. VMs du homelab : IP fixée dans Proxmox, exemptées.
  read -r lo hi <<<"$HOMELAB"
  run --separate-stderr "$FBX" get lan/browser/pub/
  missing=$(jq -r --argjson l "$(leases)" --argjson lo "$lo" --argjson hi "$hi" '
    ($l | map(.mac)) as $macs
    | .result[] | select(.active) | (.l2ident.id | ascii_upcase) as $m
    | select($macs | index($m) | not)
    | [.l3connectivities[]? | select(.af == "ipv4" and .active) | .addr | split(".")[3] | tonumber] as $o
    | select(($o | length) == 0 or any($o[]; . < $lo or . > $hi)) | "\(.primary_name) \($m) sans réservation"' <<<"$output")
  [ -z "$missing" ] || { echo "$missing"; false; }
}

@test "chaque appareil réservé utilise son IP réservée, et seulement celle-là" {
  # tolère les IP louées à un AUTRE appareil : proxy ARP Apple (Bonjour Sleep Proxy de l'Apple TV
  # qui répond pour les HomePod en veille).
  # Un appareil réservé DANS le bloc homelab peut porter en plus des IP fixes du bloc homelab :
  # contrôleur de gestion qui partage la carte réseau (Intel AMT du nœud Proxmox).
  read -r lo hi <<<"$HOMELAB"
  run --separate-stderr "$FBX" get lan/browser/pub/
  others=$("$FBX" get dhcp/dynamic_lease/ | jq -c '[.result[] | {mac: (.mac|ascii_upcase), ip}]')
  wrong=$(jq -r --argjson l "$(leases)" --argjson o "$others" --argjson lo "$lo" --argjson hi "$hi" '
    def homelab: split(".")[3] | tonumber | . >= $lo and . <= $hi;
    ($l | map({(.mac): .ip}) | add) as $want
    | .result[] | select(.active) | (.l2ident.id | ascii_upcase) as $m | select($want[$m])
    | [.l3connectivities[]? | select(.af == "ipv4" and .active) | .addr
       | . as $ip | select($o | any(.ip == $ip and .mac != $m) | not)] as $ips
    | ($ips - [$want[$m]]) as $extra
    | (if ($want[$m] | homelab) then [$extra[] | select(homelab | not)] else $extra end) as $extra
    | select(($ips | any(. == $want[$m]) | not) or ($extra | length) > 0)
    | "\(.primary_name) \($m) a \($ips) au lieu de [\($want[$m])]"' <<<"$output")
  [ -z "$wrong" ] || { echo "$wrong"; false; }
}

@test "l'IP de ce Mac selon macOS = sa réservation sur la box" {
  want=$(jq -r --arg m "$(my_mac)" '.[] | select(.mac == $m) | .ip' <<<"$(leases)")
  [ -n "$want" ] || { echo "MAC $(my_mac) sans réservation"; false; }
  [ "$(my_ip)" = "$want" ] || { echo "macOS: $(my_ip), réservé: $want"; false; }
}

@test "ce Mac est vu actif par la box avec sa MAC et son IP macOS" {
  run --separate-stderr "$FBX" get lan/browser/pub/
  jq -e --arg m "$(my_mac)" --arg ip "$(my_ip)" '
    [.result[] | select((.l2ident.id | ascii_upcase) == $m)] | length == 1 and (.[0].active) and
    ([.[0].l3connectivities[] | select(.af == "ipv4" and .active) | .addr] | index($ip) != null)
  ' <<<"$output"
}

@test "réservations hors plage dynamique, sans doublon d'IP" {
  cfg=$("$FBX" get dhcp/config/)
  jq -e --argjson c "$cfg" '
    def n: split(".") | map(tonumber) | .[0]*16777216 + .[1]*65536 + .[2]*256 + .[3];
    ($c.result.ip_range_start | n) as $lo | ($c.result.ip_range_end | n) as $hi
    | length > 0
      and (map(.ip) | length == (unique | length))
      and all(.[]; (.ip | n) < $lo or (.ip | n) > $hi)' <<<"$(leases)"
}

@test "plage DHCP dynamique = politique, attribution sticky" {
  run --separate-stderr "$FBX" get dhcp/config/
  jq -e --arg s "$DYN_START" --arg e "$DYN_END" '.result | .ip_range_start == $s and .ip_range_end == $e and .sticky_assign' <<<"$output"
}

@test "aucune IP fixée à la main dans la plage dynamique (risque de conflit)" {
  # croise le LAN observé avec les baux réellement distribués par la box
  run --separate-stderr "$FBX" get lan/browser/pub/
  rogue=$(jq -r --argjson d "$("$FBX" get dhcp/dynamic_lease/ | jq -c '[.result[] | .ip]')" \
             --arg s "$DYN_START" --arg e "$DYN_END" '
    def n: split(".") | map(tonumber) | .[0]*16777216 + .[1]*65536 + .[2]*256 + .[3];
    .result[] | select(.active) | . as $h
    | .l3connectivities[]? | select(.af == "ipv4" and .active) | .addr
    | . as $ip | select(n >= ($s | n) and n <= ($e | n) and ($d | index([$ip]) | not))
    | "\($h.primary_name) \($h.l2ident.id) a \(.) hors de tout bail DHCP"' <<<"$output")
  [ -z "$rogue" ] || { echo "$rogue"; false; }
}

@test "aucune entrée fantôme jamais joignable depuis > 1 j" {
  # une entrée tout juste découverte peut avoir last_time_reachable = 0 : on ne vise que les vieilles
  run --separate-stderr "$FBX" get lan/browser/pub/
  jq -e --argjson cutoff "$(( $(date +%s) - 86400 ))" '
    [.result[] | select((.active | not) and (.last_time_reachable // 0) == 0
                        and (.first_activity // 0) < $cutoff)] | length == 0' <<<"$output"
}

# --- Durcissement (validé le 23/11/2026)

@test "pare-feu IPv6 actif" {
  run --separate-stderr "$FBX" get connection/ipv6/config/
  jq -e '.result.ipv6_firewall == true' <<<"$output"
}

@test "partage SMB du disque de la box coupé (fichiers + imprimante)" {
  run --separate-stderr "$FBX" get netshare/samba/
  jq -e '.result | (.file_share_enabled | not) and (.print_share_enabled | not)' <<<"$output"
}

@test "WPS coupé" {
  run --separate-stderr "$FBX" get wifi/wps/config/
  jq -e '.result.enabled == false' <<<"$output"
}

@test "AirMedia et UPnP AV coupés" {
  run --separate-stderr "$FBX" get airmedia/config/;  jq -e '.result.enabled == false' <<<"$output"
  run --separate-stderr "$FBX" get upnpav/config/;    jq -e '.result.enabled == false' <<<"$output"
}

@test "administration Freebox OS fermée depuis Internet (ports http/https entrants)" {
  # api_remote_access est en lecture seule via l'API : ce sont ces ports qui exposent l'admin
  run --separate-stderr "$FBX" get fw/incoming/
  jq -e '[.result[] | select(.id == "http" or .id == "https") | .enabled or .active] == [false, false]' <<<"$output"
  run --separate-stderr "$FBX" get connection/config/
  jq -e '.result.remote_access == false' <<<"$output"
}
