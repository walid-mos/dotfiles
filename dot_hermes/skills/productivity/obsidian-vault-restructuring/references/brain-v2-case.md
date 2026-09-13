# Brain v2 — real redesign case (2026-08-28)

Vault: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain` (~546 md, 19 MB).

## Audit numbers that drove the redesign

| Zone | Notes | Verdict |
|---|---|---|
| 5. Reference/Twitter Bookmarks | 443 (81% of vault; 332 `priority: veille`, 85 `actif`) | flux drowning the fond |
| 2. NextNode | 37 | healthy |
| Reference (excl. Twitter) | 19 | good pattern (Learning) |
| 4. Ideas | 17 | healthy |
| 6. Personal / 7. Archive | 9 / 13 | healthy |
| 3. My Projects | 3 | underused |
| Orphan notes (never wikilinked) | 58 excl. flux/archive | main defect |

Old conventions had: max depth 2 (user HATED it — "catastrophique, presque du flat"), `1. Daily/2026` empty (dead routine), `IMG_1184.dng` (11 MB) at root, duplicate `Fleurs d'aujourd'hui` in two trees, `6. Personal/Finance/` promised but never created.

## Target tree (v2)

```
Brain/
├─ 0. Inbox/            # capture brute + idées brutes; se vide par promotion
├─ 1. Flux/             # auto-généré, exclu du graphe
│  └─ Twitter Bookmarks/
├─ 2. NextNode/         # Clients/<client>/ (+ Meetings/), Prospection, Strategy, Admin
├─ 3. Projets/          # Hermes (AI), Linter IA, Orchestrateur multi-modèles, NextNode interne
├─ 4. Bibliotheque/     # Dev/<thème>/ (Claude/…), Learning/<sujet>/, Setup/
├─ 5. Perso/            # Fitness, Health, People, Lists, Notes (+ Finance à venir)
├─ 6. Journal/          # daté à la demande, PAS de daily auto
├─ 7. Archive/
├─ _Meta/               # Conventions.md, _Canvas.md, Templates/
├─ _Attachments/        # tout binaire
└─ Tasks.md             # append-only Hermes
```

## Key formats

Hub folder-note:
```markdown
---
type: hub
created: YYYY-MM-DD
status: 🌿
tags: [hub]
---
<accroche 2 lignes>

## Contenu
- [[fille 1]]
- [[fille 2]]
```

Child "remonte" line inserted right after frontmatter: `[[Hub Parent]] · [[Grand-parent]]`.

Note: `type: note`, `status: 🌱/🌿/🪦`, first section = the essence (what RAG reads first), no H1, first internal heading `##`.

Templates shipped in the vault at `_Meta/Templates/`: `tpl note.md`, `tpl hub.md`, `tpl log.md`, `tpl snippet.md`.

## Obsidian config changes

- `app.json`: `"attachmentFolderPath": "_Attachments"`.
- `graph.json`: `"search": "-path:\"1. Flux\""` (keep flux out of the graph).
- Plugin `folder-notes` was already installed → clicking a folder opens its hub.

## Migration moves (all `shutil.move`, idempotent OK/SKIP log)

Twitter Bookmarks → `1. Flux/`; Dev+Learning+Setup → `4. Bibliotheque/`; Hermes (AI) → `3. Projets/`; Linter IA + Orchestrateur multi-modèles promoted from Ideas → `3. Projets/`; Mizraj → `3. Projets/NextNode/`; Fitness/Health/People/Lists → `5. Perso/`; Minimalisme reclassified Journal→`5. Perso/Notes/` (fond note, not a log); Fleurs duplicate merged (concatenated Tasks.md); RPG + Jeu biodiversité (raw ideas) → `0. Inbox/`; `_Conventions.md`→`_Meta/Conventions.md` (rewritten v2); `IMG_1184.dng`→`_Attachments/`. Deleted empty: `1. Daily`, `4. Ideas`, `5. Reference`, `6. Personal`. 7 meeting/state notes patched `type: log`. 27 hubs created.

## Result

- 116 notes outside Flux/Archive, 4 orphans remaining — all in `0. Inbox` (by design).
- File count before == after (576): nothing lost.
- Cron writer fixed: `~/.hermes/bookmarks-agent/build_vault.py` `DEST` → `1. Flux/Twitter Bookmarks`; skill `x-bookmark-curation` rule 3 updated to match.

## Open follow-up

Promote the 85 `priority: actif` bookmarks from `1. Flux` into `4. Bibliotheque` as `type: note` 🌱 notes linked to theme hubs (the standing "promotion" pipeline).
