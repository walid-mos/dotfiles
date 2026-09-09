# Studio workspaces

A small, single-host development-environment manager for **Apple Container**, Herdr and host-side Pi. Read [ARCHITECTURE.md](ARCHITECTURE.md) for the approved target and ownership contract.

## Source and installation

The authoritative source is `~/.local/share/chezmoi/bootstrap/workspace/`. On the current Studio, `~/Development/tools/workspace` is a convenience symlink to it. The Desktop architecture document links to `ARCHITECTURE.md` here; there is only one editable copy.

Runtime dependencies on the Studio: Node >=24, Git, Apple Container, Herdr, Pi, Caddy, dnsmasq and socat. No Docker daemon or Compose is used. `assets/Containerfile` is built by **Apple Container**.

The server bootstrap profile installs these dependencies, builds/reuses the development image, installs the official Pi integration and runs `scripts/install-host.py --admin sudo`. The installer generates `~/.local/bin/wt` with absolute executable/source paths.

Run `npm ci --ignore-scripts` to install the manager's locked dependencies. Its only runtime package, `jsonc-parser`, reads native Wrangler JSONC without evaluating project code. `npm test` uses Node's native TypeScript support; TypeScript and Node type definitions are development dependencies for `npm run check`. Bootstrap installs these dependencies; the manager no longer borrows Pi's `node_modules`.

## Daily commands

From a supported project repository, inside Herdr—no `.workspace.json` required:

```sh
wt trust                     # Approve the resolved environment after reviewing native dev configuration
wt open my-feature           # Create/reuse compute and its Herdr workspace
wt open my-feature --no-focus
wt status
wt shell <workspace-id>
wt stop my-feature           # Keep source, branch, Pi session and durable data
wt remove my-feature --confirm <workspace-id>
```

`wt remove` requires a clean worktree, no busy/blocked/unknown agents, exact confirmation and native Git removal. It **retains the branch and persistent data**. It has no wildcard prune or `rm -rf` fallback. There is intentionally no automatic persistent-data purge command in the first version.

`wt open <feature> --no-ui` prepares an environment without Herdr topology. `wt ensure`, `wt locate` and `wt exec <id> '<command>'` are the execution adapter's internal operations; project work should ordinarily use Pi or its development terminal.

The existing zsh `wt` function delegates to the CLI. `ws`, `wtn` and `wts` are aliases for the same `wt open` workflow. Open a fresh shell after migration so previously cached zsh function bodies are not retained. Legacy helpers/hooks are backed up under `~/.pi/agent/backups/workspace-migration-20260909/`.

Opening a workspace with an idle restored terminal reattaches that terminal to Linux. The manager checks Herdr's foreground-process information first and refuses to type into another running command. Pi resumes its official Herdr session reference when available; a new pane uses Pi's latest session for that worktree, or starts a new one if none exists.

## Simple project defaults

The configuration-free path supports the current stack: Node 24, pnpm 11, and one Astro frontend using its default port. It reads the root package and immediate `apps/*` and `packages/*` manifests; standalone Astro projects are supported too. Different toolchains/layouts are not guessed. No profile registry or plugin framework is involved.

`src/default-recipe.ts` resolves the environment from existing files:

- `package.json` declares the toolchain and normal `pnpm dev` entry point.
- Dependencies install in Linux with the frozen pnpm lockfile.
- Native `wrangler.dev.jsonc` files identify persistent `.wrangler` directories and D1 bindings/migration folders. Migrations explicitly use **local** D1, never `--remote`.
- Shared defaults provide the development image, CPU/RAM limits and host-edit polling.
- The runtime sets a workspace-local `TURBO_CACHE_DIR`; Turbo must not write caches into the unmounted main checkout through shared Git metadata.

The resolved environment is approved per repository with `wt trust`. Changes to package commands, Turbo/workspace configuration or Wrangler settings invalidate approval. Each checkout is resolved and checked before starting compute; native config is not silently inherited from main. Commit native configuration changes before opening new branches, or bring them into existing features explicitly. Unmanaged pnpm development projects are blocked by `wt locate`, so Pi cannot fall back to macOS merely because `.workspace.json` is absent.

