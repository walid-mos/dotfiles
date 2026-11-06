import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { botKey } from "./config.js";
import { clock, firstLine, plural, tint } from "./format.js";
import { avatar, button, chip, glow, icon, iconButton, note, spinner } from "./ui.js";
import { phaseOf } from "./workspaces.js";

const PHASE_COLOR = { connecting: "dim", starting: "working", setup: "working", deleting: "working", ready: "done", stopped: "dim", offline: "blocked", blocked: "blocked", failed: "blocked" };
const BUSY_PHASES = ["connecting", "starting", "setup", "deleting"];
const ALERT_PHASES = ["failed", "offline", "blocked"];

function summaryLine(model) {
  if (model.isLoading) return "Connecting to Sealskin…";
  const bots = model.workspaces.flatMap((w) => w.bots);
  const busy = bots.filter((b) => b.isBusy).length;
  return [plural(model.workspaces.length, "workspace"), plural(bots.length, "bot"), busy ? `${busy} working` : ""].filter(Boolean).join(" · ");
}

function header(t, model, actions) {
  return h_flex().h(56).px(14).gap(2).items_center().flex_none()
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(div().text_size(15).font_semibold().child("Pots"))
      .child(div().truncate().text_size(11).text_color(t.dim).child(summaryLine(model))))
    .child(iconButton(t, "pots-new-workspace", "folder-plus", actions.newWorkspace, "New workspace"))
    .child(iconButton(t, "pots-refresh", "clock", actions.refresh, "Refresh"))
    .child(iconButton(t, "pots-collapse", "panel-right", actions.collapse, "Hide Pots"));
}

function workspaceHeader(t, w, phase, actions) {
  return h_flex().px(14).pt(14).pb(6).gap(8).items_center().flex_none()
    .child(div().size(8).rounded(4).flex_none().bg(t[w.hue]))
    .child(div().truncate().text_size(12.5).font_semibold().child(w.name))
    .child(chip(t, phase.label, t[PHASE_COLOR[phase.id]]))
    .child(div().flex_1())
    .when(phase.id !== "deleting", (el) => el.child(iconButton(t, `edit-${w.home}`, "square-pen", () => actions.editWorkspace(w), "Rename, recolour or delete")))
    .when(phase.id === "ready", (el) => el.child(iconButton(t, `new-${w.home}`, "plus", () => actions.newBot(w), "New bot")));
}

function botCard(t, w, bot, { isUnread, isOpen }, actions) {
  const hue = t[w.hue];
  const preview = bot.last ? `${bot.last.person === "bot" ? "" : "You: "}${firstLine(bot.last.text ?? "", 90)}` : "No message yet";
  const ring = isOpen || isUnread ? glow(hue) : t.border;
  return h_flex().id(`bot-${w.home}-${bot.id}`).px(12).py(10).gap(11).items_center().rounded(14).flex_none()
    .border_1().border_color(ring).bg(isOpen ? tint(hue, "14") : t.background)
    .cursor_pointer().hover((s) => s.bg(isOpen ? tint(hue, "1f") : t.hover).border_color(isOpen || isUnread ? ring : t.input)).active((s) => s.opacity(0.85))
    .on_click((_e, cx) => actions.openChat(w.home, bot, cx))
    .child(avatar(t, { name: bot.name, hue, size: 38, bot }))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().truncate().text_size(13).font_semibold().child(bot.name))
        .when(isOpen, (el) => el.child(chip(t, "open", hue)))
        .child(div().flex_none().text_size(10.5).text_color(isUnread ? hue : t.dim).child(bot.last ? clock(bot.last.at) : "")))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().truncate().text_size(12).text_color(bot.isBusy ? t.working : isUnread ? t.foreground : t.muted).child(bot.isBusy ? "Working…" : preview))
        .when(isUnread, (el) => el.child(div().size(8).rounded(4).flex_none().bg(hue)))));
}

function dashedCard(t, hue, isAlert) {
  return h_flex().px(14).py(12).gap(10).items_center().rounded(14).border_1().border_dashed()
    .border_color(isAlert ? tint(t.blocked, "66") : t.border).bg(tint(hue, "0a"));
}

function phaseAction(t, w, phase, actions) {
  if (phase.id === "stopped") return button(t, { id: `start-${w.home}`, label: "Start", variant: "primary", onClick: (_e, cx) => actions.startWorkspace(w, cx) });
  if (phase.id === "failed") return button(t, { id: `retry-${w.home}`, label: "Retry", variant: "ghost", onClick: (_e, cx) => actions.retry(w, cx) });
  return null;
}

