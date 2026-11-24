#!/usr/bin/env bats
# Tests du SHELL : démarrage rapide, propre, et règles du rice tenues.
# Mesure avec hyperfine, en shell de login interactif (comme un terminal Herdr).
#
# Lancer : bats ~/.config/zsh/tests/startup.bats
# Prérequis : hyperfine, jq.

bats_require_minimum_version 1.5.0

BUDGET_MS=80        # objectif : médiane du démarrage sous 80 ms
RUNS=30

setup_file() {
  export BENCH_JSON="$BATS_FILE_TMPDIR/startup.json"
  hyperfine --shell=none --warmup 5 --runs "$RUNS" --export-json "$BENCH_JSON" \
    'zsh -l -i -c exit' >/dev/null 2>&1
}

median_ms() { jq '.results[0].summary.time_wall_clock.median * 1000 | floor' "$BENCH_JSON"; }

# --- Performance

@test "démarrage : médiane sous ${BUDGET_MS} ms (zsh -l -i)" {
  ms=$(median_ms)
  echo "médiane mesurée : ${ms} ms (budget ${BUDGET_MS} ms)" >&3
  [ "$ms" -lt "$BUDGET_MS" ]
}

# --- Démarrage propre

@test "démarrage dans un vrai terminal : aucune erreur affichée" {
  # script(1) fournit un pseudo-terminal, comme Herdr : zle et les plugins se chargent pour de vrai
  run script -q /dev/null zsh -l -i -c 'print -r -- READY' </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *READY* ]]
  [[ "$output" != *"command not found"* && "$output" != *"error"* && "$output" != *"can't"* ]]
}

@test "plugins, prompt et outils chargés" {
  run zsh -l -i -c 'whence -w fzf-tab-complete _zsh_autosuggest_start z zi szsh prompt_starship_precmd' 2>/dev/null
  [ "$status" -eq 0 ]
  [ "$(grep -c 'function' <<<"$output")" -eq 6 ]
}

# --- Règles du rice

@test "aucune commande de base remplacée par un alias (ls, cat, cd, grep, find)" {
  run zsh -l -i -c 'for c in ls cat cd grep find; do whence -w $c; done' 2>/dev/null
  [[ "$output" != *alias* ]]
}

# fastfetch se reconnaît à sa clé « machine » (voir ~/.config/fastfetch/config.jsonc).
# Avec stdin=/dev/null, le shell interactif lancé sous script(1) lit EOF et se termine.

@test "fastfetch affiché dans un terminal neuf (shell de login, comme un onglet Herdr)" {
  run script -q /dev/null zsh -l -i </dev/null
  [[ "$output" == *machine* ]]
}

@test "fastfetch absent d'un agent (zsh -lic, comme Herdr lance claude)" {
  run script -q /dev/null zsh -lic 'print -r -- FIN' </dev/null
  [[ "$output" == *FIN* && "$output" != *machine* ]]
}

@test "fastfetch absent d'un shell imbriqué (zsh sans login)" {
  run script -q /dev/null zsh -i </dev/null
  [[ "$output" != *machine* ]]
}
