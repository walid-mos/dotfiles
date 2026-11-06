import { exec, home, machines, readTextFile } from "herdr";
import { HOST } from "./config.js";

let remoteHome = null;

/** The machine that runs the Pots desktops: this computer, or the named one when Herdr reaches it from elsewhere. */
export const host = () => (machines().some((m) => m.name === HOST) ? HOST : null);

export const hostExec = (command, args) => exec(command, args, { on: host() });

export const hostReadTextFile = (path) => readTextFile(path, { on: host() });

export async function hostHome() {
  if (!host()) return home();
  remoteHome ??= hostExec("sh", ["-c", 'printf %s "$HOME"']).then((r) => r.stdout);
  return remoteHome;
}
