---
name: cron-web-agent-patterns
description: Use when building a cron agent driving logged-in websites.
---

# Patterns pour agents cron pilotant des sites web (présence, scraping, refresh)

Pattern validé sur deux agents de production : Bookmarks Curator (X/Twitter) et Freelance Presence (5 plateformes freelance, actualisation quotidienne 9h).

## Architecture type
- **Un navigateur browser_exec isolé par agent** (`session="<agent-name>"`). Ne jamais partager une session entre deux crons : les onglets dérivent vers le travail de l'autre agent en plein milieu d'une opération.
- **Sessions dans le Keychain macOS** : cookies JSON par site via `security add-generic-password -U -s "hermes-<agent>-<site>" -a <user> -w <json>`. Restauration par CDP `Network.setCookie`. Voir skill keychain-session-auth.
- **Identifiants optionnels** : si l'utilisateur accepte, stocker creds dans des services `...-creds-<site>` (JSON {url, login_url?, user, password}) pour reconnexion auto quand les tokens sont courts (<48h). Ne jamais logger les mots de passe ; CAPTCHA/2FA = STOP + rapport.
- **README par agent** dans `~/.hermes/<agent>/README.md` : URL de travail, mécanisme d'actualisation exact par site, pièges spécifiques. Le prompt du cron y renvoie explicitement.

## Procédure par run
1. Naviguer → vérifier la session (marqueurs DOM : « mon compte », avatar ; pas seulement l'absence du mot « connexion »).
2. Si déconnecté : réinjecter cookies → retester → sinon login auto si creds disponibles → sinon STOP + rapport pour ce site (continuer les autres).
3. Déclencher le mécanisme propre au site (chaque plateforme diffère : bouton « Confirmer dispo », popover profil → Actualiser, radio + Enregistrer, etc.).
4. **Vérifier le succès par un texte/compteur confirmant** (« bien été confirmée », « 30 jours restants »), jamais par l'absence d'erreur.
5. Rapport final tableau OK/échec ; watchdog silencieux si tout va bien.

## Pitfalls UI (validés)
- `.click()` JS sur UI Chakra/Element-UI = toggle : dialogue ouvert puis refermé. Préférer `click_at_xy` aux coordonnées getBoundingClientRect, avec polling de l'état après clic.
- Bouton 0×0 avec styles visibles = souvent dans un popover fermé (`.el-popover`, `span.cw-popover`) : cliquer le trigger d'abord.
- Drawer avec bouton hors viewport (x > innerWidth) : `scrollIntoView({inline:'center'})` avant lecture des coords.
- Avant d'approuver quoi que ce soit, confirmer par screenshot/texte ce qui s'est réellement ouvert — un « Valider » peut appartenir à un autre widget (ex. mandat juridique à côté du formulaire visé).
- Regex inline dans js() : échapper `\\n`, `\\d` côté Python, sinon SyntaxError CDP. Préférer includes/split.
- Les tokens de session de ces sites sont souvent courts ou des session-cookies purs : tester la durée de vie réelle (champ expires des cookies) avant de promettre un fonctionnement sans re-login.
