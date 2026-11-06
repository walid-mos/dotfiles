import { DOCKER } from "./config.js";
import { hostExec } from "./host.js";

export const lastLine = (text) => text.trim().split("\n").pop() ?? "";

export const dockerArgs = (rest) => ["--context", DOCKER.context, ...rest];

export const execArgs = (container, isDetached, command) =>
  dockerArgs(["exec", ...(isDetached ? ["-d"] : []), "--user", DOCKER.user, "--env", `HOME=${DOCKER.home}`, container, ...command]);

export async function runDocker(args, failure) {
  const r = await hostExec("docker", args);
  if (r.code !== 0) throw new Error(lastLine(r.stderr || r.stdout) || failure);
  return r.stdout;
}
