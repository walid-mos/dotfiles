import { div } from "gpui-kit";
import { h_flex, v_flex, Textarea, TextView } from "gpui-base";
import { clock, tint } from "./format.js";
import { avatar, chip, glow, iconButton, presenceColor, presenceWord, TYPING } from "./ui.js";

function header(t, model, actions) {
  const { workspace, bot, botId } = model;
  const hue = t[workspace.hue];
  const presence = model.isLoading && !bot ? "loading…" : presenceWord(bot);
  return h_flex().h(56).px(12).gap(10).items_center().flex_none().border_b(1).border_color(tint(hue, "33")).bg(tint(hue, "0a"))
    .child(avatar(t, { name: bot?.name ?? botId, hue, size: 32, bot }))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(h_flex().gap(8).items_center()
        .child(div().truncate().text_size(14).font_semibold().child(bot?.name ?? botId))
        .child(chip(t, `Pot · ${workspace.name}`, hue)))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().text_size(11).text_color(presenceColor(t, bot)).child(presence))
        .child(div().truncate().text_size(11).text_color(t.dim).child(bot?.model ?? ""))))
    .child(iconButton(t, "pots-refresh", "clock", actions.refresh, "Refresh"))
    .child(iconButton(t, "pots-close", "x", actions.close, "Back to the terminals (Esc)"));
}

function bubble(t, m) {
  const isMine = m.role === "me";
  const body = isMine
    ? div().text_size(13).text_color(t.accent_foreground).whitespace_normal().child(m.text)
    : TextView.markdown(`md-${m.id}`, m.text).selectable(true);
  const meta = [m.isPending ? "sending…" : "", !m.isPending && m.isEdited ? "edited" : "", clock(m.at)].filter(Boolean).join(" · ");
  return v_flex().w_full().flex_none().px(12).py(3).overflow_hidden().items_end().when(!isMine, (el) => el.items_start())
    .child(v_flex().max_w("84%").gap(3).px(13).py(9).rounded(18)
      .when(isMine, (el) => el.rounded_br(6).bg(t.accent))
      .when(!isMine, (el) => el.rounded_bl(6).bg(t.background).border_1().border_color(t.border))
      .when(Boolean(m.isPending), (el) => el.opacity(0.6))
      .child(body)
      .child(h_flex().justify_end().child(div().text_size(10.5).text_color(isMine ? t.accent_foreground : t.dim).opacity(0.7).child(meta))));
}

function typingRow(t) {
  return h_flex().flex_none().px(12).py(3)
    .child(h_flex().px(14).py(9).rounded(18).rounded_bl(6).bg(t.background).border_1().border_color(t.border)
      .text_size(12).text_color(t.working).child(div().frames(TYPING, 240).child(TYPING[0])));
}

function emptyState(t, model) {
  const hue = t[model.workspace.hue];
  const text = model.isLoading ? "Loading…" : model.error ? model.error : model.bot ? `Say hello to ${model.bot.name}` : "This bot no longer exists";
  return v_flex().flex_1().min_h(0).items_center().justify_center().gap(12).px(24)
    .child(avatar(t, { name: model.bot?.name ?? model.botId, hue, size: 56 }))
    .child(div().text_size(13).text_center().whitespace_normal().text_color(model.error ? t.blocked : t.dim).child(text));
}

function earlierButton(t, count, actions) {
  return h_flex().justify_center().py(6)
    .child(h_flex().id("pots-earlier").h(26).px(12).rounded(13).items_center().bg(t.raised).border_1().border_color(t.border)
      .text_size(11.5).font_medium().text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).active((s) => s.opacity(0.75))
      .on_click((_e, cx) => actions.showEarlier(cx))
      .child(`Show ${count} earlier`));
}

function latestPill(t, actions) {
  return h_flex().absolute().bottom(10).left(0).right(0).justify_center()
    .child(h_flex().id("pots-latest").h(28).px(14).rounded(14).items_center().bg(t.accent).shadow_md()
      .text_size(11.5).font_medium().text_color(t.accent_foreground).cursor_pointer()
      .hover((s) => s.opacity(0.9)).active((s) => s.opacity(0.75))
      .on_click((_e, cx) => actions.showLatest(cx))
      .child("Latest ↓"));
}

function rows(t, model, items) {
  const built = items.map((m) => bubble(t, m));
  return model.bot?.isBusy ? [...built, typingRow(t)] : built;
}

function anchoredThread(t, model, items, actions) {
  const tail = items.slice(-model.anchorCount);
  return v_flex().id("pots-thread").flex_1().min_h(0).justify_end().overflow_hidden().py(8)
    .on_scroll_wheel((e, cx) => { if (e.delta.y > 0 || (e.delta_lines?.y ?? 0) > 0) actions.browse(cx); })
    .children(rows(t, model, tail));
}

function historyThread(t, model, items, actions) {
  const shown = items.slice(-model.thread.tailCount);
  const hiddenCount = items.length - shown.length;
  return v_flex().relative().flex_1().min_h(0)
    .child(v_flex().id("pots-history").size_full().overflow_y_scrollbar().py(8).pb(44)
      .when(hiddenCount > 0, (el) => el.child(earlierButton(t, Math.min(hiddenCount, model.tailStep), actions)))
      .children(rows(t, model, shown)))
    .child(latestPill(t, actions));
}

function conversation(t, model, actions) {
  const items = model.thread.items;
  if (!items.length) return emptyState(t, model);
  return model.thread.isBrowsing ? historyThread(t, model, items, actions) : anchoredThread(t, model, items, actions);
}

function sendButton(t, canSend, send) {
  return h_flex().id("pots-send").size(30).rounded(15).items_center().justify_center().flex_none()
    .bg(canSend ? t.accent : t.raised).text_color(canSend ? t.accent_foreground : t.dim).text_size(15).font_semibold()
    .when(canSend, (el) => el.cursor_pointer().hover((s) => s.opacity(0.9)).active((s) => s.opacity(0.75)).on_click((_e, cx) => send(cx)))
    .child("↑");
}

function composer(t, model, actions) {
  const hue = t[model.workspace.hue];
  const { thread } = model;
  return v_flex().flex_none().p(10).gap(6)
    .when(Boolean(model.error) && thread.messages.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.blocked).whitespace_normal().child(model.error)))
    .child(h_flex().gap(6).items_end().px(6).py(5).rounded(18).border_1().border_color(thread.isInputFocused ? glow(hue) : t.input).bg(t.background)
      .child(Textarea.new(thread.input).flex_1().px(8).py(5).text_size(13).text_color(t.foreground))
      .child(sendButton(t, model.canSend, actions.send)));
}

export function renderChat(t, model, actions) {
  return v_flex().size_full().child(header(t, model, actions)).child(conversation(t, model, actions)).child(composer(t, model, actions));
}
