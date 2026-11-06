import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, spaces, focused, run, setAgentOrder } from "herdr";

export const LABEL = {
  working: "Working",
  waiting: "Waiting for a result",
  idle: "Idle",
  done: "Finished",
  blocked: "Waiting for an answer",
};
const STATES = ["blocked", "working", "waiting", "done", "idle"];
const ORDER_KEY = "agent-strip.order";
const WAITING_LABEL = "agent.waiting";

function stateOrder() {
  const kept = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "null");
  const want = Array.isArray(kept) ? kept.filter((s) => STATES.includes(s)) : [];
  for (const s of STATES) if (!want.includes(s)) want.splice(STATES.indexOf(s), 0, s);
  return want;
}

export function stateColor(t, state) {
  if (state === "waiting") return t.ansi3 ?? t.muted;
  return t[state] ?? t.dim;
}

export function waitingFor(terminal) {
  const why = terminal?.labels?.[WAITING_LABEL];
  return typeof why === "string" && why.trim() ? why.trim() : null;
}

export function rootState(status, why) {
  return why && (status === "idle" || status === "done") ? "waiting" : status;
}

export function kidState(k) {
  const s = k?.status;
  return !s || s === "error" || s === "unknown" || s === "done" ? "idle" : s;
}

function rootAgent(byAddr, listed, up) {
  for (let p = up; p; p = byAddr.get(p)?.parent) if (listed.has(p)) return listed.get(p);
  return null;
}

export function entries() {
  const pile = agents();
  const byAddr = new Map(terminals().map((k) => [k.address, k]));
  const listed = new Map(pile.map((a) => [a.address, a]));
  const rows = pile.map((a) => {
    const why = waitingFor(byAddr.get(a.address));
    return { address: a.address, state: rootState(a.status, why), why, space: a.space, agent: a, sub: false };
  });
  for (const k of byAddr.values()) {
    if (listed.has(k.address) || k.state !== "live" || !k.parent) continue;
    const root = rootAgent(byAddr, listed, k.parent);
    if (root) rows.push({ address: k.address, state: kidState(k), why: null, space: root.space, agent: k, sub: true });
  }
  return rows;
}

function openAgent(address) {
  const a = agents().find((x) => x.address === address);
  if (a?.pane) run("pane.focus", { pane: a.pane });
  else run("terminal.peek", { terminal: address });
}

export function programGlyph(program, color, size) {
  if (program?.icon) {
    const fig = program.tint ? svg(program.icon).size(size) : image(program.icon).w(size).h(size);
    return fig.flex_none().text_color(color);
  }
  return div().text_size(size - 1).font_bold().text_color(color).child(([...(program?.name ?? "?")][0] ?? "?").toUpperCase());
}

function glyph(e, color) {
  if (e.state === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).text_color(color).spin(900);
  if (e.state === "blocked") return div().text_size(10.5).font_bold().text_color(color).child("!");
  if (e.state === "waiting") return svg("mods/workspace-chrome/clock.svg").size(11).text_color(color);
  return programGlyph(e.agent?.program, color, 10);
}

function focusRing(t, on) {
  return div()
    .absolute()
    .inset(-2)
    .rounded(7)
    .bg(t.accent + "2e")
    .border(1)
    .border_color(t.accent)
    .transition("opacity", 120)
    .opacity(on ? 1 : 0);
}

function square(t, view, e, color, selected) {
  return h_flex()
    .id(`sq-${e.address}`)
    .relative()
    .size(22)
    .rounded(5)
    .flex_none()
    .items_center()
    .justify_center()
    .cursor_pointer()
    .bg(color + (e.state === "blocked" ? "3a" : "26"))
    .hover((s) => s.bg(color + "55"))
    .when(view.pressed === e.state, (el) => el.opacity(0.45))
    .child(focusRing(t, e.address === selected))
    .on_hover((on, cx) => view.hoverSquare(e.address, on, cx))
    .on_mouse_down("left", (_ev, cx) => {
      view.closeCard();
      view.pressed = e.state;
      view.over = e.address;
      cx.notify();
    })
    .on_mouse_move((ev, cx) => {
      view.grid[e.address] = ev.bounds;
      if (view.pressed === null || view.over === e.address) return;
      view.over = e.address;
      cx.notify();
    })
    .on_mouse_up("left", (_ev, cx) => commit(view, e, cx))
    .child(glyph(e, color));
}

export function endDrag(view, cx) {
  const dragged = view.pressed;
  if (dragged === null) return null;
  view.pressed = null;
  view.over = null;
  cx.notify();
  return dragged;
}

function commit(view, e, cx) {
  const dragged = endDrag(view, cx);
  if (dragged === null) return;
  if (dragged === e.state) return openAgent(e.address);
  const seq = stateOrder();
  const forward = seq.indexOf(dragged) < seq.indexOf(e.state);
  const next = seq.filter((s) => s !== dragged);
  next.splice(next.indexOf(e.state) + (forward ? 1 : 0), 0, dragged);
  localStorage.setItem(ORDER_KEY, JSON.stringify(next));
}

function seam(t, view, seq, state, members) {
  if (view.pressed === null || view.pressed === state || !members.some((e) => e.address === view.over)) return null;
  const forward = seq.indexOf(view.pressed) < seq.indexOf(state);
  return div()
    .absolute()
    .w(2)
    .top(3)
    .bottom(3)
    .rounded(2)
    .bg(t.accent)
    .when(forward, (el) => el.right(-5))
    .when(!forward, (el) => el.left(-5));
}

function cluster(t, view, seq, state, groups, selected) {
  const color = stateColor(t, state);
  const items = [div().w(3).h(12).mr(1).rounded(2).bg(color + "88").flex_none()];
  groups.forEach((g, i) => {
    if (i > 0) items.push(div().w(1).h(12).mx(3).rounded(1).bg(t.border).flex_none());
    items.push(h_flex().gap(3).items_center().flex_none().children(g.map((e) => square(t, view, e, color, selected))));
  });
  const drop = seam(t, view, seq, state, groups.flat());
  if (drop) items.push(drop);
  return h_flex().relative().gap(3).items_center().children(items);
}

function bySpace(members, ranks) {
  const rank = (e) => ranks.get(e.space) ?? Infinity;
  const sorted = members.slice().sort((a, b) => rank(a) - rank(b) || String(a.space).localeCompare(String(b.space)));
  const groups = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0].space === e.space) last.push(e);
    else groups.push([e]);
  }
  return groups;
}

export function renderStrip(t, view, rows) {
  if (rows.length === 0) return div().flex_none();
  const seq = stateOrder();
  const ranks = new Map(spaces().map((s, i) => [s.id, i]));
  const selected = focused()?.terminal ?? null;
  const bricks = seq
    .map((state) => [state, bySpace(rows.filter((e) => e.state === state), ranks)])
    .filter(([, groups]) => groups.length > 0);
  setAgentOrder(bricks.flatMap(([, groups]) => groups.flat().filter((e) => !e.sub).map((e) => e.address)));
  return h_flex()
    .id("agent-strip")
    .flex_none()
    .min_w(0)
    .gap(9)
    .items_center()
    .children(bricks.map(([state, groups]) => cluster(t, view, seq, state, groups, selected)));
}
