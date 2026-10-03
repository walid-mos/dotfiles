# Boat operations — lifecycle mechanics and proven environment facts

Extends the "Command map" and "Auth" sections of `SKILL.md`; the core rules are not restated here.
Facts marked *observed* were verified live on sandbox `bx_5jgvdcgb` (default size, baremetal,
2026-09-27); re-verify before relying on them.

## Stop / resume mechanics (observed)

- `boat stop <id>`: state `stopping` → `stopped`, snapshot `in_progress` → `completed`, ~4 min.
  Billed nothing while stopped. `boat info --json` nests under `sandbox` (not top level).
- `boat resume <id>`: ready in < 1 min, lands in state `idle`/`ready`, gets a **new internal IP**,
  and `archiveAfter` re-arms — the TTL clock restarts on every resume.
- What returns after resume: systemd (unit states intact — `docker.service` came back active),
  files on the disk, installed packages. What does NOT return: hand-run processes (a `nohup sleep`
  was gone). Anything that must survive a stop/resume cycle is a systemd unit — the sandbox has
  passwordless sudo, so write `/etc/systemd/system/<name>.service` and `systemctl enable --now` it.
- Fork inherits the source's type unless `--type` says otherwise; snapshots can be named
  (`boat snapshot <id> <name>`) and sandboxed from (`boat new --from <name>`).

## Inside the sandbox (observed on the current image)

- Ubuntu 24.04 LTS, x86_64, kernel-level TUN available (`/dev/net/tun` exists — KVM may or may
  not exist depending on the host; `ls /dev/kvm` to check).
- Login user is `user` (uid 1000, in the `docker` group, passwordless sudo). `/root` is not
  readable; work in `/home/user`. Disk: `/dev/vda1` (12 GB usable on `small`).
- Preinstalled: Node 24 + npm + corepack + pnpm, git, gh, jq, rg, Docker + Compose (daemon runs
  on boot), Chrome, ffmpeg, and agent harnesses (`pi`, `claude`, `codex`, … — each signs in with
  its own `login` command; Boat's preinstalled Pi may lack local extensions/skills).
- First `boat ssh` run mints `~/.ssh/ascii_box_ed25519` on the local Mac and registers it.
- Registry pulls work; egress is open. `python3 -m http.server` etc. available for quick probes.

## GitHub private clones (current setup)

- Boat's GitHub integration is OFF (`boat env set base --github false`) — the operator has no
  admin on the target org, so an org-level Boat GitHub App cannot be installed.
- Instead: dedicated key `~/.ssh/github_boat` (ed25519, no passphrase) whose public half is on the
  operator's GitHub account; the private half is injected into sandboxes as environment secret
  file `.ssh/github_boat` (env `base`). In the sandbox: `chmod 600`, then
  `GIT_SSH_COMMAND="ssh -i ~/.ssh/github_boat"` for clones.
- Fallback if the org enforces SAML SSO: HTTPS clone + classic PAT (one "Enable SSO" click,
  user-level) or Git Credential Manager with the browser session. No admin needed either way.
- Repos cannot be selected via CLI (`env add-repo` needs a Boat-connected repo) — dashboard-only,
  and moot while the integration is off.

## Tailscale on a sandbox (proven once)

- Not preinstalled. Install with the official script: `curl -fsSL https://tailscale.com/install.sh | sh`
  (adds the apt repo; `tailscaled` enabled + active, survives resume via systemd).
- Enrol with an **ephemeral, tagged, reusable** auth key so repeat enrolments leave no residue:
  `sudo tailscale up --authkey="$KEY" --hostname=<name>`. The operator's key lives in Infisical
  (project `core-vault`, env `main`, secret `TAILSCALE_AUTHKEY_BOAT`) — fetch it with the local
  CLI (`infisical secrets get TAILSCALE_AUTHKEY_BOAT --projectId ce69a081-6aec-472d-9ee8-edbb7ed2b72e --env main -o json`)
  and pass it through a shell variable so the value never lands in logs.
- MagicDNS worked; `*.ts.net` names resolve and answer from other tailnet devices. The ephemeral
  node disappears from the tailnet when the sandbox stops; on resume, re-run `tailscale up` with
  the still-valid key (another reason the key must be reusable).

## Cost reality checks

- `boat usage <id>` gives the per-sandbox bill with the size multiplier applied — use it to close
  out a work session instead of estimating.
- Stopped sandboxes are free and keep their disk; stop a sandbox when a work block ends rather
  than letting the TTL run it down.
