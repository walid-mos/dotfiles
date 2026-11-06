import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { focused, nextCommand, notify, openOverlay, playSound, props, run, setShared, shared, theme } from "herdr";
import { renderChat } from "./chat.js";
import { CHAT, SHARED, STAGE, botKey } from "./config.js";
import { renderDashboard, renderRail } from "./dashboard.js";
import { startChat } from "./desktop.js";
import { Fleet } from "./fleet.js";
import { firstLine } from "./format.js";
import { NewBotForm } from "./newBot.js";
import { collapsePane, expandPane, isCollapsed } from "./pane.js";
import { Thread, THREAD } from "./thread.js";
import { WorkspaceForm } from "./workspaceForm.js";

const DIALOGS = { newBot: { width: 440, height: 300 }, workspace: { width: 440, height: 330 }, workspaceEdit: { width: 440, height: 400 } };
const INPUT_FOCUS_DELAY_MS = 60;
const lastId = (bot) => (bot.last ? bot.last.message ?? bot.last.id : null);
const seenAll = () => shared(SHARED.seen) ?? {};
const openTarget = () => shared(SHARED.chat) ?? null;
const targetKey = (target) => (target ? botKey(target.home, target.botId) : null);
const failureText = (e) => e?.message ?? String(e);
const focusMark = () => { const f = focused(); return { space: f?.space ?? null, tab: f?.tab ?? null, terminal: f?.terminal ?? null }; };

export function showChat(home, botId) {
  setShared(SHARED.chat, { home, botId });
  run("layout.select", { stack: STAGE.stack, child: STAGE.chat });
}

export function hideChat() {
  setShared(SHARED.chat, null);
  run("layout.select", { stack: STAGE.stack, child: STAGE.terminals });
}

