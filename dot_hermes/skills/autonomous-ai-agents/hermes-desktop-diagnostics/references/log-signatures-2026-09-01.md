# Signatures de logs — session 2026-09-01 (spinner infini desktop)

Contexte : app desktop mise à jour à 20:05 (backups `state.db.pre-update-emergency-2026-09-01T17-28` et `T18-03`, `desktop-update-handoff.log`). Le tour en cours (session `20260901_192220_84d3ec`) a été tué puis relancé par l'auto-continue à 20:06:07. Le provider principal `openai-codex` (gpt-5.6-luna) était épuisé → tout est tombé sur `z-ai/glm-5.3-flash` via OpenRouter.

## Chronologie réelle

- 20:05:02 redémarrage gateway (update desktop).
- 20:06:07 `auto-continue scheduled for session 20260901_192220_84d3ec (attempt 1, interrupted 191s ago)`.
- 20:06:07→20:38:09 tour relancé : 47 appels API, 52 tool_turns, 32 min. Modèle flash, ~7-30 s par appel, un appel à 85 s, un terminal à 53 s, une commande bloquée 301 s sur consentement absent.
- 20:38:09 `Turn ended: reason=text_response ... api_calls=5/500 budget=5/500 tool_turns=52` puis `tui turn finished: status=complete duration=451.6s`. Note : `api_calls=5/500` mais `tool_turns=52` — le compteur api_calls de la ligne finale ne reflète pas le total du tour relancé.

## Signatures grep utiles

```bash
# Vie du tour
grep "84d3ec" ~/.hermes/logs/agent.log | grep conversation_loop | tail
# Relances auto
grep "auto-continue scheduled" ~/.hermes/logs/agent.log
# État du pool de credentials
grep -E "credential pool|token exchange degraded" ~/.hermes/logs/agent.log | tail
# Consentement en attente expiré
grep "timed out without user response" ~/.hermes/logs/agent.log
```

## Erreurs OUTIL vues pendant le moulinage (non bloquantes, le modèle réessaie)

- `Tool terminal returned error ... exit_code: -1, BLOCKED (hardline): command parser limit or malformed executable payload` — command sur blocklist inconditionnelle.
- `fd` inexistant (exit 1), `git log HEAD~1..HEAD` sur repo sans historique — erreurs du modèle de secours qui tâtonne, pas des pannes Hermes.
- `Auxiliary client: PAID lane engaged ... z-ai/glm-5.3-flash is not a :free SKU` — le fallback auxiliaire coûte de l'argent ; options : `auxiliary.free_only: true` ou `auxiliary.openrouter_model` vers un SKU :free.
