# Shared web logins — Pi

Infisical holds the login records; browsers stay per session. Personal Brave remains separate.

## Components

- `config.json`: dedicated Infisical project, `prod` environment, root folder. At setup it had one human project member and no machine identities; secret-link sharing is disabled and project deletion is protected. Audit membership before adding other users/identities. Organization administrators may still govern access.
- `broker.py`: validates HTTPS (or loopback HTTP) origins, hashes origin + identifier into opaque secret keys, reads/writes Infisical through the logged-in user's CLI session, verifies every write. Login payloads go to the CLI over stdin, never an argument. `list` returns metadata only; **`read` emits a password to its process pipe and must only be called by the browser adapter, never in an agent-visible shell**.
- `enroll.py`: terminal enrollment through masked prompts, then `save_login` with a verified readback. It is the only place a password is typed.
- Local Pi package `~/.pi/agent/packages/pi-frontend-check/`: `frontend_vault_list` and `frontend_vault_fill` read the same project. Password fill rechecks `location.origin` inside the same page execution and refuses ambiguous fields. Frontend tool text is redacted and screenshots remain blocked after a fill until the client connection is released.
- Pi package skill `shared-web-logins`: login workflow, failure handling, MFA and verification.

## Enrollment

1. In a terminal: `python3 ~/.pi/agent/packages/pi-frontend-check/shared-web-logins/enroll.py`. Enter the origin of the actual password form (`https://host`), the identifier, the password and, if any, the OTP secret in the masked prompts; never type them into chat or an agent shell.
2. In Pi, call `frontend_vault_list`, open the exact-origin login page, type only the listed identifier, then call `frontend_vault_fill` with its `iw:` handle. Submit only with authorization and verify the authenticated page.
3. When Pi meets a site with no entry, it asks the user to run `enroll.py`; Pi must not solicit a password in chat.

## Operational checks

- `python3 broker.py list` reports only metadata. Never run `broker.py read` in a terminal tool: its stdout is sensitive.
- The Infisical CLI must be logged in for the user running Pi, and its credentials sit in the login keychain: from an SSH or launchd context the CLI fails with "User interaction is not allowed" and Pi reports the vault unavailable. An outage or expired login is reported as vault unavailable, **not** as an absent account. Do not fall back to a prompt until availability is restored.

## Limits

Exact-origin matching intentionally rejects a login saved for another SSO domain; navigate to the actual password form's origin before enrolling. Sites may still require MFA, CAPTCHA, passkeys, consent, or renewed credentials. A shared password is **not** a shared session, nor a guarantee of unattended permanent access. This integration runs as the same macOS user as Pi; an agent with unrestricted local shell access is not an adversarial sandbox against that user or the organization's Infisical administrators.
