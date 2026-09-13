"""taskdb — base de tâches Obsidian « Brain/Tasks » pour Walid.

Principes :
- 1 fichier = 1 domaine de tâches (ex. NextNode/Clients/Pi.md, Projets/Brain v2.md).
- Zone = heading `## <Area>` dans le fichier (section_APPEND = zone par défaut).
- 1 tâche = 1 checkbox avec métadonnées inline (compatible plugin Obsidian Tasks) :
    - [ ] texte #tag ⏫ 🛫2026-09-01 📅2026-09-20 ^id12x
  ✅ date ajoutée à la fermeture. ^id = identifiant stable.
- Capture par défaut : dans le domaine demandé, sinon Inbox/Inbox.md.
- Fermeture : cochée + ✅ sur place ; « rangée » ensuite vers Archive/YYYY-MM.md.
"""
from __future__ import annotations

import random
import re
import string
from datetime import date, datetime
from pathlib import Path
from typing import Optional

BRAIN = Path(
    "/Users/walid-mos/Library/Mobile Documents/"
    "iCloud~md~obsidian/Documents/Brain"
)
DB = BRAIN / "Tasks"

DEFAULT_DOMAIN = "Inbox/Inbox"

VALID_STATUS = {"open", "wip", "done", "canceled"}
BOX = {"open": "[ ]", "wip": "[/]", "done": "[x]", "canceled": "[-]"}
PRIORITY = {"haute": "⏫", "normale": "", "basse": "⏬"}
PRIORITY_REV = {"⏫": "haute", "⏬": "basse"}

FOLDER_NOTE = {
    "Inbox": "Capture brute, tout atterrit ici par défaut.",
    "NextNode": "Tâches du métier : clients, prospection, admin.",
    "Projets": "Tâches des projets perso (Hermes AI, Brain v2…).",
    "Perso": "Tâches perso : admin, santé, maison.",
    "Archive": "Tâches closes, rangées par mois. Rien ne se supprime.",
}


# ── ids ──────────────────────────────────────────────────────────────────

def _rel(path: Path, base: Path) -> str:
    """relative_to tolérant (tests/sandbox hors vault)."""
    try:
        return str(path.relative_to(base))
    except ValueError:
        return str(path)


def new_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


# ── parsing ──────────────────────────────────────────────────────────────

_TASK_RE = re.compile(
    r"^(?P<indent>\s*)-\s+\[(?P<box>[ xX/-])\]\s+"
    r"(?P<body>.*)$"
)


def _parse_item(raw: str) -> Optional[dict]:
    m = _TASK_RE.match(raw.rstrip("\n"))
    if not m:
        return None
    body = m.group("body")
    bid_m = re.search(r"\s\^([A-Za-z0-9-]+)\s*$", body)
    bid = bid_m.group(1) if bid_m else None
    body = body[: bid_m.start()] if bid_m else body
    done_m = re.search(r"✅(\d{4}-\d{2}-\d{2})", body)
    done = done_m.group(1) if done_m else None
    due_m = re.search(r"📅(\d{4}-\d{2}-\d{2})", body)
    due = due_m.group(1) if due_m else None
    cr_m = re.search(r"🛫(\d{4}-\d{2}-\d{2})", body)
    created = cr_m.group(1) if cr_m else None
    prio = next((v for e, v in PRIORITY_REV.items() if e in body), "normale")
    tags = re.findall(r"(?<!\S)#([A-Za-zÀ-ÿ0-9_/-]+)", body)
    body = re.sub(r"[📅🛫✅]\d{4}-\d{2}-\d{2}|[⏫⏬]", "", body)
    body = re.sub(r"(?<!\S)#[A-Za-zÀ-ÿ0-9_/-]+", "", body)
    text = re.sub(r"\s+", " ", body).strip()
    if not text and not bid:
        return None
    box = m.group("box")
    if box in ("x", "X"):
        status = "done"
    elif box == "/":
        status = "wip"
    elif box == "-":
        status = "canceled"
    else:
        status = "open"
    return {
        "id": bid,
        "indent": len(m.group("indent")) // 2,  # 1 niveau = 2 espaces
        "text": text,
        "tags": tags,
        "status": status,
        "due": due,
        "created": created,
        "priority": prio,
        "done": done,
    }


