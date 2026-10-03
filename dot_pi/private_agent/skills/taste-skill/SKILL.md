---
name: taste-skill
description: Guide-only reference of anti-slop frontend aesthetics, distilled from Leonxlnx/taste-skill. Style dials (VARIANCE / MOTION / DENSITY), palette rotation, typography discipline, layout anti-templates, AI-tell bans, pre-flight checks. Landing pages, portfolios, marketing surfaces only, never dashboards or product UI. Guide role - load via /skill:taste-skill when a design task needs style presets or style-strength calibration; the impeccable skill stays the active design gatekeeper and wins on conflict.
disable-model-invocation: true
---

# Taste-skill (distilled guide)

Vendored reference. The full untruncated upstream text lives in `upstream/SKILL.md` (1207 lines); this file is the curated working set.

## Role and hierarchy

- **Guide, never driver.** This skill carries no commands, scripts, or hooks. It supplies style presets and bans as reference material.
- **`impeccable` is the active gatekeeper.** When both apply, hierarchy is: the brief > impeccable (SKILL.md, craft-floor, detectors) > this reference. Extract what fits the brief; never let this file drive the workflow or override impeccable's craft-floor.
- **Scope:** landing pages, portfolios, marketing/editorial surfaces. Out of scope (upstream §13): dashboards, dense product UI, data tables, wizards, code editors, native mobile — there, use impeccable's Operate mode and say this skill does not apply.
- **Redesigns:** read upstream §11 first (detect preserve vs overhaul, audit before touching, URL/nav/form/analytics things never change silently).

## The three dials (§1, §7)

Set explicitly, reasoned from the brief; baseline `8 / 6 / 4` only when nothing overrides it. State the values before generating.

| Band | DESIGN_VARIANCE | MOTION_INTENSITY | VISUAL_DENSITY |
|---|---|---|---|
| 1-3 | Symmetric 12-col grid, equal padding, centered | No auto animation; `:hover`/`:active` CSS only | Art gallery: `py-32`-`py-48`, huge gaps |
| 4-7 | Offsets, overlaps, mixed aspect ratios, left-aligned headers | Fluid CSS transitions on `transform`/`opacity`, stagger cascades | Daily app: `py-16`-`py-24` |
| 8-10 | Masonry, fractional grids (`2fr 1fr`), massive empty zones (`padding-left: 20vw`) | Scroll choreography (GSAP ScrollTrigger / CSS scroll-driven) | Cockpit: tight padding, no cards, 1px separators, `font-mono` numbers |

Quick inference (§1.A): minimalist/Linear → 5-6 / 3-4 / 2-3 · premium consumer → 7-8 / 5-7 / 3-4 · Awwwards/agency → 9-10 / 8-10 / 3-4 · trust-first/public-sector → 3-4 / 2-3 / 4-5 · redesign-preserve → match existing, +1 motion · redesign-overhaul → +2 / +2 / match.

Mobile override: variance ≥ 4 collapses to strict single column below `md:`.

## Palette discipline (§4.2, §4.11)

- **LILA rule:** no AI-purple/neon-glow default. Neutral base (zinc/slate/stone) + one high-contrast accent. Max 1 accent, saturation < 80% by default.
- **Color consistency lock:** one accent used identically on the whole page; one palette per project (never mix warm and cool grays).
- **Premium-consumer ban:** beige/cream + brass/clay/oxblood/ochre + espresso is banned as the default reach for cookware/wellness/artisan/luxury briefs. Rotate instead: Cold Luxury (silver/chrome), Forest (deep green/bone/amber), Black and Tan, Cobalt + Cream, Terracotta + Slate, Olive + Brick + Paper, monochrome + one saturated pop. Never ship the beige+brass family twice in a row.
- **Page theme lock:** one theme per page (light, dark, or `prefers-color-scheme`); sections never invert mid-scroll. No pure `#000`/`#fff` — off-black and off-white.

## Typography (§4.1)

- Not as defaults: `Inter` (sans), `Fraunces`, `Instrument Serif` (the two LLM-favorite display serifs). Default sans display: Geist, Satoshi, Cabinet Grotesk, Outfit, or brand-appropriate.
- Serif only with explicit brand/editorial/luxury justification; rotate from a pool, never the same serif twice in a row.
- Emphasis inside a headline: italic or bold of the SAME family. Never inject a different family for one word.
- Italic + descender (`y g j p q`) in display type: `leading-[1.1]` min + `pb-1` reserve, or the descender clips.

