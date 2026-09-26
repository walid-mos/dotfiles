#!/usr/bin/env python3
"""Remove the /copy slash command from pi (house decision: unused; Cmd+V + copy-on-select cover it).

House patch, see scripts/SOURCE.md. Only the command registration is removed;
the unreachable handler in interactive mode stays — smallest safe dist edit.
"""

from __future__ import annotations

import glob
import os
import sys
from pathlib import Path

COPY_MARKER = '    { name: "copy", description: "Copy last agent message to clipboard" },\n'


def patch_source(source: str) -> tuple[str, list[str]]:
    if COPY_MARKER not in source:
        if "name: \"copy\"" not in source:
            return source, []
        raise ValueError("copy command entry not found in expected form")
    return source.replace(COPY_MARKER, "", 1), ["copy-command-removed"]


def candidate_files() -> list[Path]:
    files: list[Path] = []
    patterns = (
        Path.home()
        / ".local/share/pnpm/global/**/node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js",
        Path.home()
        / ".local/share/pnpm/global/**/node_modules/.pnpm/node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js",
        Path.home()
        / "Library/pnpm/global/**/node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js",
        Path.home()
        / "Library/pnpm/global/**/node_modules/.pnpm/node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js",
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
        sample = "const list = [\n" + COPY_MARKER + "];\n"
        updated, applied = patch_source(sample)
        if applied != ["copy-command-removed"]:
            print(f"self-test failed: {applied}", file=sys.stderr)
            return 1
        if patch_source(updated) != (updated, []):
            print("self-test failed: patch is not idempotent", file=sys.stderr)
            return 1
        print("self-test ok")
        return 0

    files = candidate_files()
    if not files:
        print("pi-coding-agent slash-commands.js introuvable — patch ignoré", file=sys.stderr)
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