def _read_file(path: Path) -> list[dict]:
    """Toutes les tâches d'un fichier, avec area + line no."""
    if not path.exists():
        return []
    out, area = [], "DEFAULT"
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        h = re.match(r"^#{2}\s+(.+?)\s*$", line)
        if h:
            area = h.group(1)
            continue
        t = _parse_item(line)
        if t:
            t["area"] = area
            t["line"] = i
            out.append(t)
    return out


# ── écriture ─────────────────────────────────────────────────────────────

def _domain_path(domain: str) -> Path:
    if not re.fullmatch(r"[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 /_-]*", domain):
        raise ValueError(f"domaine invalide: {domain!r}")
    p = (DB / domain).with_suffix(".md") if not domain.endswith(".md") else DB / domain
    if not p.resolve().is_relative_to(DB.resolve()):
        raise ValueError(f"domaine hors de {DB}: {p}")
    return p


def _ensure_file(path: Path, domain: str) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    name = path.stem
    title = name if name not in ("Inbox",) else "Inbox"
    try:
        rel = Path(_rel(path, BRAIN)).with_suffix("")
        link = f"`obsidian://open?vault=Brain&file={rel}`"
    except ValueError:  # sandbox/tests : hors vault
        link = f"`{path}`"
    body = (
        "---\n"
        f"type: hub\ncreated: {date.today().isoformat()}\n"
        "tags: [tasks]\n"
        "---\n\n"
        f"# {title}\n\n"
        f"{FOLDER_NOTE.get(name, 'Tâches du domaine ' + name + '.')}\n\n"
        f"Domaine parent : [[{DB.name}]] · ouverture auto : {link}\n\n"
        "## BACKLOG\n\n"
    )
    path.write_text(body, encoding="utf-8")


def _ensure_area(path: Path, area: str) -> None:
    txt = path.read_text(encoding="utf-8")
    if re.search(rf"^## {re.escape(area)}\s*$", txt, flags=re.M):
        return
    if not txt.endswith("\n"):
        txt += "\n"
    path.write_text(txt + f"\n## {area}\n\n", encoding="utf-8")


