---
name: keychain-session-auth
description: Use for authenticated web sessions in agents via Keychain.
---

# Keychain Session Auth pour agents autonomes

Pattern établi avec le Bookmarks Curator agent (@dev_au_bonnet sur X).

## Principe
- Jamais de mots de passe ni de fichiers cookies en clair.
- Les cookies de session sont stockés dans le Keychain via `security add-generic-password -U -s "<agent>-<site>" -a walid-mos -w <cookies_json>`.
- Récupération : `security find-generic-password -s "<agent>-<site>" -w`.
- Le cron agent injecte ces cookies dans le navigateur piloté (browser_exec / CDP `Network.setCookie`) si la page redirige vers login.

## Procédure
1. L'utilisateur se connecte manuellement une fois dans la session navigateur pilotée par l'agent.
2. L'agent extrait les cookies pertinents (ex. `auth_token`, `ct0` pour X ; cookies de session pour Malt) et les sauvegarde dans le Keychain.
3. À chaque run : naviguer → si redirection login, restaurer les cookies du Keychain → recharger → si toujours déconnecté, STOP et rapporter (pas de retry en boucle).

## Convention de nommage
`hermes-<nom-agent>-<site>` — ex. `hermes-bookmarks-agent-x`, `hermes-freelance-presence-malt`.

## Pitfalls
- `security add-generic-password -U` met à jour silencieusement.
- Les cookies httpOnly doivent être posés via CDP `Network.setCookie`, pas document.cookie.
- Cookie expiré = rapport d'échec, jamais de tentative de login par mot de passe.
