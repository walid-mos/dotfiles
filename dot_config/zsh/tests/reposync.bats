#!/usr/bin/env bats
# Tests de `reposync` (synchronisation des dépôts tagués auto-sync, plan relay §3.7).
# Tout est local : un dépôt « distant » nu, un clone géré, un second clone qui pousse, et un faux ntfy (python)
# qui sert un flux JSON. Les vérités comparées sont lues dans git, jamais dans la sortie de reposync.
#
# Lancer : bats ~/.config/zsh/tests/reposync.bats

bats_require_minimum_version 1.5.0

RS="${REPOSYNC_BIN:-${BATS_TEST_DIRNAME}/../../../.local/bin/reposync}"
[ -x "$RS" ] || RS="$HOME/.local/bin/reposync"

setup() {
  export REPOSYNC_STATE="$BATS_TEST_TMPDIR/state" REPOSYNC_LOG="$BATS_TEST_TMPDIR/log" REPOSYNC_NOTIFY=0
  export REPOSYNC_CONFIG="$BATS_TEST_TMPDIR/config.toml"
  export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/gitconfig" GIT_CONFIG_NOSYSTEM=1
  git config --global user.name t; git config --global user.email t@t; git config --global init.defaultBranch main
  git config --global commit.gpgsign false
  R="$BATS_TEST_TMPDIR/remote.git"; W="$BATS_TEST_TMPDIR/writer"; C="$BATS_TEST_TMPDIR/clone"
  git init -q --bare "$R"
  git clone -q "$R" "$W" 2>/dev/null; git -C "$W" commit -q --allow-empty -m init; git -C "$W" push -q origin main
  git clone -q "$R" "$C"
  MARK="$BATS_TEST_TMPDIR/post-ran"
  cat > "$REPOSYNC_CONFIG" <<EOF
# config de test
[relay]
url     = "http://127.0.0.1:9"
channel = "repo-updates"
token_env = "RELAY_TOKEN_TEST"

[[repo]]
name      = "walid-mos/test"
path      = "$C"
post_sync = "touch '$MARK'"
EOF
}

push_one() { git -C "$W" commit -q --allow-empty -m "$1"; git -C "$W" push -q origin main; git -C "$W" rev-parse HEAD; }
lib() { REPOSYNC_LIB=1 zsh -c 'source "$1"; shift; load_config && "$@"' _ "$RS" "$@"; }
msg() { jq -nc --arg m "$1" --arg id "${2:-abc123}" --argjson t "$(date +%s)" '{id:$id,time:$t,event:"message",topic:"repo-updates",message:$m}'; }

# --- fast-forward et post_sync

@test "push distant : fast-forward au SHA poussé, puis post_sync" {
  sha=$(push_one a)
  run lib handle_line "$(msg "walid-mos/test $sha")"
  [ "$status" -eq 0 ]
  [ "$(git -C "$C" rev-parse HEAD)" = "$sha" ]
  [ -f "$MARK" ]
}

@test "SHA déjà présent : rien refait (post_sync non relancé)" {
  sha=$(push_one a); lib handle_line "$(msg "walid-mos/test $sha")"; rm -f "$MARK"
  run lib handle_line "$(msg "walid-mos/test $sha")"
  [ "$status" -eq 0 ]; [ ! -f "$MARK" ]
  [ "$(git -C "$C" rev-parse HEAD)" = "$sha" ]
}

# --- jamais d'écrasement

@test "arbre modifié : pas de pull, modification intacte, post_sync non lancé" {
  echo local > "$C/f"; git -C "$C" add f; git -C "$C" commit -q -m f; git -C "$C" push -q origin main
  git -C "$W" pull -q
  echo dirty >> "$C/f"
  before=$(git -C "$C" rev-parse HEAD)
  sha=$(push_one b)
  run lib handle_line "$(msg "walid-mos/test $sha")"
  [ "$(git -C "$C" rev-parse HEAD)" = "$before" ]
  [ "$(tail -1 "$C/f")" = dirty ]
  [ ! -f "$MARK" ]
  grep -q "arbre modifié" "$REPOSYNC_LOG"
}

@test "branche divergente : rien appliqué, commit local conservé" {
  git -C "$C" commit -q --allow-empty -m local; mine=$(git -C "$C" rev-parse HEAD)
  sha=$(push_one distant)
  run lib handle_line "$(msg "walid-mos/test $sha")"
  [ "$(git -C "$C" rev-parse HEAD)" = "$mine" ]
  [ ! -f "$MARK" ]
  grep -q "divergente" "$REPOSYNC_LOG"
}

# --- le message ne commande rien

