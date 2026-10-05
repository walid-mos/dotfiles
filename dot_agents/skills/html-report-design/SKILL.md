---
name: html-report-design
description: Use for HTML reports; apply shared Pi/Hermes templates.
---

# Shared HTML report design

Use one template source for HTML reports made by Pi and Hermes. This skill is installed from the same `~/.agents/skills/html-report-design/` directory in both agents. The current default, `editorial-light`, was extracted from the daily Pi AI usage audit; other variants can be added without copying its palette into prompts or other skills.

## When to use

Load when creating or restyling a standalone HTML report, data dashboard, local audit page or report-like preview. Do not replace an existing project's explicit brand system; keep its own design rules instead.

## Procedure

1. Read `templates/manifest.json` with the harness's native file reader (`read_file` in Hermes, `read` in Pi). Use its `default` entry unless the user names a registered variant. Reject an unknown name rather than silently changing styles.
2. Read the selected `css` and `starter` paths from the manifest. For layout and accessibility decisions, read [design guidance](references/design.md). Do not rely on this skill's short description as a visual specification.
3. Adapt the starter's semantic content to the real task. Use the shared CSS as-is; put charts, tables, brand data-series colors, and product-specific behavior in a separate CSS block *after* it. Use source-backed values only: the starter's em dashes are placeholders, not example data.
4. For a portable one-file HTML deliverable, embed the selected CSS inside the document. For a local multi-file page, keep a relative CSS link and deliver both files. Keep any dynamic content escaped for its HTML/JS context.
5. Verify the resulting page opens, its primary text and muted text pass WCAG AA contrast, its focus controls are keyboard-visible, and a narrow viewport does not crop essential content. When changing the Pi audit renderer, render a real day and validate the published copy and inline JavaScript.

## Add another template

Create `templates/<variant>/base.css` and `starter.html`, then add their relative paths under a new key in `templates/manifest.json`. Keep the shared class contract (`.wrap`, `.top`, `.card`, `.grid`, `.kpi`, headings) if the Pi audit should be able to select it with `AI_USAGE_HTML_TEMPLATE=<variant>`. Change `default` only when deliberately adopting the new design for both agents and the daily job. Do not fork an entire Pi report: its data and charts remain in the report engine.

## Source and scope

- [Template manifest](templates/manifest.json) — default and available variants.
- [Design guidance](references/design.md) — roles, hierarchy, layout, accessibility.
- The live Pi report loads the default CSS in `~/Library/Application Support/ai-usage-report/build/05_render.py` and embeds it before its own chart CSS. Historical HTML archives remain self-contained snapshots.
