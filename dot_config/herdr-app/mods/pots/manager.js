import { MAC, MANAGER } from "./config.js";
import { dockerArgs, runDocker } from "./docker.js";
import { hostHome, hostReadTextFile } from "./host.js";
import { startJob } from "./jobs.js";

const helper = (...rest) => dockerArgs(["exec", MANAGER.container, "python", MANAGER.helper, ...rest]);

/** Sealskin's homes and Pots sessions: { homes: string[], sessions: { session_id, home, created_at }[] }. */
export async function listWorkspaces() {
  return JSON.parse(await runDocker(helper("list"), "Sealskin did not answer"));
}

export const launchJob = (home) => `launch-${home}`;

export const provisionJob = (home) => `provision-${home}`;

export const deleteJob = (home) => `delete-${home}`;

export const launchWorkspace = (home) => startJob(launchJob(home), "docker", helper("launch", home));

export const deleteWorkspace = (home) => startJob(deleteJob(home), "docker", helper("delete", home));

/** Same flow as the Mac app: the provider key travels from Infisical to the desktop over a process pipe, never through Herdr. */
export async function provisionWorkspace(home, container) {
  const base = await hostHome();
  const binding = JSON.parse((await hostReadTextFile(`${base}/${MAC.vaultBinding}`)) ?? "null");
  if (!binding?.projectId || !binding?.environment) throw new Error("The Infisical binding is missing");
  const script = `${base}/${MAC.potsApp}/provision.mjs`;
  const args = ["run", "--silent", "--projectId", binding.projectId, "--env", binding.environment, "--path", "/providers", "--", "node", script, container];
  await startJob(provisionJob(home), "infisical", args);
}
