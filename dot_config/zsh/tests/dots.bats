#!/usr/bin/env bats
# Tests of `dots` (saves the dotfiles into the chezmoi repository and pushes them).
# Everything is local: a throwaway HOME with its own chezmoi config, a source repository cloned from a bare
# "remote", and the real chezmoi, git, gitleaks and jq. What was saved is read from the remote with git,
# never from the output of dots.
#
# Run: bats ~/.config/zsh/tests/dots.bats
#
# No `[[ ... ]]` assertion here: with the bash 3.2 of macOS, bats only notices one that fails on a test's last line.

bats_require_minimum_version 1.5.0

DOTS="${BATS_TEST_DIRNAME}/../bin/dots"

setup() {
  export HOME="$BATS_TEST_TMPDIR/home"
  unset ZDOTDIR XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
  export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/gitconfig" GIT_CONFIG_NOSYSTEM=1
  git config --global user.name t; git config --global user.email t@t; git config --global init.defaultBranch main
  git config --global commit.gpgsign false
  R="$BATS_TEST_TMPDIR/remote.git"; SRC="$BATS_TEST_TMPDIR/src"
  git init -q --bare "$R"
  git clone -q "$R" "$SRC" 2>/dev/null
  mkdir -p "$HOME/.config/chezmoi" "$HOME/.claude" "$SRC/dot_claude"
  # The directories in which dots looks for new files: it stops when one is missing.
  mkdir -p "$HOME"/.config/{zsh,nvim,git,atuin,btop,fastfetch,lazygit} "$HOME"/.config/herdr-app/{themes,layouts}
  printf 'sourceDir = "%s"\n' "$SRC" > "$HOME/.config/chezmoi/chezmoi.toml"

  printf 'one\n' > "$SRC/dot_one"
  printf 'two\n' > "$SRC/dot_two"
  printf 'os={{ .chezmoi.os }}\n' > "$SRC/dot_tpl.tmpl"
  printf 'notes\n' > "$SRC/README.md"
  printf 'README.md\n' > "$SRC/.chezmoiignore"
  # ~/.claude/settings.json as in the real repository: a base file plus the keys each machine keeps (model).
  printf 'claudeLocalKeys = ["model"]\n' > "$SRC/.chezmoidata.toml"
  jq -n '{theme: "dark"}' > "$SRC/dot_claude/.settings.base.json"   # jq's own layout, as dots writes it
  cat > "$SRC/dot_claude/modify_settings.json" <<'EOF'
{{- /* chezmoi:modify-template */ -}}
{{- $settings := include "dot_claude/.settings.base.json" | fromJson -}}
{{- if .chezmoi.stdin -}}
{{-   $current := .chezmoi.stdin | fromJson -}}
{{-   range .claudeLocalKeys -}}
{{-     if hasKey $current . -}}{{- $_ := set $settings . (get $current .) -}}{{- end -}}
{{-   end -}}
{{- end -}}
{{ toPrettyJson $settings }}
EOF
  printf '{"model":"local-model","theme":"dark"}\n' > "$HOME/.claude/settings.json"
  git -C "$SRC" add -A; git -C "$SRC" commit -q -m "chore: init"; git -C "$SRC" push -q origin main
  chezmoi apply
  BASE=$(git -C "$R" rev-parse HEAD)
}

remote_head()    { git -C "$R" rev-parse HEAD; }
remote_subject() { git -C "$R" log -1 --format=%s; }
remote_files()   { git -C "$R" show --name-only --format= HEAD | sort | tr '\n' ' '; }
remote_show()    { git -C "$R" show "HEAD:$1"; }
# A token gitleaks detects, assembled here so that this file holds no such token itself.
fake_token()     { printf 'ghp_%s%s' x7Kq2mVb9Lr4Tz8Wc1 Yd5Hn3Fj6Gs0PaUeXi; }

# --- dots -m: one commit with only the named files

@test "-m: one pushed commit with the given message and only the named file" {
  printf 'one changed\n' > "$HOME/.one"
  printf 'two changed\n' > "$HOME/.two"
  printf 'notes changed\n' > "$SRC/README.md"
  run "$DOTS" -m "feat(zsh): change one" "$HOME/.one"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "feat(zsh): change one" ]
  [ "$(remote_files)" = "dot_one " ]
  [ "$(remote_show dot_one)" = "one changed" ]
  # The rest stays as it was: .two is not copied into the repository, README.md is still an uncommitted edit.
  [ "$(cat "$SRC/dot_two")" = "two" ]
  [ "$(git -C "$SRC" status --porcelain)" = " M README.md" ]
}

@test "-m: a file chezmoi does not manage yet is added to the repository" {
  printf 'three\n' > "$HOME/.three"
  run "$DOTS" -m "feat: add three" "$HOME/.three"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "feat: add three" ]
  [ "$(remote_files)" = "dot_three " ]
}

@test "-m: a file of another git repository is refused, not added to the dotfiles" {
  git init -q "$HOME/project"; printf 'x\n' > "$HOME/project/file"
  run "$DOTS" -m "feat: add a project file" "$HOME/project/file"
  [ "$status" -ne 0 ]
  [ "$(remote_head)" = "$BASE" ]
  [ -z "$(git -C "$SRC" status --porcelain)" ]
}

