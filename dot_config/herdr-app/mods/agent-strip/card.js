import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, hc } from "herdr";
import { LABEL, kidState, programGlyph, rootState, stateColor, waitingFor } from "./strip.js";

const LETTER = /[\p{L}\p{N}]/u;
const NOISE = /[^ \p{L}\p{N}]/gu;

const duration = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

const cut = (s, n) =>
  s.length <= n ? s : (s.lastIndexOf(" ", n) > 24 ? s.slice(0, s.lastIndexOf(" ", n)) : s.slice(0, n)).trimEnd() + "\u2026";

function tailLines(text) {
  const raw = text.split("\n");
  const kept = [];
  for (let i = raw.length - 1; i >= 0 && kept.length < 2; i--) {
    const line = raw[i].replace(/[\u2500-\u25ff]/gu, " ").replace(/[\t ]+/g, " ").trim();
    const marks = line.match(NOISE)?.length ?? 0;
    const letters = line.replace(NOISE, "").length;
    const words = line.split(" ").filter((w) => LETTER.test(w)).length;
    if (words < 3 || marks > 6 || letters / (letters + marks) < 0.74) continue;
    kept.unshift(cut(line, 88));
  }
  return kept;
}

export async function loadExcerpt(address) {
  const r = await hc(["read", address, "--lines", "18"]);
  return r.code !== 0 ? [] : tailLines(r.stdout);
}

function face(address) {
  const all = terminals();
  const k = all.find((x) => x.address === address);
  const a = agents().find((x) => x.address === address);
  if (a) {
    const name = [a.space_name, a.title || a.program?.name || a.tab_name].filter(Boolean).join(" \u2014 ");
    const why = waitingFor(k);
    return { state: rootState(a.status, why), why, name, program: a.program };
  }
  const up = all.find((x) => x.address === k?.parent);
  return {
    state: kidState(k),
    why: null,
    name: k?.where || (up ? `sub-agent of ${up.agent ?? up.address}` : "sub-agent"),
    program: k?.program,
  };
}

export function renderCard(t, view) {
  const f = face(view.address);
  const color = stateColor(t, f.state);
  const elapsed = view.since ? duration(Date.now() - view.since) : "";
  const lines = view.excerpt;
  return h_flex()
    .id("hover-card")
    .w(356)
    .h(120)
    .rounded(12)
    .bg(t.popover)
    .border(1)
    .border_color(t.border)
    .child(div().w(4).h_full().bg(color).flex_none())
    .child(v_flex()
      .flex_1()
      .min_w(0)
      .p(12)
      .gap(7)
      .child(h_flex()
        .gap(7)
        .items_center()
        .child(programGlyph(f.program, color, 11))
        .child(div().flex_none().font_semibold().text_size(12).text_color(color).child(LABEL[f.state] ?? "Idle"))
        .when(Boolean(f.why), (el) => el.child(div().min_w(0).truncate().text_size(10.5).text_color(t.muted).mt(1).child(f.why)))
        .when(Boolean(elapsed), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).mt(1).child(elapsed))))
      .child(div().truncate().text_size(13).font_semibold().text_color(t.foreground).child(f.name))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .gap(2)
        .children((lines === undefined ? ["\u00a0", "\u00a0"]
          : lines.length ? lines : ["no output"]).map((line) =>
          div().truncate().text_size(11.5).whitespace_nowrap().text_color(t.muted).child(line)))));
}
