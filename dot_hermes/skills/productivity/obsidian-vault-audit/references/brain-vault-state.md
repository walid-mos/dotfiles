# Brain vault — state as of 2026-08-28

Vault path: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain` (581 files, 546 md, 19 MB). Conventions live in `_Conventions.md` and `_Canvas.md` at vault root.

## Structure (Johnny-Decimal, 0–7)

| Zone | md | State |
|---|---|---|
| 0. Inbox | 2 | Should be emptied by filing; currently stale |
| 1. Daily | 0 | `2026/` exists but empty — dead morning-brief routine |
| 2. NextNode | 37 | Active business domain, healthy |
| 3. My Projects | 3 | Almost empty; `Clients/Fleurs d'aujourd'hui` duplicated here vs 2. |
| 4. Ideas | 17 | Healthy (Linter IA, Orchestrateur multi-modèles) |
| 5. Reference | 462 | **443 = Twitter Bookmarks flux**; only 19 real (Learning hubs, Dev, Setup) |
| 6. Personal | 9 | Healthy; `Finance/` promised in conventions but missing |
| 7. Archive | 13 | Healthy |

## Known problems (2026-08 audit)

1. **Flux noies le fond**: 443 TB notes (332 `veille`, 85 `actif`, 60 orphan). Recommendation: isolate to a Flux vault or `9. Flux/`, keep only promoted notes in `5. Reference`.
2. **58 true orphans** outside TB/Inbox/Archive (meetings, Ideas, Dev) — pattern Learning (hub + filles + canvas) is the vault's best format but not generalized.
3. **Convention drift**: depth-2 rule violated under Accor Hotel; `Fleurs d'aujourd'hui` exists in both 2. and 3.; duplicate basenames `Tasks.md` ×2, `Site.md` ×2; `IMG_1184.dng` (11 MB) at vault root with no `_Attachments/` defined.

## Pending decisions (user not yet answered)

- Execute flux isolation? Execute convention-repass (merge duplicates, flatten Accor, move .dng, create Finance/)?

## Vault conventions worth knowing

- Filename = title, no `# H1` repeat; first heading is `##`. Max folder depth 2 (exception: `5. Reference/Learning/<Sujet>/`).
- Client/billed work → `2. NextNode/Clients/<Client>/`; own work → `3. My Projects/`.
- Meeting notes: `Meetings/YYYY-MM-DD <person>.md`. Tasks: append-only `Tasks.md` at root, `#domain 📅 date` format.
- Canvas rules: read `_Canvas.md` before generating any `.canvas` (grid geometry, 20px grid, routing constraints).