## Layout anti-templates (§4.7, §4.9)

- **Hero fits the initial viewport:** headline ≤ 2 lines, subtext ≤ 20 words and ≤ 4 lines, CTA visible without scroll, top padding ≤ `pt-24`. Max 4 text elements; no tagline below CTAs, no trust strip inside the hero — logo walls live under the hero.
- **Eyebrow cap (mechanical):** ≤ 1 uppercase/tracking micro-label per 3 sections, hero counts as one.
- **Split-header ban:** no "big headline left + small explainer floating right" section header; stack vertically instead.
- **Zigzag cap:** max 2 consecutive image+text alternating sections.
- **Layout repetition:** each layout family appears at most once per page; ≥ 4 different families across 8 sections.
- **Bento:** N items → N cells (no empty cells); at least 2-3 cells get real visual variation (image, gradient, pattern), not all text-on-white.
- **No 3-equal feature cards.** Long lists (> 5 items) get a different component: 2-col grouped split, card grid, tabs, scroll-snap pills, or marquee — never a default `<ul>` with a hairline under every row.
- Hero must contain a real visual asset; a text + gradient blob hero is a placeholder. No div-based fake screenshots ever.

## Images and social proof (§4.8)

Image-gen tool first, then `picsum.photos/seed/<descriptive-seed>/<w>/<h>`, then clearly labeled placeholder slots plus a request for real assets. Logo walls use real SVG logos (Simple Icons / devicon) or generated marks, never plain text wordmarks, and carry no category labels under each logo.

## Copy and AI tells (§9, §4.9-§4.10)

- **Em-dash ban, binary:** zero `—` and zero `–` used as a separator anywhere visible (headlines, body, quotes, captions, buttons). Use hyphen, period, colon, or restructure.
- No generic names (Jane Doe), no fake-perfect numbers (`99.99%`) — use organic realistic data or label mock data; no filler verbs ("Elevate", "Seamless", "Unleash").
- Banned decorations: version labels in hero (`BETA`, `V0.6`), section-number eyebrows (`001 · Capabilities`), scroll cues, locale/weather/time strips, decorative status dots, version footers on marketing pages, decoration text strips at hero bottom, pills overlaid on images, photo-credit captions, micro-meta sentences under eyebrows.
- Quotes ≤ 3 lines, attribution name + role. One copy register per page. Re-read every visible string before shipping: broken grammar and cute-but-wrong AI copy get rewritten.

## Motion (§5, §6)

- Every animation justifiable in one sentence (hierarchy, storytelling, feedback, state transition); "it looked cool" is not a reason. Motion claimed = motion shown: if the dial is > 4, the page must actually move — otherwise drop the dial to 3 and ship clean static.
- Marquee: max one per page. No `window.addEventListener('scroll')` and no scroll state in React — use Motion `useScroll`, GSAP ScrollTrigger, or IntersectionObserver. Animate only `transform`/`opacity`.
- `prefers-reduced-motion` is mandatory for anything above motion 3; infinite loops, parallax, and physics collapse to static.
- GSAP sticky-stack / horizontal-pan: `start: "top top"`, `pin: true`, scrub only the inner track — canonical skeletons in upstream §5.A-§5.C.
- Performance targets: LCP < 2.5s, INP < 200ms, CLS < 0.1; grain filters only on fixed `pointer-events-none` layers; restrained z-index scale.

## Pre-flight check (§14)

Before delivering, run the mechanical sweep — the condensed version:

dials declared · em-dash count = 0 · one theme · one accent · one radius system · CTA contrast AA and no wrapped CTA labels · form contrast AA · no banned serif/palette default · hero fits viewport with ≤ 4 text elements · eyebrow count ≤ sections/3 · no duplicated CTA intent · logo wall under hero with real SVGs · no div fake screenshots · real images present · every motion motivated and reduced-motion-safe · no `window.addEventListener('scroll')` · mobile collapse explicit (`min-h-[100dvh]`, never `h-screen`) · loading/empty/error states present · no §9 tells.

The full 60-item matrix is in `upstream/SKILL.md` §14; run it for landing-page deliverables. Any failed box means the page is not done.

## Files

- `upstream/SKILL.md` — full upstream text. Load when you need exact wording, the redesign protocol (§11), the pattern vocabulary (§10), the design-system map (§2), or the appendices (install commands, canonical doc links, Apple Liquid Glass approximation).
- `upstream/LICENSE` — MIT, upstream license text.
