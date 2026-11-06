import { layout, run, setShared, shared } from "herdr";
import { PANE, SHARED } from "./config.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export const isCollapsed = () => shared(SHARED.collapsed) === true;

export function collapsePane() {
  const px = find(layout(), PANE.id)?.size?.px;
  if (px && px > PANE.railPx) setShared(SHARED.width, px);
  setShared(SHARED.collapsed, true);
  run("layout.resize", { id: PANE.id, px: PANE.railPx });
}

export function expandPane() {
  setShared(SHARED.collapsed, false);
  run("layout.resize", { id: PANE.id, px: shared(SHARED.width) ?? PANE.defaultPx });
}
