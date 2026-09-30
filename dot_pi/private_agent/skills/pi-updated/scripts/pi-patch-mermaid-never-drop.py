#!/usr/bin/env python3
"""Mermaid diagrams: warnings are advisory — render, never drop (house patch).

House patch, see scripts/SOURCE.md. Three changes to pi's mermaid call site
(`dist/modes/interactive/components/mermaid.js` and its inlined copy in
`dist/bundle/chunks/chunk-OJP47DM6.js`):

1. Never drop. grok-mermaid's documented contract (types.d.ts): "warnings are
   advisory, never a reason to withhold the art". pi replaced the whole diagram
   with `Mermaid diagram not rendered: …` whenever a warning existed. Now the
   diagram is drawn and the warning is appended below it.
2. Quoted two-dash link labels. `A -- "label" --> B` is valid Mermaid that
   grok-mermaid@0.2.3 cannot parse ("dropped, link has no target"). The source
   is rewritten to the equivalent pipe form `A -->|"label"| B` before render,
   which grok-mermaid parses. Fires only on that exact form; pipe labels and
   unquoted middle labels already parse and stay untouched.
3. Dangling arrows. A line ending in `-->`/`---` (optionally with a trailing
   pipe label) is an incomplete statement: grok-mermaid drops the link and
   warns. The trailing connector is truncated (the source node stays), so a
   partially broken diagram renders clean instead of art-plus-warning. Other
   warnings still show under the art (change 1). Comment (`%% …`) lines and
   arrows followed by a real target are left untouched. The left operand is
   any non-separator character (word chars, `)`, `]`, quotes, `*`, …).

Installs already at stage 1 (quoted-label normalize only) are upgraded in
place; installs with the earlier truncator class are healed; idempotent on
rerun (keyed on `truncateDanglingArrows` plus a healthy class).
"""

from __future__ import annotations

import glob
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------- readable ---

READ_HELPER_ANCHOR = "/** Create a transformer that replaces top-level Mermaid code blocks with Unicode terminal diagrams. */"

READ_NORM_HELPER = '''/**
 * `A -- "quoted label" --> B` is valid Mermaid that grok-mermaid@0.2.3 cannot
 * parse ("dropped, link has no target"). Rewrite it to the equivalent pipe
 * form `A -->|"quoted label"| B`, which parses cleanly. The rewrite fires only
 * on that exact form (word endpoints, no `|` or `"` inside the label): pipe
 * labels and unquoted middle labels already parse and are left untouched.
 */
function normalizeQuotedLinkLabels(src) {
    return src.replace(
        /([ \\t\\n]|^)([A-Za-z0-9_]+)[ \\t]+--[ \\t]*"([^"|"\\n]*)"[ \\t]*(-->|---)[ \\t]*([A-Za-z0-9_]+)/g,
        (m, pre, from, label, arrow, to) => `${pre}${from} ${arrow}|"${label}"| ${to}`,
    );
}'''

READ_TRUNC_HELPER = '''/**
 * A line ending in `-->` or `---` (optionally a trailing pipe label) is an
 * incomplete statement: grok-mermaid drops its link and warns. Truncate the
 * trailing connector - the source node and every complete line stay - so a
 * partially broken diagram renders clean. Comment lines (`%% …`) keep their
 * text verbatim. The left operand may be any non-separator character, so
 * `[*] -->`, `"quoted" -->` and `(paren) -->` are all handled.
 */
function truncateDanglingArrows(src) {
    return src
        .split("\\n")
        .map((line) =>
            line.trimStart().startsWith("%%")
                ? line
                : line.replace(/([^\\n\\-| \\t])([ \\t]*)(-->|---)([ \\t]*\\|[^|]*\\|)?[ \\t]*$/, "$1$2"),
        )
        .join("\\n");
}'''

READ_HELPER_NEW = READ_NORM_HELPER + "\n" + READ_TRUNC_HELPER + "\n" + READ_HELPER_ANCHOR

