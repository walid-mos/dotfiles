#!/usr/bin/env python3
"""Shadow job : transfert automatique des factures reçues sur walidmostefaoui@nextnode.fr
vers l'adresse receipts Qonto (OCR côté Qonto pour lier la facture à la transaction).

Autorisation explicite de Walid (28/08/2026) : envoi automatique SANS validation,
uniclement vers DEST_TO ci-dessous. Toute autre destination est refusée en dur.

Usage :
  python3 qonto_receipts_forwarder.py            # run normal (depuis cron 2x/jour)
  python3 qonto_receipts_forwarder.py --dry-run  # ne lit, n'envoie pas
  python3 qonto_receipts_forwarder.py --backfill 2026-03-01  # traite aussi l'historique depuis cette date
"""
import json, os, re, subprocess, sys, time, smtplib, email
from email.message import EmailMessage
from email import policy
from datetime import datetime, date

# ----------------------------------------------------------------- config ----
GUARD = ["python3", "/Users/walid-mos/.config/himalaya/email-guard.py"]
ACCOUNT = "zoho"
BOXES = ["Inbox", "Archive"]
STATE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(STATE_DIR, "qonto_receipts_state.json")
LOG_FILE = os.path.join(STATE_DIR, "qonto_receipts_forwarded.jsonl")

DEST_TO = "receipts-1gfyds41so0i@inbox.qonto.com"   # SEULE destination autorisée
FROM_ADDR = "walidmostefaoui@nextnode.fr"
SMTP_HOST, SMTP_PORT = "smtp.zoho.eu", 465
KEYCHAIN = ("-a", FROM_ADDR, "-s", "hermes-himalaya-zoho")

# déployé le 28/08/2026 : par défaut on ne traite que le nouveau courrier
DEFAULT_SINCE = "2026-08-28"

# providers suivis (factures DEPENSES). Domaines matchés en sous-chaîne du From.
PROVIDERS = {
    "Anthropic":   ["mail.anthropic.com"],
    "OpenRouter":  ["openrouter.ai"],
    "Resend":      ["invoicing.resend.com"],
    "Hetzner":     ["hetzner.com"],
    "Cloudflare":  ["notify.cloudflare.com"],
    "Stripe/X":    ["stripe.com"],
    "Moonshot":    ["moonshot"],
}
SUBJECT_HINT = re.compile(r"facture|invoice|receipt|reçu|reçue|paiement|payment", re.I)
ATT_INVOICE = re.compile(r"facture|invoice|receipt|reçu|payment|paiement", re.I)
ATT_PDFISH = re.compile(r"\.(pdf|png|jpe?g)$", re.I)
ATT_NOISE = re.compile(r"logo|icon|banner|signature|avatar|badge", re.I)

# ---------------------------------------------------------------- helpers ----
def guard(args, timeout=90):
    r = subprocess.run(GUARD + args, capture_output=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr

def parse_table(out):
    rows = []
    for line in out.splitlines():
        line = line.strip()
        if not (line.startswith("│") and line.endswith("│")):
            continue
        cells = [c.strip() for c in line[1:-1].split("┆")]
        if len(cells) >= 6 and re.match(r"^\d+$", cells[0]):
            m = re.search(r"([\d.]+)\s*(KiB|MiB|B)$", cells[5])
            kib = float(m.group(1)) * (1024 if m.group(2) == "MiB" else (1/1024) if m.group(2) == "B" else 1) if m else 0
            rows.append({"id": int(cells[0]), "subject": cells[2], "from": cells[3],
                         "date": cells[4], "kib": kib})
    return rows

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"seen": {}, "last_run": None}

def save_state(st):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)

