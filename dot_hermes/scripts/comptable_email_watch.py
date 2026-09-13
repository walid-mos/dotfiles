#!/usr/bin/env python3
"""Read-only, bounded mailbox metadata collector for the Comptable cron.

It never reads message bodies, downloads attachments, or mutates mailboxes/files.
The LLM receives a compact JSON report and performs only the prioritisation.
"""
from __future__ import annotations

import json
import subprocess
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

WRAPPER = str(Path.home() / ".config/himalaya/email-guard.py")
ACCOUNTS = ("gmail", "zoho", "outlook1", "outlook2")
PAGE_SIZE = 15
COMMAND_TIMEOUT = 20

KEYWORDS = (
    "facture", "invoice", "receipt", "reçu", "recu", "avoir", "payment",
    "paiement", "prélèvement", "prelevement", "urssaf", "dgfip", "impôt",
    "impot", "fisc", "huissier", "saisie", "échéancier", "echeancier",
    "qonto", "nextnode", "fournisseur", "warning", "reminder", "overdue",
    "final payment", "service blocked", "relance", "mise en demeure",
)


def fold(value: object) -> str:
    text = str(value or "")
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", text.casefold())
        if not unicodedata.combining(ch)
    )


def run_json(args: list[str]) -> tuple[dict | None, str | None]:
    command = [sys.executable, WRAPPER, *args, "--json"]
    try:
        proc = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None, f"timeout après {COMMAND_TIMEOUT}s"
    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()
    if proc.returncode != 0:
        return None, (stderr or stdout or f"code de sortie {proc.returncode}")[-500:]
    try:
        return json.loads(stdout), None
    except json.JSONDecodeError as exc:
        return None, f"JSON invalide: {exc}"


def parse_date(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def compact_from(value: object) -> list[dict[str, str | None]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value[:3]:
        if isinstance(item, dict):
            result.append({"name": item.get("name"), "email": item.get("email")})
    return result


def is_archive_name(name: str) -> bool:
    lowered = fold(name)
    return lowered in {"archive", "[gmail]/all mail", "all mail"}


def choose_mailboxes(raw: dict) -> list[str]:
    mailboxes = raw.get("mailboxes") if isinstance(raw, dict) else None
    if not isinstance(mailboxes, list):
        return []
    names = []
    for item in mailboxes:
        if isinstance(item, dict):
            name = item.get("id") or item.get("name")
            if isinstance(name, str) and name:
                names.append(name)
    inbox = next((name for name in names if fold(name) == "inbox"), None)
    archive = next((name for name in names if is_archive_name(name)), None)
    selected = []
    for name in (inbox, archive):
        if name and name not in selected:
            selected.append(name)
    return selected


def compact_envelope(item: dict, mailbox: str, cutoff: datetime) -> dict:
    date_value = item.get("date")
    parsed = parse_date(date_value)
    subject = item.get("subject") or ""
    sender = item.get("from")
    sender_text = " ".join(
        str(part.get(key) or "")
        for part in (sender if isinstance(sender, list) else [])
        if isinstance(part, dict)
        for key in ("name", "email")
    )
    relevance_text = fold(f"{subject} {sender_text}")
    return {
        "mailbox": mailbox,
        "id": item.get("id"),
        "message_id": item.get("message-id"),
        "date": date_value,
        "recent_24h": bool(parsed and parsed >= cutoff),
        "subject": subject,
        "from": compact_from(sender),
        "has_attachment": item.get("has-attachment"),
        "flags": item.get("flags") or [],
        "relevance_hint": any(keyword in relevance_text for keyword in KEYWORDS),
    }


def main() -> int:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    report = {
        "read_only": True,
        "bodies_read": False,
        "attachments_downloaded": False,
        "generated_at_utc": now.isoformat(),
        "window_start_utc": cutoff.isoformat(),
        "accounts": [],
    }

    for account in ACCOUNTS:
        account_report: dict = {"account": account, "mailboxes": []}
        mailbox_data, mailbox_error = run_json(["mailbox", "list", "--account", account])
        if mailbox_error:
            account_report["mailbox_list_error"] = mailbox_error
            report["accounts"].append(account_report)
            continue

        selected = choose_mailboxes(mailbox_data or {})
        account_report["available_mailboxes"] = [
            item.get("name") or item.get("id")
            for item in (mailbox_data or {}).get("mailboxes", [])
            if isinstance(item, dict)
        ]
        account_report["selected_mailboxes"] = selected
        if not selected:
            account_report["mailbox_list_error"] = "Inbox/Archive introuvables dans la liste"
            report["accounts"].append(account_report)
            continue

        seen: set[tuple[str, str]] = set()
        for mailbox in selected:
            envelopes, envelope_error = run_json(
                [
                    "envelope", "list", "--account", account,
                    "--mailbox", mailbox, "--page", "1",
                    "--page-size", str(PAGE_SIZE),
                ]
            )
            mailbox_report: dict = {"mailbox": mailbox}
            if envelope_error:
                mailbox_report["error"] = envelope_error
                account_report["mailboxes"].append(mailbox_report)
                continue
            compact = []
            for item in (envelopes or {}).get("envelopes", []):
                if not isinstance(item, dict):
                    continue
                key = (str(item.get("message-id") or ""), str(item.get("id") or ""))
                if key in seen:
                    continue
                seen.add(key)
                compact.append(compact_envelope(item, mailbox, cutoff))
            mailbox_report["envelopes"] = compact
            mailbox_report["returned"] = len(compact)
            account_report["mailboxes"].append(mailbox_report)
        report["accounts"].append(account_report)

    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