READ_CALL_OLD = "            const art = render(token.text);"

V1_CALL = "render(normalizeQuotedLinkLabels(token.text))"
FINAL_CALL = "render(truncateDanglingArrows(normalizeQuotedLinkLabels(token.text)))"

READ_CALL_NEW = (
    "            // Quoted two-dash link labels otherwise parse as art.warnings; rewrite first.\n"
    "            // A dangling arrow is an incomplete statement; truncate it before render.\n"
    f"            const art = {FINAL_CALL};"
)

READ_DROP_OLD = """            if (!context.isStreaming && art.warnings.length > 0) {
                const suffix = art.warnings.length > 1 ? ` (+${art.warnings.length - 1} more)` : "";
                const warning = `Mermaid diagram not rendered: ${art.warnings[0]}${suffix}`;
                const styledWarning = options.theme ? options.theme.fg("warning", warning) : warning;
                return `${token.raw}\\n${codeSpan(styledWarning)}  \\n`;
            }
            const lines = options.theme ? themedLines(art, options.theme) : art.plain;
            // Markdown hard breaks keep every diagram row on its own line.
            return `${lines.map(codeSpan).join("  \\n")}\\n`;"""

READ_DROP_NEW = """            // grok-mermaid contract (types.d.ts): warnings are advisory and never
            // a reason to withhold the art. Draw the diagram, then append the
            // warnings below it (settled only) - the block is never dropped.
            const lines = options.theme ? themedLines(art, options.theme) : art.plain;
            let out = `${lines.map(codeSpan).join("  \\n")}\\n`;
            if (!context.isStreaming && art.warnings.length > 0) {
                const suffix = art.warnings.length > 1 ? ` (+${art.warnings.length - 1} more)` : "";
                const warning = `Mermaid diagram warning: ${art.warnings[0]}${suffix}`;
                out += `${codeSpan(options.theme ? options.theme.fg("warning", warning) : warning)}  \\n`;
            }
            return out;"""

# ----------------------------------------------------------------- minified --

MINI_HELPER_ANCHOR = "function createMermaidMarkdownTransformer(options){"

MINI_NORM_HELPER = 'function normalizeQuotedLinkLabels(src){return src.replace(/([ \\t\\n]|^)([A-Za-z0-9_]+)[ \\t]+--[ \\t]*"([^"|"\\n]*)"[ \\t]*(-->|---)[ \\t]*([A-Za-z0-9_]+)/g,(m,pre,from,label,arrow,to)=>`${pre}${from} ${arrow}|"${label}"| ${to}`)}'
MINI_TRUNC_HELPER = "function truncateDanglingArrows(src){return src.split(\"\\n\").map((line)=>line.trimStart().startsWith(\"%%\")?line:line.replace(/([^\\n\\-| \\t])([ \\t]*)(-->|---)([ \\t]*\\|[^|]*\\|)?[ \\t]*$/,\"$1$2\")).join(\"\\n\")}"

MINI_HELPER_NEW = MINI_NORM_HELPER + MINI_TRUNC_HELPER + MINI_HELPER_ANCHOR

MINI_CALL_OLD = "let art=render(token.text);if(!art||art.width>context.availableWidth)return token.raw;"
MINI_CALL_NEW = f"let art={FINAL_CALL};if(!art||art.width>context.availableWidth)return token.raw;"

# Different pi builds spell `\n` inside template literals differently (escape vs
# real newline). The minified drop anchor is defined with '@@NL@@' placeholders
# and instantiated in both spellings at patch time (exactly one matches).
MINI_DROP_NEW = 'let out=`${(options.theme?themedLines(art,options.theme):art.plain).map(codeSpan).join(`  \\n`)}\\n`;if(!context.isStreaming&&art.warnings.length>0){let suffix=art.warnings.length>1?` (+${art.warnings.length-1} more)`:"",warning=`Mermaid diagram warning: ${art.warnings[0]}${suffix}`;out+=`  \\n`+codeSpan(options.theme?options.theme.fg("warning",warning):warning)}return out'

