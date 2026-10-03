import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { handleMissionAction } from "../../src/missions/actions.ts";
import {
	createMission,
	listGlobalMissions,
	listMissions,
	readMission,
	resolveMissionStoreLocation,
	updateMission,
} from "../../src/missions/store.ts";

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-missions-"));
	const projectRoot = path.join(root, "project");
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(projectRoot, { recursive: true });
	const location = resolveMissionStoreLocation({ projectRoot, agentDir });
	return { root, projectRoot, agentDir, location };
}

describe("mission store", () => {
	it("stores default missions outside the project and preserves configured project storage", () => {
		const test = fixture();
		try {
			assert.equal(path.relative(test.projectRoot, test.location.missionDir).startsWith(".."), true);
			assert.equal(test.location.missionDir.startsWith(path.join(test.agentDir, "missions", "projects")), true);
			assert.equal(
				resolveMissionStoreLocation({ projectRoot: test.projectRoot, agentDir: test.agentDir, config: { directory: ".pi/subagents/missions" } }).missionDir,
				path.join(test.projectRoot, ".pi/subagents", "missions"),
			);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("creates, reads, updates, lists, and globally indexes project missions", () => {
		const test = fixture();
		try {
			const created = createMission(test.location, {
				title: "Ship durable missions",
				objective: "Make delegated work resumable",
				labels: ["phase-1"],
			});
			const updated = updateMission(test.location, created.id, {
				status: "active",
				summary: "Implementation started",
				addRuns: [
					{ runId: "run-1", mode: "single", status: "running" },
					{ runId: "workflow-1", mode: "workflow", status: "completed" },
				],
				addArtifacts: [{ kind: "status", path: path.join(test.root, "status.json") }],
				addReceipts: [{ kind: "pull_request", status: "ready", title: "PR 733", url: "https://github.com/example/repo/pull/733" }],
			});

			assert.equal(readMission(test.location, created.id).status, "active");
			assert.equal(updated.runs[0]?.runId, "run-1");
			assert.equal(readMission(test.location, created.id).runs[1]?.mode, "workflow");
			assert.equal(updated.receipts[0]?.url, "https://github.com/example/repo/pull/733");
			const receiptUpdated = updateMission(test.location, created.id, {
				addReceipts: [{ kind: "pull_request", status: "succeeded", title: "PR 733", url: "https://github.com/example/repo/pull/733" }],
			});
			assert.equal(receiptUpdated.receipts[0]?.status, "succeeded");
			assert.equal(receiptUpdated.receipts[0]?.createdAt, updated.receipts[0]?.createdAt);
			assert.deepEqual(listMissions(test.location).records.map((record) => record.id), [created.id]);
			const global = listGlobalMissions(test.location.globalIndexDir);
			assert.equal(global.entries[0]?.missionId, created.id);
			assert.equal(global.entries[0]?.stale, false);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("persists workflow child attempts and projects their latest heartbeat", () => {
		const test = fixture();
		try {
			const mission = createMission(test.location, { title: "Dispatch ledger", objective: "Track workflow children", status: "active" });
			updateMission(test.location, mission.id, {
				upsertWorkflowChildren: [{
					workflowRunId: "workflow-1",
					key: "review",
					status: "running",
					agent: "reviewer",
					task: "Review the diff",
					phase: "review",
					sessionPath: "/tmp/review.jsonl",
					heartbeat: { status: "running", phase: "review" },
				}],
			}, new Date("2026-08-11T10:00:00.000Z"));
			const completed = updateMission(test.location, mission.id, {
				upsertWorkflowChildren: [{
					workflowRunId: "workflow-1",
					key: "review",
					status: "completed",
					runId: "child-1",
					completedAt: "2026-08-11T10:05:00.000Z",
					artifactPaths: ["/tmp/review.md"],
					heartbeat: { status: "completed", phase: "review" },
				}],
			}, new Date("2026-08-11T10:05:00.000Z"));

			assert.equal(completed.workflowChildren.length, 1);
			assert.deepEqual(completed.workflowChildren[0], {
				workflowRunId: "workflow-1",
				key: "review",
				status: "completed",
				startedAt: "2026-08-11T10:00:00.000Z",
				updatedAt: "2026-08-11T10:05:00.000Z",
				runId: "child-1",
				agent: "reviewer",
				task: "Review the diff",
				phase: "review",
				completedAt: "2026-08-11T10:05:00.000Z",
				sessionPath: "/tmp/review.jsonl",
				artifactPaths: ["/tmp/review.md"],
				heartbeat: { status: "completed", phase: "review", updatedAt: "2026-08-11T10:05:00.000Z" },
			});
			const shown = handleMissionAction("mission.show", { missionId: mission.id }, { cwd: test.projectRoot, agentDir: test.agentDir });
			assert.match(shown.content[0]?.type === "text" ? shown.content[0].text : "", /review \(child-1\): completed — reviewer \[review\]; updated .*; heartbeat completed\/review at/);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("loads older records that do not have receipts", () => {
		const test = fixture();
		try {
			const created = createMission(test.location, { title: "Older record", objective: "Stay readable" });
			const recordPath = path.join(test.location.missionDir, `${created.id}.json`);
			const raw = JSON.parse(fs.readFileSync(recordPath, "utf-8")) as Record<string, unknown>;
			delete raw.receipts;
			fs.writeFileSync(recordPath, JSON.stringify(raw), "utf-8");

			const mission = readMission(test.location, created.id);
			assert.equal(mission.objective, "Stay readable");
			assert.deepEqual(mission.receipts, []);
			assert.deepEqual(mission.workflowChildren, []);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("skips corrupt records, removes missing pointers, and preserves parse-error pointers", () => {
		const test = fixture();
		try {
			const missing = createMission(test.location, { title: "Missing record", objective: "Heal its pointer" });
			const corrupt = createMission(test.location, { title: "Corrupt record", objective: "Keep evidence" });
			fs.writeFileSync(path.join(test.location.missionDir, "broken.json"), "{not json", "utf-8");
			assert.equal(listMissions(test.location).warnings.length, 1);

			fs.rmSync(path.join(test.location.missionDir, `${missing.id}.json`));
			fs.writeFileSync(path.join(test.location.missionDir, `${corrupt.id}.json`), "{not json", "utf-8");
			const global = listGlobalMissions(test.location.globalIndexDir);
			assert.equal(global.entries.length, 1);
			assert.equal(global.entries[0]?.missionId, corrupt.id);
			assert.equal(global.entries[0]?.stale, true);
			assert.match(global.warnings.join("\n"), /Removed stale global mission pointer/);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("prunes only the oldest terminal missions at the configured bound", () => {
		const test = fixture();
		const location = { ...test.location, retainTerminal: 1 };
		try {
			const oldest = createMission(location, { title: "Old terminal", objective: "Prune me" }, new Date("2026-01-01T00:00:00Z"));
			const newest = createMission(location, { title: "New terminal", objective: "Keep me" }, new Date("2026-01-02T00:00:00Z"));
			const active = createMission(location, { title: "Active", objective: "Never prune", status: "active" }, new Date("2026-01-03T00:00:00Z"));
			const planned = createMission(location, { title: "Planned", objective: "Never prune", status: "planned" }, new Date("2026-01-04T00:00:00Z"));
			updateMission(location, oldest.id, { status: "completed" }, new Date("2026-01-05T00:00:00Z"));
			updateMission(location, newest.id, { status: "failed" }, new Date("2026-01-06T00:00:00Z"));

			assert.throws(() => readMission(location, oldest.id), /was not found/);
			assert.equal(readMission(location, newest.id).status, "failed");
			assert.equal(readMission(location, active.id).status, "active");
			assert.equal(readMission(location, planned.id).status, "planned");
			assert.equal(listGlobalMissions(location.globalIndexDir).entries.some((entry) => entry.missionId === oldest.id), false);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("shows missions with warnings when linked run status is unreadable", () => {
		const test = fixture();
		try {
			const ctx = { cwd: test.projectRoot, agentDir: test.agentDir, currentSessionId: "session-1" };
			const created = handleMissionAction("mission.create", { mission: { title: "Unreadable status", objective: "Keep mission readable" } }, ctx);
			const missionId = created.details?.missionId;
			assert.ok(missionId);
			const asyncDir = path.join(test.root, "async-run");
			fs.mkdirSync(asyncDir, { recursive: true });
			handleMissionAction("mission.attach-run", { missionId, runId: "run-3", runMode: "single", runStatus: "running", dir: asyncDir }, ctx);
			fs.writeFileSync(path.join(asyncDir, "status.json"), "{not json", "utf-8");

			const shown = handleMissionAction("mission.show", { missionId }, ctx);

			assert.equal(shown.details?.mission?.runs[0]?.status, "running");
			assert.match(shown.content[0]?.type === "text" ? shown.content[0].text : "", /Warning: Failed to read linked run status/);
			assert.equal(shown.details?.missions?.warnings?.length, 1);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});

	it("supports the mission management actions with structured details", () => {
		const test = fixture();
		try {
			const ctx = { cwd: test.projectRoot, agentDir: test.agentDir, currentSessionId: "session-1" };
			const created = handleMissionAction("mission.create", { mission: { title: "Action mission", objective: "Exercise actions" } }, ctx);
			const missionId = created.details?.missionId;
			assert.ok(missionId);
			const asyncDir = path.join(test.root, "async-run");
			fs.mkdirSync(asyncDir, { recursive: true });
			const attached = handleMissionAction("mission.attach-run", { missionId, runId: "run-2", runMode: "parallel", runStatus: "running", dir: asyncDir }, ctx);
			assert.equal(attached.details?.mission?.runs[0]?.runId, "run-2");
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({ state: "complete" }), "utf-8");
			const shown = handleMissionAction("mission.show", { missionId }, ctx);
			assert.equal(shown.details?.mission?.status, "completed");
			assert.equal(shown.details?.mission?.runs[0]?.status, "complete");
			const receipt = handleMissionAction("mission.update", {
				missionId,
				missionUpdate: {
					receipts: [{ kind: "ci", status: "succeeded", title: "Unit tests", url: "https://github.com/example/repo/actions/runs/1", description: "All checks passed" }],
				},
			}, ctx);
			assert.equal(receipt.details?.mission?.receipts[0]?.status, "succeeded");
			assert.match(receipt.content[0]?.type === "text" ? receipt.content[0].text : "", /Delivery receipts:\n  ci \(succeeded\): Unit tests/);
			const updatedReceipt = handleMissionAction("mission.update", {
				missionId,
				missionUpdate: { receipts: [{ kind: "ci", status: "ready", title: "Unit tests", url: "https://github.com/example/repo/actions/runs/1" }] },
			}, ctx);
			assert.equal(updatedReceipt.details?.mission?.receipts.length, 1);
			assert.equal(updatedReceipt.details?.mission?.receipts[0]?.status, "ready");
			const closed = handleMissionAction("mission.close", { missionId, missionStatus: "completed", summary: "Done" }, ctx);
			assert.equal(closed.details?.mission?.status, "completed");
			const global = handleMissionAction("mission.list", { missionScope: "global" }, ctx);
			assert.equal(global.details?.missions?.globalEntries?.length, 1);
			assert.throws(() => handleMissionAction("mission.list", { missionScope: "everywhere" as "global" }, ctx), /missionScope/);
			assert.throws(() => handleMissionAction("mission.update", { missionId, missionUpdate: { unsupported: true } as never }, ctx), /unknown/);
			assert.throws(() => handleMissionAction("mission.update", { missionId, missionUpdate: { receipts: [{ kind: "ci", status: "ready", title: "Bad URL", url: "relative" }] } as never }, ctx), /absolute URL/);
		} finally {
			fs.rmSync(test.root, { recursive: true, force: true });
		}
	});
});