function phaseCard(t, w, phase, actions) {
  const isAlert = ALERT_PHASES.includes(phase.id);
  const action = phaseAction(t, w, phase, actions);
  return dashedCard(t, t[w.hue], isAlert)
    .when(BUSY_PHASES.includes(phase.id), (el) => el.child(spinner(t, t[w.hue])))
    .child(div().flex_1().min_w(0).text_size(12).whitespace_normal().text_color(isAlert ? t.blocked : t.muted).child(phase.hint))
    .when(Boolean(action), (el) => el.child(action));
}

function noBotsCard(t, w, actions) {
  return dashedCard(t, t[w.hue], false)
    .child(div().flex_1().min_w(0).text_size(12).whitespace_normal().text_color(t.muted).child("No bots yet"))
    .child(button(t, { id: `first-${w.home}`, label: "Create a bot", variant: "primary", onClick: () => actions.newBot(w) }));
}

function workspaceBody(t, w, phase, model, actions) {
  if (phase.id !== "ready") return [phaseCard(t, w, phase, actions)];
  if (!w.bots.length) return [noBotsCard(t, w, actions)];
  const state = (bot) => ({ isUnread: model.isUnread(w.home, bot), isOpen: model.openKey === botKey(w.home, bot.id) });
  return w.bots.map((bot) => botCard(t, w, bot, state(bot), actions));
}

function workspaceSection(t, w, model, actions) {
  const phase = phaseOf(w);
  return [workspaceHeader(t, w, phase, actions), v_flex().px(10).gap(6).children(workspaceBody(t, w, phase, model, actions))];
}

function emptyFleet(t, actions) {
  return v_flex().flex_1().items_center().justify_center().gap(10).px(24)
    .child(h_flex().size(52).rounded(16).items_center().justify_center().bg(tint(t.accent, "24")).text_color(t.accent).child(icon("folder-plus", 24)))
    .child(div().text_size(14).font_semibold().child("No workspace yet"))
    .child(div().text_size(12).text_center().whitespace_normal().text_color(t.dim).child("A workspace is an isolated desktop with its own bots."))
    .child(div().pt(6).child(button(t, { id: "pots-first-workspace", label: "Create a workspace", variant: "primary", onClick: () => actions.newWorkspace() })));
}

function railBot(t, w, bot, model, actions) {
  const hue = t[w.hue];
  const isLit = model.openKey === botKey(w.home, bot.id) || model.isUnread(w.home, bot);
  return div().id(`rail-${w.home}-${bot.id}`).p(2).rounded(12).flex_none().cursor_pointer().tooltip(`${bot.name} · ${w.name}`)
    .border_2().border_color(isLit ? glow(hue) : tint(hue, "00"))
    .hover((s) => s.bg(t.hover)).active((s) => s.opacity(0.75))
    .on_click((_e, cx) => actions.openFromRail(w.home, bot, cx))
    .child(avatar(t, { name: bot.name, hue, size: 26, bot }));
}

function railGroup(t, w, model, actions) {
  const phase = phaseOf(w);
  const mark = div().w(14).h(3).rounded(2).flex_none().bg(tint(t[w.hue], phase.id === "ready" ? "aa" : "44"))
    .when(BUSY_PHASES.includes(phase.id), (el) => el.loop("opacity", { from: 0.3, to: 1, period: 1100 }));
  return v_flex().gap(5).items_center().flex_none().tooltip(`${w.name} · ${phase.label}`)
    .child(mark)
    .children(w.bots.map((bot) => railBot(t, w, bot, model, actions)));
}

export function renderRail(t, model, actions) {
  return v_flex().size_full().pt(12).pb(8).gap(12).items_center().overflow_hidden()
    .child(iconButton(t, "pots-expand", "panel-left", actions.expand, "Show Pots"))
    .when(Boolean(model.error), (el) => el.child(div().size(8).rounded(4).bg(t.blocked).tooltip(model.error)))
    .children(model.workspaces.map((w) => railGroup(t, w, model, actions)));
}

export function renderDashboard(t, model, actions) {
  const isEmpty = !model.isLoading && !model.workspaces.length;
  const sections = model.workspaces.flatMap((w) => workspaceSection(t, w, model, actions));
  return v_flex().size_full()
    .child(header(t, model, actions))
    .when(Boolean(model.error), (el) => el.child(note(t, model.error, t.blocked)))
    .when(isEmpty, (el) => el.child(emptyFleet(t, actions)))
    .when(!isEmpty, (el) => el.child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().pb(12).children(sections)));
}
