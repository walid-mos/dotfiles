---
name: obsidian-vault-restructuring
description: Use when restructuring or migrating an Obsidian vault.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [obsidian, notes, migration, knowledge-management]
---

## When to Use

Use when the user asks for a vault audit ("audit my brain/folder"), a structure redesign, new conventions, or a migration of an Obsidian vault (move folders, reorganize notes, split flux from permanent notes). Also use before ANY folder move inside a vault that other tools write into.

## Workflow

1. **Audit before touching anything.** Count files per folder, per extension, per mtime month. Measure the flux/permanent ratio — auto-generated collections (bookmarks, daily logs) routinely dwarf real knowledge (80%+ of a vault) and dominate search/graph/RAG. Report numbers, not impressions.
2. **Read existing conventions first.** Look for a conventions note (`_Conventions.md` etc.), plugin list (`.obsidian/plugins/`), `app.json`, `graph.json`. Existing plugins change what's possible (e.g. `folder-notes` makes folder-note hubs clickable).
3. **Design principles that survived a real redesign (Brain v2):**
   - Separate **flux** (auto-generated, never hand-edited, excluded from graph) from **fond** (permanent formatted notes).
   - Depth is governed by meaning, not a number: each level must answer a distinct question (domain → client → project → aspect). User may HATE numeric caps and flat structures — offer "free depth + guards" instead: no folder with a single child (anti-tunnel), min 3 notes before creating a folder (anti-flat).
   - Every "fond" folder gets a **folder-note hub** (same-name `.md`, `type: hub`, frontmatter, 2-line abstract, links to children). Every child links back up ("remonte" line after frontmatter). Goal: zero orphans outside Inbox.
   - Typology via frontmatter `type:`: hub / note / log (dated, append-only) / snippet / idee / flux. Status emoji (`🌱 pousse · 🌿 stable · 🪦 à archiver`) as the only maintenance mechanism.
   - Filename = title, no H1 repeating it, first internal heading `##`. Dated logs: `YYYY-MM-DD <sujet>.md`.
4. **Execute in one scripted pass** (Python via execute_code, not dozens of shell calls): build the move list, `shutil.move` each with existence checks, print OK/SKIP per line. Idempotent moves (skip if dst exists) let a crashed script be replayed safely — this happened and worked.
5. **Create missing hubs and back-links**, then re-run the orphan check until only Inbox notes remain.
6. **Sync the toolchain**: `app.json` → `attachmentFolderPath` for binaries; `graph.json` → `search: -path:"<flux folder>"`; cron writers → new paths (see Pitfalls). Report a final tree + orphan count + writer-path verification.

## Verification

- Re-run the orphan scan after all patches; expect orphans only in the capture folder (Inbox).
- Verify file count before == after (nothing lost, only moved).
- `grep` automation scripts/cron prompts for the OLD vault path after any move.

## Pitfalls

- **Automation-writer coupling (cost a mid-session fix):** a cron job (e.g. X bookmarks via `build_vault.py`) writing into a vault folder will silently recreate the old tree at its old `DEST` after the vault is restructured. Grep every writer for the old path and patch it in the same pass; update any skill that documents the path too.
- **`os.path.splitext` bug in link-matching:** `splitext("GPT-5.6")` → `("GPT-5", ".6")`. When matching wikilink targets to filenames, strip a trailing `.md` manually instead of using `splitext` on the link text (only use `splitext` on the actual filename). False "orphan" reports otherwise.
- **Unicode:** compare wikilink targets and filenames with `unicodedata.normalize("NFC", ...)` — macOS filenames may be NFD; accents in `[[links]]` vs on disk differ otherwise.
- **Wikilinks are path-independent:** Obsidian resolves by note name, so moving folders doesn't break `[[links]]` — but duplicate basenames across folders become ambiguous; rename with a disambiguating suffix (e.g. `Yasmine (client)` vs the person note) when merging trees.
- **Merging duplicate folders:** concatenate file contents when the target file already exists; never overwrite.
- **Don't reclassify silently:** a note in the "wrong" folder (e.g. an undated reflection in Journal/) may be moved to its fitting type-location, but say so in the report.

## References

- `references/brain-v2-case.md` — the real Brain v2 redesign: audit numbers, target tree, hub format, template files.
