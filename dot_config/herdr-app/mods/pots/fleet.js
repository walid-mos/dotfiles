import { CHAT } from "./config.js";
import { probeDesktop, runningDesktops } from "./desktop.js";
import { clearJob, readJob } from "./jobs.js";
import { deleteJob, deleteWorkspace, launchJob, launchWorkspace, listWorkspaces, provisionJob, provisionWorkspace } from "./manager.js";
import { readRegistry, writeRegistry } from "./registry.js";
import { buildWorkspaces, isTransient, phaseOf } from "./workspaces.js";

const failureText = (e) => e?.message ?? String(e);
const FAILURES = { launch: "The desktop did not start", provision: "Model access could not be configured", delete: "The workspace could not be deleted" };

/** Every workspace and its bots. The actor copy (the dashboard) also drives launches and provisioning. */
export class Fleet {
  constructor({ isActor }) {
    this.isActor = isActor;
    this.workspaces = [];
    this.listing = null;
    this.containers = new Map();
    this.isLoading = true;
    this.error = null;
    this.pollCount = 0;
    this.registrySnapshot = JSON.stringify(readRegistry());
  }

  byHome(home) { return this.workspaces.find((w) => w.home === home) ?? null; }
  bot(home, botId) { return this.byHome(home)?.bots.find((b) => b.id === botId) ?? null; }
  forget() { this.listing = null; }

  /** True once per change of the persisted names and colours. */
  noteRegistry() {
    const now = JSON.stringify(readRegistry());
    if (now === this.registrySnapshot) return false;
    this.registrySnapshot = now;
    return true;
  }

  isDiscoveryDue() {
    return !this.listing || Boolean(this.error) || this.pollCount % CHAT.rediscoverEveryPolls === 0 || this.workspaces.some(isTransient);
  }

  async discover() {
    this.pollCount += 1;
    if (!this.isDiscoveryDue()) return;
    try {
      [this.listing, this.containers] = await Promise.all([listWorkspaces(), runningDesktops()]);
      this.error = null;
    } catch (e) {
      this.error = failureText(e);
      return;
    }
    this.workspaces = buildWorkspaces({ listing: this.listing, containers: this.containers, registry: readRegistry(), previous: this.workspaces });
  }

  /** Probes the running desktops (only the target's, for a chat copy); returns the target bot's messages. */
  async refresh(target) {
    await this.discover();
    const probed = this.isActor ? this.workspaces : this.workspaces.filter((w) => w.home === target?.home);
    const results = await Promise.all(probed.map((w) => this.probe(w, target)));
    if (this.isActor) await this.settle();
    this.isLoading = false;
    return results.find((r) => r) ?? null;
  }

  async probe(w, target) {
    if (!w.container) { w.bots = []; w.isLoading = false; return null; }
    const wantsHistory = target?.home === w.home;
    try {
      const probe = await probeDesktop(w.container, wantsHistory ? target.botId : null);
      Object.assign(w, { isGatewayUp: probe.isGatewayUp, isBlocked: probe.isBlocked, isConfigured: probe.isConfigured, bots: probe.bots, error: null });
      return wantsHistory ? probe.messages : null;
    } catch (e) {
      w.error = failureText(e);
      return null;
    } finally {
      w.isLoading = false;
    }
  }

  async settle() {
    for (const w of this.workspaces) await this.settleOne(w);
    this.pruneRegistry();
  }

  async settleOne(w) {
    const launch = await this.trackJob(launchJob(w.home), Boolean(w.session), FAILURES.launch);
    const provision = await this.trackJob(provisionJob(w.home), Boolean(w.isConfigured), FAILURES.provision);
    const removal = await this.trackJob(deleteJob(w.home), !w.isKnown, FAILURES.delete);
    w.isLaunching = launch.isActive;
    w.isProvisioning = provision.isActive;
    w.isDeleting = removal.isActive;
    if (!w.failure && removal.failure) w.failedJob = "delete";
    w.failure = w.failure ?? launch.failure ?? provision.failure ?? removal.failure;
    if (!w.failure && !w.isProvisioning && phaseOf(w).id === "setup") await this.provision(w);
  }

  /** A finished job stays on file until its effect is visible, so the card never flickers back. */
  async trackJob(name, isSettled, fallback) {
    const job = await readJob(name);
    if (!job) return { isActive: false, failure: null };
    if (job.isRunning || (job.isOk && !isSettled)) return { isActive: true, failure: null };
    await clearJob(name);
    return { isActive: false, failure: job.isOk ? null : job.message || fallback };
  }

  async provision(w) {
    w.isProvisioning = true;
    try {
      await provisionWorkspace(w.home, w.container);
    } catch (e) {
      w.isProvisioning = false;
      w.failure = failureText(e);
    }
  }

  async launch(home) {
    const w = this.byHome(home);
    if (w) { w.failure = null; w.isLaunching = true; }
    try {
      await launchWorkspace(home);
    } catch (e) {
      if (w) { w.isLaunching = false; w.failure = failureText(e); }
    }
  }

  retry(w) {
    const failedJob = w.failedJob;
    w.failure = null;
    w.failedJob = null;
    if (failedJob === "delete") return this.remove(w);
    if (!w.session) return this.launch(w.home);
    return Promise.resolve();
  }

  async remove(w) {
    w.isDeleting = true;
    try {
      await deleteWorkspace(w.home);
    } catch (e) {
      w.isDeleting = false;
      w.failedJob = "delete";
      w.failure = failureText(e);
    }
  }

  pruneRegistry() {
    const stale = this.workspaces.filter((w) => !w.isKnown && !w.isLaunching && !w.isDeleting && !w.failure).map((w) => w.home);
    if (!stale.length) return;
    const next = Object.fromEntries(Object.entries(readRegistry()).filter(([home]) => !stale.includes(home)));
    writeRegistry(next);
    this.registrySnapshot = JSON.stringify(next);
    this.workspaces = this.workspaces.filter((w) => !stale.includes(w.home));
  }
}
