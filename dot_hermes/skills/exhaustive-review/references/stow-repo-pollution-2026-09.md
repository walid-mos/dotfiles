# Stow repository pollution — 2026-09-03 incident

The user's GNU Stow dotfiles repo lives at `~/.stow_repository/` (target `~`).
Packages under it are symlinked into `$HOME`, so `pi/.pi/agent/skills/` inside
the repo IS `~/.pi/agent/skills/` — and `.hermes/` is likewise Stow-owned.
Consequence: any agent (Pi or Hermes) writing scratch artifacts into its own
skill directories or cwd pollutes the user's git repository.

## What happened

On 2026-09-02 an exhaustive-review audit run from `~/.stow_repository/` wrote
`.review-lots/`, `.review-manifest.csv`, and `.review-reports/` at the repo root.
The Hermes-installed copy of the skill was an old version whose `inventory.sh` /
`coverage.sh` defaulted the manifest to `.review-manifest.csv` in the cwd and
accepted a custom manifest path argument. The versioned copy in
`pi/.pi/agent/skills/exhaustive-review/` had already been fixed (unique JSONL
manifest under `$TMPDIR`, auto-delete, locking test), but the installed copy
under `~/.hermes/skills/` had drifted behind it.

On 2026-09-03 the user had another agent destow the vault config entirely
(commit `598a377c` — Makefile obsidian targets, `obsidian/` package and the 11
vault symlinks removed; iCloud is now the single source for `.obsidian/`). Then
they demanded: no agent may ever write into the Stow repository again, and asked
which skills write there. Cleanup left only the user's two personal uncommitted
files (`hermes/.hermes/config.yaml`, `pi/.pi/agent/settings.json`);
`.review-reports/` (empty, audit residue) awaited user approval for removal.

## Lessons

1. **Sync check before running versioned tooling.** `diff -r` the installed
   skill against the repo copy first; the versioned copy wins.
2. **Temp files never in cwd.** Anything a review script writes must go to
   `$TMPDIR` and be auto-deleted; never a dotfile at the repo root.
3. **Stow means write-through.** Under this setup, editing
   `~/.pi/agent/...` or `~/.hermes/...` edits the git repo. Before writing any
   file under `$HOME`, consider whether Stow folds that path into
   `~/.stow_repository/` — scratch data must go to `$TMPDIR`.
