import { div } from "gpui-kit";
import { h_flex, InputState, v_flex } from "gpui-base";
import { closeOverlay, notify, props } from "herdr";
import { createBot, desktopDefaultModel } from "./desktop.js";
import { button, chip, field } from "./ui.js";

const FOCUS_RETRY_MS = 600;

export class NewBotForm {
  constructor(p, cx) {
    this.workspace = { home: p.home, name: p.name, hue: p.hue, container: p.container };
    this.fields = {
      name: InputState.new({ placeholder: "Name" }),
      about: InputState.new({ placeholder: "One sentence: what this bot is for" }),
    };
    for (const state of Object.values(this.fields)) state.on("change", (_e, cx) => cx.notify());
    this.fields.about.on("submit", (_e, cx) => this.create(cx));
    this.fields.name.focus();
    cx.timer.after(FOCUS_RETRY_MS, () => this.fields.name.focus());
    this.handle = cx.focus_handle();
    this.isCreating = false;
    this.error = null;
  }

  values() {
    return Object.fromEntries(Object.entries(this.fields).map(([key, state]) => [key, state.value().trim()]));
  }

  create(cx) {
    const bot = this.values();
    if (!bot.name || this.isCreating) return;
    this.isCreating = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (!this.workspace.container) throw new Error(`The ${this.workspace.name} desktop is not running`);
        const model = await desktopDefaultModel(this.workspace.container);
        await createBot(this.workspace.container, { ...bot, model });
        notify({ title: `${bot.name} joined ${this.workspace.name}`, body: `It thinks with ${model} and starts within a few seconds`, level: "success" });
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = e?.message ?? String(e);
      } finally {
        this.isCreating = false;
        cx.notify();
      }
    });
  }

  render(t) {
    const close = () => closeOverlay(props().overlay);
    return v_flex().id("pots-new-bot").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .w_full().p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(15).font_semibold().child("New bot"))
        .child(chip(t, this.workspace.name, t[this.workspace.hue])))
      .child(field(t, "Name", this.fields.name))
      .child(field(t, "About", this.fields.about))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).whitespace_normal().child(this.error)))
      .child(h_flex().pt(6).gap(8).justify_end()
        .child(button(t, { id: "pn-cancel", label: "Cancel", variant: "ghost", onClick: close }))
        .child(button(t, { id: "pn-create", label: this.isCreating ? "Creating…" : "Create", variant: "primary", isDisabled: this.isCreating, onClick: (_e, cx) => this.create(cx) })));
  }
}
