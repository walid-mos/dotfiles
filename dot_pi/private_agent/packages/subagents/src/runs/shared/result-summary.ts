import { isUnexplainedProcessSignal } from "./process-signal.ts";
import type {
	NestedRunSummary,
	PublicNestedRunSummary,
	SubagentResultChild,
	SubagentResultStatus,
} from "../../shared/types.ts";

export function resolveSubagentResultStatus(input: {
	exitCode?: number;
	success?: boolean;
	state?: string;
	interrupted?: boolean;
	detached?: boolean;
	processSignal?: string | null;
	timedOut?: boolean;
	stopped?: boolean;
	turnBudgetExceeded?: boolean;
}): SubagentResultStatus {
	if (input.detached) return "detached";
	if (input.stopped || input.state === "stopped") return "stopped";
	if (input.interrupted || input.state === "paused") return "paused";
	if (input.state === "running" || input.state === "queued") return "running";
	if (input.success === true) return "completed";
	if (isUnexplainedProcessSignal(input) && input.exitCode !== 0) return "stopped";
	if (input.success === false) return "failed";
	if (input.state === "complete") return "completed";
	if (input.state === "failed") return "failed";
	if (typeof input.exitCode === "number") return input.exitCode === 0 ? "completed" : "failed";
	return "failed";
}

function compactNestedRun(run: NestedRunSummary | PublicNestedRunSummary, depth = 0): PublicNestedRunSummary {
	return {
		id: run.id,
		parentRunId: run.parentRunId,
		...(run.parentStepIndex !== undefined ? { parentStepIndex: run.parentStepIndex } : {}),
		...(run.parentAgent ? { parentAgent: run.parentAgent } : {}),
		depth: run.depth,
		path: run.path.slice(0, 4).map((part) => ({
			runId: part.runId,
			...(part.stepIndex !== undefined ? { stepIndex: part.stepIndex } : {}),
			...(part.agent ? { agent: part.agent } : {}),
		})),
		...(run.asyncDir ? { asyncDir: run.asyncDir } : {}),
		...(run.sessionId ? { sessionId: run.sessionId } : {}),
		...(run.sessionName ? { sessionName: run.sessionName } : {}),
		...(run.sessionFile ? { sessionFile: run.sessionFile } : {}),
		...(run.intercomTarget ? { intercomTarget: run.intercomTarget } : {}),
		...(run.ownerIntercomTarget ? { ownerIntercomTarget: run.ownerIntercomTarget } : {}),
		...(run.leafIntercomTarget ? { leafIntercomTarget: run.leafIntercomTarget } : {}),
		...(run.ownerState ? { ownerState: run.ownerState } : {}),
		...(run.mode ? { mode: run.mode } : {}),
		state: run.state,
		...(run.agent ? { agent: run.agent } : {}),
		...(run.agents?.length ? { agents: run.agents.slice(0, 12) } : {}),
		...(run.model ? { model: run.model } : {}),
		...(run.thinking ? { thinking: run.thinking } : {}),
		...(run.currentStep !== undefined ? { currentStep: run.currentStep } : {}),
		...(run.chainStepCount !== undefined ? { chainStepCount: run.chainStepCount } : {}),
		...(run.parallelGroups?.length ? { parallelGroups: run.parallelGroups.slice(0, 8) } : {}),
		...(run.activityState ? { activityState: run.activityState } : {}),
		...(run.lastActivityAt !== undefined ? { lastActivityAt: run.lastActivityAt } : {}),
		...(run.currentTool ? { currentTool: run.currentTool } : {}),
		...(run.currentToolStartedAt !== undefined ? { currentToolStartedAt: run.currentToolStartedAt } : {}),
		...(run.currentPath ? { currentPath: run.currentPath } : {}),
		...(run.turnCount !== undefined ? { turnCount: run.turnCount } : {}),
		...(run.toolCount !== undefined ? { toolCount: run.toolCount } : {}),
		...(run.totalTokens ? { totalTokens: run.totalTokens } : {}),
		...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
		...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
		...(run.lastUpdate !== undefined ? { lastUpdate: run.lastUpdate } : {}),
		...(run.error ? { error: run.error } : {}),
		...(run.steps?.length ? { steps: run.steps.slice(0, 12).map((step) => ({
			agent: step.agent,
			...(step.sessionName ? { sessionName: step.sessionName } : {}),
			status: step.status,
			...(step.model ? { model: step.model } : {}),
			...(step.thinking ? { thinking: step.thinking } : {}),
			...(step.sessionFile ? { sessionFile: step.sessionFile } : {}),
			...(step.activityState ? { activityState: step.activityState } : {}),
			...(step.lastActivityAt !== undefined ? { lastActivityAt: step.lastActivityAt } : {}),
			...(step.currentTool ? { currentTool: step.currentTool } : {}),
			...(step.currentToolStartedAt !== undefined ? { currentToolStartedAt: step.currentToolStartedAt } : {}),
			...(step.currentPath ? { currentPath: step.currentPath } : {}),
			...(step.turnCount !== undefined ? { turnCount: step.turnCount } : {}),
			...(step.toolCount !== undefined ? { toolCount: step.toolCount } : {}),
			...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
			...(step.endedAt !== undefined ? { endedAt: step.endedAt } : {}),
			...(step.error ? { error: step.error } : {}),
			...(depth < 2 && step.children?.length ? { children: step.children.slice(0, 8).map((child) => compactNestedRun(child, depth + 1)) } : {}),
		})) } : {}),
		...(depth < 2 && run.children?.length ? { children: run.children.slice(0, 8).map((child) => compactNestedRun(child, depth + 1)) } : {}),
	};
}

export function compactNestedResultChildren(children: Array<NestedRunSummary | PublicNestedRunSummary> | undefined): PublicNestedRunSummary[] | undefined {
	if (!children?.length) return undefined;
	return children.slice(0, 16).map((child) => compactNestedRun(child));
}

export function attachNestedChildrenToResultChildren(
	runId: string,
	children: SubagentResultChild[],
	nestedChildren: NestedRunSummary[] | undefined,
): SubagentResultChild[] {
	const compact = compactNestedResultChildren(nestedChildren);
	if (!compact?.length) return children.map((child) => ({ ...child, children: compactNestedResultChildren(child.children) }));
	return children.map((child, index) => {
		const childIndex = child.index ?? index;
		const alreadyAttachedIds = new Set(child.children?.map((nested) => nested.id) ?? []);
		const attached = compact.filter((nested) => nested.parentRunId === runId && nested.parentStepIndex === childIndex && !alreadyAttachedIds.has(nested.id));
		const fallbackAttached = children.length === 1
			? compact.filter((nested) => nested.parentRunId === runId && nested.parentStepIndex === undefined && !alreadyAttachedIds.has(nested.id))
			: [];
		const merged = compactNestedResultChildren([...(child.children ?? []), ...attached, ...fallbackAttached]);
		return merged?.length ? { ...child, children: merged } : { ...child, children: undefined };
	});
}
