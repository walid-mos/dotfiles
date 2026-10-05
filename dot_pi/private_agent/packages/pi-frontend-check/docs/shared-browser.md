# Managed shared browser — opt-in Pi and Hermes website-session sharing

The default for every Pi session and Hermes task is one isolated browser of its own: separate process and its own per-session persistent profile, no shared tabs, cookies or authentication. Concurrent sessions sharing one browser fight over tabs and cookies; do not point several sessions at one browser.

This doc covers the OPTIONAL managed shared browser, used only when several agents must deliberately reuse one signed-in website session: one dedicated headless Brave process, one persistent default context, and separate agent-owned tabs. Website sessions are shared; unrelated tabs, viewport and page navigation are not. This is a trusted same-user browser, not an isolation boundary between agents.

## Ownership

- `scripts/shared-browser.py`: authoritative launchd service, endpoint and profile paths. `--no-startup-window` keeps process startup free of restored task tabs; agents create their own tabs. This retains profile authentication, not past task windows. No browser dependency download and no changes to personal Brave.
- `~/Library/LaunchAgents/fr.nextnode.agent-browser.plist`: generated service; launchd owns process start, crash recovery and login-time start.
- `~/.local/share/agent-browser/profile/`: live persistent browser profile, mode `0700`; never store it in a scratch directory, repo, cloud-synced folder or Infisical.
- `~/.local/share/agent-browser/logs/`: private service diagnostics.
- Hermes **factory**: supported `browser.cdp_url` setting; the managed browser is external to Hermes' per-task inactivity cleanup.
- Pi: `CDP_URL` in `~/.pi/agent/frontend-check.json`; `FrontendBrowser` connects to the default context, creates its own page and observes only its own descendants. Reset, cancellation and shutdown close owned pages and disconnect, not the shared browser or other agents' tabs.

Only one process may own the profile directory. Agents attach over CDP; never launch another browser on the same directory. Never call `Browser.close` through raw CDP, `context.close`, `clearCookies`, or whole-profile deletion from an agent flow. In maintenance scripts, do not unload and immediately reload a launchd job: teardown is asynchronous and immediate bootstrap can fail; keep the registered job for a restart and wait for a changed healthy browser endpoint.

## Setup

Opt-in only: default Pi and Hermes settings do not point at the managed browser. From this package, with Brave installed in `/Applications`:

```bash
python3 scripts/shared-browser.py install
python3 scripts/shared-browser.py configure --hermes-profile factory
python3 scripts/shared-browser.py status
```

`configure` writes the supported Hermes setting through its CLI and preserves unrelated Pi settings. It changes only the explicitly named Hermes profile. Hermes rereads the endpoint for browser calls; an already-running Pi instance needs `/reload`. Fresh Pi sessions load it immediately.

The endpoint is loopback-only (`http://127.0.0.1:9222`). CDP grants access to the signed-in browser: do not bind it to LAN/all interfaces or expose it through a proxy. No sandbox-disabling, TLS-bypass, real-profile snapshot, personal-browser cookie copying, or password-store workaround is used.

## Website sign-in

Open the site with Hermes `browser_exec`, then use the existing vault tools for passwords or the masked `browser_vault_enter_code` prompt for OTP. Confirm a genuinely authenticated page, not only a filled field. Pi's `frontend_open` can then access the same origin through the same default browser context without a second login.

Infisical remains the shared origin-bound **credential** vault. Cookies and refresh tokens stay in the browser profile and never enter model output or Infisical. Read only cookie names/domain/expiry when diagnosing persistence.

A persistent profile prevents local cleanup from discarding sessions; it cannot override server-side logout, revocation, expiry, MFA or CAPTCHA. Cookie expiry alone does not prove an active or indefinitely renewable session. Independent incognito contexts do not inherit this authentication.

## Operations

```bash
python3 scripts/shared-browser.py status
python3 scripts/shared-browser.py restart
python3 scripts/shared-browser.py stop
```

`restart` sends a non-forced SIGTERM to the registered job, lets launchd's KeepAlive restart it, and waits for a **new** healthy browser endpoint. It preserves the profile and avoids an unload/reload race with launchd teardown. `stop` unloads the job without deleting data; `restart` starts it again. Never use forced process killing as routine maintenance. Service startup occurs when the macOS user logs in after reboot, not before login. Because the plist carries `RunAtLoad`, a stopped service relaunches at the next login; to retire it until the next `install`, move `~/Library/LaunchAgents/fr.nextnode.agent-browser.plist` out of `LaunchAgents` (the profile is retained).

Keep Brave updated through its normal installation. After a Brave or Playwright update, rerun the package checks and verify a signed-in page from both agents. Back up the profile only after a graceful stop and through a private, access-controlled local backup; a profile is sensitive account access, not a shareable artifact.

## Verification

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run test:browser
```

Existing regression suites use default `CDP_URL: ""` and keep clean isolated contexts. `frontend_scenarios` and cold-URL diff browsers remain isolated even when interactive browsing uses CDP. They must not mutate or inherit signed-in account state.

Also exercise the real shared flow: authenticate in Hermes; open the protected URL through Pi's actual `frontend_open`; shut down Pi and confirm Hermes' tab survives; gracefully restart the managed browser and confirm a **fresh** Pi and Hermes connection still reach the protected page. A passing isolated suite alone does not verify this sharing.

If the shared endpoint is unavailable, interactive Pi fails explicitly rather than silently launching a signed-out ephemeral browser. Diagnose with `status` and restart the managed service. Do not disable sharing to hide an outage.
