# Invoice harvesting from mailboxes (mail-received invoices)

Use this reference when Walid asks to collect all invoices from his mailboxes (e.g. "récupère toutes les factures Nextnode de mes mails"), or before building/extending the Qonto receipts forwarder. Validated end-to-end on 2026-08-29: 2 628 envelopes scanned across 4 accounts, 83 invoice attachments extracted, transfers to Qonto verified.

## Decision gate: whose invoices, which scope

- Ask/confirm the economic scope first. "Factures Nextnode" may include invoices **paid with the personal card** (Anthropic, Cloudflare 2026) that never appear in Qonto — therefore scan **all 4 accounts** (gmail, zoho, outlook1, outlook2), not just the Nextnode address.
- Inbox + Archive on every account (Walid archives after reading).
- Walid's stated criterion: **judge by the attachment's FILENAME** (facture/invoice/receipt/reçu/payment/ticket…), not the body. This deliberately keeps the job mechanical and fast.

## Pipeline that worked (3 scripts, incremental, resumable)

1. **Candidate inventory** (`Audits/<campagne>/scan_invoices.py`): himalaya `envelope list` per account/mailbox, pages of 100, stop when oldest date < since-date. Filter: date ≥ since, size > 40 KiB as the attachment proxy (`--has-attachment` was unreliable on Gmail/IMAP), noise regex (github, linkedin, newsletters, crypto…). Output `candidates.json`.
2. **MIME extraction** (`extract_invoices.py`): for each candidate, `email-guard.py message read --raw <id>` (bytes!), `email.message_from_bytes`, walk parts, save attachments whose filename matches invoice patterns into `Archives/Justificatifs/<dossier>/`. Incremental JSONL inventory (`inventory.jsonl`), flush per message, resume skips only ids already recorded **with success** (errors are retried). Name saved files `YYYYMMDD_<from-slug>_<original-name>.pdf` to dedupe collisions and make them sortable.
3. **Sort + reconcile** (`report.py`, `sort_files.py`, `reconcile.py`): group by sender into nextnode/ perso/ a_trier/ subfolders, then match against Qonto export by counterparty name + date ±7j.

## Hard-won pitfalls

- **email-guard blocks `attachment download`** by design; `message read --raw` + local MIME parsing is the sanctioned read-only way to get attachments. Never call himalaya directly for anything the guard blocks.
- **Himalaya table output is `│`-framed with `┆` column separators.** Parsing on `│` yields zero rows (lost ~30 min once). Split on `┆`, require cell[0] to be numeric.
- **`--json` is a global flag** and email-guard only inspects the first arg, so `--json` before the subcommand is blocked and after the query breaks the query parser. Parse the table instead.
- **IMAP search DSL**: `or` groups with parentheses fail on some backends (Gmail: "Could not parse command"). Use simple `subject X and after YYYY-MM-DD` queries or just list and filter locally — listing + local filtering is the robust path.
- **Message read must be bytes**: `subprocess.run(..., capture_output=True)` without `text=True`, then `out_b.decode("utf-8", errors="replace")`. Outlook messages with non-UTF8 bytes crash text-mode reads (UnicodeDecodeError).
- **Exchange/Outlook throttling**: bulk reads fail with `XOAUTH2 ... User is authenticated but not connected`. Retry with growing waits (8/16/24/32/40 s), add a 1 s sleep between Outlook reads, and abort after ~8 consecutive failures — the resume logic continues next run.
- **Read state**: `message read` WITHOUT `--seen` does not mark anything read. Keep it that way.
- A **shadow-process termination mid-run is harmless** if the inventory is append-only and resume skips successes. Expect long runs (1 300+ messages ≈ 15–30 min with throttling delays).

## Test-phase lessons (2026-08-29, forwarder dry-run + real runs)

- **Himalaya's envelope FROM column is TRUNCATED** (display name only, e.g. `"OpenRouter, Inc"` instead of `invoice+statements@openrouter.ai`). Domain matching on the envelope From alone found **1 of 21** invoices. Correct selection: envelope-From domain match **OR** subject invoice-hint → read MIME → authoritative filter on the **full `From:` header** of the message.
- **A dry-run must be side-effect-free including state**: the first dry-run marked mails as seen in the state file, which would have silently skipped them at the real run. Dry-run writes nothing.
- **Merchant brand ≠ Qonto counterparty**: Stripe/X invoices appear as `X CORP. PAID FEATURES` in Qonto, not `STRIPE`. Before asserting a match, dump the day's counterparties from the export; avoid loose substrings (`"X "` false-positives). Reclassified once after re-verification.
- **`no_agent` cron exit discipline**: print only actions/errors (silent no-op), and `sys.exit(1)` when any error occurred so the scheduler raises an alert.
- **Manual test sends must be recorded with the REAL Message-ID** read from the MIME — a placeholder marker does not protect against a later backfill double-sending the same mail.
- **Qonto's `Re: Fwd:` replies in the mailbox** are evidence a receipt was already forwarded manually — check them before backfilling to avoid duplicates.
- Validated numbers: 21 economic invoice mails on zoho since 01/03/2026 (24 attachment mails, Invoice+Receipt pairs = one payment each); 8 matched Qonto cent-level, 13 not-in-Qonto (personal card, unpaid reminder series, or post-export-cutoff).

## Known blind spot of the filename criterion

Invoices sent **without an attachment** ("voir votre facture" links — Stripe/Anthropic style) are NOT captured. A second pass over candidate senders' mail without attachments (subject/body keywords) is the identified follow-up.

## Qonto reconciliation of harvested invoices

Match by counterparty substring (ANTHROPIC, OPENROUTER, RESEND, HETZNER, CLOUDFLARE, STRIPE, MOONSHOT, CECCA) + date ±7 days against `SOURCES/qonto/extract_*.csv` (Date de l'opération (local), Montant total (TTC) with French comma decimals). Report three buckets honestly: matched at cent-level, not-in-Qonto (paid by personal card / after export cutoff), and never-paid (unpaid reminder series — e.g. Hetzner K0171521426 Warning→Reminder→Final warning with no matching debit). Invoice+Receipt pairs in the same email = ONE payment; never double count.
