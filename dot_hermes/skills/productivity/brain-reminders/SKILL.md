---
name: brain-reminders
description: "Use when Walid captures, lists or closes a task or reminder."
version: 1.0.0
---

# Brain Reminders — base de taches Obsidian

## ⚠️ Déclencheurs de capture — AVANT TOUTE AUTRE LECTURE

**Raccourci déterministe `r:`** : un message commençant par `r:` ou `r —`
(ex. `r: appeler la banque`, `r Projets/Pi: régénérer l'index`) est TOUJOURS
une capture de tâche, sans aucune interprétation :

1. Extraire le domaine optionnel avant le `:` si présent (`r <domaine>: texte`),
   sinon domaine déduit du contexte, sinon Inbox.
2. `taskdb.add(...)` → UNE ligne de confirmation (« ✓ rangé dans Projets/Pi »).
   Rien d'autre : pas de lecture de fichiers, pas d'exploration, pas de code.

Autres déclencheurs équivalents : « Rappel : », « rappelle-moi », « faudra que je »,
« pense à », « note que je dois » → CAPTURE DE TÂCHE, pas une demande de travail :

1. `taskdb.add(...)` avec le domaine déduit du contexte, puis une ligne de
   confirmation (« ✓ rangé dans Projets/Pi »). C'est tout.
2. NE JAMAIS chercher le projet, ouvrir des fichiers, lire du code, explorer,
   ni commencer à implémenter — même si la suite du message ressemble à une
   demande de dev. Le préfixe gagne toujours.
3. Walid explicitement : « c'est parti », « implémente », « vas-y » → là
   seulement, travailler sur la tâche (et la clore quand c'est fait).

**Raccourci déterministe `c:` (contexte)** : un message commençant par `c:`
ajoute du CONTEXTE à une tâche existante — ce n'est NI une nouvelle tâche,
NI une demande de travail immédiat :

1. Identifier la tâche visée : la dernière tâche capturée dans la conversation,
   sinon `taskdb.query()` / sous-chaîne donnée par Walid (`c Projets/Pi: ...`).
2. Ajouter le contenu comme sous-puce indentée sous la ligne de tâche dans le
   fichier domaine (`  - 📝 ...`) — liens, tweets, consignes d'exécution, détails.
3. Confirmer en une ligne (« ✓ contexte ajouté à <tâche> »). Si le contexte est
   une consigne à exécuter tout de suite (ex. « retrouver le tweet »),
   l'exécuter d'abord puis ranger son résultat dans la sous-puce.

Exemples :
- `r: copier le selector de Devin` puis `c: retrouver le tweet en lien`
  → la consigne est exécutée immédiatement, le résultat devient une sous-puce
  📝 de la tâche Devin (le tweet n'apparaît JAMAIS dans le texte du rappel).
- `c Projets/Pi: le budget est validé par Baptiste` → simple sous-puce 📝.

Le reste du temps, la base se gère comme décrit ci-dessous.

Base de taches de Walid : `Brain/Tasks/` dans le vault Obsidian
(`/Users/walid-mos/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/Tasks`).

**1 fichier = 1 domaine de taches** (ex. `Projets/Brain v2.md`, `NextNode/Clients/Igocreate.md`).
Dans chaque fichier, les taches vivent sous `## BACKLOG` (zone par defaut ; d'autres zones
possibles : `## A FAIRE`, `## EN ATTENTE`…). Une tache = une checkbox avec metadonnees inline
(compatible plugin Obsidian Tasks) :

```
- [ ] Texte de la tache #tag ⏫ 🛫2026-09-01 📅2026-09-20 ^abc12x
  - [ ] Sous-tache ^def34y
```

Statuts : `[ ]` open · `[/]` wip · `[x]` done (avec ✅date) · `[-]` annule.
Priorites : ⏫ haute · ⏬ basse. 🛫 cree, 📅 due, ^id = identifiant stable.

## Module a utiliser

### En chat (par Hermes)

```python
sys.path.insert(0, "/Users/walid-mos/.hermes/plugins/brain-reminders")
import taskdb
```

Fonctions : `add(text, domain=None, tags=[], due=None, priority="normale", after=None)`,
`query(domain=None, status="open", tag=None, q=None, due_before=None, limit=50)`
(status: open|wip|done|canceled|all), `set_status(ref, status)` (ref = ^id ou sous-chaine
du texte), `domains()` (liste des fichiers + compteurs).

### Depuis n'importe ou (CLI `remind`, hermes one-shot `hermes chat -q` inclus)

`~/.local/bin/remind` (s'assurer que `~/.local/bin` est sur le PATH) :

```bash
remind "texte"                          # → Inbox
remind -d "Projets/Pi" -p haute -D 2026-09-05 -t tag1,tag2 "texte"
remind --done "sous-chaine"             # clore (--wip/--cancel/--reopen)
remind list                             # ouvertes ; --all inclut les closes
remind list --domain-filter "Projets/Pi"
```

- `domain=None` → Inbox (`Inbox/Inbox.md`) — capture par defaut.
- `after=<id>` → sous-tache indente sous la tache parente.
- `set_status` par sous-chaine prend la plus recente en cas d'ambiguite.
- Archive = `Tasks/Archive/YYYY-MM.md` (l'agent peut y deplacer les taches closes).

## Regles de capture (quick chat)

1. Walid dit la tache en chat (« faudra penser a X », « rappelle-moi de Y plus tard »).
2. Deduis le domaine : projet en cours dans la conversation > domaine existant (voir
   `domains()`) > **Inbox**. Ne JAMAIS poser de question pour une capture — deduis et dis
   ou tu l'as mise en une ligne (« ✓ ajoutee a Projets/Brain v2 »).
3. Si le domaine n'existe pas mais est clair (client, projet), passe-le : le fichier
   et son header sont crees automatiquement (folder-note conforme Brain v2).
4. Due date : uniquement si Walid en donne une ou si c'est evident (« avant vendredi »).
5. cloture : « c'est fait » / « task faite X » → `set_status(ref, "done")`.
6. Le widget desktop « Rappels » (pane droit + chip statusbar) lit l'API backend
   (`/api/plugins/brain-reminders`) — aucune action necessaire pour l'affichage.

## Domaines par defaut (creer a la demande)

| Domaine | Fichier |
|---|---|
| Inbox (defaut) | `Inbox/Inbox.md` |
| NextNode clients | `NextNode/Clients/<Client>.md` |
| NextNode prospection/admin | `NextNode/Prospection.md`, `NextNode/Admin.md` |
| Projets perso | `Projets/<Projet>.md` |
| Perso | `Perso/Admin.md`, `Perso/Maison.md`, `Perso/Voiture.md`, `Perso/Parents.md` (taches pour papa/maman, prefixer « Pour Papa/Maman : ») |
| Archive | `Archive/YYYY-MM.md` |

## Depannage

- Le widget affiche « Backend indisponible » → verifier `hermes config get plugins.enabled`
  contient brain-reminders, puis redemarrer le gateway (`hermes gateway restart`).
- Recreer l'arborescence a la main : `taskdb.add("tache test", domain="Inbox/Inbox")`.
