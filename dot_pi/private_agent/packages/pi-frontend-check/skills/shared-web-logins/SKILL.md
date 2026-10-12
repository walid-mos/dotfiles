---
name: shared-web-logins
description: Use when signing into websites from Pi's browser.
version: 0.1.0
platforms: [macos]
---

# Connexions web communes Pi

Use the origin-bound `frontend_vault_*` tools from pi-frontend-check for saved Infisical credentials. Each session runs its own isolated Brave with its own persistent profile; the shared Infisical vault supplies credentials, not a shared browser profile. Personal Brave stays separate. Open a protected URL and verify whether the session is already authenticated before starting a new login.

## When to Use

Connexion à un compte web avec Pi, compte connu ou manquant. Pas pour les clés API, passkeys, cartes ou adresses.

## Procedure

1. Open the protected URL with `frontend_open` and verify whether the session is already authenticated. If login is necessary, call `frontend_vault_list` and select only a handle whose origin exactly matches the login form. Never infer the account identifier from a different website's entry. Never read Infisical values through shell commands, `broker.py read`, `infisical secrets get`, the Infisical MCP, or `frontend_eval`; those integrations may point to a different project from the shared web vault.
2. If a password login has no exact-origin entry, ask the user to enroll it from a terminal with `python3 ~/.pi/agent/packages/pi-frontend-check/shared-web-logins/enroll.py` (masked prompts), then relist in Pi. For a passwordless email-code login, stop and ask the user how to proceed: do not create a fake password entry and do not store an OTP. Never ask for a password or verification code in chat.
3. On a production origin, open the login page in Pi with `frontend_open`, type only the non-secret identifier with a `frontend_batch` `type` step, then call `frontend_vault_fill` with the shared handle; the password fill requires the **exact origin** and a single visible password field, never bypass an origin refusal. On a dev/test origin (localhost, private hosts, `.local`/`.test`), type the identifier and the disposable test password of a dedicated test account directly with `frontend_batch` — `type` accepts password fields there without the vault.
4. Soumets seulement si l'utilisateur t'a autorisé à te connecter. Vérifie sur la page une preuve de connexion (pas seulement `filled: true`). Si le site refuse l'identifiant/mot de passe, **arrête-toi** : ne retente pas la même valeur (risque de verrouillage), et vérifie avec l'utilisateur s'il faut un mot de passe valide ou une connexion SSO. Verify the protected page rather than assuming that a vault fill or a cookie proves authentication.
5. Pour 2FA, CAPTCHA ou passkey, demande l'action exigée par le site à la personne ; n'entre jamais un code reçu dans le chat. Le coffre partagé ne contourne pas les vérifications du site.

## Pitfalls

- `frontend_batch` `type` accepts `type=password` fields only on dev/test origins (localhost, private hosts, `.local`/`.test`) for disposable test accounts; production origins stay vault-only. After `frontend_vault_fill`, Pi captures remain blocked until this client connection is released; text output is redacted.
- Une coupure Infisical n'est pas un compte « absent » : attends le retour du coffre, n'exige pas une nouvelle saisie. Depuis une session SSH ou un job launchd, le CLI Infisical ne peut pas ouvrir le trousseau : le coffre est indisponible, pas vide.

## Verification

`frontend_vault_list` retourne l'entrée pour l'origine ; `frontend_vault_fill` réussit uniquement sur cette origine ; après soumission autorisée, constate l'état connecté dans **Pi**.
