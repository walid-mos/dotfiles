import { HOME_NAME_MAX_LENGTH, HUES } from "./config.js";

export const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, HOME_NAME_MAX_LENGTH);

export const deriveName = (home) => home.split(/[-_]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");

export function hueFor(home) {
  const hash = [...home].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return HUES[hash % HUES.length];
}

const blank = (home) => ({
  home, session: null, container: null, bots: [], isGatewayUp: null, isBlocked: false, isConfigured: null, error: null,
  isLoading: true, isLaunching: false, isProvisioning: false, isDeleting: false, failure: null, failedJob: null,
});

/** One workspace per Sealskin home (plus homes still being created), keeping each one's probe state. */
export function buildWorkspaces({ listing, containers, registry, previous }) {
  const homes = [...new Set([...listing.homes, ...Object.keys(registry)])];
  return homes.map((home) => {
    const session = listing.sessions.find((s) => s.home === home) ?? null;
    const prior = previous.find((w) => w.home === home) ?? blank(home);
    const meta = registry[home] ?? {};
    const container = session ? containers.get(session.session_id) ?? null : null;
    return { ...prior, session, container, name: meta.name ?? deriveName(home), hue: meta.hue ?? hueFor(home), isKnown: listing.homes.includes(home) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function phaseOf(w) {
  if (w.isLoading) return { id: "connecting", label: "connecting", hint: "Connecting…" };
  if (w.failure) return { id: "failed", label: "failed", hint: w.failure };
  if (w.isDeleting) return { id: "deleting", label: "deleting", hint: "Stopping the desktop and erasing its home…" };
  if (w.isLaunching || (w.session && !w.container)) return { id: "starting", label: "starting", hint: "Booting the desktop…" };
  if (!w.session) return { id: "stopped", label: "stopped", hint: "The desktop is stopped" };
  if (w.error) return { id: "offline", label: "offline", hint: w.error };
  if (w.isBlocked) return { id: "blocked", label: "blocked", hint: "Pots refuses to start: this home's bot instructions (.pots/bots/AGENTS.md) differ from the image. Restore them or delete the workspace." };
  if (!w.isGatewayUp) return { id: "starting", label: "starting", hint: "Waking Pots up…" };
  if (!w.isConfigured) return { id: "setup", label: "setting up", hint: "Connecting model access…" };
  return { id: "ready", label: "ready", hint: "" };
}

const TRANSIENT = ["connecting", "starting", "setup", "deleting"];

export const isTransient = (w) => TRANSIENT.includes(phaseOf(w).id);
