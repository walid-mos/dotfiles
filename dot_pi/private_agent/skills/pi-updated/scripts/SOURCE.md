# Source

- Upstream: `walid-mos/mac-config` (GitHub), `scripts/pi-patch-prompt-history.py`
- Revision vendored: `18332b380be1d819ecf79bfecce177b38af57524` (2026-09-02)
- Vendored on: 2026-09-21
- Local divergence: added macOS pnpm store patterns (`~/Library/pnpm/global/**/…`) — upstream only globs `~/.local/share/pnpm`, so it found nothing on macOS. Re-copy from upstream would reintroduce that gap until upstream is fixed.