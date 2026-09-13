#!/bin/zsh
# bootstrap.sh - one-command setup for a fresh Mac.
#
# Usage (from an interactive terminal on a brand-new Mac):
#   curl -fsSL https://raw.githubusercontent.com/walid-mos/dotfiles/main/bootstrap.sh -o /tmp/bootstrap.sh \
#     && zsh /tmp/bootstrap.sh [--dry-run] [profile]
#
# Profiles: laptop (default, full setup + fonts) and server (minimal).
#
# This entry point only downloads the bootstrap modules, then hands over to
# bootstrap/profiles.sh, which holds the actual setup logic. It never prompts,
# so it is the only file that is safe to pipe into a shell.

set -eu

MODULES_URL="https://raw.githubusercontent.com/walid-mos/dotfiles/main/bootstrap"
MODULES=(lib.sh packages.sh configure.sh hermes.sh profiles.sh)

bootstrap_dir="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap.XXXXXX")"
trap 'rm -rf "$bootstrap_dir"' EXIT

for module in "${MODULES[@]}"; do
    printf 'Downloading %s\n' "$module"
    curl -fsSL "$MODULES_URL/$module" -o "$bootstrap_dir/$module"
done

zsh "$bootstrap_dir/profiles.sh" "$@"