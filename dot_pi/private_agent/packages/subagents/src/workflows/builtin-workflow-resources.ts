import { Type } from "typebox";
import { Value } from "typebox/value";

import type { Static, TSchema } from "typebox";
import type { WorkflowResourceDefinition } from "./workflow-resources.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "bash"];
const READ_BLOCK = ["read", "grep", "find", "ls"];

const taskArgsSchema = Type.Object({ task: Type.String({ minLength: 1, maxLength: 16 * 1024 }) }, { additionalProperties: false });
const runCiArgsSchema = Type.Object(
	{
		command: Type.Optional(Type.Union([Type.Literal("pnpm test"), Type.Literal("pnpm run typecheck")])),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400_000 })),
	},
	{ additionalProperties: false },
);
const gateSchema = Type.Object(
	{
		key: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
		task: Type.String({ minLength: 1, maxLength: 16 * 1024 }),
		cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 16 * 1024 })),
	},
	{ additionalProperties: false },
);
const parallelGatesArgsSchema = Type.Object({ gates: Type.Array(gateSchema, { minItems: 1, maxItems: 8 }) }, { additionalProperties: false });
const ISSUE_SEAMS = ["contracts-runtime", "interface-behavior", "reproduction-data"] as const;
type IssueSeam = (typeof ISSUE_SEAMS)[number];

const issueSeamSchema = Type.Union(ISSUE_SEAMS.map((seam) => Type.Literal(seam)));
const MAX_ISSUES_PER_SEAM = 6;
const scoutIssueSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" }),
		seam: issueSeamSchema,
		task: Type.String({ minLength: 1, maxLength: 2048 }),
		files: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 8 }),
	},
	{ additionalProperties: false },
);
const multiIssueScoutArgsSchema = Type.Object(
	{
		task: Type.String({ minLength: 1, maxLength: 16 * 1024 }),
		commonFindings: Type.Optional(Type.String({ minLength: 1, maxLength: 16 * 1024 })),
		issues: Type.Array(scoutIssueSchema, { minItems: 1, maxItems: 48 }),
	},
	{ additionalProperties: false },
);

type WorkflowArgs = Parameters<WorkflowResourceDefinition["resolve"]>[0];
type Resolution = ReturnType<WorkflowResourceDefinition["resolve"]>;
type ScoutIssue = Static<typeof scoutIssueSchema>;

const SEAM_LABELS = {
	"contracts-runtime": "Inspect contracts and runtime",
	"interface-behavior": "Inspect interfaces and behavior",
	"reproduction-data": "Inspect reproduction data",
} as const satisfies Record<IssueSeam, string>;

function invalidArgs(name: string, schema: TSchema, args: WorkflowArgs): Resolution {
	const details = [...Value.Errors(schema, args)].map((error) => `${error.instancePath}: ${error.message}`);
	return { error: `workflow '${name}' args are invalid: ${details.join("; ")}.` };
}

function resolveRunCi(args: WorkflowArgs): Resolution {
	if (!Value.Check(runCiArgsSchema, args)) return invalidArgs("run-ci", runCiArgsSchema, args);
	const command = args.command ?? "pnpm test";
	const timeoutMs = args.timeoutMs ?? 120_000;
	const params = { kind: "command", command, timeoutMs, role: "ci" };
	return {
		script: `return await runs.host("ci", ${JSON.stringify(params)});`,
		hostCommands: [{ key: "ci", command }],
	};
}

function resolveReview(args: WorkflowArgs): Resolution {
	if (!Value.Check(taskArgsSchema, args)) return invalidArgs("review", taskArgsSchema, args);
	return {
		script: `return (await runs.run("review", { agent: "reviewer", task: ${JSON.stringify(args.task.trim())} })).output;`,
	};
}

function partitionScoutIssues(issues: readonly ScoutIssue[]): Map<IssueSeam, ScoutIssue[]> | { error: string } {
	const bySeam = new Map<IssueSeam, ScoutIssue[]>();
	for (const seam of ISSUE_SEAMS) bySeam.set(seam, []);
	const seenIds = new Set<string>();
	for (const issue of issues) {
		const owned = bySeam.get(issue.seam);
		if (owned === undefined) throw new Error(`workflow 'multi-issue-scout' seam '${issue.seam}' is missing from the seam registry.`);
		if (seenIds.has(issue.id)) {
			return { error: `workflow 'multi-issue-scout' issue id '${issue.id}' is assigned more than once; each issue id must have exactly one seam owner.` };
		}
		seenIds.add(issue.id);
		owned.push(issue);
	}
	for (const [seam, owned] of bySeam) {
		if (owned.length > MAX_ISSUES_PER_SEAM) {
			return {
				error: `workflow 'multi-issue-scout' seam '${seam}' has ${owned.length} assigned issues; at most ${MAX_ISSUES_PER_SEAM} per seam keeps each scout inside its read budget. Split the remainder into another workflow.`,
			};
		}
	}
	return bySeam;
}