MINI_DROP_OLD_T = 'if(!context.isStreaming&&art.warnings.length>0){let suffix=art.warnings.length>1?` (+${art.warnings.length-1} more)`:"",warning=`Mermaid diagram not rendered: ${art.warnings[0]}${suffix}`,styledWarning=options.theme?options.theme.fg("warning",warning):warning;return`${token.raw}@@NL@@${codeSpan(styledWarning)}  @@NL@@`}return`${(options.theme?themedLines(art,options.theme):art.plain).map(codeSpan).join(`  @@NL@@`)}@@NL@@`'

MINI_HELPER_OLD = MINI_HELPER_ANCHOR

# Self-healing: installs patched while the first truncator class was malformed
# (`([A-Za-z0-9_)]\]"']) — the unescaped `]` closed the class, so the helper
# matched nothing. Evidence string appears only in that broken class.
# Replacement goes through a function so re.sub cannot reinterpret escapes
# (`\n` in a template becomes a real newline and would break the JS regex).
HEAL_EVIDENCE = "A-Za-z0-9_)]"
HEAL_RE = re.compile(r"line\.replace\(/.*?\$\S*\),")
HEAL_MINI = re.compile(r'line\.replace\(/.*?\$\S*\)\)')

HEAL_LINE_READ = r'line.replace(/([^\n\-| \t])([ \t]*)(-->|---)([ \t]*\|[^|]*\|)?[ \t]*$/, "$1$2"),'
HEAL_LINE_MINI = r'line.replace(/([^\n\-| \t])([ \t]*)(-->|---)([ \t]*\|[^|]*\|)?[ \t]*$/,"$1$2"))'