export default class Pots extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.newBot) { this.form = new NewBotForm(p, cx); return; }
    if (p.workspaceForm) { this.form = new WorkspaceForm(p, cx); return; }
    this.isChat = p.role === "chat";
    this.fleet = new Fleet({ isActor: !this.isChat });
    this.shownKey = null;
    this.isPolling = false;
    this.isSending = false;
    this.handle = cx.focus_handle();
    if (this.isChat) {
      this.thread = new Thread((cx) => this.send(cx));
      this.focusMark = null;
    }
    cx.timer.every(CHAT.pollMs, (cx) => this.poll(cx));
    this.poll(cx);
    cx.spawn(async (cx) => { for (;;) { this.onCommand(await nextCommand(), cx); cx.notify(); } });
  }

  onCommand(command, cx) {
    if (command === "focus" && this.isChat) this.thread.input.focus();
    if (command !== "open" || this.isChat) return;
    const pending = shared(SHARED.pending);
    if (!pending) return;
    if (isCollapsed()) expandPane();
    this.openChat(pending.home, { id: pending.botId }, cx);
  }

  isUnread(home, bot) {
    const id = lastId(bot);
    return Boolean(id) && bot.last.person === "bot" && seenAll()[botKey(home, bot.id)] !== id;
  }

  markSeen(home, botId, id) {
    const key = botKey(home, botId);
    if (seenAll()[key] === id) return;
    setShared(SHARED.seen, { ...seenAll(), [key]: id });
  }

  announce(previousBots) {
    const isNewReply = (w, bot) => {
      const prior = previousBots.get(botKey(w.home, bot.id));
      return Boolean(prior) && lastId(prior) !== lastId(bot) && this.isUnread(w.home, bot);
    };
    this.fleet.workspaces.forEach((w) => w.bots.filter((bot) => isNewReply(w, bot)).forEach((bot) => this.ring(w, bot)));
  }

  ring(w, bot) {
    if (targetKey(openTarget()) === botKey(w.home, bot.id)) return;
    setShared(SHARED.pending, { home: w.home, botId: bot.id });
    notify({ title: `${bot.name} · ${w.name}`, body: firstLine(bot.last.text ?? ""), level: "success", action: { name: "pots.open" } });
    playSound("done");
  }

  poll(cx) {
    const target = openTarget();
    if (this.isPolling || (this.isChat && !target)) return;
    this.isPolling = true;
    const before = new Map(this.fleet.workspaces.flatMap((w) => w.bots.map((bot) => [botKey(w.home, bot.id), bot])));
    cx.spawn(async (cx) => {
      try {
        const messages = await this.fleet.refresh(this.isChat ? target : null);
        if (this.isChat && messages && targetKey(target) === this.shownKey) this.acceptHistory(target, messages);
        if (!this.isChat) this.announce(before);
      } finally {
        this.isPolling = false;
        cx.notify();
      }
    });
  }

  /** Herdr redraws mods on every focus change: a terminal or tab picked while the chat is open takes the stage back. */
  followFocus(cx) {
    const was = this.focusMark;
    if (!this.shownKey || !was) return;
    const now = focusMark();
    const isElsewhere = now.space !== was.space || now.tab !== was.tab || (now.terminal !== null && now.terminal !== was.terminal);
    if (!isElsewhere) return;
    this.focusMark = null;
    cx.timer.after(1, (cx) => { hideChat(); cx.notify(); });
  }

  acceptHistory(target, messages) {
    const lastBot = this.thread.accept(messages);
    if (lastBot) this.markSeen(target.home, target.botId, lastBot.id);
  }

  send(cx) {
    const target = openTarget();
    const w = target ? this.fleet.byHome(target.home) : null;
    if (!this.thread.hasDraft || !w?.container || this.isSending) return;
    this.isSending = true;
    const outgoing = this.thread.post();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await startChat(w.container, target.botId, outgoing.text);
      } catch (e) {
        this.thread.withdraw(outgoing);
        notify({ title: "Message not sent", body: failureText(e), level: "error" });
      } finally {
        this.isSending = false;
        cx.notify();
        this.poll(cx);
      }
    });
  }

  openChat(home, bot, cx) {
    if (targetKey(openTarget()) === botKey(home, bot.id)) hideChat();
    else showChat(home, bot.id);
    cx.notify();
  }

  followTarget(cx) {
    const key = targetKey(openTarget());
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.thread.reset();
    this.focusMark = key ? focusMark() : null;
    if (!key) return;
    cx.timer.after(1, (cx) => this.poll(cx));
    cx.timer.after(INPUT_FOCUS_DELAY_MS, () => this.thread.input.focus());
  }

  openDialog(kind, dialogProps) {
    openOverlay({ mod: "pots", kind: "dialog", ...DIALOGS[kind], props: dialogProps });
  }

  onKey(e, cx) {
    if (e.key !== "escape" || !this.isChat || this.thread.isInputFocused) return;
    hideChat();
    cx.stop_propagation();
  }

  actions() {
    const after = (cx, work) => { cx.spawn(async (cx) => { await work; cx.notify(); }); cx.notify(); };
    return {
      refresh: (cx) => { this.fleet.forget(); this.poll(cx); },
      newWorkspace: () => this.openDialog("workspace", { workspaceForm: true }),
      editWorkspace: (w) => this.openDialog("workspaceEdit", { workspaceForm: true, home: w.home, name: w.name, hue: w.hue, botCount: w.bots.length }),
      startWorkspace: (w, cx) => after(cx, this.fleet.launch(w.home)),
      retry: (w, cx) => after(cx, this.fleet.retry(w)),
      newBot: (w) => this.openDialog("newBot", { newBot: true, home: w.home, name: w.name, hue: w.hue, container: w.container }),
      openChat: (home, bot, cx) => this.openChat(home, bot, cx),
      close: (cx) => { hideChat(); cx.notify(); },
      collapse: (cx) => { hideChat(); collapsePane(); cx.notify(); },
      expand: (cx) => { expandPane(); cx.notify(); },
      openFromRail: (home, bot, cx) => { expandPane(); this.openChat(home, bot, cx); },
      send: (cx) => this.send(cx),
      browse: (cx) => { if (this.thread.browse()) cx.notify(); },
      showEarlier: (cx) => { this.thread.showEarlier(); cx.notify(); },
      showLatest: (cx) => { this.thread.showLatest(); cx.notify(); },
    };
  }

  dashboardModel() {
    return { workspaces: this.fleet.workspaces, isLoading: this.fleet.isLoading, error: this.fleet.error, openKey: targetKey(openTarget()), isUnread: (home, bot) => this.isUnread(home, bot) };
  }

  chatModel(w, target) {
    const absence = this.fleet.isLoading ? null : `The ${w.name} desktop is not running`;
    return {
      workspace: w, botId: target.botId, bot: this.fleet.bot(w.home, target.botId), thread: this.thread, ...THREAD,
      isLoading: this.fleet.isLoading || w.isLoading, error: this.fleet.error ?? (w.container ? w.error : absence),
      canSend: this.thread.hasDraft && !this.isSending && Boolean(w.container) && Boolean(w.isGatewayUp),
    };
  }

  renderDashboard(root, t, cx) {
    if (this.fleet.noteRegistry()) { this.fleet.forget(); cx.timer.after(1, (cx) => this.poll(cx)); }
    const render = isCollapsed() ? renderRail : renderDashboard;
    return root.bg(t.surface).child(render(t, this.dashboardModel(), this.actions()));
  }

  render(cx) {
    const t = theme();
    if (this.form) return this.form.render(t);
    const root = v_flex().id("pots-root").track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx)).size_full().text_color(t.foreground);
    if (!this.isChat) return this.renderDashboard(root, t, cx);
    this.followTarget(cx);
    this.followFocus(cx);
    const target = openTarget();
    const w = target ? this.fleet.byHome(target.home) : null;
    if (!target || !w) return root;
    return root.child(renderChat(t, this.chatModel(w, target), this.actions()));
  }
}
