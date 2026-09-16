#!/bin/zsh
# A source file that .chezmoiignore also matches never reaches a machine, and
# silently: `chezmoi apply` reports success while the file is simply absent.
# That is how the managed pi npm workspace file was committed but never applied
# (.pi/agent/npm was ignored wholesale), leaving pi's extension tree broken.
# The files the setup depends on must therefore stay managed - and the ignore
# section that keeps the repository's own files out of $HOME must keep working.
set -eu

repo_root=${0:A:h:h:h}

if ! managed=$(chezmoi --source "$repo_root" managed --include=files 2>&1); then
    print -u2 "FAIL: chezmoi could not list the managed files: $managed"
    exit 1
fi

is_managed() { [[ $'\n'"$managed"$'\n' == *$'\n'"$1"$'\n'* ]] }

for path in .pi/agent/npm/pnpm-workspace.yaml .pi/agent/pnpm-workspace.yaml .pi/agent/settings.json; do
    is_managed "$path" || {
        print -u2 "FAIL: $path is in the repository but not managed (check .chezmoiignore)"
        exit 1
    }
done

if is_managed 'README.md'; then
    print -u2 "FAIL: the repository README would be applied to \$HOME"
    exit 1
fi

print 'PASS: the files the setup depends on reach the machine'
