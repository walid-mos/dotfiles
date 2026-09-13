"""Backend HTTP du plugin brain-reminders — monté sous /api/plugins/brain-reminders.

Expose la base de tâches Obsidian (Brain/Tasks) au widget desktop.
"""
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

# taskdb.py vit à la racine du plugin (un niveau au-dessus de dashboard/)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import taskdb  # noqa: E402

router = APIRouter()


class AddBody(BaseModel):
    text: str
    domain: Optional[str] = None
    area: str = "BACKLOG"
    tags: list = []
    due: Optional[str] = None
    priority: str = "normale"
    after: Optional[str] = None


class StatusBody(BaseModel):
    ref: str
    status: str


@router.get("/domains")
async def list_domains():
    return {"domains": taskdb.domains()}


@router.get("/tasks")
async def list_tasks(
    domain: Optional[str] = None,
    area: Optional[str] = None,
    status: str = "open",
    tag: Optional[str] = None,
    q: Optional[str] = None,
    due_before: Optional[str] = None,
    limit: int = 100,
):
    tasks = taskdb.query(
        domain=domain, area=area, status=status, tag=tag,
        q=q, due_before=due_before, limit=limit,
    )
    return {"tasks": tasks, "count": len(tasks)}


@router.post("/add")
async def add_task(body: AddBody):
    task = taskdb.add(
        text=body.text,
        domain=body.domain,
        area=body.area,
        tags=body.tags,
        due=body.due,
        priority=body.priority,
        after=body.after,
    )
    return {"ok": True, "task": task}


@router.post("/status")
async def set_status(body: StatusBody):
    task = taskdb.set_status(body.ref, body.status)
    if task is None:
        return {"ok": False, "error": f"introuvable: {body.ref}"}
    return {"ok": True, "task": task}


@router.get("/counts")
async def counts():
    domains = taskdb.domains()
    return {
        "open": sum(d["open"] for d in domains),
        "done": sum(d["done"] for d in domains),
        "domains": len(domains),
    }
