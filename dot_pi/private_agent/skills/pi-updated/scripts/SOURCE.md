# Source

## pi-patch-prompt-history.py

- Upstream: `walid-mos/mac-config` (GitHub), `scripts/pi-patch-prompt-history.py`
- Revision vendored: `18332b380be1d819ecf79bfecce177b38af57524` (2026-09-02)
- Vendored on: 2026-09-21
- Local divergence: added macOS pnpm store patterns (`~/Library/pnpm/global/**/…`) — upstream only globs `~/.local/share/pnpm`, so it found nothing on macOS. Re-copy from upstream would reintroduce that gap until upstream is fixed.

## pi-patch-clipboard-osc52.py

- House-authored 2026-09-26 (no upstream source; policy: `harness-tuning` § Modifying pi or herdr).
- Upstream file: `packages/coding-agent/src/utils/clipboard.ts` in `walid-mos/pi` (fork of earendil-works/pi); installed target `dist/utils/clipboard.js`.
- Change: in `copyToClipboard`, when `HERDR_ENV` is set emit OSC 52 first and return — a native write targets the herdr server machine, while herdr forwards OSC 52 to the client's clipboard. Also removes the `WT_SESSION` Windows Terminal branch (the generic WSL PowerShell fallback remains).
- Audited against: pi 0.87.1. Reapply via `pi-updated` step 6 after every pi update.
- Origin: validated fix first made as repo commit `674a56b88` (branch `feat/herdr-clipboard-osc52`, deleted after conversion to this patch).

## pi-patch-remove-copy-command.py

- House-authored 2026-09-26 (no upstream source; policy: `harness-tuning` § Modifying pi or herdr; ordered directly by the user — never used).
- Upstream file: `packages/coding-agent/src/core/slash-commands.ts` in `walid-mos/pi` (fork of earendil-works/pi); installed target `dist/core/slash-commands.js`.
- Change: removes the `/copy` command registration ("Copy last agent message to clipboard"). The unreachable handler in interactive mode is left in place. Copying works via mouse copy-on-select and Cmd+V; no keyboard or slash command is needed.
- Audited against: pi 0.87.1. Reapply via `pi-updated` step 6 after every pi update.