function scoutIssueLine(issue: ScoutIssue): string {
	return `- [${issue.id}] ${issue.task.trim()}\n  Files: ${issue.files.join("; ")}`;
}

function scoutTaskText(objective: string, commonFindings: string | undefined, assigned: readonly ScoutIssue[]): string {
	const lines = [
		"Read-only investigation: do not edit files or run destructive commands. Do not use a browser or external service.",
		`Objective: ${objective.trim()}`,
	];
	if (commonFindings !== undefined && commonFindings.trim()) {
		lines.push(`Common findings from the parent (verify only what your assigned issues need; do not rediscover them): ${commonFindings.trim()}`);
	}
	lines.push(`Assigned issues (investigate only these; other issues belong to other lanes):\n${assigned.map(scoutIssueLine).join("\n")}`);
	lines.push(
		"Bound the report: one entry per assigned issue with a verdict (confirmed, refuted, or inconclusive), at most 3 file-and-line evidence pointers, and the smallest likely fix.",
		"Finish with at most 2 unknowns stated as unanswered questions and at most 5 unread file paths, each with a one-line reason it matters next.",
	);
	return lines.join("\n");
}

function resolveMultiIssueScout(args: WorkflowArgs): Resolution {
	if (!Value.Check(multiIssueScoutArgsSchema, args)) {
		return invalidArgs("multi-issue-scout", multiIssueScoutArgsSchema, args);
	}
	const partition = partitionScoutIssues(args.issues);
	if ("error" in partition) return partition;
	const lanes = ISSUE_SEAMS.map((seam) => ({ seam, owned: partition.get(seam) ?? [] }))
		.filter(({ owned }) => owned.length > 0)
		.map(({ seam, owned }) => ({
			key: seam,
			label: SEAM_LABELS[seam],
			agent: "scout",
			context: "fresh",
			tools: READ_ONLY_TOOLS,
			task: scoutTaskText(args.task, args.commonFindings, owned),
			toolBudget: { soft: 20, hard: 30, block: READ_BLOCK },
			lane: { version: 1, key: seam, mode: "scout" },
		}));
	return {
		script: `const results = await runs.all(${JSON.stringify(lanes)});\nreturn results.map(({ key, ok, output }) => ({ key, ok, output }));`,
	};
}

function resolveParallelGates(args: WorkflowArgs): Resolution {
	if (!Value.Check(parallelGatesArgsSchema, args)) return invalidArgs("parallel-gates", parallelGatesArgsSchema, args);
	const keys = new Set(args.gates.map((gate) => gate.key));
	if (keys.size !== args.gates.length) return { error: "workflow 'parallel-gates' gate keys must be unique." };
	const toolBudget = { soft: 6, hard: 10, block: READ_BLOCK };
	const launches = args.gates.map(({ key, task, cwd }) => ({
		key,
		label: `Validate ${key}`,
		agent: "scout",
		context: "fresh",
		tools: READ_ONLY_TOOLS,
		task: `Validation-only lane: do not edit files or run destructive commands.\nGate: ${task.trim()}\nRun only the required checks. Report exact command status, test counts, elapsed time when available, and the first actionable failure. Do not fix failures.`,
		cwd,
		toolBudget,
		lane: { version: 1, key, mode: "gate" },
	}));
	return {
		script: `const results = await runs.all(${JSON.stringify(launches)});\nreturn results.map(({ key, ok, output }) => ({ key, ok, output }));`,
	};
}

export const BUILTIN_WORKFLOW_RESOURCES: readonly WorkflowResourceDefinition[] = [
	{ name: "multi-issue-scout", version: 1, resolve: resolveMultiIssueScout },
	{ name: "parallel-gates", version: 1, resolve: resolveParallelGates },
	{ name: "review", version: 1, resolve: resolveReview },
	{ name: "run-ci", version: 1, resolve: resolveRunCi },
];
