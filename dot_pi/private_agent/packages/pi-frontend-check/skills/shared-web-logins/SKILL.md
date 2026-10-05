---
name: shared-web-logins
description: Use when signing into websites from Pi's browser.
version: 0.1.0
platforms: [macos]
---

# Connexions web communes Pi–Hermes

Use the origin-bound `frontend_vault_*` tools from pi-frontend-check for saved Infisical credentials. Each session runs its own isolated Brave with its own persistent profile by default; the shared Infisical vault supplies credentials, not a shared browser profile. Only when the managed shared browser is explicitly enabled ([the managed browser guide](../../docs/shared-browser.md)) do Pi and Hermes share one signed-in session. Personal Brave stays separate. Open a protected URL and verify whether the session is already authenticated before starting a new login.

## When to Use

Connexion à un compte web avec Pi, compte connu ou manquant. Pas pour les clés API, passkeys, cartes ou adresses.

## Procedure

1. Open the protected URL with `frontend_open` and verify whether the session is already authenticated. If login is necessary, call `frontend_vault_list` and select only a handle whose origin exactly matches the login form. Never infer the account identifier from a different website's entry. Never read Infisical values through shell commands, `broker.py read`, `infisical secrets get`, the Infisical MCP, or `frontend_eval`; those integrations may point to a different project from the shared web vault.
2. If a password login has no exact-origin entry, use Hermes desktop's masked `browser_vault_save_login`, then verify `synced_to_pi: true` and relist in Pi. For a passwordless email-code login, do not create a fake password entry or store an OTP: complete the login through Hermes' masked `browser_vault_enter_code`, then verify the protected page in Pi. Never ask for a password or verification code in chat.
3. Ouvre la page de connexion dans Pi avec `frontend_open`. Saisis uniquement l'identifiant (non secret) avec `frontend_act`, puis appelle `frontend_vault_fill` avec le handle commun. Le remplissage du mot de passe exige **l'origine exacte** et un seul champ mot de passe visible. Ne contourne pas un refus d'origine.
4. Soumets seulement si l'utilisateur t'a autorisé à te connecter. Vérifie sur la page une preuve de connexion (pas seulement `filled: true`). Si le site refuse l'identifiant/mot de passe, **arrête-toi** : ne retente pas la même valeur (risque de verrouillage), et vérifie avec l'utilisateur s'il faut un mot de passe valide ou une connexion SSO. Verify on the page a proof of login (not just `filled: true`). If the site refuses the identifier/password, **stop**: do not retry the same value (lockout risk), and check with the user whether a valid password or an SSO login is needed. Verify the protected page rather than assuming that a vault fill or a cookie proves authentication. In shared-browser mode, each configured client sees the same website session; consult the managed-browser guide before changing session ownership.
5. Pour 2FA, CAPTCHA ou passkey, demande l'action exigée par le site à la personne ; n'entre jamais un code reçu dans le chat. Le coffre partagé ne contourne pas les vérifications du site.

## Pitfalls

- `frontend_act` refuses `type=password` fields. After `frontend_vault_fill`, Pi captures remain blocked until this client connection is released; text output is redacted. In shared mode, releasing the client does not close the managed browser or discard its authentication.
- Une coupure Infisical n'est pas un compte « absent » : attends le retour du coffre, n'exige pas une nouvelle saisie.

## Verification

`frontend_vault_list` retourne l'entrée pour l'origine ; `frontend_vault_fill` réussit uniquement sur cette origine ; après soumission autorisée, constate l'état connecté dans **Pi**. Pour Hermes, vérifie séparément `browser_vault_list` et le remplissage natif du navigateur.