def patch_target(path: Path) -> str:
    original = path.read_text(encoding="utf-8")
    if "truncateDanglingArrows" in original and HEAL_EVIDENCE in original:
        # Broken-class heal (see HEAL_EVIDENCE note above). The replacement runs
        # through a function so re.sub cannot reinterpret the `\\n` / `\\t`
        # escapes of the emitted regex (a template turns them into real
        # newline/tab and breaks the JS literal).
        pattern, line = (HEAL_RE, HEAL_LINE_READ) if path.name == "mermaid.js" else (HEAL_MINI, HEAL_LINE_MINI)
        healed = pattern.sub(lambda _: line, original, count=1)
        if healed == original:
            raise ValueError("broken truncator class present but heal produced no change — re-audit")
        path.write_text(healed, encoding="utf-8")
        return f"healed truncator class: {path}"
    if "truncateDanglingArrows" in original:
        return f"already patched: {path}"

    if path.name == "mermaid.js":
        if "normalizeQuotedLinkLabels" in original:
            # Stage 1 install: upgrade in place (helper + call site; drop block already v2).
            for label, old in (("render() call site", V1_CALL), ("transformer anchor", READ_HELPER_ANCHOR)):
                count = original.count(old)
                if count != 1:
                    raise ValueError(f"upgrade {label}: {count} matches (expected 1)")
            updated = original.replace(READ_HELPER_ANCHOR, READ_TRUNC_HELPER + "\n" + READ_HELPER_ANCHOR, 1)
            updated = updated.replace(V1_CALL, FINAL_CALL, 1)
            path.write_text(updated, encoding="utf-8")
            return f"upgraded (truncate-helper, call-site): {path}"

        # Readable copy: three exact, unique anchors, straight to final form.
        for label, old in (("render() call site", READ_CALL_OLD), ("drop block", READ_DROP_OLD), ("transformer anchor", READ_HELPER_ANCHOR)):
            count = original.count(old)
            if count != 1:
                raise ValueError(f"{label}: {count} matches (expected 1)")
        updated = original
        for old, new in ((READ_HELPER_ANCHOR, READ_HELPER_NEW), (READ_CALL_OLD, READ_CALL_NEW), (READ_DROP_OLD, READ_DROP_NEW)):
            updated = updated.replace(old, new, 1)
        path.write_text(updated, encoding="utf-8")
        return f"patched (normalize-helper, truncate-helper, call-site, never-drop): {path}"

    # Bundle chunk (minified): only the one carrying the mermaid component.
    if "normalizeQuotedLinkLabels" in original:
        # Stage 1 chunk: upgrade in place.
        for label, old in (("mini render() call site", V1_CALL), ("mini transformer anchor", MINI_HELPER_ANCHOR)):
            count = original.count(old)
            if count != 1:
                raise ValueError(f"upgrade {label}: {count} matches (expected 1)")
        updated = original
        updated = updated.replace(MINI_HELPER_ANCHOR, MINI_TRUNC_HELPER + MINI_HELPER_ANCHOR, 1)
        updated = updated.replace(V1_CALL, FINAL_CALL, 1)
        path.write_text(updated, encoding="utf-8")
        return f"upgraded (mini truncate-helper, mini call-site): {path}"

    if MINI_HELPER_OLD not in original:
        if "Mermaid diagram not rendered" in original:
            raise ValueError("chunk has a mermaid warning but no known anchor — re-audit")
        return f"no mermaid transformer, skipped: {path}"

    if original.count(MINI_CALL_OLD) != 1:
        raise ValueError(f"render() call site: {original.count(MINI_CALL_OLD)} matches (expected 1)")

    # The minified drop block arrives in two \n spellings; exactly one matches.
    matches = 0
    for spelling in (lambda t: t.replace("@@NL@@", "\\n"), lambda t: t.replace("@@NL@@", "\n")):
        matches += 1 if spelling(MINI_DROP_OLD_T) in original else 0
    if matches == 0:
        raise ValueError("drop block: no anchor variant matched — re-audit minified source")
    if matches > 1:
        raise ValueError("drop block: both spellings matched (impossible)")

    updated = original
    updated = updated.replace(MINI_HELPER_OLD, MINI_HELPER_NEW, 1)
    updated = updated.replace(MINI_CALL_OLD, MINI_CALL_NEW, 1)
    for spelling in (lambda t: t.replace("@@NL@@", "\\n"), lambda t: t.replace("@@NL@@", "\n")):
        candidate = spelling(MINI_DROP_OLD_T)
        if candidate in updated:
            updated = updated.replace(candidate, MINI_DROP_NEW, 1)
            break
    path.write_text(updated, encoding="utf-8")
    return f"patched (mini normalize-helper, mini truncate-helper, mini call-site, mini never-drop): {path}"


def candidate_files() -> list[Path]:
    files: list[Path] = []
    home = Path.home()
    for pattern in (
        ".local/share/pnpm/global/**/node_modules/@earendil-works/pi-coding-agent/dist",
        "Library/pnpm/global/**/node_modules/@earendil-works/pi-coding-agent/dist",
        "Library/pnpm/global/**/node_modules/.pnpm/@earendil-works+pi-coding-agent@*/node_modules/@earendil-works/pi-coding-agent/dist",
    ):
        dist = [Path(m) for m in glob.glob(str(home / pattern), recursive=True)]
        for pkg_dist in dist:
            files.append(pkg_dist / "modes/interactive/components/mermaid.js")
            files.extend(pkg_dist.glob("bundle/chunks/chunk-*.js"))
    unique: list[Path] = []
    seen: set[str] = set()
    for path in files:
        key = str(path.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def main() -> int:
    files = candidate_files()
    if not files:
        print("pi-coding-agent dist introuvable — patch ignoré", file=sys.stderr)
        return 1

    failed = False
    for path in files:
        try:
            print(patch_target(path))
        except ValueError as error:
            failed = True
            print(f"échec {path}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
