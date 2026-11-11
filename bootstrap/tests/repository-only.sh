#!/bin/zsh
# The repository's own files must never reach $HOME: the "repository documentation" section of .chezmoiignore keeps them out.
set -eu

repo_root=${0:A:h:h:h}

if ! managed=$(chezmoi --source "$repo_root" managed --include=files 2>&1); then
    print -u2 "FAIL: chezmoi could not list the managed files: $managed"
    exit 1
fi

is_managed() { [[ $'\n'"$managed"$'\n' == *$'\n'"$1"$'\n'* ]] }

if is_managed 'README.md'; then
    print -u2 "FAIL: the repository README would be applied to \$HOME"
    exit 1
fi

print 'PASS: the repository files stay out of $HOME'
