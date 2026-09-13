---
name: hermes-desktop-diagnostics
description: "Use when a Hermes desktop turn spins forever or seems stuck."
version: 1.2.0
platforms: [macos]
---

# Hermes desktop "tourne dans le vide" — diagnostic

Workflow éprouvé (session 2026-09-01) quand le spinner desktop tourne indéfiniment ou qu'un tour relance en boucle. Le spinner est presque toujours un tour VIVANT mais lent — jamais un deadlock. Vérifier avant de conclure.

## 1. Lire les logs (source de vérité)

```bash
date; grep "<session-id>" ~/.hermes/logs/agent.log | tail -20
```

Le session-id figure dans la ligne `tui prompt accepted: ... agent_session_id=YYYYMMDD_HHMMSS_xxxxxx`. Lignes qui comptent :
- `agent.conversation_loop: API call #N ... latency=Xs` — tour vivant ; latence 8-30 s par appel = modèle de secours lent (voir §3).
- `tool_executor: tool X completed` — les outils tournent.
- `Turn ended: reason=...` + `tui turn finished: status=complete` — le tour EST terminé.

## 2. Tour relancé en boucle après update/crash → auto-continue

Signatures : `auto-continue scheduled for session X (attempt N, interrupted Xs ago)` + prompt `kind=auto_continue` avec msg `[System note: Your previous turn was interrupted mid-run...]`. Cause typique : mise à jour de l'app desktop (indices : `state.db.pre-update-emergency-*` dans `~/.hermes/`, `desktop-update-handoff.log`) qui tue le tour en cours.

- Config : `desktop.auto_continue` — `enabled` (défaut true), `freshness_minutes` (15), `max_attempts` (2). Défauts dans `hermes_cli/config_defaults.py`.
- Désactivation : `hermes config set desktop.auto_continue.enabled false` (fait le 2026-09-01 sur cette machine).
- **Piège : la config n'agit PAS rétroactivement** sur un tour déjà lancé — il faut `/stop` dans la conversation concernée.

## 3. Modèle lent (glm-5.3-flash openrouter) — fallback OU modèle épinglé du composer

Signatures dans `~/.hermes/logs/agent.log` (ou errors.log) :
- Lignes de tour montrant `model=z-ai/glm-5.3-flash provider=openrouter` au lieu du modèle principal.
- `credential pool: no available entries (all exhausted or empty)` + `Copilot token exchange degraded to RAW token` — souvent du BRUIT DE FOND (tâches auxiliaires), pas la cause du moulinage. Ne pas conclure trop vite.

glm-5.3-flash fait des micro-appels d'outils de 5-45 s avec de gros retours : un tour de 2 min en prend 30+. Et ses streams peuvent se suspendre SANS être détectés comme stale (une seule ligne `Interrupted provider wait counted as stale` n'apparaît pas toujours) — dernier `API call #N` loggé puis plus RIEN pendant 30+ min = tour mort, `/stop` requis.

**Deux causes possibles — vérifier dans cet ordre (leçon 2026-09-02 : on avait diagnostiqué « fallback » à tort) :**
1. **Fallback configuré ?** `hermes config get model.fallback` / lire `get_fallback_chain()` (hermes_cli/fallback_config.py). Sur cette machine la chaîne est VIDE.
2. **Modèle épinglé dans le composer desktop** — cause réelle ici. Le sélecteur de modèle du composer est mémorisé dans le Local Storage Electron (`~/Library/Application Support/Hermes/Local Storage/leveldb` → `composer.model = openrouter::z-ai/glm-5.3-flash`) et s'applique à TOUTES les nouvelles sessions desktop. Vérification fiable : `sqlite3 -readonly ~/.hermes/state.db "SELECT id, model FROM sessions ORDER BY started_at DESC LIMIT 10;"` — si toutes les sessions desktop récentes montrent le même modèle secondaire alors que les crons sont sur le principal, c'est le composer. Remède : changer le modèle via le SÉLECTEUR DU COMPOSER (persistant), pas via config.yaml.

Rappel : le modèle principal de cette machine = `gpt-5.6-luna-900k` via `openai-codex` (config.yaml `model:`). Vérifier qu'il marche via les sessions cron dans state.db avant de blâmer le pool.

## 4. Spinner figé sur une entrée utilisateur bloquante (approbation OU clarify)

### 4a. Approbation de commande

Signature : `BLOCKED: Command timed out without user response. The user has NOT consented...` après ~300 s. Une commande nécessitant le consentement affiche un prompt d'approbation que l'utilisateur ne voit pas (mauvaise fenêtre / UI) — le spinner tourne pendant toute l'attente.

### 4b. Clarify invisible (cas 2026-09-02, session fd5ea8 : spinner 15:03→16:03)

Signature : `tool_executor: tool clarify completed (3600.01s, ...)` — durée EXACTEMENT ~3600 s = timeout clarify, pas du vrai travail. L'agent a appelé `clarify`, le backend se bloque sur `clarify.respond`, mais la **carte de question ne s'affiche pas** côté desktop (cadre blanc + loader) : le renderer jette silencieusement le payload quand la validation client échoue (question vide après trim, choices toutes rejetées par normalizeChoices). Le modèle openrouter/glm-flash produit ce genre de payload plus souvent que les autres.

Diagnostic :
```bash
grep "tool clarify completed" ~/.hermes/logs/agent.log | tail
```

- Durée ~3600 s → clarify jamais vu par l'utilisateur. Le `_pending_clarify` re-joué au resume/switch rejoue le MÊME payload → la carte ne réapparaîtra pas en changeant d'onglet.
- Le tour reprend SEUL à l'expiration ("use your best judgement") — pas la peine de /stop si on est proche du timeout.

Remède appliqué le 2026-09-02 : `hermes config set agent.clarify_timeout 600` (config.yaml) — une clarify invisible bloque max 10 min au lieu d'1 h. Sans effet sur les cartes qui s'affichent normalement.

Vrai fix (renderer, à remonter upstream, pas patché localement) : `apps/desktop/src/store/clarify.ts` — rendre un fallback texte libre au lieu de dropper le request quand normalize vide le payload. Idem `input-requests.ts` (handler `clarify.request` : `return true` sans carte si question/questions vides après normalisation).

Réflexe général : quand ça « tourne dans le vide », vérifier d'abord s'il n'y a pas une demande d'approbation OU un clarify en attente dans les logs avant de blâmer le réseau/le modèle.

## Sur le vif — ce qu'il faut dire à l'utilisateur

1. Ce n'est pas bloqué : citer le numéro d'appel API et la latence, ça rassure et ça oriente.
2. Tour mort (dernier `API call #N` sans suite pendant 30+ min, §3) : `/stop` puis relancer. Ne pas attendre un stale-detector qui ne voit pas toujours les streams suspendus.
3. Spinner ~1 h pile : clarify en attente (§4b) — vérifier `grep "tool clarify completed"` ; le tour reprend seul à l'expiration.
4. Après update : un tour interrompu peut avoir été relancé automatiquement (auto-continue) — expliquer plutôt que laisser croire à un bug mystère.

Voir `references/log-signatures-2026-09-01.md` pour la transcription complète des signatures de logs de la session d'origine.
