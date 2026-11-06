import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme, layout, settings, window, run } from "herdr";

function attention(t, status) {
  if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked" || status === "done") return div().size(8).rounded(4).flex_none().bg(t[status]);
  return div().size(8).rounded(4).flex_none().border(1).border_color(t.dim);
}

export default class CurrentSession extends View {
  render() {
    const t = theme();
    const root = layout(), w = window();
    const lights = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom)
      : 10;
    const space = spaces().find((p) => p.active);

    return h_flex()
      .id("session-now")
      .size_full()
      .pl(lights + 10)
      .items_center()
      .min_w(0)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("session-pill")
          .flex_1()
          .min_w(0)
          .h(32)
          .px(12)
          .gap(9)
          .items_center()
          .rounded(16)
          .border(1)
          .border_color(t.border)
          .bg(t.raised)
          .cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            run("mod.open", { name: "session-picker" });
          })
          .hover((st) => st.bg(t.hover))
          .child(attention(t, space?.status))
          .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(space?.name ?? "Home"))
          .child(
            h_flex().flex_none().px(7).h(21).rounded(11).items_center().bg(t.chrome).text_size(10.5).text_color(t.dim)
              .child("⌘K"),
          ),
      );
  }
}
