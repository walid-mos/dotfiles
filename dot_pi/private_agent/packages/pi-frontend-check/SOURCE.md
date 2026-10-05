# Source

The owner's fork of `pi-frontend-check`, vendored into Pi. This directory is the
only copy and is not under version control: edit it in place. The fork keeps the
upstream frontend-testing tools but drives the installed Brave instead of a
downloaded Chromium build, and adds the shared Infisical vault tools
(`extensions/shared-vault.ts`) plus the `shared-web-logins` skill.

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| Upstream       | https://github.com/sebaxzero/pi-frontend-check                                             |
| Fork base      | commit `afd74c8` (branch `brave-integration`, single squashed fork commit)                 |
| Vendored on    | 2026-10-04                                                                                 |
| License        | MIT (upstream, per its README)                                                             |
| History bundle | `~/.pi/agent/git/pi-frontend-check-brave-integration.bundle` (machine-local, never synced) |
