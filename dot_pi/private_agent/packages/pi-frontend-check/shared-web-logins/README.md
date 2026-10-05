# Shared web logins — Pi + Hermes (factory)

This integration shares Infisical login records, not browser storage. Each Pi session and Hermes task runs its own isolated browser by default. For deliberate shared signed-in sessions, read [the managed browser guide](../docs/shared-browser.md) — it is opt-in, never the default. Personal Brave remains separate.

## Components

- `config.json`: dedicated Infisical project, `prod` environment, root folder. At setup it had one human project member and no machine identities; secret-link sharing is disabled and project deletion is protected. Audit membership before adding other users/identities. Organization administrators may still govern access.
- `broker.py`: validates HTTPS (or loopback HTTP) origins, hashes origin + identifier into opaque secret keys, reads/writes Infisical through the logged-in user's CLI session, verifies every write. Login payloads go to the CLI over stdin, never an argument. `list` returns metadata only; **`read` emits a password to its process pipe and must only be called by the browser adapter, never in an agent-visible shell**.
- `~/.hermes/profiles/factory/plugins/infisical-web-logins/`: overrides four native browser-vault tools. Hermes's existing masked save prompt and exact-origin fill remain the only entry/fill mechanisms. On save, it publishes to Infisical and deletes the transient encrypted local vault copy after a verified readback. `browser_shared_sync_local` retries a failed publication without a second user entry.
- Local Pi package `~/.pi/agent/packages/pi-frontend-check/`: `frontend_vault_list` and `frontend_vault_fill` read the same project. Password fill rechecks `location.origin` inside the same page execution and refuses ambiguous fields. Frontend tool text is redacted and screenshots remain blocked after a fill until the client connection is released.
- Hermes factory skill `shared-web-logins` and Pi package skill `shared-web-logins`: login workflow, failure handling, MFA and verification.

## Enrollment

1. In **Hermes desktop**, open the site's login page, call `browser_vault_list`, then `browser_vault_save_login` if absent. Only the masked UI receives the identifier and password; never type them into chat or shell.
2. Check the save result includes `success: true` and `synced_to_pi: true`. If publication failed, use `browser_shared_sync_local` with the returned **local handle** once Infisical is reachable; do not re-prompt.
3. In Pi, call `frontend_vault_list`, open the exact-origin login page, type only the listed identifier, then call `frontend_vault_fill` with its `iw:` handle. Submit only with authorization and verify the authenticated page independently in each browser.
4. When a site is first encountered **in Pi**, ask the user to enroll it in Hermes desktop's masked prompt; Pi must not solicit a password in chat.

## Operational checks

- `hermes -p factory plugins list --plain --no-bundled` should show `infisical-web-logins` enabled. Its override permission is explicit in Hermes config.
- `python3 broker.py list` reports only metadata. Never run `broker.py read` in a terminal tool: its stdout is sensitive.
- A fresh Hermes session may be required after installing the plugin. Existing agent sessions can retain the old native tool handler until restarted.
- Infisical CLI authentication must remain valid for the user running both agents. An outage or expired login is reported as vault unavailable, **not** as an absent account. Do not fall back to a prompt until availability is restored.

## Limits

Exact-origin matching intentionally rejects a login saved for another SSO domain; navigate to the actual password form's origin before enrolling. Sites may still require MFA, CAPTCHA, passkeys, consent, or renewed credentials. A shared password is **not** a shared session, nor a guarantee of unattended permanent access. This integration runs as the same macOS user as both agents; an agent with unrestricted local shell access is not an adversarial sandbox against that user or the organization's Infisical administrators.

