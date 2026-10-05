# Editorial Light — usage guidance

Extends the procedure in `../SKILL.md`; the stylesheet in `../templates/editorial-light/base.css` is the authoritative source of tokens and component values.

- **Mood:** restrained, editorial, light only; no gradients on cards, saturated page backgrounds or dark-mode variant.
- **Hierarchy:** one quiet brand line, large lightweight section titles, small widely spaced uppercase labels, and tabular numerals for measurements. Introduce a metric with its unit, scope and provenance.
- **Surfaces:** warm off-white canvas, faintly tinted cards, hairline borders and generous negative space. Prefer bordered panels to drop shadows.
- **Accent:** deep lime for links, the brand dot, focus rings and narrow KPI edge; never use vivid lime as small text on white. Data-series colors are local to the product, not shared design tokens.
- **Composition:** `.wrap` for the page, `.top`/`.top-in` for a sticky header, `section`/`h2`/`.sub` for report chapters, `.grid` with `.g-kpi`/`.g-2`/`.g-3`/`.g-4`, `.card` and `.kpi` for content. `.seg`, `.chip`, `.badge`, and `button.ghost` are optional controls. The Pi audit's chart, table, tooltip, provider and scope rules are intentionally not part of this kit.
- **Accessibility:** maintain semantic headings and real button/link elements; mark decorative marks `aria-hidden`, keep focus visible, and never encode a finding only in color. Check final text contrast ≥4.5:1 (large text ≥3:1) and graphical distinctions ≥3:1. Muted text on the panel and accent on white are the critical pairs.
- **Portability:** the starter references `base.css` relatively. If producing a single-file report, embed the same CSS inside `<style>` before product-specific CSS. No external fonts, assets or scripts are required. Never copy the tokens into a second palette file.
