import { div, svg } from "gpui-kit";
import { h_flex, Input, v_flex } from "gpui-base";
import { HUES } from "./config.js";
import { initial, tint } from "./format.js";

const ICONS = "mods/workspace-chrome";
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const TYPING = ["●  ", "●● ", "●●●", " ●●", "  ●", "   "];
const ALPHA = { wash: "24", edge: "4d", glow: "99", none: "00" };
const SPIN_FRAME_MS = 80;

export const presenceColor = (t, bot) => (bot?.isBusy ? t.working : bot?.isLive ? t.done : t.dim);
export const presenceWord = (bot) => (bot?.isBusy ? "working…" : bot?.isLive ? "online" : "offline");
export const glow = (color) => tint(color, ALPHA.glow);
export const icon = (name, size) => svg(`${ICONS}/${name}.svg`).size(size);

export function avatar(t, { name, hue, size, bot }) {
  const radius = Math.round(size * 0.32);
  const dot = Math.max(9, Math.round(size * 0.3));
  return div().relative().size(size).flex_none()
    .child(h_flex().size(size).rounded(radius).items_center().justify_center()
      .bg(tint(hue, ALPHA.wash)).border_1().border_color(tint(hue, ALPHA.edge))
      .text_size(Math.round(size * 0.45)).font_semibold().text_color(hue).child(initial(name)))
    .when(Boolean(bot), (el) => el.child(div().absolute().bottom(-1).right(-1).size(dot).rounded(dot / 2)
      .bg(presenceColor(t, bot)).border_2().border_color(t.surface)
      .when(bot.isBusy, (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1100 }))));
}

export function iconButton(t, id, name, action, tip) {
  return div().id(id).p(6).rounded(8).text_color(t.muted).cursor_pointer().flex_none().tooltip(tip)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .active((s) => s.opacity(0.7))
    .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(icon(name, 15));
}

export function chip(t, label, color) {
  return h_flex().h(20).px(8).rounded(10).items_center().flex_none()
    .bg(tint(color, ALPHA.wash)).text_size(10.5).font_medium().text_color(color).child(label);
}

export function note(t, text, color) {
  return div().px(16).py(8).text_size(12).whitespace_normal().text_color(color).child(text);
}

export function spinner(t, color) {
  return div().flex_none().w(14).text_size(12).text_color(color).child(div().frames(SPIN, SPIN_FRAME_MS).child(SPIN[0]));
}

export function button(t, { id, label, variant, isDisabled = false, onClick }) {
  const isPrimary = variant === "primary";
  return h_flex().id(id).h(32).px(14).items_center().rounded(9).flex_none()
    .bg(isPrimary ? t.solid : t.raised).border_1().border_color(isPrimary ? t.solid : t.input)
    .text_color(isPrimary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
    .when(isDisabled, (el) => el.opacity(0.5))
    .when(!isDisabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.9)).active((s) => s.opacity(0.75)).on_click(onClick))
    .child(label);
}

export function field(t, label, state) {
  return v_flex().gap(5)
    .child(div().text_size(11.5).text_color(t.dim).child(label))
    .child(Input.new(state).h(34).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground));
}

function swatch(t, hue, isSelected, onPick) {
  return div().id(`hue-${hue}`).size(26).rounded(13).p(3).flex_none().cursor_pointer()
    .border_2().border_color(isSelected ? t.foreground : tint(t[hue], ALPHA.none))
    .hover((s) => s.border_color(isSelected ? t.foreground : t.muted)).active((s) => s.opacity(0.75))
    .on_click((_e, cx) => onPick(hue, cx))
    .child(div().size_full().rounded(8).bg(t[hue]));
}

export function swatches(t, label, selected, onPick) {
  return v_flex().gap(6)
    .child(div().text_size(11.5).text_color(t.dim).child(label))
    .child(h_flex().gap(8).children(HUES.map((hue) => swatch(t, hue, hue === selected, onPick))));
}
