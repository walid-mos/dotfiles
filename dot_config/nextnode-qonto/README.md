---
name: nextnode-qonto-forwarding
description: "Use when managing the NextNode->Qonto forwarder daemon."
version: 1.0.0
author: walid-mos
license: MIT
platforms: [macos]
metadata:
  hermes:
    tags: [Email, Invoice, Qonto, NextNode, Automation, IMAP, IDLE]
prerequisites:
  commands: [launchctl]
---

# NextNode → Qonto invoice forwarder

Event-driven daemon that watches the NextNode mailbox and forwards any
mail that looks like an invoice/payment for **NextNode** to the **Qonto**
receipt inbox (`receipts-1gfyds41so0i@inbox.qonto.com`), then archives the
original. Uses IMAP **IDLE** (no polling): reacts instantly on each new mail.

## Detection rule (the important part)

Forward when **all three** hold — in the mail BODY **or the text extracted
locally from any attached PDF** (`pypdf`, fully on-device, no cloud):
- the marker `nextnode` (case-insensitive), AND
- an amount (currency symbol/ISO, French or EN formats: `12,50 EUR`, `€ 45`,
  `$19.99` …), AND
- it LOOKS like a billing doc: an attached PDF **or** a subject with a billing
  keyword (`receipt`, `invoice`, `facture`, `reçu`, `payment`, `paiement`,
  `bill`, `order`, `#<num>` …).

The billing-keyword/PDF gate kills marketing/newsletter false positives where
`nextnode` only appears in the footer (the `@nextnode.fr` recipient) next to
any price — e.g. Field Notes "25% Off" promos had to be filtered this way.

**Always read the attached PDFs.** The NextNode billing line and the price
often live ONLY inside the PDF (email body is just "your receipt is attached").
Else you silently miss genuine invoices (real data: the OpenRouter, Resend, X
and GitHub-invoice receipts were all missed until PDF text was read).

PDF attachment is **not** required to forward: a mail without a PDF can still
match if its body has NextNode billing + an amount. A mail matching only one
of the two conditions is skipped. The `To: @nextnode.fr` recipient header must
NOT count as the vendor marker — match body/PDF text only. **Amounts <= 0
($0.00, €0) are never forwarded.**

Forwarded mail = the original PDF attached when present; otherwise the whole
original message attached as `.eml` (so Qonto still gets a retrievable doc).

### Sender / subject exclusions (user-confirmed)

- Sender blocklist: `qonto.com` (don't bounce Qonto's own mail back to it),
  `huissier95.fr` (URSSAF debt-collection). Do NOT block `cecca.f`/`cecca.fr`
  — it issues plenty of **real** invoices.
- Subject blocklist for non-invoice admin mail from trusted senders:
  `urssaf`, `dgfip`, `direction générale des finances`, `point rdv`, `tva 2t`,
  `s.elarl`, `affaire`, `price changes` — these are legal/tax filings / pricing
  notifications, not purchase invoices. Dynadot "price changes" is excluded
  this way but Dynadot's real domain invoices still pass.

## Robustness: don't miss (design invariants)

- **Scan = INBOX + Archive** every cycle over a recent window (45 d). Because
  the user archives read mail, an invoice archived while the daemon was down
  is still caught on the next pass.
- **Dedup by Message-ID** (global), not by UID (UIDs are per-folder and change
  on move) — a mail is never forwarded twice even when it moves folders.
- **Baseline on first run**: on startup the daemon marks every mail in the
  window as seen WITHOUT forwarding, so the whole history is not blasted into
  Qonto (would duplicate the manu forward). Only new mail is forwarded.
  Clearing `state.json` re-runs the baseline.
- **Second-pass local Gemma**: for PDF mails the regex does NOT flag, the
  daemon asks Hermes' own locally-launched Gemma (`hermes -m <gemma> -z`,
  free/on-device) whether it is a NextNode invoice, and forwards if yes.
  Failures/timeouts return None → skipped, never wrong-blasted.

## Convention: "archive = inbox" (user habit)

The user archives essentially every mail after reading it, so the `Archive`
folder holds all the real content. Treat INBOX **and** `Archive` together as
the reading/search scope: any inbox triage, review, or search over recent
history MUST include `Archive`. New mail still lands in INBOX first, which is
what the live IDLE watcher reacts to; `Archive` is where processed and read
mail accumulates.

## Key facts / files

