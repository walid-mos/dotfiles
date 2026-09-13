"""Backend HTTP du plugin bookmarks-readlist — monté sous /api/plugins/bookmarks-readlist.

Expose la Read List Obsidian (Brain/1. Flux/Read List) au widget desktop.
100% read-only : les checkboxes se cochent dans Obsidian, jamais ici.
"""
import re
from pathlib import Path

from fastapi import APIRouter

VAULT = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain"
READLIST = VAULT / "1. Flux" / "Read List"

router = APIRouter()

# Une entrée : "- [ ] [Titre](url) — résumé — via @auteur — ~12 min"
ENTRY = re.compile(
    r"^-\s*\[( |x)\]\s*\[([^\]]+)\]\((\S+?)\)\s*(.*)$"
)


def _parse_month_file(path: Path):
    """Parse une note mensuelle : {month, days: [{date, entries: [...]}]}."""
    month = path.stem
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {"month": month, "days": []}

    days = []          # [{date, entries}]
    cur_day = None
    cur_heading = None
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            cur_heading = m.group(1)
            if re.match(r"\d{4}-\d{2}-\d{2}", cur_heading):
                cur_day = {"date": cur_heading, "entries": []}
                days.append(cur_day)
            else:
                cur_day = None  # ex. "## Récap de la semaine" : hors comptage
            continue
        em = ENTRY.match(line.strip())
        if em and cur_day is not None:
            checked, title, url, rest = em.group(1), em.group(2), em.group(3), em.group(4)
            via = re.search(r"via\s+(@?\w+)", rest)
            mins = re.search(r"~\s*(\d+)\s*min", rest)
            cur_day["entries"].append({
                "title": title,
                "url": url,
                "read": checked == "x",
                "via": via.group(1) if via else None,
                "minutes": int(mins.group(1)) if mins else None,
            })

    return {"month": month, "days": days}


def _months():
    return sorted(READLIST.glob("20*.md")) if READLIST.is_dir() else []


@router.get("/months")
async def list_months():
    return {"months": [p.stem for p in _months()]}


@router.get("/readlist")
async def readlist(month: str | None = None):
    files = _months()
    if not files:
        return {"exists": False, "months": [], "current": None, "data": None}
    path = files[-1] if not month else READLIST / f"{month}.md"
    if not path.exists():
        return {"exists": False, "months": [p.stem for p in files], "current": month, "data": None}
    return {"exists": True, "months": [p.stem for p in files],
            "current": path.stem, "data": _parse_month_file(path)}


@router.get("/counts")
async def counts():
    files = _months()
    if not files:
        return {"exists": False, "total": 0, "unread": 0}
    data = _parse_month_file(files[-1])
    entries = [e for d in data["days"] for e in d["entries"]]
    return {
        "exists": True,
        "month": data["month"],
        "total": len(entries),
        "unread": sum(1 for e in entries if not e["read"]),
    }