Existing explicit `.workspace.json` recipes remain readable for compatibility (feature first, then main), but are not required by the normal workflow and are never merged with inferred defaults. The shared image contains tooling and execution helpers, not application startup scripts.

### fitApp verification

fitApp uses its ordinary `pnpm dev`; its package tasks and Turbo environment forwarding preserve the frontend/API service binding, the feature-specific authentication origin and Astro's foreground lock workaround. Its README documents those native settings. A disposable copy was opened without `.workspace.json` and verified for private HTTPS, frontend-to-API signup, host-edit HMR/WebSockets, and successful signin after full container recreation with the same local D1 data. The user's active feature was not restarted.

## What is shared

Apple Container image/layer storage is reused automatically. Worktrees, installed dependencies, processes and D1 state are independent.

The first implementation does **not** contain a speculative PostgreSQL/Redis provisioning framework. fitApp does not need one. General shared-engine providers, supported package-cache reuse and capacity-aware resource pooling remain later extensions of the architecture. Unknown resource sharing is never guessed or enabled implicitly.

## Files and identity

Each workspace has an opaque SHA-256-derived identity based on the canonical Git common directory and exact branch name. Names such as `feature/a` and `feature-a` cannot collapse into one directory. Hostnames include a short identity suffix to avoid normalized-name collisions.

Worktree files and Git common metadata are mounted at their **same absolute Studio paths** inside Linux. Only the selected checkout, required Git metadata and this workspace's execution/persistence directories are mounted. No whole-home mount is used.

State defaults to `~/.local/share/studio-workspace/`:

| Path | Purpose |
|---|---|
| `workspaces/<id>.json` | Exact identities, phase, recipe revision, Herdr association |
| `trusted/<project-id>/<digest>.json` | Explicit recipe approvals |
| `files/<id>/runs/` | Per-command requests, cancellation and completion protocol |
| `files/<id>/prepare.log` | Dependency/migration preparation output |
| `files/<id>/application.log` | Application output |
| `files/<id>/tmp/` | Host-readable tool artifacts; supplied as guest `TMPDIR` |
| `files/<id>/application.sock` | Apple-published application socket |
| `persistent/<id>/` | Data retained across compute rebuild/removal |
| `gateway/` | Generated DNS/routes and Caddy state |
| `locks/` | Exclusive repository/resource lifecycle operations |

Do not commit state, credentials or CA keys. `WT_STATE_HOME` and `WORKTREES_BASE` exist for isolated tests; never point tests at user data.

Interrupted locks fail explicitly rather than stealing a possibly active lock. Inspect the exact lock's PID and workspace state; only after verifying the owner is gone should that exact lock be removed and the operation retried. Automatic stale-lock recovery is not claimed in this version.

## Execution and cancellation

Pi's `bash` and `!` backends call `wt exec`. Provisioning is owned by `wt open`/`ensure`, not Pi. A stopped, failed or untrusted managed environment never falls back to native execution.

The guest runner creates a separate process group. Abort/timeout writes a cancellation marker visible inside the guest. The runner terminates the guest group and reports completion before the transport exits. If guest completion is not confirmed, the operation reports uncertainty and preserves the execution request for diagnosis; stop the workspace before retrying.

The Studio `host` tool is an explicit administration escape hatch. Pi's direct file tools remain host-backed: this architecture is development isolation, not confinement of a malicious agent. Git worktrees share their repository metadata by design.

## Private DNS and HTTPS

Example URLs on the reference Studio:

```text
https://dev-a-c9740d0c.fitapp.herdr.test
https://dev-b-8b73419f.fitapp.herdr.test
```

No purchased/public domain is required.

Implementation:

1. dnsmasq answers only the private `herdr.test` zone on unprivileged loopback port 5354.
2. Caddy runs as the Studio user on loopback port 8443; its admin API also binds loopback only.
3. Small root-owned launchd socket relays bind standard 53/443 only on loopback and, after authentication, the explicit Studio Tailscale address. Accepted relay connections drop privileges to the user.
4. `/etc/resolver/herdr.test` configures Studio-side split DNS. This does not modify unrelated DNS domains.
5. Tailscale split DNS must point the `herdr.test` zone to the Studio's tailnet IP for the MacBook.
6. Caddy terminates TLS and proxies over **Apple Container's native published Unix sockets**, not changing VM IPs. The guest relay forwards to the application's ordinary loopback port. HTTP/1.1, HTTP/2 and WebSockets are supported; HTTP/3 is disabled because it is not forwarded by this topology.

