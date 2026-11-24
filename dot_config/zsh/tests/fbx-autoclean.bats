#!/usr/bin/env bats
# Tests de `fbx-autoclean` (nettoyage des hôtes fantômes de la box, plan freebox-autoclean §7).
# Sélection : fixtures construites ici, une par branche de la règle, sans recopier le filtre testé.
# Garde-fous : faux `fbx` (FBX_BIN) qui journalise ses appels : on vérifie qu'aucun DELETE n'est parti.
# E2E : la vraie box, en lecture seule (dry-run), comparée aux baux lus à part.
#
# Lancer : bats ~/.config/zsh/tests/fbx-autoclean.bats (sur le LXC ops : sous `infisical run`, voir fbx.bats)

load helpers
AC="${BATS_TEST_DIRNAME}/../bin/fbx-autoclean"
DAY=86400

setup() {
  NOW=$(date +%s); OLD=$(( NOW - 31 * DAY )); RECENT=$(( NOW - 5 * DAY ))
  T="$BATS_TEST_TMPDIR"
  echo '[{"mac":"AA:AA:AA:AA:AA:01","ip":"192.0.2.10"}]' > "$T/leases.json"
}

host() { # mac active last_time_reachable(vide = absent)
  jq -nc --arg m "$1" --argjson a "$2" --arg t "${3-}" \
    '{id:("ether-" + ($m|ascii_downcase)), active:$a, primary_name:("h-" + $m), l2ident:{id:$m, type:"mac_address"}}
     + (if $t == "" then {} else {last_time_reachable: ($t|tonumber)} end)'
}
sel() { "$AC" --select "$T/hosts.json" "$T/leases.json" "$NOW" ${1:+"$1"}; }
macs() { jq -r '[.[].mac] | sort | join(" ")'; }

@test "sélection : seul l'inactif de plus de 30 j sans bail est retenu (et les entrées corrompues)" {
  jq -n --argjson a "$(host 00:00:00:00:00:01 true "$OLD")" \
        --argjson b "$(host 00:00:00:00:00:02 false "$RECENT")" \
        --argjson c "$(host 00:00:00:00:00:03 false "$OLD")" \
        --argjson d "$(host AA:AA:AA:AA:AA:01 false "$OLD")" \
        --argjson e "$(host 00:00:00:00:00:05 false 0)" \
        --argjson f "$(host 00:00:00:00:00:06 false)" \
        '{pub: [$a,$b,$c,$d,$e,$f], wifiguest: []}' > "$T/hosts.json"
  # actif, récent, avec bail : gardés ; vieux sans bail, 0, absent : retenus
  [ "$(sel | macs)" = "00:00:00:00:00:03 00:00:00:00:00:05 00:00:00:00:00:06" ]
}

@test "sélection : la MAC d'un bail protège quelle que soit la casse" {
  jq -n --argjson d "$(host aa:aa:aa:aa:aa:01 false "$OLD")" '{pub: [$d], wifiguest: []}' > "$T/hosts.json"
  [ "$(sel | jq length)" = 0 ]
  echo '[{"mac":"aa:aa:aa:aa:aa:01"}]' > "$T/leases.json"
  jq -n --argjson d "$(host AA:AA:AA:AA:AA:01 false "$OLD")" '{pub: [$d], wifiguest: []}' > "$T/hosts.json"
  [ "$(sel | jq length)" = 0 ]
}

@test "sélection : interface wifiguest couverte, iface reportée" {
  jq -n --argjson g "$(host 00:00:00:00:00:07 false "$OLD")" '{pub: [], wifiguest: [$g]}' > "$T/hosts.json"
  [ "$(sel | jq -r '.[0].iface + " " + .[0].id')" = "wifiguest ether-00:00:00:00:00:07" ]
}

@test "sélection : limite à 30 jours (29 j gardé, 31 j retenu)" {
  jq -n --argjson a "$(host 00:00:00:00:00:08 false $(( NOW - 29 * DAY )))" \
        --argjson b "$(host 00:00:00:00:00:09 false $(( NOW - 31 * DAY )))" '{pub: [$a,$b], wifiguest: []}' > "$T/hosts.json"
  [ "$(sel | macs)" = "00:00:00:00:00:09" ]
}

