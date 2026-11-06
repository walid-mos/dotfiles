import { hc } from "herdr";
import { MAC } from "./config.js";
import { host, hostExec, hostHome, hostReadTextFile } from "./host.js";

const EXIT_MARK = "@@exit ";
const PREPARE = 'mkdir -p "$(dirname "$1")" && : > "$1"';
const SCRIPT = `
out=$1; shift
"$@" >> "$out" 2>&1 < /dev/null
echo "${EXIT_MARK}$?" >> "$out"
`;

const logPath = async (name) => `${await hostHome()}/${MAC.jobs}/${name}.log`;

/** A core terminal without Herdr labels: it stays out of the window and outlives the call, whereas exec ends everything it started when it returns. */
export async function startJob(name, command, args) {
  const log = await logPath(name);
  const prepared = await hostExec("sh", ["-c", PREPARE, "herdr-pots-job", log]);
  if (prepared.code !== 0) throw new Error(prepared.stderr.trim() || `${name} could not start`);
  const on = host();
  const r = await hc(["run", "--json", "--bg", "--no-parent", "--rm", ...(on ? ["--on", on] : []), "--", "sh", "-c", SCRIPT, "herdr-pots-job", log, command, ...args]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `${name} could not start`);
}

export async function readJob(name) {
  const text = await hostReadTextFile(await logPath(name));
  if (text === null) return null;
  const at = text.lastIndexOf(EXIT_MARK);
  if (at < 0) return { isRunning: true, isOk: false, message: "" };
  const lines = text.slice(0, at).trim().split("\n").filter(Boolean);
  return { isRunning: false, isOk: Number(text.slice(at + EXIT_MARK.length).trim()) === 0, message: lines.pop() ?? "" };
}

export const clearJob = async (name) => hostExec("rm", ["-f", await logPath(name)]);
