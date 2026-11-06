import { div } from "gpui-kit";
import { h_flex, InputState, v_flex } from "gpui-base";
import { closeOverlay, notify, props } from "herdr";
import { HUES } from "./config.js";
import { plural, tint } from "./format.js";
import { deleteWorkspace, launchWorkspace } from "./manager.js";
import { rememberWorkspace } from "./registry.js";
import { button, field, swatches } from "./ui.js";
import { slugify } from "./workspaces.js";

const FOCUS_RETRY_MS = 600;
const failureText = (e) => e?.message ?? String(e);

export class WorkspaceForm {
  constructor(p, cx) {
    this.home = p.home ?? null;
    this.hue = p.hue ?? HUES[0];
    this.botCount = p.botCount ?? 0;
    this.name = InputState.new({ placeholder: "Name", value: p.name ?? "" });
    this.name.on("change", (_e, cx) => cx.notify());
    this.name.on("submit", (_e, cx) => this.submit(cx));
    this.name.focus();
    cx.timer.after(FOCUS_RETRY_MS, () => this.name.focus());
    this.handle = cx.focus_handle();
    this.isBusy = false;
    this.isConfirmingDelete = false;
    this.error = null;
  }

  get isEditing() { return Boolean(this.home); }
  get targetHome() { return this.home ?? slugify(this.name.value()); }

  close() { closeOverlay(props().overlay); }

  run(cx, work) {
    if (this.isBusy) return;
    this.isBusy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try { await work(); this.close(); } catch (e) { this.error = failureText(e); } finally { this.isBusy = false; cx.notify(); }
    });
  }

  submit(cx) {
    const name = this.name.value().trim();
    const home = this.targetHome;
    if (!name) return;
    if (!home) { this.error = "Use at least one letter or digit in the name"; cx.notify(); return; }
    if (this.isEditing) { rememberWorkspace(home, { name, hue: this.hue }); this.close(); return; }
    this.run(cx, async () => {
      await launchWorkspace(home);
      rememberWorkspace(home, { name, hue: this.hue });
      notify({ title: `${name} is starting`, body: "Its desktop boots in the background", level: "success" });
    });
  }

  remove(cx) {
    if (!this.isConfirmingDelete) { this.isConfirmingDelete = true; cx.notify(); return; }
    this.run(cx, async () => {
      await deleteWorkspace(this.home);
      rememberWorkspace(this.home, { name: this.name.value().trim(), hue: this.hue });
      notify({ title: `${this.name.value().trim()} is being deleted`, body: "Its desktop stops and its home is erased", level: "success" });
    });
  }

  dangerZone(t) {
    const warning = `Stops the desktop and erases its home, ${plural(this.botCount, "bot")} and every conversation. This cannot be undone.`;
    const label = this.isConfirmingDelete ? "Delete for good" : "Delete workspace";
    return v_flex().mt(4).p(12).gap(8).rounded(12).border_1().border_color(tint(t.blocked, "4d")).bg(tint(t.blocked, "0a"))
      .child(div().text_size(11.5).whitespace_normal().text_color(this.isConfirmingDelete ? t.blocked : t.muted).child(warning))
      .child(h_flex().justify_end()
        .child(h_flex().id("pw-delete").h(30).px(12).items_center().rounded(9).flex_none().cursor_pointer()
          .bg(this.isConfirmingDelete ? t.blocked : tint(t.blocked, "00")).border_1().border_color(t.blocked)
          .text_size(12.5).font_medium().text_color(this.isConfirmingDelete ? t.solid_foreground : t.blocked)
          .when(this.isBusy, (el) => el.opacity(0.5))
          .hover((s) => s.opacity(0.85)).active((s) => s.opacity(0.7))
          .on_click((_e, cx) => this.remove(cx))
          .child(this.isBusy ? "Deleting…" : label)));
  }

  render(t) {
    const verb = this.isEditing ? "Save" : "Create";
    const hint = `An isolated desktop named "${this.targetHome || "…"}" boots in the background and gets model access.`;
    return v_flex().id("pots-workspace").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .w_full().p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(15).font_semibold().child(this.isEditing ? "Edit workspace" : "New workspace"))
      .child(field(t, "Name", this.name))
      .child(swatches(t, "Colour", this.hue, (hue, cx) => { this.hue = hue; cx.notify(); }))
      .when(!this.isEditing, (el) => el.child(div().text_size(11.5).text_color(t.dim).whitespace_normal().child(hint)))
      .when(this.isEditing, (el) => el.child(this.dangerZone(t)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).whitespace_normal().child(this.error)))
      .child(h_flex().pt(6).gap(8).justify_end()
        .child(button(t, { id: "pw-cancel", label: "Cancel", variant: "ghost", onClick: () => this.close() }))
        .child(button(t, { id: "pw-submit", label: this.isBusy && !this.isEditing ? "Starting…" : verb, variant: "primary", isDisabled: this.isBusy, onClick: (_e, cx) => this.submit(cx) })));
  }
}
