import { View, div } from "gpui-kit";
import { agents, spaces, terminals, run } from "herdr";

const TITLE_LABEL = "agent.title";
const SCAN_MS = 2000;

function titleOf(terminal) {
  const title = terminal?.labels?.[TITLE_LABEL];
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

const TITLE_FROM_TERMINAL = new Set(["claude-code"]);
const PLACEHOLDER_TITLE = /^[^\p{L}\p{N}]*claude(\s+code)?$/iu;

// Claude Code names its session on the terminal title (OSC 0) and sets no label.
function terminalTitleOf(agent) {
  if (!TITLE_FROM_TERMINAL.has(agent.app)) return null;
  const title = (agent.title ?? "").trim();
  return title && !PLACEHOLDER_TITLE.test(title) ? title : null;
}

function titlesByTab() {
  const byAddress = new Map(terminals().map((t) => [t.address, titleOf(t)]));
  const byTab = new Map();
  for (const agent of agents()) {
    const title = byAddress.get(agent.address) ?? terminalTitleOf(agent);
    if (title && !byTab.has(agent.tab)) byTab.set(agent.tab, title);
  }
  return byTab;
}

export default class AgentNaming extends View {
  init(_props, cx) {
    this.given = new Map();
    // A 0px layout block never re-renders live, so live data is scanned on a timer.
    cx.timer.every(SCAN_MS, () => this.scan());
    this.scan();
  }

  scan() {
    const wanted = titlesByTab();
    const open = new Set();
    for (const space of spaces()) {
      if (space.machine) continue;
      for (const tab of space.tabs) {
        open.add(tab.id);
        const title = wanted.get(tab.id);
        if (!title) continue;
        if (tab.name === title) {
          this.given.set(tab.id, title);
          continue;
        }
        const ours = !tab.named || this.given.get(tab.id) === tab.name;
        if (!ours) continue;
        this.given.set(tab.id, title);
        run("tab.rename", { id: tab.id, name: title });
      }
    }
    for (const id of this.given.keys()) if (!open.has(id)) this.given.delete(id);
  }

  render() {
    return div();
  }
}