def _fmt_line(t: dict) -> str:
    text = t["text"]
    # retire tags/prio déjà présents dans le texte pour éviter les doublons
    text = re.sub(r"(?<!\S)#[A-Za-zÀ-ÿ0-9_/-]+", "", text)
    text = re.sub(r"[⏫⏬]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    parts = [BOX[t["status"]], text]
    tags = []
    for tg in t["tags"]:
        if tg not in tags:
            tags.append(tg)
    if tags:
        parts.append(" ".join("#" + tg for tg in tags))
    if t["priority"] != "normale":
        parts.append(PRIORITY[t["priority"]])
    if t["created"]:
        parts.append("🛫" + t["created"])
    if t["due"]:
        parts.append("📅" + t["due"])
    if t["done"]:
        parts.append("✅" + t["done"])
    parts.append("^" + t["id"])
    return "  " * t.get("indent", 0) + "- " + " ".join(p for p in parts if p)


# ── opérations ───────────────────────────────────────────────────────────

def domains() -> list[dict]:
    """Tous les fichiers-domaine, avec compteurs open. N'inclut pas Archive."""
    out = []
    for p in sorted(DB.rglob("*.md")):
        rel = Path(_rel(p, DB)).with_suffix("")
        if "Archive" in rel.parts:
            continue
        tasks = _read_file(p)
        out.append({
            "domain": str(rel),
            "open": sum(1 for t in tasks if t["status"] in ("open", "wip")),
            "done": sum(1 for t in tasks if t["status"] == "done"),
            "areas": sorted({t["area"] for t in tasks} | {"BACKLOG"}),
        })
    if not out:
        out = [{"domain": "Inbox/Inbox", "open": 0, "done": 0, "areas": ["BACKLOG"]}]
    return out


def add(
    text: str,
    domain: Optional[str] = None,
    area: str = "BACKLOG",
    tags: Optional[list[str]] = None,
    due: Optional[str] = None,
    priority: str = "normale",
    after: Optional[str] = None,
) -> dict:
    """Capture une tâche. after = id sous lequel l'indenter (sous-tâche)."""
    text = text.strip()
    if not text:
        raise ValueError("texte vide")
    dom = (domain or DEFAULT_DOMAIN).strip("/ ")
    path = _domain_path(dom)
    _ensure_file(path, dom)
    task = {
        "id": new_id(),
        "indent": 1 if after else 0,
        "text": text,
        "tags": list(tags or []),
        "status": "open",
        "due": due,
        "created": date.today().isoformat(),
        "priority": priority if priority in PRIORITY else "normale",
        "done": None,
        "area": area,
    }
    if after:
        parent = next((t for t in _read_file(path) if t["id"] == after), None)
        task["area"] = parent["area"] if parent else area
    _ensure_area(path, task["area"])
    lines = path.read_text(encoding="utf-8").splitlines()
    newline = _fmt_line(task)
    if after:
        parent = next((t for t in _read_file(path) if t["id"] == after), None)
        if parent:
            lines.insert(parent["line"] + 1, newline)
        else:
            lines.append(newline)
    else:
        lines.append(newline)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return task | {"file": _rel(path, BRAIN)}


def query(
    domain: Optional[str] = None,
    area: Optional[str] = None,
    status: str = "open",
    tag: Optional[str] = None,
    q: Optional[str] = None,
    due_before: Optional[str] = None,
    limit: int = 50,
) -> list[dict]:
    if status != "all":
        status = status if status in VALID_STATUS else "open"
    out = []
    if domain:
        files = [_domain_path(domain)]
    else:
        files = [p for p in sorted(DB.rglob("*.md")) if "Archive" not in Path(_rel(p, DB)).parts]
    for p in files:
        rel = str(Path(_rel(p, DB)).with_suffix(""))
        for t in _read_file(p):
            t = t | {"domain": rel}
            if status != "all" and t["status"] != status:
                continue
            if area and t["area"].lower() != area.lower():
                continue
            if tag and tag.lower() not in [x.lower() for x in t["tags"]]:
                continue
            if q and q.lower() not in t["text"].lower():
                continue
            if due_before:
                if not t["due"] or t["due"] > due_before:
                    continue
            out.append(t)
    prio_rank = {"haute": 0, "normale": 1, "basse": 2}
    out.sort(key=lambda t: (t["due"] or "9999", prio_rank[t["priority"]], t["domain"]))
    return out[:limit]


def set_status(ref: str, status: str) -> Optional[dict]:
    """ref = ^id (précis) ou sous-chaîne du texte (plus récente si ambigu)."""
    if status not in VALID_STATUS:
        raise ValueError(f"statut invalide: {status}")
    target, path = _find(ref=ref)
    if not target or not path:
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    old = _parse_item(lines[target["line"]])
    if not old:
        return None
    old["status"] = status
    old["done"] = date.today().isoformat() if status == "done" else None
    lines[target["line"]] = _fmt_line(old)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return old | {
        "file": _rel(path, BRAIN),
        "domain": str(Path(_rel(path, DB)).with_suffix("")),
    }


def _find(ref: str) -> tuple[Optional[dict], Optional[Path]]:
    """retrouve par ^id exact (rapide) sinon par sous-chaîne."""
    files = [p for p in DB.rglob("*.md")]
    for p in files:  # id exact d'abord
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines()):
            t = _parse_item(line)
            if t and t["id"] and t["id"] == ref:
                return t | {"line": i}, p
    hits = []
    for p in files:
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines()):
            t = _parse_item(line)
            if t and ref.lower() in t["text"].lower():
                hits.append((i, t | {"line": i}, p))
    if not hits:
        return None, None
    hits.sort(key=lambda h: (h[1].get("created") or "", h[0]))
    return hits[-1][1], hits[-1][2]
