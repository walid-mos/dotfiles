# =============================================================================
# wt - Git Worktree Manager completion
# =============================================================================
# Subcommand completion for `wt`, branch completion for `wt switch` / `wt
# clean`, and the `wts` / `wtc` aliases. Overrides the generic _help_only
# fallback, which cannot handle `wt switch --help` safely.

# List worktree branches for the current project (excluding the main checkout)
_wt_branches() {
  git rev-parse --git-dir >/dev/null 2>&1 || return 1

  local wt_git_root
  wt_git_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1

  local -a wt_branches
  wt_branches=(${(f)"$(git worktree list --porcelain 2>/dev/null | awk -v root="$wt_git_root" '
    /^worktree / { path = substr($0, 10) }
    /^branch / {
      branch = substr($0, 8)
      sub(/^refs\/heads\//, "", branch)
      if (path != root) print branch
      path = ""; branch = ""
    }
  ')"})

  (( ${#wt_branches} )) || { _message 'no worktrees found'; return 1; }
  _describe -t wt_branches 'worktree branch' wt_branches
}

_wt() {
  local curcontext="$curcontext" state line
  local -a wt_subcommands
  wt_subcommands=(
    'new:Create a new worktree for a branch'
    'spawn:Create worktree and launch a session (spawn hooks, fallback: pi)'
    'switch:Switch to an existing worktree'
    'list:List worktrees for current project'
    'status:Show git status for all worktrees'
    'clean:Remove worktrees'
    'prune:Remove worktrees for deleted remote branches'
    'help:Show help message'
  )

  _arguments -C \
    '1: :->command' \
    '*:: :->args'

  case $state in
    command)
      _describe -t commands 'wt command' wt_subcommands
      ;;
    args)
      case $words[1] in
        new|spawn)
          _message 'branch name'
          ;;
        switch)
          _wt_branches
          ;;
        clean)
          _arguments \
            '(-y --yes)'{-y,--yes}'[auto-confirm]' \
            '*: :_wt_branches'
          ;;
        prune)
          _arguments \
            '(-i --interactive)'{-i,--interactive}'[confirm each worktree]'
          ;;
      esac
      ;;
  esac
}

compdef _wt wt ws wtn wts wtl wtc wtp wtst 2>/dev/null