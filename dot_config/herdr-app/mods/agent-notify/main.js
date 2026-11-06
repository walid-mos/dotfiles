import { View, div } from "gpui-kit";
import { agents, panes, home, writeTextFile } from "herdr";

const ALERTS = { done: "finished", blocked: "needs you" };

function post(agent) {
  const pane = panes().find((p) => p.terminal === agent.address);
  const safe = agent.address.replace(/[^A-Za-z0-9_-]/g, "_");
  return writeTextFile(`${home()}/.local/state/herdr-alerts/queue/${safe}-${Date.now()}.json`, JSON.stringify({
    title: `${agent.program.name} — ${ALERTS[agent.status]}`,
    subtitle: [agent.tab_name, agent.space_name, pane?.branch].filter(Boolean).join(" · "),
    body: agent.title || pane?.cwd || "",
    terminal: agent.address,
  }), null);
}

export default class AgentNotify extends View {
  init(_props, cx) {
    this.check(cx);
    // Herdr never calls render() for a mod in a 0px block, so changes are sampled.
    cx.timer.every(1000, (cx) => this.check(cx));
  }

  check(cx) {
    const list = agents();
    for (const agent of list) {
      const before = this.seen?.get(agent.address);
      if ((before === "working" || before === "idle") && agent.status in ALERTS) {
        cx.spawn(async () => post(agent));
      }
    }
    this.seen = new Map(list.map((a) => [a.address, a.status]));
  }

  render() {
    return div().size_full();
  }
}
