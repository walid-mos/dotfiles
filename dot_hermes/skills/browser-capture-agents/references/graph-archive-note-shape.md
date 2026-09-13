# Lesson: graph-tool archives need one titled node per item

From the X Bookmarks Curator session (2026-08-23), user corrected the output shape of v1:

**What failed**: monthly digest files where each bookmark was an inline `####` paragraph.
1. No Obsidian graph links — paragraphs inside a digest are invisible to the graph; user called the unlinked archive a miss ("le graphe visuel, c'est vraiment top d'avoir un truc qui lie vraiment").
2. Tag navigation unusable — clicking a tag listed search hits with no titles; user couldn't tell which tweet each hit was.

**Fix that satisfied him**:
- One note per captured item in `Notes/`, filename = readable title derived from content (first clause of text + author + date, sanitized of `\/:*?"<>|#^[]`, deduped with `(2)` suffixes). Each note links back to hub via first-line `[[Twitter Bookmarks]]`.
- Wikilink authors too (`[[MengTo]]`) — unresolved author nodes are acceptable; they materialize later if real notes are created.
- Monthly files become indexes of wikilinks, split "## Actif" (🔥 bold) / "## Veille" sections → tag-click results show real titles.
- Rich frontmatter per note (`source`, `url`, `author`, `bookmarked`, theme tags, `priority`) so search/filter works without opening notes.

**Rule of thumb**: if the archive lives in a graph-based tool (Obsidian, Logseq, Roam), every captured item must be its own titled node linked to the hub — never a paragraph inside an aggregate.

Related: browser-capture-agents SKILL.md and references/x-twitter-bookmarks.md describe the live deployment this came from.