- Account: `walidmostefaoui@nextnode.fr` (Zoho). IMAP `imappro.zoho.eu:993`,
  SMTP `smtppro.zoho.eu:465`. Password in macOS keychain
  (`service himalaya-cli, account walid-mostefaoui-nextnode`), read at runtime
  via `security find-generic-password` — never stored in a config file.
- Qonto target: `receipts-1gfyds41so0i@inbox.qonto.com` (whitelisted; sending
  allowed).
- Archive folder on Zoho: `Archive` (MOVE, or COPY+delete fallback).
- Script: `~/.config/nextnode-qonto/forwarder.py`
- venv:   `~/.local/share/nextnode-qonto/venv`
- state:  `~/.local/share/nextnode-qonto/state.json` (baselined flag + list of
  processed Message-IDs for dedup across folders)
- logs:   `~/.local/share/nextnode-qonto/forwarder.log`,
  daemon stdout/stderr: `daemon.out.log` / `daemon.err.log`
- LaunchAgent: `~/Library/LaunchAgents/com.walid.nextnode-qonto.plist`

## Commands

Run once (safe test, nothing sent/archived):
```bash
~/.local/share/nextnode-qonto/venv/bin/python \
  ~/.config/nextnode-qonto/forwarder.py once --dry
```

Review recent history as a dry-run (INBOX + Archive, no send/archive).
Returns a per-mail verdict table; useful to check detection accuracy:
```bash
~/.local/share/nextnode-qonto/venv/bin/python \
  ~/.config/nextnode-qonto/forwarder.py review --since 15
```

Backfill: forward the invoice history in the window that has NOT already
been sent to Qonto (detected via Qonto's "Re: Fwd …" confirmations from
*.qonto.com). `--dry` only lists the plan:
```bash
# plan first (nothing sent)
~/.local/share/nextnode-qonto/venv/bin/python \
  ~/.config/nextnode-qonto/forwarder.py catchup --dry
# real backfill (sends + archives)
~/.local/share/nextnode-qonto/venv/bin/python \
  ~/.config/nextnode-qonto/forwarder.py catchup
```

Run once, real (process everything new, send + archive):
```bash
~/.local/share/nextnode-qonto/venv/bin/python \
  ~/.config/nextnode-qonto/forwarder.py once
```

Daemon status / logs:
```bash
launchctl list | grep nextnode
pgrep -fl forwarder.py
```
`LastExitStatus` is the 3rd column of `launchctl list`; `0` = previous run clean.

```bash
tail -30 ~/.local/share/nextnode-qonto/forwarder.log
```

Stop / start the daemon:
```bash
UID=$(id -u)
launchctl bootout gui/$UID/com.walid.nextnode-qonto   # stop
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.walid.nextnode-qonto.plist  # start
```

## Known detection weaknesses (real-data findings)

With PDF text read on-device, the two-condition rule catches genuine NextNode
receipts (OpenRouter, Resend, X, Cloudflare, GitHub invoice + payment
receipt). The email-body-only version wrongly concluded these receipts "don't
mention NextNode" — false, they just keep NextNode + billing inside the PDF.

Current real-data detection on a 15-day review (179 mails): 6 flagged, of
which 5 genuine receipts and 1 expected noise:
- **Scanned/image PDFs** have no text layer → `extract_text()` returns empty,
  so amount-in-scan invoices are still missed (would need OCR).
- **Consumer orders vs invoices**: a Field Notes "Order …" confirmation
  (no PDF, `nextnode` only in footer) still passes the keyword gate — decide
  per case before backfilling; don't auto-blast such mails to Qonto.

### Local model note

The PDF text extraction is `pypdf` — 100% local and free (no LLM, no cloud).
Hermes' local Gemma (`llamacpp`), launched on demand via `hermes -m
<gemma> -z`, is wired as a **second-pass safety net** (see Robustness): it
only fires for PDF mails the regex did not flag, so a failure never loses a
mail the regex already caught. `USE_LOCAL_LLM_SECOND_PASS` in the script
flips it; launching takes ~25 s per call (model loads on demand).

## Pitfalls

- **Don't count the recipient header as the vendor marker.** Every mail in that
  box is addressed `@nextnode.fr`, so matching headers makes every priced mail
  an "invoice". Match the body only.
- Never resend blindly after a send error: a Zoho SMTP success with a failed
  save-to-Sent can duplicate mail. The daemon only archives after a successful
  `send_message`, so a failed forward leaves the mail in INBOX instead of
  silently dropping it.
- The daemon reconnects on IDLE errors and re-establishes a fresh IDLE every
  ~60 min (Zoho can drop long-lived IDLE connections).
