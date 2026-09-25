// Reports per-pane sidebar metadata to Herdr: $proj (project/branch label)
// and $indent (tree marker for child panes). Consumed by [ui.sidebar.agents]
// rows.
//
// Herdr strips the terminal title to "π - agent" for every pane and the
// `agent` token is constant, so the informative labels live in custom tokens:
//   - own pane: $proj/$indent from this session's cwd (worktree-aware)
//   - child panes: pi-subagents inspector panes, found via their binding JSON
//     (<cwd>/.pi/subagents/**/inspectors/herdr*.json), get indent + the run's
//     project label so they render nested under this session in the sidebar.
//
// Runs only in TUI sessions inside Herdr (headless runs inherit the mother
// pane's HERDR_PANE_ID and must not stomp its metadata).
// @ts-nocheck
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERDR_ENV = process.env.HERDR_ENV;
const paneId = process.env.HERDR_PANE_ID;
const SOURCE = "herdr-pi-meta";
const REFRESH_MS = 4 * 60 * 1000; // below the report TTL so tokens never lapse
const TTL_MS = 5 * 60 * 1000;

function enabled() {
	return HERDR_ENV === "1" && !!paneId;
}

function labelFromWorktree(cwd) {
	const index = cwd.indexOf("/worktrees/");
	if (index === -1) return undefined;
	// Keep the full branch path: /worktrees/<repo>/<feature>/<name> ->
	// <repo>/<feature>/<name> (the branch may contain slashes).
	const rest = cwd.slice(index + "/worktrees/".length);
	if (!rest || !rest.includes("/")) return undefined;
	return { proj: rest, indent: "-> " };
}

function dirnameLabel(cwd) {
	return path.basename(cwd) || cwd;
}

function gitBranch(cwd) {
	return new Promise((resolve) => {
		execFile("git", ["branch", "--show-current"], { cwd, timeout: 2000 }, (error, stdout) => {
			if (error) {
				resolve(undefined);
				return;
			}
			const branch = String(stdout).trim();
			resolve(branch || undefined);
		});
	});
}

async function computeMeta() {
	const cwd = process.cwd();
	const worktree = labelFromWorktree(cwd);
	if (worktree) return worktree;
	const branch = await gitBranch(cwd);
	const base = dirnameLabel(cwd);
	if (branch) return { proj: `${base}/${branch}`, indent: "" };
	// Not a project checkout (config dirs, dotfiles): show the tab name the
	// user gave, falling back to the native agent name, then the directory.
	return { proj: (await tabLabel()) || (await nativeName()) || base, indent: "" };
}

/** The user-set label of this pane's tab, from the workspace snapshot. */
function tabLabel() {
	return new Promise((resolve) => {
		execFile("herdr", ["api", "snapshot"], { timeout: 5000, maxBuffer: 8 << 20 }, (error, stdout) => {
			if (error) {
				resolve(undefined);
				return;
			}
			try {
				const snap = JSON.parse(String(stdout))?.result?.snapshot;
				const pane = (snap?.panes ?? []).find((p) => p?.pane_id === paneId);
				const tab = (snap?.tabs ?? []).find((t) => t?.tab_id === pane?.tab_id);
				const label = tab?.label;
				resolve(typeof label === "string" && label ? label : undefined);
			} catch {
				resolve(undefined);
			}
		});
	});
}

/** This pane's registered herdr agent name, when it has one. */
function nativeName() {
	return new Promise((resolve) => {
		execFile("herdr", ["agent", "list"], { timeout: 5000, maxBuffer: 4 << 20 }, (error, stdout) => {
			if (error) {
				resolve(undefined);
				return;
			}
			try {
				const agents = JSON.parse(String(stdout))?.result?.agents ?? [];
				const mine = agents.find((a) => a?.pane_id === paneId);
				resolve(typeof mine?.name === "string" && mine.name ? mine.name : undefined);
			} catch {
				resolve(undefined);
			}
		});
	});
}

let reportSeq = Date.now() * 1000;

function reportMeta(targetPaneId, tokens, ttlMs = TTL_MS) {
	if (!enabled() || !targetPaneId) return;
	reportSeq += 1;
	const args = [
		"pane", "report-metadata", targetPaneId,
		"--source", SOURCE,
		"--agent", "pi",
		"--ttl-ms", String(ttlMs),
		"--seq", String(reportSeq),
	];
	for (const [name, value] of Object.entries(tokens)) {
		if (value) args.push("--token", `${name}=${value}`);
	}
	execFile("herdr", args, { timeout: 5000 }, () => {
		// Best-effort display metadata; failures (dead panes, races) are ignored.
	});
}

/** Live pane ids from pi-subagents herdr-inspector bindings under cwd. */
function inspectorChildPanes(cwd) {
	const roots = [path.join(cwd, ".pi", "subagents")];
	const panes = new Set();
	for (const root of roots) {
		let runs;
		try {
			runs = fs.readdirSync(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const run of runs) {
			const dir = path.join(root, run.name, "inspectors");
			let files;
			try {
				files = fs.readdirSync(dir);
			} catch {
				continue;
			}
			for (const file of files) {
				if (!file.startsWith("herdr") || !file.endsWith(".json")) continue;
				try {
					const binding = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
					if (binding?.kind === "herdr-inspector" && typeof binding.paneId === "string") {
						panes.add(binding.paneId);
					}
				} catch {
					// binding mid-write or unreadable; next refresh picks it up
				}
			}
		}
	}
	return [...panes];
}

export default function (pi) {
	if (!enabled()) {
		return;
	}

	let timer;

	async function refresh() {
		const meta = await computeMeta();
		reportMeta(paneId, meta);
		const childIndent = meta.indent ? meta.indent : "-> ";
		for (const child of inspectorChildPanes(process.cwd())) {
			reportMeta(child, { ...meta, indent: childIndent });
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx?.mode !== "tui") {
			return;
		}
		void refresh();
		if (!timer) {
			timer = setInterval(() => {
				void refresh();
			}, REFRESH_MS);
			timer.unref?.();
		}
	});

	pi.on("agent_start", () => {
		// Refresh alongside the lifecycle reports so a long session never
		// lets the TTL lapse mid-conversation.
		void refresh();
	});
}