@test "-m: a file of the repository itself is committed as it is" {
  printf 'notes changed\n' > "$SRC/README.md"
  run "$DOTS" -m "docs: explain the notes" "$SRC/README.md"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "docs: explain the notes" ]
  [ "$(remote_files)" = "README.md " ]
}

@test "-m: a template edited in the repository and applied is committed" {
  printf 'system={{ .chezmoi.os }}\n' > "$SRC/dot_tpl.tmpl"
  chezmoi apply "$HOME/.tpl"
  run "$DOTS" -m "refactor: rename the key" "$SRC/dot_tpl.tmpl"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "refactor: rename the key" ]
  [ "$(remote_files)" = "dot_tpl.tmpl " ]
}

@test "-m: a file removed from the repository with chezmoi forget is committed as a deletion" {
  chezmoi forget --force "$HOME/.two"
  run "$DOTS" -m "chore: stop managing two" "$SRC/dot_two"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "chore: stop managing two" ]
  [ "$(remote_files)" = "dot_two " ]
  run git -C "$R" cat-file -e HEAD:dot_two
  [ "$status" -ne 0 ]
}

@test "-m ~/.claude/settings.json: saved without the keys the machine keeps for itself" {
  printf '{"model":"local-model","theme":"light"}\n' > "$HOME/.claude/settings.json"
  run "$DOTS" -m "feat(claude): use the light theme" "$HOME/.claude/settings.json"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "feat(claude): use the light theme" ]
  [ "$(remote_files)" = "dot_claude/.settings.base.json " ]
  [ "$(remote_show dot_claude/.settings.base.json | jq -c .)" = '{"theme":"light"}' ]
}

# --- dots -m: refusals, before anything is committed

@test "-m: a message that is not a Conventional Commit is refused and nothing changes" {
  printf 'one changed\n' > "$HOME/.one"
  run "$DOTS" -m "update stuff" "$HOME/.one"
  [ "$status" -ne 0 ]
  [ "$(remote_head)" = "$BASE" ]
  [ -z "$(git -C "$SRC" status --porcelain)" ]
}

@test "-m without a file is refused and nothing changes" {
  printf 'one changed\n' > "$HOME/.one"
  run "$DOTS" -m "feat: change one"
  [ "$status" -ne 0 ]
  [ "$(remote_head)" = "$BASE" ]
  [ -z "$(git -C "$SRC" status --porcelain)" ]
}

@test "-m: a secret blocks the commit and is left unstaged" {
  printf 'token = "%s"\n' "$(fake_token)" > "$HOME/.one"
  run "$DOTS" -m "feat: change one" "$HOME/.one"
  [ "$status" -ne 0 ]
  [ "$(remote_head)" = "$BASE" ]
  [ "$(git -C "$SRC" rev-parse HEAD)" = "$BASE" ]
  git -C "$SRC" diff --cached --quiet
}

@test "-m: removing a secret is not blocked by the secret being removed" {
  # The token is already in the repository (committed here without dots); the change only deletes it.
  printf 'token = "%s"\n' "$(fake_token)" > "$HOME/.one"
  chezmoi re-add "$HOME/.one"
  git -C "$SRC" commit -q -am "chore: fixture with a token"; git -C "$SRC" push -q origin main
  printf 'one\n' > "$HOME/.one"
  run "$DOTS" -m "fix: drop the token" "$HOME/.one"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "fix: drop the token" ]
}

@test "-m: a deployed file rendered from a template and edited in place is refused, not skipped" {
  printf 'edited in place\n' >> "$HOME/.tpl"
  run "$DOTS" -m "feat: change tpl" "$HOME/.tpl"
  [ "$status" -ne 0 ]
  grep -qF dot_tpl.tmpl <<<"$output"
  [ "$(remote_head)" = "$BASE" ]
}

@test "-m: a repository file that is not applied on this machine is refused" {
  printf 'one changed in the repository\n' > "$SRC/dot_one"
  run "$DOTS" -m "feat: change one" "$SRC/dot_one"
  [ "$status" -ne 0 ]
  grep -qF "chezmoi apply" <<<"$output"
  [ "$(remote_head)" = "$BASE" ]
}

@test "-m: a commit that could not be pushed is pushed by the next run" {
  printf 'one changed\n' > "$HOME/.one"
  git -C "$SRC" remote set-url origin "$BATS_TEST_TMPDIR/missing.git"
  run "$DOTS" -m "feat: change one" "$HOME/.one"
  [ "$status" -ne 0 ]
  git -C "$SRC" remote set-url origin "$R"
  run "$DOTS" -m "feat: change one" "$HOME/.one"
  [ "$status" -eq 0 ]
  [ "$(remote_subject)" = "feat: change one" ]
  [ "$(remote_head)" = "$(git -C "$SRC" rev-parse HEAD)" ]
}

# --- dots: everything at once

@test "without -m: everything pending goes into one Conventional Commit" {
  printf 'one changed\n' > "$HOME/.one"
  printf 'two changed\n' > "$HOME/.two"
  run "$DOTS"
  [ "$status" -eq 0 ]
  remote_subject | grep -Eq '^chore\(dots\): .+'
  [ "$(remote_files)" = "dot_one dot_two " ]
}
