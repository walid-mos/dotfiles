import { View, div } from "gpui-kit";
import { props, theme, openOverlay, closeOverlay } from "herdr";
import { renderBar } from "./bar.js";
import { entries } from "./strip.js";
import { loadExcerpt, renderCard } from "./card.js";

const STAMP_KEY = "agent-strip.stamp";

export default class AgentStrip extends View {
  init(_props, cx) {
    const boot = props() ?? {};
    this.mode = boot.card ? "card" : boot.overlay ? "none" : "bar";
    if (boot.card) {
      this.address = boot.card;
      this.since = boot.since ?? 0;
      cx.spawn(async (cx) => {
        this.excerpt = await loadExcerpt(boot.card);
        cx.notify();
      });
      return;
    }
    this.stamp = JSON.parse(localStorage.getItem(STAMP_KEY) ?? "{}");
    this.pressed = null;
    this.over = null;
    this.hoverSeq = 0;
    this.cardId = null;
    this.grid = {};
  }

  track(rows, now) {
    let dirty = false;
    for (const e of rows) {
      if (this.stamp[e.address]?.s === e.state) continue;
      this.stamp[e.address] = { s: e.state, at: now };
      dirty = true;
    }
    const live = new Set(rows.map((e) => e.address));
    for (const addr of Object.keys(this.stamp)) if (!live.has(addr)) delete this.stamp[addr];
    if (dirty) localStorage.setItem(STAMP_KEY, JSON.stringify(this.stamp));
  }

  closeCard() {
    if (this.cardId) closeOverlay(this.cardId);
    this.cardId = null;
  }

  hoverSquare(address, on, cx) {
    const seq = ++this.hoverSeq;
    if (!on) return this.closeCard();
    if (this.pressed !== null) return;
    cx.timer.after(160, () => {
      if (seq === this.hoverSeq && this.pressed === null) this.showCard(address);
    });
  }

  showCard(address) {
    this.closeCard();
    const b = this.grid[address];
    if (b?.y === undefined) return;
    this.cardId = openOverlay({
      mod: "agent-strip",
      kind: "window",
      frame: "none",
      width: 356,
      height: 120,
      at: { x: Math.max(6, b.x + (b.width ?? 22) / 2 - 178), y: Math.max(6, b.y - 130) },
      props: { card: address, since: this.stamp[address]?.at ?? 0 },
    });
  }

  render() {
    const t = theme();
    if (this.mode === "card") return renderCard(t, this);
    if (this.mode === "none") return div();
    const rows = entries();
    this.track(rows, Date.now());
    return renderBar(t, this, rows);
  }
}
