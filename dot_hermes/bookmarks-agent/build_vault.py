#!/usr/bin/env python3
"""Build/update Obsidian vault notes from collected bookmarks.

One note per bookmark (graph node, titled) + monthly index notes + hub spine.
Idempotent: re-running rewrites everything deterministically.
"""
import json, re, sys
from pathlib import Path
from collections import defaultdict

VAULT = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain"
DEST = VAULT / "1. Flux" / "Twitter Bookmarks"
NOTES = DEST / "Notes"
AGENT = Path.home() / ".hermes/bookmarks-agent"
HUB = "[[Twitter Bookmarks]]"

THEMES = [
    ("carrer", r"\b(hiring|hire|recruit|recruiting|job|jobs|career|careers|candidate|employment|work with us)\b"),
    ("ai-agents", r"\bagent(s)?\b|claude|codex|cursor|mcp|llm|gpt|grok|gemini|openai|anthropic|nous|opus|sonnet|qwen|mlx|inference|prompt"),
    ("dev", r"code|typescript|python|rust|golang|api|git|sql|react|node|css|html|deploy|docker|kubernetes|regex"),
    ("design", r"design|ui\b|ux\b|figma|typographie|font|couleur|landing|three\.js|animation|css art"),
    ("productivite", r"productivité|workflow|notion|obsidian|calendar|routine|schedule|habitude|focus"),
    ("business", r"saas|startup|pricing|revenue|mrr|client|freelance|mission|prospection|vente|invoice"),
]

ACTIVE_PAT = r"(open.?sourc|library|tool|guide|how to|tutorial|repo|github|checklist|template|framework|liste|list of|alternative)"

# Jugement avant regex (2026-09-02, demandé par Walid) : le curator cron écrit
# désormais dans chaque record un champ `category` = nom EXACT du folder X choisi
# par jugement du domaine réel du tweet (pas par mots-clés). On le consomme en
# priorité ; THEMES ne sert plus que de fallback pour les records sans category.
CATEGORY_MAP = {
    "Carrer": "carrer",
    "AI & Agents": "ai-agents",
    "Dev": "dev",
    "Design": "design",
    "Productivité": "productivite",
    "Business": "business",
    "À lire": "non-classe",
}

# Couche 2 (2026-09-01, demandé par Walid) : sous-tags affinés, appliqués uniquement
# quand le thème primaire est ai-agents. First-match sur chaque règle, cumulables.
SUBTAGS = [
    ("ai/workflow", r"workflow|automat|pipeline|orchestrat|\bmcp\b|n8n|zapier|agent framework|hook"),
    ("ai/prompting", r"prompt|context engineering|few.?shot|system message|\bevals?\b"),
    ("ai/rag", r"\brag\b|embedding|vector|retrieval|knowledge base|chroma|qdrant"),
    ("ai/tools", r"\bcli\b|library|\brepo\b|github|open.?sourc|\btool\b|framework"),
    ("ai/to-test", r"github\.com|pypi\.org|npmjs\.com|pip install|npm (i|install)\b|git clone|docker (run|pull)|\btry (it|this)\b"),
]

def classify(t):
    """Theme primaire : champ `category` (jugement du curator) sinon fallback regex."""
    text = t.get("text") or ""
    cat = (t.get("category") or "").strip()
    if cat in CATEGORY_MAP:
        theme = CATEGORY_MAP[cat]
    else:
        tl = text.lower()
        theme = next((th for th, pat in THEMES if re.search(pat, tl)), "non-classe")
    tags = [theme]
    if theme == "ai-agents":
        tt = text.lower()
        tags += [s for s, pat in SUBTAGS if re.search(pat, tt)]
    return tags

def priority(text: str) -> str:
    return "actif" if re.search(ACTIVE_PAT, text.lower()) else "veille"

def title_of(t, idx):
    """Titre lisible et unique : première phrase du tweet sinon author."""
    txt = re.sub(r"\s+", " ", (t.get("text") or "").replace("\n", " ")).strip()
    # coupe URL/mention en fin de phrase
    txt = re.sub(r"\s*https?://\S*$", "", txt)
    for sep in [". ", "! ", "? ", " — ", ": "]:
        if sep in txt[:90]:
            txt = txt.split(sep)[0]
            break
    txt = txt.strip(" -–—:·")[:60].strip()
    if len(txt) < 8:
        txt = f"{t['author']} — {t['date'][:10]}"
    date = t["date"][:10] if t.get("date") else "nodate"
    base = re.sub(r'[\\/:*?"<>|#^\[\]]', "", f"{txt} — {t['author']}").strip()
    return f"{base} ({date})"[:110]

