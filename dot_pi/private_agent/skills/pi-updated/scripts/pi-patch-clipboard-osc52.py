#!/usr/bin/env python3
"""Route clipboard copies through OSC 52 first inside herdr panes (HERDR_ENV).

House patch, see scripts/SOURCE.md. In a herdr pane a native clipboard write
targets the server machine; herdr intercepts OSC 52 and applies it on the
machine running the client, so OSC 52 must go first. Also removes the
WT_SESSION Windows Terminal branch (superseded by the generic WSL fallback).
"""

from __future__ import annotations

import glob
import os
import sys
from pathlib import Path

HERDR_MARKER = """export async function copyToClipboard(text) {
    const p = platform();
    const env = process.env;
    let copied = false;"""

HERDR_PATCHED = """export async function copyToClipboard(text) {
    const p = platform();
    const env = process.env;
    // herdr patch (pi-updated, scripts/SOURCE.md): a native write would target
    // the server machine's clipboard. herdr intercepts OSC 52 and applies it on
    // the machine running the client, so it goes first.
    if (env.HERDR_ENV) {
        if (emitOsc52(text))
            return;
        throw new Error("Clipboard unavailable: text exceeds the OSC 52 size limit");
    }
    let copied = false;"""

WT_MARKER = """        // Windows Terminal supports OSC 52; prefer it over the slower PowerShell round trip.
        if (env.WT_SESSION)
            osc52Emitted = emitOsc52(text);
        copied = osc52Emitted || (await copyViaWindowsClipboard(text));"""

WT_PATCHED = """        copied = await copyViaWindowsClipboard(text);"""


def patch_source(source: str) -> tuple[str, list[str]]:
    applied: list[str] = []
    updated = source

    if HERDR_PATCHED not in updated:
        if HERDR_MARKER not in updated:
            raise ValueError("copyToClipboard header not found")
        updated = updated.replace(HERDR_MARKER, HERDR_PATCHED, 1)
        applied.append("herdr-osc52-first")

    if WT_MARKER in updated:
        updated = updated.replace(WT_MARKER, WT_PATCHED, 1)
        applied.append("wt-session-removed")

    return updated, applied


def candidate_files() -> list[Path]:
    files: list[Path] = []
    patterns = (
        Path.home()
        / ".local/share/pnpm/global/**/node_modules/@earendil-works/pi-coding-agent/dist/utils/clipboard.js",
        Path.home()
        / ".local/share/pnpm/global/**/node_modules/.pnpm/node_modules/@earendil-works/pi-coding-agent/dist/utils/clipboard.js",
        Path.home()
        / "Library/pnpm/global/**/node_modules/@earendil-works/pi-coding-agent/dist/utils/clipboard.js",
        Path.home()
        / "Library/pnpm/global/**/node_modules/.pnpm/node_modules/@earendil-works/pi-coding-agent/dist/utils/clipboard.js",
    )
    for pattern in patterns:
        files.extend(Path(match) for match in glob.glob(str(pattern), recursive=True))

    unique: list[Path] = []
    seen: set[str] = set()
    for path in files:
        key = str(path.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def patch_file(path: Path) -> str:
    original = path.read_text(encoding="utf-8")
    updated, applied = patch_source(original)
    if not applied:
        return f"already patched: {path}"
    path.write_text(updated, encoding="utf-8")
    return f"patched ({', '.join(applied)}): {path}"


def main() -> int:
    if os.environ.get("PI_PATCH_SELF_TEST") == "1":
        sample = HERDR_MARKER + "\n" + WT_MARKER
        updated, applied = patch_source(sample)
        if applied != ["herdr-osc52-first", "wt-session-removed"]:
            print(f"self-test failed: {applied}", file=sys.stderr)
            return 1
        if patch_source(updated) != (updated, []):
            print("self-test failed: patch is not idempotent", file=sys.stderr)
            return 1
        print("self-test ok")
        return 0

    files = candidate_files()
    if not files:
        print("pi-coding-agent clipboard.js introuvable — patch ignoré", file=sys.stderr)
        return 1

    failed = False
    for path in files:
        try:
            print(patch_file(path))
        except ValueError as error:
            failed = True
            print(f"échec {path}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
