---
name: email-accounts
description: "Use when checking Walid's mail accounts or reconnecting one."
version: 1.2.0
author: Walid + Hermes
license: MIT
platforms: [macos]
metadata:
  hermes:
    tags: [Email, IMAP, SMTP, OAuth, himalaya]
---

# Comptes mail de Walid via himalaya

## When to Use

- Lire, chercher ou envoyer des mails sur l'un des 4 comptes de Walid
- Une connexion mail échoue (jeton expiré, app password révoqué) → suivre la section reconnexion correspondante

## Les 4 comptes

| Compte | Account name | Auth |
|---|---|---|
| pro.walid.mostefaoui@gmail.com | `gmail` | App password (Keychain `hermes-himalaya-gmail`) |
| walidmostefaoui@nextnode.fr (Zoho) | `zoho` | App password (Keychain `hermes-himalaya-zoho`) |
| w.mostefaoui@outlook.fr | `outlook1` | OAuth2 (Ortie + Thunderbird client-id) |
| w.mostefaoui.2@outlook.fr | `outlook2` | OAuth2 (Ortie + Thunderbird client-id) |

## Usage quotidien

⚠️ **POLITIQUE SÉCURITÉ (imposée par Walid, non négociable)** :
- **LECTURE seule** autorisée, et uniquement ce qui est nécessaire à la tâche en cours
- **ENVOI / SUPPRESSION / DÉPLACEMENT : INTERDITS** sauf demande explicite de Walid dans la conversation courante
- Toujours passer par le wrapper : `python3 ~/.config/himalaya/email-guard.py <args himalaya>`
  (il bloque en dur send/delete/move/copy/attachment ; exit 42/43 = refus, ne pas insister ni contourner)

```bash
python3 ~/.config/himalaya/email-guard.py envelope list --account gmail --page-size 10
python3 ~/.config/himalaya/email-guard.py message read --account outlook1 <id>
```

Ne JAMAIS appeler `himalaya` directement pour une opération d'écriture.

Config: `~/.config/himalaya/config.toml`

## Workflow email de Walid (client GUI, v1.2.0)

- **Vue unifiée** : il travaille TOUJOURS en boîte unifiée (4 comptes mélangés). Ne jamais raisonner par compte sauf demande explicite.
- **Inbox = uniquement les mails importants/en attente**. Tout mail lu, traité ou peu important doit être **archivé** (Archive, jamais Trash). Boîte propre par défaut.
- **Listes** : il tient des listes de lecture et des listes d'affaires (sujets suivis). Les drapeaux Apple Mail le satisfaisent moyen → il préfère tags/labels par thème quand possible (labels Gmail natifs ; sinon dossiers/flags).
- Ces règles s'appliquent aussi à moi : sur demande de tri, archiver plutôt que supprimer, respecter l'unifié, utiliser labels/flags de façon cohérente entre comptes.

## Reconnexion Outlook (quand les jetons expirent)

Les jetons vivent dans `~/.local/share/ortie/outlook{1,2}.json` et se rafraîchissent
tout seuls. Une reconnexion manuelle n'est nécessaire que si le refresh token expire
(~90 jours d'inactivité) ou si l'utilisateur révoque l'accès.

**Procédure (compte par compte)** — chaque étape compte, ne pas improviser :

1. Lancer la demande dans tmux pour capturer state+pkce :
   ```bash
   tmux new-session -d -s ortie 'ortie auth get --account <outlook1|outlook2> 2>&1 | tee /tmp/ortie.log'
   sleep 6 && cat /tmp/ortie.log   # contient state, pkce, et l'URL authorize
   ```
2. Ouvrir l'URL : `open "<url authorize du log>"`.
3. **Piège n°1** : l'utilisateur doit se connecter avec le BON compte
   (`w.mostefaoui@outlook.fr` pour outlook1, `w.mostefaoui.2@outlook.fr` pour outlook2).
   Se déconnecter du compte précédent si besoin.
4. À la fin Microsoft redirige vers `https://localhost/?code=...&state=...`
   → Safari affiche « ne parvient pas à se connecter au serveur » : C'EST NORMAL.
5. **Piège n°2** : le `code` expire en ~2 min et le `state`/PKCE doit correspondre
   EXACTEMENT à ceux du log de l'étape 1. Demander à l'utilisateur de copier l'URL
   depuis la barre d'adresse (⌘L ⌘C) rapidement.
6. Finaliser :
   ```bash
   ortie auth resume --account <outlook1|outlook2> \
     --state='<state du log>' --pkce='<pkce du log>' '<url localhost collée>'
   ```
7. Vérifier : `himalaya envelope list --account <outlook1|outlook2> --page-size 3`

**Piège n°3** : ne JAMAIS utiliser un client-id first-party Microsoft ni Thunderbird
en device-code — les comptes personnels @outlook.fr sont refusés (« Basic authentication
is disabled » ou « users are not permitted to consent »). Le seul chemin qui marche :
client-id public Thunderbird IMAP `9e5f94bc-e8a4-4e73-b8be-63364c29d753` avec
authorization-code + PKCE via Ortie (déjà configuré dans `~/.config/ortie/config.toml`,
ne pas y toucher).

## Reconnexion Gmail / Zoho (rare)

Les app passwords sont stockés dans le Keychain macOS (jamais en clair ailleurs).
Pour retrouver la valeur : `security find-generic-password -s <service> -w`.
Si révoqué : régénérer un mot de passe d'application puis
`security add-generic-password -a <email> -s <service> -w '<nouveau mdp>'`.

## Dépannage

- `Basic authentication is disabled` → jeton expiré, suivre « Reconnexion Outlook »
- `Mailbox is required` → ajouter `mailbox.alias.inbox = "INBOX"` au compte
- Test rapide jeton Outlook : `cat ~/.local/share/ortie/outlook1.json | python3 -m json.tool | head -5`
