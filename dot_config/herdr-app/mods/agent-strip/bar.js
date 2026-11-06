import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, keys, window, run } from "herdr";
import { renderStrip, endDrag } from "./strip.js";

function paletteHint(t) {
  const mac = window()?.platform === "macos";
  const mod = { cmd: "\u2318", ctrl: "\u2303", shift: mac ? "\u21e7" : "Shift+", alt: mac ? "\u2325" : "Alt+" };
  const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
  const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
  const key = parts?.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
  return key ? `${key}  commands` : "commands";
}

export function renderBar(t, view, rows) {
  const space = spaces().find((s) => s.active);
  const list = agents();
  const needs = list.filter((a) => a.status === "blocked").length;
  const folder = (space?.folder ?? "").split("/").filter(Boolean).pop();
  const chip = (iconName, label, color) => h_flex()
    .gap(6)
    .items_center()
    .flex_none()
    .child(svg(`mods/workspace-chrome/${iconName}.svg`).size(13).text_color(color ?? t.muted))
    .child(div().child(label));
  const dot = () => div().flex_none().text_color(t.border).child("\u00b7");
  const rule = () => div().w(1).h(13).bg(t.border).flex_none();
  return h_flex()
    .id("agent-bar")
    .size_full()
    .px(14)
    .gap(10)
    .items_center()
    .bg(t.chrome)
    .border_t(1)
    .border_color(t.border)
    .text_size(11.8)
    .text_color(t.muted)
    .on_mouse_up("left", (_e, cx) => endDrag(view, cx))
    .on_hover((on, cx) => on || endDrag(view, cx))
    .child(chip(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
    .child(dot())
    .child(renderStrip(t, view, rows))
    .child(h_flex()
      .gap(6)
      .items_center()
      .flex_none()
      .child(div().size(6).rounded(3).bg(t.dim))
      .child(`${list.length} agents`)
      .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`\u00b7 ${needs} needs you`))))
    .child(dot())
    .child(chip("folder", folder || "\u2302", t.dim))
    .child(rule())
    .when(Boolean(space?.branch), (el) => el.child(chip("branch", space.branch, t.accent)))
    .child(div().flex_1())
    .child(div().flex_none().min_w(0).truncate().text_color(t.dim).on_click(() => run("app.palette", {})).child(paletteHint(t)));
}