def note_md(t, tags, prio):
    txt = (t.get("text") or "").strip() or "(media sans texte)"
    return (
        "---\n"
        f"source: twitter-bookmark\nurl: \"{t['url']}\"\n"
        f"author: {t['author']}\nbookmarked: {t.get('date') or ''}\n"
        f"tags: [reference, twitter-bookmark, {' , '.join(tags)}]\n"
        f"priority: {prio}\n---\n\n"
        f"{HUB}\n\n"
        f"> {txt}\n\n"
        f"- 🔗 [Voir sur X]({t['url']})\n"
        f"- Auteur : [[{t['author']}]]\n"
        f"- Priorité : **{prio}**\n"
    )

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else str(AGENT / "data/bookmarks_full.json")
    bookmarks = json.load(open(src))
    NOTES.mkdir(parents=True, exist_ok=True)

    by_month = defaultdict(list)
    used_titles = set()
    counts = defaultdict(int)
    prio_counts = defaultdict(int)

    for i, t in enumerate(sorted(bookmarks, key=lambda x: x.get("date") or "")):
        t = dict(t)
        t["url"] = re.sub(r"/analytics$", "", t.get("url") or "")
        tags = classify(t)
        prio = priority(t["text"])
        title = title_of(t, i)
        n = 2
        while title in used_titles:
            title = re.sub(r" \(\d+\)$", "", title) + f" ({n})"
            n += 1
        used_titles.add(title)
        (NOTES / f"{title}.md").write_text(note_md(t, tags, prio))
        month = (t.get("date") or "unknown")[:7]
        by_month[month].append((t, title, tags))
        for tag in tags:
            counts[tag] += 1
        prio_counts[prio] += 1

    # Index mensuels : liste de wikilinks vers les notes
    for month, items in sorted(by_month.items()):
        lines = [
            "---\nsource: twitter-bookmarks\ntags: [reference, twitter-bookmark]\n"
            f"month: {month}\n---\n",
            HUB,
            "",
            f"{len(items)} bookmarks — chaque ligne pointe vers la note dédiée.",
            "",
        ]
        actives = [x for x in items if priority(x[0]["text"]) == "actif"]
        if actives:
            lines.append("## Actif\n")
            lines += [f"- 🔥 **[[{title}]]** — {t['author']}" for t, title, _ in actives]
            lines.append("")
        lines.append(f"## Veille ({len(items) - len(actives)})\n")
        active_titles = {title for _, title, _ in actives}
        lines += [f"- [[{title}]] — {t['author']}" for t, title, _ in items if title not in active_titles]
        (DEST / f"{month}.md").write_text("\n".join(lines))

    # Spine hub
    rows = "\n".join(
        f"| [[{m}]] | {len(items)} |" for m, items in sorted(by_month.items(), reverse=True))
    themes_rows = "\n".join(f"| #{k} | {v} |" for k, v in sorted(counts.items(), key=lambda x: -x[1]))
    spine = (
        "---\nsource: twitter-bookmarks\ntags: [reference, hub, twitter-bookmark]\n---\n\n"
        "# Twitter Bookmarks\n\n"
        "Archive des bookmarks X/Twitter, capturés par l'agent cron Hermes (`~/.hermes/bookmarks-agent`).\n"
        "Chaque bookmark a sa note dans `Notes/` — le graphe les relie tous à ce hub.\n\n"
        "## Matrice de priorité\n\n"
        f"| Actif (à exploiter) | Veille (lecture occasionnelle) |\n|---|---|\n"
        f"| {prio_counts['actif']} | {prio_counts['veille']} |\n\n"
        "## Par thème\n\n| Thème | Count |\n|---|---|\n" + themes_rows + "\n\n"
        "## Index mensuels\n\n| Mois | Bookmarks |\n|---|---|\n" + rows + "\n"
    )
    (DEST / "Twitter Bookmarks.md").write_text(spine)
    print(f"OK: {len(bookmarks)} bookmarks -> {len(bookmarks)} notes + {len(by_month)} index + spine")

if __name__ == "__main__":
    main()
