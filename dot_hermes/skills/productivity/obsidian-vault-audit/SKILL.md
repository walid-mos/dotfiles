---
name: obsidian-vault-audit
description: Use when auditing an Obsidian vault's structure or notes.
---

## When to Use

- User asks to audit, review, reorganize, or optimize an Obsidian vault (folders, notes, links, conventions).
- User asks "how should I structure my notes / what's wrong with my vault".
- Before bulk-editing a vault: run the audit scan first so changes are backed by numbers.

# Obsidian Vault Audit

Workflow for auditing an Obsidian vault (structure, conventions, link health) and proposing optimizations. Built on the user's "Brain" vault (see `references/brain-vault-state.md` for its specific state).

## Read before judging

1. **Read the vault's own conventions note first** (in Brain: `_Conventions.md`, `_Canvas.md`). These are the source of truth for what the vault *intends* to be. The audit's job is to measure reality against them, not to impose a generic PARA/LYT template. If the user already wrote rules (max depth, naming, filing rules), audit against THOSE.
2. Never propose a reorganization without numbers. Run the scans below, quantify, then conclude.

## Mechanical scans (one execute_code pass)

Gather all of this with `glob`/`re` in a single Python pass, not by eye:

- **Inventory**: total md count, count per top-level folder, file types.
- **Frontmatter hygiene**: notes with/without frontmatter, empty notes.
- **Orphan detection**: build a counter of wikilink targets `re.findall(r"\[\[([^\]|#]+)", content)` across all notes, then list notes whose basename is never targeted. Report orphans excluding intentionally-isolated zones (Inbox, Archive) — the rest is the real backlog.
- **Signal/noise ratio**: identify auto-generated "flux" notes (bookmarks, captures, imports) vs hand/formatted "fond" notes. When flux > 80% of the vault, that's the headline finding — it pollutes search, graph, and any future RAG.
- **Convention violations**: folder depth > stated max, duplicated folder/note names across zones (`collections.Counter` on basenames), assets floating at vault root, promised-but-missing folders.
- **Activity**: mtime buckets per month (`collections.Counter` of `YYYY-MM`) — shows where the vault actually lives and which routines are dead (e.g. an empty Daily folder = dead morning-brief routine).

## Findings shape

- Report as a table per zone (folder, count, verdict) plus a numbered problem list, each backed by a number (counts, orphan totals, duplicate names).
- Distinguish structural fixes (one-shot, high impact: isolate flux, merge duplicates) from ongoing work (promote/link notes continuously).
- Rank by impact and say which are executable now. Ask before mutating the vault — a vault audit is read-only until the user approves.

## Pitfalls

- Paths with spaces and accents (`Brain/5. Reference/…`): plain `find` in shell breaks on word-splitting — prefer Python `glob`/`os` or quote everything.
- Don't count auto-generated flow notes as "content to reorganize" — the fix for flux is isolation/promotion, not better folders.
- A convention note may be stale (promised folders missing, rules violated) — report the drift, don't silently assume either side is right.

## Reference

- `references/brain-vault-state.md` — current state, counts, and open recommendations for the user's Brain vault.