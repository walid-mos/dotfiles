#!/usr/bin/env bats
# Tests de l'OUTIL `fbx` : contrat CLI, crypto, découverte, sécurité, chemins d'erreur.
# Chaque test compare la sortie à une source de vérité indépendante (vecteur RFC, macOS, ps,
# faux serveur local). Les appels réels à la box sont en lecture seule.
# L'état du réseau (baux, réglages) est vérifié à part, dans reseau.bats.
#
# Lancer : bats ~/.config/zsh/tests
# Prérequis : LAN Freebox, `fbx auth` fait, droit « settings » accordé.

load helpers

NOHOST="lan/browser/pub/ether-00:00:00:00:00:01"   # MAC réservée, n'existe jamais

assert_clean_failure() {
  [ "$status" -eq 1 ]
  [[ "$output$stderr" != *"command not found"* && "$output$stderr" != *"parse error"* ]] || false
}

# --- Contrat CLI : refus avant tout accès réseau, codes de sortie, messages clairs

@test "sans argument : usage sur stderr, exit 1" {
  run --separate-stderr "$FBX"
  assert_clean_failure
  [[ "$stderr" == Usage:* ]] || false
  [ -z "$output" ]
}

@test "verbe inconnu refusé sans contacter la box" {
  run --separate-stderr env FBX_URL=http://127.0.0.1:9 "$FBX" gte lan/config/
  assert_clean_failure
  [[ "$stderr" == Usage:* ]] || false   # pas « injoignable » : validé avant le réseau
}

@test "chemin manquant / argument en trop refusés" {
  run --separate-stderr "$FBX" get;                   assert_clean_failure
  run --separate-stderr "$FBX" get lan/config/ '{}';  assert_clean_failure
}

@test "JSON invalide refusé sans contacter la box" {
  run --separate-stderr env FBX_URL=http://127.0.0.1:9 "$FBX" put lan/config/ '{bad'
  assert_clean_failure
  [[ "$stderr" == "JSON invalide"* ]] || false
}

@test "box injoignable : message clair, exit 1" {
  run --separate-stderr env FBX_URL=http://127.0.0.1:9 "$FBX" get lan/config/
  assert_clean_failure
  [[ "$stderr" == *injoignable* ]] || false
}

@test "serveur HTTP qui n'est pas une Freebox : rejeté avant tout login" {
  # faux serveur local : répond un JSON valide, mais sans api_base_url, sur /api_version
  root="$BATS_TEST_TMPDIR/www"; mkdir -p "$root"
  echo '{"hello":"world"}' > "$root/api_version"
  port=$(( 20000 + RANDOM % 20000 ))
  python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" 2>"$root/log" & srv=$!
  for _ in {1..50}; do curl -s -o /dev/null "http://127.0.0.1:$port/api_version" && break; sleep 0.1; done

  run --separate-stderr env FBX_URL="http://127.0.0.1:$port" "$FBX" get lan/config/
  kill "$srv"
  assert_clean_failure
  [[ "$stderr" == *"pas une Freebox"* ]] || false
  # preuve qu'il s'est arrêté à la découverte : aucune requête vers login/
  grep -q 'GET /api_version' "$root/log"
  ! grep -q '/login' "$root/log" || false
}

# --- Crypto : vecteurs officiels RFC 2202 (HMAC-SHA1)

@test "hmac_sha1 respecte les vecteurs RFC 2202" {
  h() { FBX_LIB=1 zsh -c 'source "$1"; hmac_sha1 "$2" "$3"' _ "$FBX" "$1" "$2"; }
  [ "$(h Jefe 'what do ya want for nothing?')" = effcdf6ae5eb2fa2d27416d5f184df9c259a7c79 ]
  [ "$(h key 'The quick brown fox jumps over the lazy dog')" = de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9 ]
  # clé de 64 octets pile (taille d'un token Freebox, = taille de bloc SHA1)
  k=$(printf 'a%.0s' {1..64})
  [ "$(h "$k" msg)" = "$(printf msg | openssl dgst -sha1 -hmac "$k" -binary | xxd -p -c 256)" ]
}

# --- Découverte, performance, secrets

@test "IP de la box = passerelle par défaut macOS" {
  run --separate-stderr "$FBX" get lan/config/
  [ "$status" -eq 0 ]
  [ "$(jq -r .result.ip <<<"$output")" = "$(gateway)" ]
}

@test "un appel prend moins de 2 s (régression .local ~5 s)" {
  start=$(perl -MTime::HiRes=time -e 'print time')
  run "$FBX" get lan/config/
  end=$(perl -MTime::HiRes=time -e 'print time')
  [ "$status" -eq 0 ]
  perl -e "exit(($end - $start) < 2 ? 0 : 1)"
}

@test "chemin avec / initial équivalent" {
  [ "$("$FBX" get lan/config/)" = "$("$FBX" get /lan/config/)" ]
}

@test "aucun secret visible dans ps pendant les appels" {
  tok=$(security find-generic-password -s freebox-api -a fr.local.fbx-cli -w)
  snap="$BATS_TEST_TMPDIR/ps"
  ( for i in 1 2 3; do "$FBX" get lan/config/ >/dev/null; done ) & pid=$!
  while kill -0 "$pid" 2>/dev/null; do ps -axww -o args= >>"$snap"; done
  wait "$pid"
  [ -s "$snap" ]
  ! grep -qF "$tok" "$snap" || false
  ! grep -q "X-Fbx-App-Auth" "$snap" || false
}

# --- Erreurs API et chemin d'écriture (sans rien supprimer de réel)

@test "hôte inconnu : erreur API nohost, exit 1" {
  run --separate-stderr "$FBX" get "$NOHOST"
  [ "$status" -eq 1 ]
  [ "$(jq -r .error_code <<<"$output")" = nohost ]
}

@test "delete d'un hôte inexistant atteint l'API (auth + droit + route) sans effet" {
  run --separate-stderr "$FBX" delete "$NOHOST"
  [ "$status" -eq 1 ]
  [ "$(jq -r .error_code <<<"$output")" = nohost ]   # pas insufficient_rights / auth_required
}
