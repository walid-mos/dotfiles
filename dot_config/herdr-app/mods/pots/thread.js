import { TextareaState } from "gpui-base";
import { CHAT } from "./config.js";

const TAIL_STEP = 12;

export const THREAD = { anchorCount: 40, tailStep: TAIL_STEP };

/** The open conversation: its history, unsent messages, composer and scroll mode. */
export class Thread {
  constructor(onSubmit) {
    this.input = TextareaState.new({ placeholder: "Message…", rows: 1 });
    this.input.set_auto_grow(1, 6);
    this.draft = "";
    this.isInputFocused = false;
    this.input.on("change", (_e, cx) => { this.draft = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => onSubmit(cx));
    this.input.on("focus", (_e, cx) => { this.isInputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.isInputFocused = false; cx.notify(); });
    this.reset();
  }

  reset() {
    this.messages = [];
    this.pending = [];
    this.isBrowsing = false;
    this.tailCount = TAIL_STEP;
  }

  get hasDraft() { return Boolean(this.draft.trim()); }
  get items() { return [...this.messages, ...this.pending]; }

  /** Replaces the history; returns the newest bot message, or null. */
  accept(messages) {
    this.messages = messages;
    this.pending = this.pending.filter((p) => !messages.some((m) => m.role === "me" && m.text === p.text) && Date.now() - p.at < CHAT.pendingTtlMs);
    return [...messages].reverse().find((m) => m.role === "bot") ?? null;
  }

  post() {
    const text = this.draft.trim();
    this.input.set_value("");
    this.draft = "";
    const outgoing = { id: `pending-${Date.now()}`, text, role: "me", at: Date.now(), isPending: true };
    this.pending = [...this.pending, outgoing];
    this.isBrowsing = false;
    return outgoing;
  }

  withdraw(outgoing) {
    this.pending = this.pending.filter((p) => p !== outgoing);
    this.input.set_value(outgoing.text);
    this.draft = outgoing.text;
  }

  browse() {
    if (this.isBrowsing) return false;
    this.isBrowsing = true;
    this.tailCount = TAIL_STEP;
    return true;
  }

  showEarlier() { this.tailCount += TAIL_STEP; }
  showLatest() { this.isBrowsing = false; }
}
