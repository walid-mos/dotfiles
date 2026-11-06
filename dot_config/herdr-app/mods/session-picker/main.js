import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, agents, run, nextCommand, theme, props, closeOverlay } from "herdr";

const ROW = 34;
const ROW_HEIGHT = 32;
const LIST_MAX = 340;
const DRAG_THRESHOLD = 4;
const SLIDE = { duration: 160, easing: "ease-out" };
const SETTLE_MS = 1500;

function attention(t, status) {
  if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked" || status === "done") return div().size(8).rounded(4).flex_none().bg(t[status]);
  return div().size(8).rounded(4).flex_none().border(1).border_color(t.dim);
}

function sameMachine(a, b) {
  return (a.machine ?? null) === (b.machine ?? null);
}

export default class SessionPicker extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = null;
    this.pin = null;
    this.drag = null;
    this.settled = null;
    this.input = InputState.new({ placeholder: "Filter workspaces…  ⌘1–9 jumps, Enter opens, ⌘N creates" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value().toLowerCase();
      this.at = 0;
      this.pin = null;
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.handle = cx.focus_handle();
    this.input.focus();
    cx.timer.after(400, () => { try { this.input.focus(); } catch {} });
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          const command = await nextCommand();
          if (command === "new") this.create();
          if (command === "move-up") this.move(-1);
          if (command === "move-down") this.move(1);
          const jump = /^jump-([1-9])$/.exec(command);
          if (jump) this.go(this.rows()[Number(jump[1]) - 1]);
        } catch (error) {
          console.log(`session-picker command failed: ${error}`);
        }
        cx.notify();
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  ordered() {
    const all = spaces();
    if (!this.settled) return all;
    const ids = all.map((w) => w.id);
    const same = ids.length === this.settled.length && ids.every((id, i) => id === this.settled[i]);
    const known = this.settled.every((id) => ids.includes(id)) && ids.every((id) => this.settled.includes(id));
    if (same || !known) {
      this.settled = null;
      return all;
    }
    return this.settled.map((id) => all.find((w) => w.id === id));
  }

  rows() {
    const filter = this.filter;
    return this.ordered().filter((w) => !filter || w.name.toLowerCase().includes(filter));
  }

  create() {
    this.dismiss();
    run("space.new");
  }

  move(step) {
    const w = this.rows()[this.at];
    if (!w) return;
    const all = spaces();
    const from = all.findIndex((x) => x.id === w.id);
    const neighbor = all[from + step];
    if (!neighbor || !sameMachine(neighbor, w)) return;
    this.pin = w.id;
    run("space.move", { id: w.id, index: from + step + 1 });
  }

  go(w) {
    if (!w) return;
    this.dismiss();
    const first = w.tabs.find((tb) => agents().some((x) => x.tab === tb.id && x.pane)) ?? w.tabs[0];
    if (!w.active) run("space.select", { id: w.id });
    if (first && !first.active) run("tab.select", { id: first.id });
    const a = first ? agents().find((x) => x.tab === first.id && x.pane) : null;
    if (a) run("pane.focus", { pane: a.pane });
  }

  press(w, i, e) {
    if (!e.bounds) return;
    const rows = this.rows();
    let lo = i;
    let hi = i;
    while (lo > 0 && sameMachine(rows[lo - 1], w)) lo--;
    while (hi < rows.length - 1 && sameMachine(rows[hi + 1], w)) hi++;
    this.drag = { id: w.id, from: i, slot: i, lo, hi, listTop: e.bounds.y - i * ROW, grab: e.position.y - e.bounds.y, startY: e.position.y, top: i * ROW, moved: false };
  }

  track(e, cx) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.abs(e.position.y - d.startY) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.top = e.position.y - d.listTop - d.grab;
    d.slot = Math.max(d.lo, Math.min(d.hi, Math.round(d.top / ROW)));
    cx.notify();
  }

  release(cx) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const rows = this.rows();
    const w = rows[d.from];
    if (!d.moved) {
      if (w) this.go(w);
      return;
    }
    this.pin = d.id;
    if (w && d.slot !== d.from) {
      const target = rows[d.slot];
      const index = spaces().findIndex((s) => s.id === target.id);
      if (index !== -1) {
        const order = spaces().map((s) => s.id);
        order.splice(index, 0, order.splice(order.indexOf(d.id), 1)[0]);
        this.settled = order;
        cx.timer.after(SETTLE_MS, () => { this.settled = null; cx.notify(); });
        run("space.move", { id: d.id, index: index + 1 });
      }
    }
    cx.notify();
  }

  slotOf(i) {
    const d = this.drag;
    if (!d || !d.moved || i === d.from) return i;
    if (i > d.from && i <= d.slot) return i - 1;
    if (i < d.from && i >= d.slot) return i + 1;
    return i;
  }

  row(w, i, t, rows) {
    const d = this.drag;
    const lifted = d?.moved && d.id === w.id;
    const running = agents().filter((x) => x.pane && w.tabs.some((tb) => tb.id === x.tab));
    const el = h_flex()
      .id(`wp-${w.id}`)
      .absolute()
      .left(4)
      .right(4)
      .top(lifted ? d.top : this.slotOf(i) * ROW)
      .px(10)
      .h(ROW_HEIGHT)
      .rounded(7)
      .gap(10)
      .items_center()
      .cursor_pointer()
      .when(!lifted, (el) => el.transition("top", SLIDE))
      .when(lifted, (el) => el.bg(t.popover).shadow_lg().border_1().border_color(t.accent))
      .when(!lifted && i === this.at, (el) => el.bg(t.hover))
      .when(!lifted && !d?.moved, (el) => el.hover((st) => st.bg(t.hover)))
      .on_mouse_down("left", (e) => this.press(w, i, e))
      .child(attention(t, w.status))
      .child(div().flex_1().min_w(0).truncate().text_size(12.8).text_color(t.foreground).when(w.active, (el) => el.font_semibold()).child(w.name))
      .when(running.length, (el) => el.child(div().text_size(11).text_color(t.dim).child(running.length === 1 ? "1 session" : `${running.length} sessions`)))
      .when(w.status === "blocked", (el) => el.child(div().text_size(11).font_semibold().text_color(t.blocked).child("needs you")))
      .when(i < 9 && rows.length > 1 && !d?.moved, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`⌘${i + 1}`)));
    return el;
  }

  render(cx) {
    const t = theme();
    const rows = this.rows();
    if (this.at === null) this.at = Math.max(0, rows.findIndex((w) => w.active));
    if (this.pin !== null) {
      const pinned = rows.findIndex((w) => w.id === this.pin);
      if (pinned !== -1) this.at = pinned;
    }
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));

    const lifted = this.drag?.moved ? this.drag.id : null;
    const list = rows.map((w, i) => this.row(w, i, t, rows));
    if (lifted) list.push(list.splice(rows.findIndex((w) => w.id === lifted), 1)[0]);

    return v_flex()
      .id("session-picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(12)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .on_mouse_move((e, cx) => this.track(e, cx))
      .on_mouse_up("left", (_e, cx) => this.release(cx))
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.dismiss();
        if (e.key === "down") this.at = (this.at + 1) % Math.max(1, rows.length);
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % Math.max(1, rows.length);
        else return;
        this.pin = null;
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex().items_center().px(2).pb(2)
          .child(div().flex_1().text_size(12).font_semibold().text_color(t.dim).child("GO TO WORKSPACE"))
          .child(div().text_size(11).text_color(t.dim).child("⌘N new  ·  drag or ⌥↑↓ to reorder  ·  Esc")),
      )
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("sp-list")
          .h(Math.min(LIST_MAX, Math.max(1, rows.length) * ROW))
          .min_h(0)
          .overflow_y_scrollbar()
          .child(
            div()
              .relative()
              .w_full()
              .h(Math.max(1, rows.length) * ROW)
              .children(rows.length
                ? list
                : [div().px(10).py(8).text_size(12).text_color(t.dim).child("No workspace matches. ⌘N creates a workspace.")]),
          ),
      );
  }
}