Native socket publication was selected after a live test found macOS denying a background gateway's IP connection to the VM. Socket publication also removes IP parsing/reassignment from the routing path.

Caddy owns its private CA and automatic leaf-certificate renewal. The installer trusts the public root certificate in the current user's login keychain; an elevated noninteractive trust operation was rejected by macOS, so certificate trust deliberately runs in the normal user context.

Public certificate to transfer to the MacBook:

```text
~/.local/share/studio-workspace/gateway/data/caddy/pki/authorities/local/root.crt
```

**Never copy the CA private key.** Compare the certificate SHA-256 fingerprint over a trusted channel and trust that certificate on each intended client. Tailscale encryption does not replace browser certificate trust.

## Host setup and remote prerequisites

Host administration entry point:

```sh
python3 scripts/install-host.py --admin prompt
```

Bootstrap uses `--admin sudo` after its normal sudo authorization. `--admin none` installs the user services and prepares the privileged plan without running it. The native administrator prompt never sends a password to the agent/chat.

The installer handles transient launchd bootout/bootstrap races with a bounded retry. It does not alter mDNSResponder or weaken macOS trust authorization. UDP DNS relaying uses `RECVFROM`, avoiding the persistent connected-UDP listener behavior that failed during initial testing.

At initial implementation, the Studio's Homebrew `tailscaled` **was already running as a root LaunchDaemon**, but reported `Logged out` and had no saved account profiles. Browser authorization resolved this, and the installer subsequently bound the Studio's tailnet address. DNS and HTTPS through that address were verified on the Studio; this is not a MacBook end-to-end test.

The owner selected IP-based infrastructure listeners rather than depending on the MagicDNS hostname. The installer discovers the address from `tailscale status`; project recipes never hardcode it. Reconnects/reboots retain a device's Tailscale IP. After an actual device identity/address replacement, rerun the host installer and update the split-DNS nameserver; automatic identity-change reconciliation is not implemented.

On a fresh installation, authenticate first, rerun the host installer to bind the tailnet address, then configure Tailscale **restricted nameserver / split DNS** for `herdr.test`. This tailnet-admin setting is not silently changed without account access. Allow the intended clients to reach Studio TCP 443 and UDP/TCP 53 under the tailnet policy.

## Reboot policy

Herdr configuration sets `resume_agents_on_restore = false`: restore terminal topology first, not every feature's compute. `wt open` starts/reuses the selected environment and resumes its Pi session. Restored development terminals reattach through the foreground-process check.

Caddy/dnsmasq are user LaunchAgents. Port relays and tailscaled are root LaunchDaemons. User services become available after the Studio user session starts/unlocks; this is not a promise of availability before FileVault unlock/login. No full reboot was performed during installation because active work must not be interrupted.

If a container was changed/stopped outside the manager, `wt gateway` refreshes route availability and `wt open` reconciles the selected environment. Socket identities avoid accidentally routing to a different container that reused an IP.

## Verification

```sh
npm test
npm run check
node scripts/acceptance.ts <dev-a-id> <dev-b-id>
NODE_EXTRA_CA_CERTS=<root.crt> node scripts/hmr-acceptance.mjs <hostname> <disposable-worktree>
```

The real-runtime acceptance script is deliberately restricted to `dev-a`/`dev-b` fixtures. It creates and removes a temporary D1 test table, stops/reopens one environment, and leaves both usable. Never point it at valuable feature data.

Checks include Git/path parity, guest cancellation, timeout, independent local D1 state, simultaneous feature URLs, fail-closed stopped execution, sibling survival, persistence after reopen, private WebSockets and HMR after a host-side edit. Unit tests cover trust invalidation, collision-safe identity, unsafe-path rejection, exact ownership, dirty removal and guest-runner termination.

Remaining verification: MacBook access after tailnet login/configuration and certificate trust; full Studio reboot recovery; broader projects/service providers; backup restore and performance under larger concurrency. These are not represented as passing merely because local tests pass.
