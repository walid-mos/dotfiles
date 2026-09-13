"""brain_tasks — lecture/écriture du fichier Brain/Tasks.md (append-only).

Format d'une ligne :
  - [ ] YYYY-MM-DD [projet] texte — #attente #fatto ##quick
Statuts via tags : #attente (en attente, défaut), #fatto (fait),
                   #annule (annulé), #quick (rappel rapide/sans projet).
Tri : plus récent en premier (le fichier est append-only, on ajoute en fin).
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Optional

BRAIN = Path("/Users/walid-mos/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain")
TASKS = BRAIN / "Tasks.md"

HEADER = """---
type: log
created: 2026-09-01
tags: [meta, tasks]
---

# Tasks — rappels & follow-ups

Append-only. Une ligne = un rappel. Écrit par Hermes.
Tags : #attente (en attente) · #fatto (fait) · #annule (annulé) · #quick (sans projet)
"""

_LINE = re.compile(
    r"^\s*-\s+\[(?P<box>[ xX])\]\s+"
    r"(?P<date>\d{4}-\d{2}-\d{2})\s+"
    r"(?:\[(?P<project>[^\]]+)\]\s+)?"
    r"(?P<text>.*?)\s*$"
)

VALID_STATUS = {"attente", "fatto", "annule"}


def _parse_line(line: str, idx: int) -> Optional[dict]:
    m = _LINE.match(line)
    if not m:
        return None
    tags = re.findall(r"#([A-Za-zÀ-ÿ0-9_-]+)", m.group("text"))
    status = next((t for t in tags if t in VALID_STATUS), None)
    # Un checkbox coché impose fatto sauf si #annule explicite.
    if m.group("box") != " " and status not in ("annule",):
        status = "fatto"
    status = status or "attente"
    rest = [t for t in tags if t not in VALID_STATUS and t != "quick"]
    return {
        "idx": idx,
        "raw": line.rstrip("\n"),
        "date": m.group("date"),
        "project": m.group("project") or None,
        "text": m.group("text"),
        "status": status,
        "tags": rest,
        "quick": "quick" in tags or m.group("project") is None,
    }


def read_tasks(path: Path = TASKS) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        t = _parse_line(line, i)
        if t:
            out.append(t)
    return list(reversed(out))  # récent en premier


def list_tasks(
    status: Optional[str] = None,
    project: Optional[str] = None,
    quick: Optional[bool] = None,
    limit: int = 50,
    path: Path = TASKS,
) -> list[dict]:
    tasks = read_tasks(path)
    if status:
        tasks = [t for t in tasks if t["status"] == status]
    if project:
        p = project.lower()
        tasks = [t for t in tasks if t["project"] and t["project"].lower() == p]
    if quick is not None:
        tasks = [t for t in tasks if t["quick"] == quick]
    return tasks[:limit]


def counts(path: Path = TASKS) -> dict:
    tasks = read_tasks(path)
    c = {"attente": 0, "fatto": 0, "annule": 0, "total": len(tasks)}
    for t in tasks:
        c[t["status"]] += 1
    return c


def add_task(
    text: str,
    project: Optional[str] = None,
    status: str = "attente",
    tags: Optional[list[str]] = None,
    when: Optional[date] = None,
    path: Path = TASKS,
) -> dict:
    text = text.strip().strip("-• ")
    if not text:
        raise ValueError("texte vide")
    status = status if status in VALID_STATUS else "attente"
    parts = [t.strip("# ") for t in (tags or []) if t.strip("# ")]
    parts = [t for t in parts if t not in VALID_STATUS] + [status]
    if project is None:
        parts.append("quick")
    if parts:
        text = f"{text} — " + " ".join(f"#{t}" for t in parts)
    d = (when or date.today()).isoformat()
    line = f"- [ ] {d} " + (f"[{project}] " if project else "") + text
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(HEADER, encoding="utf-8")
    body = path.read_text(encoding="utf-8").rstrip("\n")
    path.write_text(body + "\n" + line + "\n", encoding="utf-8")
    return _parse_line(line, 0) | {"raw": line}


def set_status(
    needle: str,
    status: str,
    path: Path = TASKS,
) -> Optional[dict]:
    """Retrouve la tâche par sous-chaîne (insensible casse) et change son statut."""
    if status not in VALID_STATUS:
        raise ValueError(f"statut invalide: {status}")
    lines = path.read_text(encoding="utf-8").splitlines()
    hits = []
    for i, line in enumerate(lines):
        t = _parse_line(line, i)
        if t and needle.lower() in t["text"].lower():
            hits.append((i, t))
    if not hits:
        return None
    if len(hits) > 1:
        # ambigu : on prend le plus récent (fichier append-only → index le plus grand)
        hits = [hits[-1]]
    i, t = hits[0]
    # Ambigu ou pas de tag de statut : on passe par la sous-chaîne, plus fiable.
    new = re.sub(r"#attente\b", f"#{status}", t["raw"], count=1)
    if new == t["raw"] and f"#{t['status']}" in t["raw"]:
        new = t["raw"].replace(f"#{t['status']}", f"#{status}", 1)
    if new == t["raw"]:
        new = f"{t['raw']} #{status}"
    if status == "annule":
        new = new.replace("- [ ]", "- [-]", 1)
    elif status == "fatto":
        new = new.replace("- [ ]", "- [x]", 1)
    else:  # ré-ouvrir
        new = new.replace("- [x]", "- [ ]", 1).replace("- [-]", "- [ ]", 1)
    lines[i] = new
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return _parse_line(new, i)