@test "messages forgés : ignorés, rien exécuté, aucun pull" {
  sha=$(push_one a); before=$(git -C "$C" rev-parse HEAD)
  canary="$BATS_TEST_TMPDIR/pwned"
  for m in "walid-mos/test $sha; touch $canary" "walid-mos/test \$(touch $canary)" "\`touch $canary\`" \
           "evil/test $sha" "walid-mos/../x $sha" "walid-mos/test ${sha:0:39}" "walid-mos/test $(printf %s "$sha" | tr a-f A-F)" ""; do
    run lib handle_line "$(msg "$m")"
    [ "$status" -eq 0 ]
  done
  [ ! -e "$canary" ]
  [ "$(git -C "$C" rev-parse HEAD)" = "$before" ]
  [ ! -f "$MARK" ]
}

@test "dépôt valide mais absent de la config : ignoré" {
  run lib handle_line "$(msg "NextNodeSolutions/autre $(printf 'a%.0s' {1..40})")"
  [ "$status" -eq 0 ]
  grep -q "absent de la config" "$REPOSYNC_LOG"
}

@test "événements non-message (keepalive, open) et JSON invalide : ignorés, last-id inchangé" {
  for l in '{"id":"k1","event":"keepalive","time":1}' '{"id":"o1","event":"open","time":1}' 'pas du json' '[]'; do
    run lib handle_line "$l"; [ "$status" -eq 0 ]
  done
  [ ! -e "$REPOSYNC_STATE/last-id" ]
}

@test "last-id mémorisé à chaque message, même ignoré" {
  lib handle_line "$(msg "format faux" Xy12)"
  [ "$(cat "$REPOSYNC_STATE/last-id")" = Xy12 ]
}

# --- config

@test "config : clé inconnue ou nom de dépôt invalide refusés" {
  printf '[[repo]]\nname = "walid-mos/x"\npath = "/tmp"\ncommande = "rm"\n' > "$REPOSYNC_CONFIG"
  run lib true; [ "$status" -ne 0 ]
  printf '[[repo]]\nname = "x;y"\npath = "/tmp"\n' > "$REPOSYNC_CONFIG"
  run lib true; [ "$status" -ne 0 ]
}

# --- flux complet contre un faux ntfy : rattrapage puis reprise par since

@test "daemon : rattrapage au démarrage, puis message du flux appliqué ; since=<dernier id> à la reprise" {
  sha1=$(push_one a)                                # poussé pendant que reposync était arrêté
  www="$BATS_TEST_TMPDIR/www"; mkdir -p "$www"
  port=$(( 20000 + RANDOM % 20000 ))
  cat > "$www/srv.py" <<'PY'
import http.server, sys, json, os
www, port = sys.argv[1], int(sys.argv[2])
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        with open(os.path.join(www, "requests"), "a") as f:
            f.write(self.path + " auth=" + ("ok" if self.headers.get("Authorization") == "Bearer tk_test" else "absent") + "\n")
        body = open(os.path.join(www, "stream")).read().encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
http.server.HTTPServer(("127.0.0.1", port), H).serve_forever()
PY
  sha2=$(push_one b)
  { echo '{"id":"o","event":"open","time":1}'; msg "walid-mos/test $sha2" id2; } > "$www/stream"
  python3 -I "$www/srv.py" "$www" "$port" & srv=$!
  sed -i '' "s#http://127.0.0.1:9#http://127.0.0.1:$port#" "$REPOSYNC_CONFIG"
  RELAY_TOKEN_TEST=tk_test REPOSYNC_RETRY=1 timeout 4 zsh "$RS" daemon || true
  kill "$srv"
  [ "$(git -C "$C" rev-parse HEAD)" = "$sha2" ]
  head -1 "$www/requests" | grep -q '^/repo-updates/json?since=[0-9]* auth=ok$'
  sed -n 2p "$www/requests" | grep -q '^/repo-updates/json?since=id2 auth=ok$'
  ! grep -q tk_test "$REPOSYNC_LOG"
}

@test "daemon : sans jeton, refuse de démarrer" {
  run env -u RELAY_TOKEN_TEST zsh "$RS" daemon
  [ "$status" -ne 0 ]
}

@test "aucun jeton dans ps pendant le flux" {
  www="$BATS_TEST_TMPDIR/www2"; mkdir -p "$www"; port=$(( 20000 + RANDOM % 20000 ))
  python3 -I -c "import http.server,time
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        self.send_response(200); self.end_headers(); time.sleep(3)
http.server.HTTPServer(('127.0.0.1',$port),H).serve_forever()" & srv=$!
  sed -i '' "s#http://127.0.0.1:9#http://127.0.0.1:$port#" "$REPOSYNC_CONFIG"
  RELAY_TOKEN_TEST=tk_secret_ps zsh "$RS" daemon & d=$!
  snap="$BATS_TEST_TMPDIR/ps"; for i in $(seq 1 30); do ps -axww -o args= >> "$snap"; sleep 0.1; done
  pkill -P "$d" 2>/dev/null; kill "$d" "$srv" 2>/dev/null; wait 2>/dev/null || true
  grep -q "repo-updates/json" "$snap"     # contrôle positif : curl était bien lancé
  ! grep -q tk_secret_ps "$snap"
}