@test "sélection : jamais la machine qui l'exécute" {
  jq -n --argjson a "$(host 00:00:00:00:00:0A false "$OLD")" '{pub: [$a], wifiguest: []}' > "$T/hosts.json"
  echo '["00:00:00:00:00:0a"]' > "$T/self.json"
  [ "$(sel "$T/self.json" | jq length)" = 0 ]
}

# --- garde-fous, avec un faux fbx

fake_fbx() { # $1 = nombre d'hôtes fantômes, $2 = réponse des baux (JSON)
  cat > "$T/fbx" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$T/calls"
case "\$1 \$2" in
  "get dhcp/static_lease/") echo '$2' ;;
  "get lan/browser/pub/") jq -nc --argjson n $1 --argjson t $OLD '{success:true, result:[range(\$n) | {id:("ether-00:00:00:00:01:" + (if . < 16 then "0" else "" end) + (. | tostring)), active:false, last_time_reachable:\$t, primary_name:"x", l2ident:{id:("00:00:00:00:01:" + (if . < 16 then "0" else "" end) + (. | tostring))}}]}' ;;
  "get lan/browser/wifiguest/") echo '{"success":true,"result":[]}' ;;
  delete*) echo '{"success":true}' ;;
esac
EOF
  chmod +x "$T/fbx"; export FBX_BIN="$T/fbx"
}
LEASES='{"success":true,"result":[{"mac":"AA:AA:AA:AA:AA:01"}]}'

@test "plafond : 21 candidats → rien supprimé, sortie en erreur" {
  fake_fbx 21 "$LEASES"
  run "$AC" --apply
  [ "$status" -ne 0 ]
  ! grep -q '^delete' "$T/calls"
  [ "$(jq -r 'select(.event=="abort") | .candidates' <<<"$output")" = 21 ]
}

@test "plafond : 20 candidats → supprimés en --apply (contrôle positif)" {
  fake_fbx 20 "$LEASES"
  run "$AC" --apply
  [ "$status" -eq 0 ]
  [ "$(grep -c '^delete lan/browser/pub/ether-' "$T/calls")" = 20 ]
}

@test "dry-run par défaut : aucun DELETE" {
  fake_fbx 3 "$LEASES"
  run "$AC"
  [ "$status" -eq 0 ]
  ! grep -q '^delete' "$T/calls"
  [ "$(jq -s '[.[] | select(.event=="would_delete")] | length' <<<"$output")" = 3 ]
}

@test "baux vides ou en erreur → rien supprimé, sortie en erreur" {
  for l in '{"success":true,"result":[]}' '{"success":false,"error_code":"auth_required"}' 'pas du json'; do
    rm -f "$T/calls"; fake_fbx 3 "$l"
    run "$AC" --apply
    [ "$status" -ne 0 ]
    ! grep -q '^delete' "$T/calls"
    ! grep -q 'lan/browser' "$T/calls"     # arrêt avant même de lire les hôtes
  done
}

# --- E2E sur la vraie box, lecture seule

@test "E2E dry-run : JSON valide, aucun hôte à bail statique, ni cette machine, parmi les candidats" {
  unset FBX_BIN
  run --separate-stderr "$AC"
  [ "$status" -eq 0 ]
  jq -se 'length > 0 and (.[-1].event == "summary") and (.[-1].mode == "dry-run")' <<<"$output" >/dev/null
  leases=$("$FBX" get dhcp/static_lease/ | jq -c '[.result[].mac | ascii_upcase]')
  [ "$(jq -s --argjson l "$leases" '[.[] | select(.event=="would_delete") | select(.mac as $m | $l | index($m))] | length' <<<"$output")" = 0 ]
  [ "$(jq -s --arg m "$(my_mac)" '[.[] | select(.event=="would_delete" and .mac == $m)] | length' <<<"$output")" = 0 ]
}