def log(rec):
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def smtp_password():
    r = subprocess.run(["security", "find-generic-password", *KEYCHAIN, "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("Mot de passe SMTP introuvable dans le trousseau")
    return r.stdout.strip()

def build_forward(orig_msg, provider, date_m):
    """Construit un transfert du message original : Fwd: + corps original + PDF en PJ."""
    msg = EmailMessage()
    msg["From"] = FROM_ADDR
    msg["To"] = DEST_TO                      # destination unique, non paramétrable
    subj = str(orig_msg.get("Subject") or "(sans objet)")
    msg["Subject"] = f"Fwd: {subj}"[:200]
    hdr = ("---------- Message transféré ----------\n"
           f"De: {orig_msg.get('From')}\nDate: {date_m}\nObjet: {subj}\n\n")
    body_text = ""
    for part in orig_msg.walk():
        if part.get_content_type() == "text/plain" and not part.get_filename():
            try:
                body_text = part.get_content()
                break
            except Exception:
                continue
    msg.set_content(hdr + (body_text.strip()[:4000] or "(pas de texte dans le mail original)"))
    return msg

def send_msg(msg):
    """Envoi SMTP direct. Destination verrouillée sur DEST_TO (déjà dans le message)."""
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as s:
        s.login(FROM_ADDR, smtp_password())
        s.send_message(msg)

def list_envelopes(box, page):
    rc, out_b, err = guard(["envelope", "list", "--account", ACCOUNT, "-m", box,
                            "--page-size", "100", "--max-width", "500", "--page", str(page)])
    if rc != 0:
        return []
    return parse_table(out_b.decode("utf-8", errors="replace"))

# ------------------------------------------------------------------- main ----
def main():
    dry = "--dry-run" in sys.argv
    since = DEFAULT_SINCE
    if "--backfill" in sys.argv:
        i = sys.argv.index("--backfill")
        since = sys.argv[i + 1] if len(sys.argv) > i + 1 else "2026-03-01"
    st = load_state()
    seen = st.setdefault("seen", {})
    actions, errors, skipped_noatt = [], [], []

    for box in BOXES:
        page = 1
        while True:
            envs = list_envelopes(box, page)
            if not envs:
                break
            stop = False
            for e in envs:
                if e["date"][:10] < since:
                    stop = True
                    break
                frm_env = e["from"].lower()
                provider_env = next((p for p, doms in PROVIDERS.items()
                                     if any(d in frm_env for d in doms)), None)
                # La colonne FROM des enveloppes est TRONQUÉE par himalaya :
                # on lit aussi les messages dont le SUJET évoque une facture,
                # puis on filtre sur le From COMPLET du MIME.
                if not provider_env and not SUBJECT_HINT.search(e["subject"]):
                    continue
                key = f"{box}:{e['id']}"
                if key in seen:
                    continue
                # lire le message
                try:
                    rc, raw, err = guard(["message", "read", "--account", ACCOUNT,
                                          "-m", box, "--raw", str(e["id"])])
                    if rc != 0 or not raw.strip():
                        errors.append(f"{box}/{e['id']} lecture KO")
                        continue
                    msg = email.message_from_bytes(raw, policy=policy.default)
                    msgid = (msg.get("Message-ID") or key).strip()
                    if isinstance(seen, dict) and msgid in seen.values():
                        continue
                    # filtre réel : From COMPLET du MIME (l'enveloppe est tronquée)
                    frm_full = str(msg.get("From") or "").lower()
                    provider = next((p for p, doms in PROVIDERS.items()
                                     if any(d in frm_full for d in doms)), None)
                    if not provider:
                        continue
                except Exception as ex:
                    errors.append(f"{box}/{e['id']} {ex!r}")
                    continue
                # pièces jointes facture
                atts = []
                for part in msg.walk():
                    fn = part.get_filename()
                    if not fn or ATT_NOISE.search(fn):
                        continue
                    data = part.get_payload(decode=True)
                    if not data or len(data) < 500:
                        continue
                    if ATT_PDFISH.search(fn) and (ATT_INVOICE.search(fn) or SUBJECT_HINT.search(e["subject"])):
                        atts.append((fn, data))
                subj = str(msg.get("Subject") or e["subject"])
                date_m = str(msg.get("Date") or e["date"])
                if not atts:
                    skipped_noatt.append(f"{provider}: {subj[:60]} ({date_m[:16]})")
                    if not dry:
                        seen[key] = msgid
                    continue
                if dry:
                    names = ", ".join(a[0] for a in atts)
                    actions.append(f"DRY {provider}: {subj[:60]} -> {len(atts)} PJ [{names}]")
                    continue
                try:
                    fwd = build_forward(msg, provider, date_m)
                    for fn, data in atts:
                        maintype, subtype = ("application", "pdf") if fn.lower().endswith(".pdf") else ("image", "png")
                        fwd.add_attachment(data, maintype=maintype, subtype=subtype, filename=fn)
                    send_msg(fwd)
                    actions.append(f"{provider}: {subj[:60]} ({len(atts)} PJ)")
                    seen[key] = msgid
                    log({"ts": datetime.now().isoformat(timespec="seconds"),
                         "provider": provider, "subject": subj, "date": date_m,
                         "attachments": [a[0] for a in atts], "to": DEST_TO})
                except Exception as ex:
                    errors.append(f"{provider} envoi KO: {ex!r}")
            if stop or len(envs) < 100:
                break
            page += 1

    st["last_run"] = datetime.now().isoformat(timespec="seconds")
    save_state(st)

    # sortie watchdog : rien si rien à dire
    lines = []
    if actions:
        lines.append(f"Forwarded {len(actions)} facture(s) vers Qonto ({'DRY-RUN' if dry else 'ENVOI REEL'}):")
        lines += [f"  - {a}" for a in actions]
    if skipped_noatt and (actions or os.environ.get("VERBOSE")):
        lines.append(f"{len(skipped_noatt)} mail(s) provider SANS PJ facture (à vérifier manuellement):")
        lines += [f"  ? {s}" for s in skipped_noatt[:10]]
    if errors:
        lines.append(f"{len(errors)} ERREUR(S):")
        lines += [f"  ! {e}" for e in errors[:10]]
    if lines:
        print("\n".join(lines))
    if errors:
        sys.exit(1)   # le cron doit alerter si un envoi a échoué

if __name__ == "__main__":
    main()
