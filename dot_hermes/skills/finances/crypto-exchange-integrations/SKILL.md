---
name: crypto-exchange-integrations
description: Use when reading crypto exchange accounts via API.
category: finances
---

# Crypto exchange API integrations

## When to Use

- User wants to see or track someone else's (or their own) crypto positions live via an exchange API.
- Questions about Revolut crypto data access: statements/CSV export, API availability, third-party trackers.
- Setting up Revolut X API keys (Ed25519) or live portfolio valuation (public prices + private quantities).

## Landscape (verified by web research, 2026-09)

- **Revolut crypto (classic app)**: NO API, no portfolio/family sharing, no third-party sync. The only data exit is the CSV/PDF statement: Profile → *Documents et relevés* → *Crypto* → *Relevé de compte*, period **Lifetime**, format Excel/CSV. Columns: date, type (buy/sell/receive/send), asset, quantity, fiat value, fee, balance.
- **Revolut X** (exchange.revolut.com, the standalone advanced exchange): full REST API with **Ed25519-signed** requests. Official open-source tooling by revolut-engineering: npm CLI `@revolut/revolut-x-cli` (the `revx` command) and an MCP server, both on GitHub `revolut-engineering/revolut-x-api`.
- **No third-party SaaS tracker syncs Revolut X live.** CoinStats, Delta, Kubera, AllInvestView, Pulse: no Revolut X integration. Waltio accepts a Revolut X API key but only for tax reports, not live tracking. Don't send the user hunting through trackers for Revolut X — the answer is the official CLI/API.

## Live tracking for a third party (e.g. family member's account)

The correct security model — no secrets ever change hands:

1. **Generate the Ed25519 keypair locally** on the tracking machine (see `references/revolut-x-api.md` for the exact method).
2. The account owner pastes the **public key** into Revolut X web (Profile → API keys → + New).
3. They receive an **API key** (64-char alphanumeric) and hand only that over.
4. Requests are signed with the local private key; the API key alone is useless for signing, and keys can be revoked by the owner at any time.

Security rules: private key stays local and chmod 600; never ask for or accept the owner's password; for read-only monitoring take the minimum permissions Revolut X offers (no trade permissions); verify what the CLI does before trusting it with a key (it is open source — auditable).

## Pitfall: key generation on macOS

The system `/usr/bin/openssl` (LibreSSL) does **not** support `ed25519` — `openssl genpkey -algorithm ed25519` fails with `Algorithm ed25519 not found`. Do not fight it; generate with Python `cryptography` instead (needs a venv on this machine, PEP 668). Working snippet in `references/revolut-x-api.md`.

## Pricing layer

Current crypto/fiat prices are public and free (CoinGecko, CoinCap) — live valuation of positions never requires account access. Only the *quantities* come from the exchange API. This split (public prices + private quantities) is the basis of every cheap live-tracking setup.

## Reference

- `references/revolut-x-api.md` — Revolut X auth/signing details, endpoints, keygen snippet, `revx` CLI quick reference, and validation status of the integration.
