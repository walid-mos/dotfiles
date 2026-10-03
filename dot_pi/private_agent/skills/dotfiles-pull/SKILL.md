---
name: dotfiles-pull
description: >-
    Pull dotfiles changes from the remote (walid-mos/dotfiles) into the chezmoi
    source repo and apply them to the live config. Direction rule: the Mac
    Studio is the source of truth, so on the MacBook Pro remote is truth — pull
    always, without exception. Use when the user asks to pull / récupérer /
    sync les dotfiles depuis le repo. On the Mac Studio local is truth: use
    dotfiles-sync instead; this skill only runs there as explicit screw-up
    recovery.
---

# dotfiles Pull

chezmoi source repo: `~/.local/share/chezmoi`, remote `walid-mos/dotfiles`.
Companion skill: `dotfiles-sync` owns the push direction — never push from here.

**1. Detect the machine.**

```bash
hostname
```

- Hostname contains `macbook` → remote is truth. Pull unconditionally, no confirmation — go straight to step 3.
- Hostname is `mac-studio` → local is truth here. This run is only legitimate as screw-up recovery; go to step 2.

**2. (Mac Studio only) confirm.** Show `chezmoi git -- status --short`, state that these local source changes will be set aside, and proceed only on explicit approval.

**3. Make remote win.** In the source repo:

```bash
chezmoi git -- stash push --include-untracked -m "pre-pull $(date +%F-%H%M)"   # only when status is non-empty
chezmoi git -- pull --ff-only
```

If `pull --ff-only` fails (diverged history), force remote truth:

```bash
chezmoi git -- reset --hard origin/$(chezmoi git -- branch --show-current)
```

The stash keeps whatever was discarded recoverable. Never pop, drop, or delete it in this flow.

**4. Apply.**

```bash
chezmoi apply
```

**5. Report.** One line: up to date or the `--stat` summary of what the pull brought in, plus the stash name if one was created. Never echo the content of stashed files (secrets may be among them).
