# Bookmarks Curator Agent

Agent cron Hermes qui capture, trie et archive les bookmarks Twitter dans le vault Obsidian Brain.

## Structure
- `state/state.json` — dernier tweet traité (ID), stats, historique des runs
- `data/` — extractions brutes JSON (un fichier par run)
- `logs/` — logs d'exécution

## Pipeline (cron quotidien 06:00)
1. Collecte incrémentale sur x.com/i/bookmarks (navigateur piloté, session Keychain)
2. Enrichissement : résumé + classification thématique + score de priorité
3. Écriture dans le vault Brain (`1. Flux/Twitter Bookmarks/` — Brain v2)
4. Mise à jour de la matrice de priorité dans le spine
5. Rapport uniquement si nouveautés (watchdog silencieux sinon)

## Vault (Brain)
- Spine : `1. Flux/Twitter Bookmarks/Twitter Bookmarks.md` (tag #hub)
- Une note par bookmark substantiel ; les tweets courts sont agrégés en digest
- Tags frontmatter : `reference` + thèmes ; priorité dans un champ `priority`
