import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { installRunnerHttpDispatcher } from "./runner-http-dispatcher.ts";
import { writeAtomicJson } from "../../shared/atomic-json.ts";
import { writeAsyncResultFile, writePendingAsyncResultFile } from "./result-files.ts";
import { createFileCoalescer } from "../../shared/file-coalescer.ts";
import { createCapacityResilientJsonWriter } from "../../shared/capacity-resilient-json.ts";
import { isStorageCapacityError } from "../../shared/file-system-retry.ts";
import { updateActiveRunIndex } from "./active-run-index.ts";
import { createChildTranscriptWriter, type ChildTranscriptWriter } from "../../shared/child-transcript.ts";
import { closeSteerInbox, closeStopInbox, consumeInterruptRequest, consumeSteerRequests, consumeStopRequestPayloads, deliverInterruptRequest, deliverStopRequest, deliverTimeoutRequest, watchAsyncControlInbox, type SteerRequest, type StopRequest } from "./control-channel.ts";
import { appendJsonl as appendRawJsonl, formatOutputArtifactContent, getArtifactPaths, writeArtifact, writeMetadata } from "../../shared/artifacts.ts";
import { preflightLaunchCwd } from "../shared/launch-cwd.ts";
import { captureSingleOutputSnapshot, extractChildWrittenOutput, finalizeSingleOutput, formatSavedOutputReference, resolveSingleOutput, type SingleOutputSnapshot } from "../shared/single-output.ts";
import {
	type ActivityState,
	type ArtifactConfig,
	type ArtifactPaths,
	type AsyncParallelGroupStatus,
	type AsyncStatus,
	type ChainOutputMap,
	type CostSummary,
	type LaunchResolvedChildExtensions,
	type RuntimeAcknowledgedChildExtensions,
	type PiWriterProcessInstanceExit,
	type NestedRouteInfo,
	type NestedRunSummary,
	type ResolvedControlConfig,
	type ResolvedToolBudget,
	type RunFanoutBudgetDescriptor,
	type SubagentRunMode,
	type SubagentOutputState,
	type UsageBudgetConfig,
	type ToolBudgetState,
	type Usage,
	type WorkflowGraphSnapshot,
	type SteeringTargetState,
	type SteeringTargetStatus,
	type SubagentChildStatusEvent,
	type WorkflowLaneMetadata,
	DEFAULT_MAX_OUTPUT,
	type MaxOutputConfig,
	SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
	truncateOutput,
} from "../../shared/types.ts";
import {
	DEFAULT_CONTROL_CONFIG,
	buildControlEvent,
	deriveActivityState,
	claimControlNotification,
	formatControlNoticeMessage,
	shouldEmitOpenToolAttention,
} from "../shared/subagent-control.ts";
import {
	type RunnerSubagentStep as SubagentStep,
	type RunnerStep,
	isParallelGroup,
	flattenSteps,
	mapConcurrent,
	aggregateParallelOutputs,
	MAX_PARALLEL_CONCURRENCY,
	DEFAULT_GLOBAL_CONCURRENCY_LIMIT,
	Semaphore,
} from "../shared/parallel-utils.ts";
import { projectLaunchResolvedChildExtensions, resolvePiLaunchToolPlan } from "../shared/child-tool-plan.ts";
import type { InheritedChildRuntime } from "../shared/child-launch.ts";
import { buildRunnerChildLaunch } from "./runner-child-launch.ts";
import { normalizeExtensionBindings } from "../shared/extension-bindings.ts";
import type { ChildSessionFactory, DefaultChildSessionFactoryOptions } from "../shared/child-session.ts";
import { runChildSession, type ChildEvent, type RunChildSessionInput, type RunChildSessionResult, type SteerDelivery, type StepSteerHandler } from "./run-child-session.ts";
import { loadRunnerChildSessionFactory } from "./runner-child-sessions.ts";
import { SUBAGENT_CHILD_ENV } from "../shared/child-runtime-config.ts";
import { deriveChildSessionName } from "../../shared/child-session-name.ts";
import { alignForkedSessionCwd } from "../../shared/fork-session-cwd.ts";
import { outputEntryFromAsyncResult, resolveOutputReferences } from "../shared/chain-outputs.ts";
import { clearStructuredOutputCaptures, createStructuredOutputFileCapture, createStructuredOutputRuntime, formatStructuredOutputRejectionError, MISSING_STRUCTURED_OUTPUT_CALL_ERROR, readStructuredOutput, readStructuredOutputAcceptanceReport } from "../shared/structured-output.ts";
import { formatMidToolExitError, isOrdinaryToolForMidToolExit, isUnexplainedProcessSignal } from "../shared/process-signal.ts";
import { formatChildToolDiagnostic } from "../shared/tool-availability.ts";
import { buildTimeoutRecoverySummary, collectTrackedMutationEvidence, snapshotTrackedMutations } from "../shared/mutation-evidence.ts";
import { getRunFanoutBudgetSnapshot } from "../shared/run-fanout-budget.ts";
import { nestedSummaryFromAsyncStatus, projectNestedEvents, resolveNestedAsyncDir, writeNestedEvent } from "../shared/nested-events.ts";
import { formatSubagentModelVerificationError, isContextOverflow } from "../shared/model-resolution.ts";
import { processTerminalPath, writeProcessTerminalCandidate, type ProcessTerminalCandidate } from "./process-terminal.ts";
import { persistRunnerStartupFailure } from "./runner-startup-failure.ts";
import { currentPidNamespaceScope } from "./pid-namespace.ts";
import { createSteeringStatus, recordSteeringRequest, steeringStatus, terminalSteeringNoticeState, unconsumedSteerReason, updateSteeringTarget } from "./steering.ts";
import { PROMPT_REDACTED, detectSubagentError, extractTextFromContent, extractToolArgsPreview, formatEmptyTerminalAssistantResponseError, getAgentDir, getFinalOutput, hasEmptyTerminalAssistantResponse } from "../../shared/utils.ts";
import { planAbortRecovery } from "../shared/abort-recovery.ts";
import {
	createMutatingFailureState,
	didMutatingToolFail,
	isMutatingTool,
	nextLongRunningTrigger,
	recordMutatingFailure,
	resetMutatingFailureState,
	resolveCurrentPath,
	shouldEscalateMutatingFailures,
	summarizeRecentMutatingFailures,
} from "../shared/long-running-guard.ts";
import { parseSessionTokens } from "../../shared/session-tokens.ts";
import type { TokenUsage } from "../../shared/types.ts";
import {
	cleanupWorktrees,
	createWorktrees,
	withWorktreeTransaction,
	WorktreeSetupError,
	type WorktreeSetupProgress,
	diffWorktrees,
	findWorktreeTaskCwdConflict,
	formatWorktreeDiffSummary,
	formatWorktreeTaskCwdConflict,
	type WorktreeSetup,
} from "../shared/worktree.ts";
import { findModelInfo, resolveEffectiveThinking, splitKnownThinkingSuffix } from "../../shared/model-info.ts";
import { assertThinkingWithinCeiling } from "../../shared/thinking-ceiling.ts";
import { resolveLaunchBinding } from "../../shared/launch-contract.ts";
import { writeInitialProgressFile } from "../../shared/settings.ts";
import { acceptanceBlocksGate, acceptanceFailureMessage, acceptanceNeedsRecovery, acceptanceRecoveryMessage, buildSkippedAcceptanceLedger, captureStagedIndexBaseline, evaluateAcceptance, resolveAcceptanceReportMode, stripAcceptanceReport, typedVerifyOutput } from "../shared/acceptance.ts";
import { attachContractProjections, isAgentContract } from "../shared/agent-contract.ts";
import { statusStepDescription } from "../../shared/status-format.ts";
import { asyncStatusChildIdentity } from "../shared/child-identity.ts";
import { initialToolBudgetState, toolBudgetState } from "../shared/tool-budget.ts";
import { effectiveToolTimeoutMs, formatToolTimeoutMessage, toolTimeoutCallKey } from "../shared/tool-timeout.ts";
import { usageBudgetExceededMessage, usageBudgetState } from "../shared/usage-budget.ts";
import { formatParallelHandoffError, formatParallelHandoffReference, parallelHandoffPath, writeParallelHandoffGroup, writeWorktreeSetupHandoff } from "../shared/parallel-handoff.ts";
import type { SessionLeaseRequest } from "../shared/session-lease.ts";
import type { ResolvedSubagentCapabilityCeiling } from "../shared/capability-ceiling.ts";

const INTERCOM_DETACH_RECEIPT = "Detached for intercom coordination before task completion.";

// This process hosts child sessions. An ambient copy of pi-subagents loaded
// into one of them must register nothing; the variable marks the process as a
// child host.
process.env[SUBAGENT_CHILD_ENV] = "1";

export interface SubagentRunConfig {
	id: string;
	steps: RunnerStep[];
	resultPath: string;
	cwd: string;
	placeholder: string;
	taskIndex?: number;
	totalTasks?: number;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig?: Partial<ArtifactConfig>;
	sessionDir?: string;
	asyncDir: string;
	sessionId?: string | null;
	completionOwnerId?: string;
	piPackageRoot?: string;
	/** Test seam: module the runner imports its `ChildSessionFactory` from. */
	childSessionFactoryModule?: string;
	/** The launching executor's own child runtime when it was itself an in-process child. */
	inheritedChildRuntime?: InheritedChildRuntime;
	/** The launching session's project trust; undefined keeps Pi's default for hosts without trust. */
	projectTrusted?: boolean;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
	worktreeBaseDir?: string;
	baseRef?: string;
	worktreeBranchPrefix?: string;
	controlConfig?: ResolvedControlConfig;
	controlIntercomTarget?: string;
	childIntercomTargets?: Array<string | undefined>;
	resultMode?: SubagentRunMode;
	mode?: SubagentRunMode;
	workflowGraph?: WorkflowGraphSnapshot;
	nestedRoute?: NestedRouteInfo;
	nestedSelf?: { parentRunId: string; parentStepIndex?: number; depth: number; path?: Array<{ runId: string; stepIndex?: number; agent?: string }> };
	timeoutMs?: number;
	deadlineAt?: number;
	/** Resolved configured hard per-tool-call timeout (ms); fast tools still have a default when undefined. */
	toolTimeoutMs?: number;
	/** Steer the running steps to checkpoint and stop this many ms before `deadlineAt`; absent = no checkpoint steer. */
	checkpointBeforeDeadlineMs?: number;
	toolBudget?: ResolvedToolBudget;
	usageBudget?: UsageBudgetConfig;
	revivalLease?: SessionLeaseRequest;
	revivalLeaseToken?: string;
	/** Global cap on simultaneously-running subagent tasks within this run. */
	globalConcurrencyLimit?: number;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	runFanoutBudget?: RunFanoutBudgetDescriptor;
	/** Builtin tool names the host runtime provides; used to intersect agent-declared tools. */
	launchContractDigest?: string;
	launchResolvedExtensions?: LaunchResolvedChildExtensions;
	runtimeAcknowledgedExtensions?: RuntimeAcknowledgedChildExtensions;
	runnerProcessInstanceId?: string;
	launchBarrierToken?: string;
	parentWorkflowRunId?: string;
	workflowKey?: string;
	lane?: WorkflowLaneMetadata;
}

interface StepResult {
	agent: string;
	/** Human-readable display name for the child session, when derived at launch. */
	sessionName?: string;
	context?: "fresh" | "fork";
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: import("../shared/capability-ceiling.ts").SubagentCapabilityAudit;
	launchResolvedExtensions?: LaunchResolvedChildExtensions;
	runtimeAcknowledgedExtensions?: RuntimeAcknowledgedChildExtensions;
	output: string;
	outputState?: SubagentOutputState;
	error?: string;
	success?: boolean;
	exitCode: number | null;
	usage?: Usage;
	savedOutputPath?: string;
	skipped?: boolean;
	interrupted?: boolean;
	detached?: boolean;
	timedOut?: boolean;
	stopped?: boolean;
	processSignal?: string | null;
	timeoutRecovery?: import("../../shared/types.ts").TimeoutRecoverySummary;
	toolBudget?: ToolBudgetState;
	toolBudgetBlocked?: boolean;
	sessionFile?: string;
	intercomTarget?: string;
	model?: string;
	thinking?: string;
	requestedModel?: string;
	/** True when the dispatch failed because the input exceeded the model's context window. */
	contextOverflow?: boolean;
	totalCost?: CostSummary;
	artifactPaths?: ArtifactPaths;
	outputSaveError?: string;
	artifactOutputSaveFailed?: true;
	metadataSaveError?: string;
	truncated?: boolean;
	transcriptPath?: string;
	transcriptError?: string;
	agentContract?: import("../../shared/types.ts").AgentContract;
	launchContractDigest?: string;
	execution?: import("../../shared/types.ts").ExecutionProjection;
	review?: import("../../shared/types.ts").ReviewProjection;
	effects?: import("../../shared/types.ts").EffectsProjection;
	structuredOutput?: unknown;
	structuredOutputFailed?: boolean;
	structuredOutputPath?: string;
	structuredOutputSchemaPath?: string;
	acceptance?: import("../../shared/types.ts").AcceptanceLedger;
}

function persistStepArtifacts(input: {
	artifactPaths: ArtifactPaths;
	artifactConfig?: Partial<ArtifactConfig>;
	output: string;
	metadata: object;
}): { outputSaveError?: string; metadataSaveError?: string } {
	const errors: { outputSaveError?: string; metadataSaveError?: string } = {};
	if (input.artifactConfig?.includeOutput !== false) {
		try {
			writeArtifact(input.artifactPaths.outputPath, input.output);
		} catch (error) {
			errors.outputSaveError = `Artifact output post-processing failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	if (input.artifactConfig?.includeMetadata !== false) {
		try {
			writeMetadata(input.artifactPaths.metadataPath, input.metadata);
		} catch (error) {
			errors.metadataSaveError = `Artifact metadata post-processing failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	return errors;
}

const ASYNC_INTERRUPT_SIGNAL: NodeJS.Signals = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";
const DEFAULT_MAX_ASYNC_EVENTS_BYTES = 50 * 1024 * 1024;
const ASYNC_EVENTS_MAX_BYTES_ENV = "PI_SUBAGENT_ASYNC_EVENTS_MAX_BYTES";
const TRUNCATED_EVENT_TYPE = "subagent.events.truncated";
const TRUNCATION_MARKER_RESERVE_BYTES = 512;

interface AsyncEventLogState {
	bytes: number;
	diagnosticsTruncated: boolean;
}

const asyncEventLogStates = new Map<string, AsyncEventLogState>();

function maxAsyncEventsBytes(): number {
	const raw = process.env[ASYNC_EVENTS_MAX_BYTES_ENV];
	if (!raw) return DEFAULT_MAX_ASYNC_EVENTS_BYTES;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_ASYNC_EVENTS_BYTES;
	return Math.floor(parsed);
}

function eventLogState(filePath: string): AsyncEventLogState {
	let state = asyncEventLogStates.get(filePath);
	if (state) return state;
	let bytes = 0;
	try {
		bytes = fs.statSync(filePath).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			// Diagnostic event accounting is best-effort; writes below are also safe.
		}
	}
	state = { bytes, diagnosticsTruncated: false };
	asyncEventLogStates.set(filePath, state);
	return state;
}

function appendJsonl(filePath: string, line: string): void {
	try {
		appendRawJsonl(filePath, line);
		const state = asyncEventLogStates.get(filePath);
		if (state) state.bytes += Buffer.byteLength(`${line}\n`, "utf-8");
	} catch {
		// Async event logging is diagnostic and must not fail the run.
	}
}

function appendDiagnosticJsonl(filePath: string, line: string, droppedEventType?: string): void {
	if (!line.trim()) return;
	const state = eventLogState(filePath);
	if (state.diagnosticsTruncated) return;
	const maxBytes = maxAsyncEventsBytes();
	const chunkBytes = Buffer.byteLength(`${line}\n`, "utf-8");
	const diagnosticBudget = Math.max(0, maxBytes - TRUNCATION_MARKER_RESERVE_BYTES);
	if (state.bytes + chunkBytes <= diagnosticBudget) {
		appendJsonl(filePath, line);
		return;
	}

	const marker = JSON.stringify({
		type: TRUNCATED_EVENT_TYPE,
		ts: Date.now(),
		maxBytes,
		droppedEventType,
	});
	if (state.bytes + Buffer.byteLength(`${marker}\n`, "utf-8") <= maxBytes) {
		appendJsonl(filePath, marker);
	}
	state.diagnosticsTruncated = true;
}

function isBlockingSupervisorTool(toolName: string | undefined, args: unknown): boolean {
	if (!args || typeof args !== "object" || Array.isArray(args)) return false;
	if (toolName === "contact_supervisor") {
		const reason = (args as Record<string, unknown>).reason;
		return reason === "need_decision" || reason === "interview_request";
	}
	return toolName === "intercom" && (args as Record<string, unknown>).action === "ask";
}

function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

function tokenUsageFromUsage(usage: Usage | undefined): TokenUsage | null {
	const input = usage?.input ?? 0;
	const output = usage?.output ?? 0;
	const total = input + output;
	return total > 0 ? { input, output, total } : null;
}

function costSummaryFromUsage(usage: Usage | undefined): CostSummary | undefined {
	const inputTokens = usage?.input ?? 0;
	const outputTokens = usage?.output ?? 0;
	const costUsd = usage?.cost ?? 0;
	return inputTokens > 0 || outputTokens > 0 || costUsd > 0
		? { inputTokens, outputTokens, costUsd }
		: undefined;
}

function appendRecentStepOutput(step: RunnerStatusStep, lines: string[]): void {
	const nonEmpty = lines.filter((line) => line.trim());
	if (nonEmpty.length === 0) return;
	step.recentOutput ??= [];
	step.recentOutput.push(...nonEmpty);
	if (step.recentOutput.length > 50) {
		step.recentOutput.splice(0, step.recentOutput.length - 50);
	}
}

type UndefinedOmitted<T extends object> = {
	[K in keyof T]: Exclude<T[K], undefined>;
};

function omitUndefinedProperties<const T extends object>(value: T): UndefinedOmitted<T> {
	for (const key in value) {
		if (value[key] === undefined) delete value[key];
	}
	return value as UndefinedOmitted<T>;
}

type WithUndefinedOptionals<T extends object> = {
	[K in keyof T]: {} extends Pick<T, K> ? T[K] | undefined : T[K];
};

type RequiredKeysAllowingUndefined<T extends object> = {
	[K in keyof T]-?: {} extends Pick<T, K> ? never : undefined extends T[K] ? K : never;
}[keyof T];

function compactOptional<T extends object>(
	value: WithUndefinedOptionals<T> & (RequiredKeysAllowingUndefined<T> extends never ? unknown : never),
): T {
	for (const key of Object.keys(value) as Array<keyof T>) {
		if (value[key] === undefined) delete value[key];
	}
	return value as T;
}

function setOptionalProperty<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
	if (value === undefined) delete target[key];
	else target[key] = value;
}

function resetStepLiveDetail(step: RunnerStatusStep): void {
	delete step.currentTool;
	delete step.currentToolArgs;
	delete step.currentToolStartedAt;
	delete step.currentPath;
	step.recentTools = [];
	step.recentOutput = [];
}

const MAX_CHILD_FAILURE_DIAGNOSTIC_CHARS = 8_192;

function formatRequiredOutputError(requiredOutput: {
	kind: "file-only" | "structured";
	path: string;
	missing: boolean;
} | undefined): string | undefined {
	if (!requiredOutput?.missing) return undefined;
	return `Required ${requiredOutput.kind} output was not produced: ${requiredOutput.path.slice(0, 2_048)}`;
}

function formatChildFailureDiagnostic(input: {
	error: string | undefined;
	afterCompactionSettlement?: boolean;
	abortRecoveryDiagnostic?: string;
	requiredOutput?: {
		kind: "file-only" | "structured";
		path: string;
		missing: boolean;
	};
}): string | undefined {
	const missingOutput = formatRequiredOutputError(input.requiredOutput);
	const notes = [
		input.abortRecoveryDiagnostic,
		input.afterCompactionSettlement ? "Child failure followed session compaction and agent settlement." : undefined,
		missingOutput && input.error !== missingOutput ? missingOutput : undefined,
	].filter((note): note is string => Boolean(note));
	if (notes.length === 0) return input.error;
	const context = notes.join("\n");
	const errorLimit = MAX_CHILD_FAILURE_DIAGNOSTIC_CHARS - (context ? context.length + 1 : 0);
	const baseError = input.error || "Subagent failed.";
	return `${baseError.slice(0, Math.max(0, errorLimit))}${context ? `\n${context}` : ""}`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);
	return `${minutes}m${seconds}s`;
}

function writeRunLog(
	logPath: string,
	input: {
		id: string;
		mode: SubagentRunMode;
		cwd: string;
		startedAt: number;
		endedAt: number;
		steps: Array<{
			agent: string;
			status: string;
			durationMs?: number;
		}>;
		summary: string;
		truncated: boolean;
		artifactsDir?: string;
		sessionFile?: string;
	},
	write: (filePath: string, content: string) => void = (filePath, content) => fs.writeFileSync(filePath, content, "utf-8"),
): void {
	const lines: string[] = [];
	lines.push(`# Subagent run ${input.id}`);
	lines.push("");
	lines.push(`- **Mode:** ${input.mode}`);
	lines.push(`- **CWD:** ${input.cwd}`);
	lines.push(`- **Started:** ${new Date(input.startedAt).toISOString()}`);
	lines.push(`- **Ended:** ${new Date(input.endedAt).toISOString()}`);
	lines.push(`- **Duration:** ${formatDuration(input.endedAt - input.startedAt)}`);
	if (input.sessionFile) lines.push(`- **Session:** ${input.sessionFile}`);
	if (input.artifactsDir) lines.push(`- **Artifacts:** ${input.artifactsDir}`);
	lines.push("");
	lines.push("## Steps");
	lines.push("| Step | Agent | Status | Duration |");
	lines.push("| --- | --- | --- | --- |");
	input.steps.forEach((step, i) => {
		const duration = step.durationMs !== undefined ? formatDuration(step.durationMs) : "-";
		lines.push(`| ${i + 1} | ${step.agent} | ${step.status} | ${duration} |`);
	});
	lines.push("");
	lines.push("## Summary");
	if (input.truncated) {
		lines.push("_Output truncated_");
		lines.push("");
	}
	lines.push(input.summary.trim() || "(no output)");
	lines.push("");
	write(logPath, lines.join("\n"));
}

/** Context for running a single step */
interface SingleStepContext {
	previousOutput: string;
	outputs?: ChainOutputMap;
	placeholder: string;
	cwd: string;
	sessionEnabled: boolean;
	sessionDir?: string;
	artifactsDir?: string;
	artifactConfig?: Partial<ArtifactConfig>;
	id: string;
	flatIndex: number;
	flatStepCount: number;
	outputFile: string;
	transcriptPath?: string;
	piPackageRoot?: string;
	/** Factory the runner creates this step's child session through. */
	childSessions: ChildSessionFactory;
	/** The launching executor's own child runtime; nested route, depth, and ceilings come from here. */
	inheritedChildRuntime?: InheritedChildRuntime;
	projectTrusted?: boolean;
	registerInterrupt?: (interrupt: (() => void) | undefined) => void;
	registerTimeout?: (interrupt: (() => void) | undefined) => void;
	registerStop?: (stop: (() => void) | undefined) => void;
	/** Receives the live child's steer handler while its session runs. */
	registerSteer?: (steer: StepSteerHandler | undefined) => void;
	/** Reports a live child's later steer consumption or unconsumed settlement. */
	onSteerOutcome?: (request: SteerRequest, delivery: SteerDelivery) => void;
	timeoutSignal?: AbortSignal;
	stopSignal?: AbortSignal;
	timeoutMessage?: string;
	stopMessage?: string;
	/** Resolved configured hard per-tool-call timeout (ms); fast tools still have a default when undefined. */
	toolTimeoutMs?: number;
	/** Effective step deadline (Date.now() + effective timeout) when a run budget exists. */
	deadlineAt?: number;
	childIntercomTarget?: string;
	orchestratorIntercomTarget?: string;
	nestedRoute?: NestedRouteInfo;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	runFanoutBudget?: RunFanoutBudgetDescriptor;
	onAttemptStart?: (attempt: { model?: string; thinking?: string; contextLimit?: number }) => void;
	onChildEvent?: (event: ChildEvent) => void;
	skipAcceptance?: () => boolean;
	/** Authoritative owner decision after event delivery; undefined includes incomplete run-wide usage. */
	usageBudgetExhausted?: () => boolean | undefined;
	/** Existing run-owned budget configuration; cost allowance is not settled by the live token ledger. */
	usageBudget?: UsageBudgetConfig;
}

export async function runSingleStepInner(
	step: SubagentStep,
	ctx: SingleStepContext,
): Promise<StepResult> {
	const effectiveStructuredOutput = step.structuredOutput ?? (step.structuredOutputSchema
		? createStructuredOutputRuntime(step.structuredOutputSchema, path.join(path.dirname(ctx.outputFile), "structured-output"), { acceptanceReport: resolveAcceptanceReportMode(step.acceptanceInput) })
		: undefined);
	const placeholderRegex = new RegExp(ctx.placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
	let task = step.task.replace(placeholderRegex, () => ctx.previousOutput);
	if (ctx.outputs) task = resolveOutputReferences(task, ctx.outputs);
	const resolvedTaskToolPlan = resolvePiLaunchToolPlan(omitUndefinedProperties({
		tools: step.tools,
		excludeTools: step.excludeTools,
		allowNestedSubagents: step.allowNestedSubagents,
		extensions: step.extensions,
		subagentOnlyExtensions: step.subagentOnlyExtensions,
		fast: step.fast,
		model: step.model,
		mcpDirectTools: step.mcpDirectTools,
		cwd: step.cwd ?? ctx.cwd,
		requireReadTool: Boolean(step.skills?.length),
		structuredOutput: Boolean(effectiveStructuredOutput),
		capabilityCeiling: step.capabilityCeiling ?? ctx.capabilityCeiling,
		inheritedCapabilityCeiling: ctx.inheritedChildRuntime?.capabilityCeiling,
		permissionRules: step.permissionRules,
	}));
	// Derive from the pre-acceptance task so internal acceptance/recovery
	// instructions never leak into the display name.
	const childSessionName = step.sessionName ?? deriveChildSessionName({ agent: step.agent, task, label: step.label });
	const sessionEnabled = Boolean(step.sessionFile) || ctx.sessionEnabled;
	const sessionDir = step.sessionFile ? undefined : ctx.sessionDir;

	let artifactPaths: ArtifactPaths | undefined;
	let transcriptWriter: ChildTranscriptWriter | undefined;
	if (ctx.artifactsDir && ctx.artifactConfig?.enabled !== false) {
		const index = ctx.flatStepCount > 1 ? ctx.flatIndex : undefined;
		artifactPaths = getArtifactPaths(ctx.artifactsDir, ctx.id, step.agent, index);
		fs.mkdirSync(ctx.artifactsDir, { recursive: true });
		if (ctx.artifactConfig?.includeInput !== false) {
			fs.writeFileSync(artifactPaths.inputPath, `# Task for ${step.agent}\n\n${PROMPT_REDACTED}\n`, "utf-8");
		}
		if (ctx.artifactConfig?.includeTranscript !== false) {
			transcriptWriter = createChildTranscriptWriter({
				transcriptPath: artifactPaths.transcriptPath,
				source: "async",
				runId: ctx.id,
				agent: step.agent,
				childIndex: ctx.flatIndex,
				cwd: step.cwd ?? ctx.cwd,
			});
		}
	}
	transcriptWriter?.writeInitialUserMessage(PROMPT_REDACTED);

	const effectiveCwd = step.cwd ?? ctx.cwd;
	const cwdError = preflightLaunchCwd(step.requestedCwd ?? effectiveCwd, effectiveCwd);
	if (cwdError) return { agent: step.agent, output: cwdError, error: cwdError, exitCode: 1, context: step.context };
	if (step.context === "fork" && step.sessionFile && fs.existsSync(step.sessionFile)) {
		alignForkedSessionCwd(step.sessionFile, effectiveCwd);
	}

	const candidate = step.model;
	let capabilityAudit: import("../shared/capability-ceiling.ts").SubagentCapabilityAudit | undefined;
	let launchResolvedExtensions = step.launchResolvedExtensions;
	let finalRequiredOutputMissing: boolean | undefined;
	const eventsPath = path.join(path.dirname(ctx.outputFile), "events.jsonl");
	let finalResult: RunChildSessionResult | undefined;
	let finalOutputSnapshot: SingleOutputSnapshot | undefined;
	let structuredAcceptanceReport: unknown;
	let structuredAcceptanceReportError: string | undefined;
	let toolBudget = step.toolBudget ? initialToolBudgetState(step.toolBudget) : undefined;
	let toolBudgetBlocked = false;
	let actualLaunchContractDigest = step.launchContractDigest;
	const mutationSnapshot = snapshotTrackedMutations(step.cwd ?? ctx.cwd);
	let finalMutationEvidence = collectTrackedMutationEvidence(mutationSnapshot, step.cwd ?? ctx.cwd);

	let contextOverflow = false;
	let launchWarningsEmitted = false;
	const aggregateUsage = emptyUsage();
	let launched = false;
	let recoveryTask = task;
	let stagedIndexBaseline: string | undefined;
	singleLaunch: for (let attemptIndex = 0; attemptIndex < 2; attemptIndex++) {
		if (ctx.timeoutSignal?.aborted || ctx.stopSignal?.aborted || ctx.skipAcceptance?.()) break singleLaunch;
		const expectedModelForVerification = candidate && !step.skipPrimaryModelVerification ? candidate : undefined;
		try {
			assertThinkingWithinCeiling({ model: candidate, configThinking: step.thinking, ceiling: step.thinkingCeiling, agent: step.agent, runId: ctx.id });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return omitUndefinedProperties({ agent: step.agent, output: message, error: message, exitCode: 1, context: step.context, thinkingCeiling: step.thinkingCeiling });
		}
		const attemptModel = omitUndefinedProperties({ model: candidate, thinking: resolveEffectiveThinking(candidate, step.thinking) });
		ctx.onAttemptStart?.(omitUndefinedProperties({
			...attemptModel,
			contextLimit: findModelInfo(candidate, step.modelVerificationRegistry)?.contextWindow,
		}));
		const outputSnapshot = captureSingleOutputSnapshot(step.outputPath);
		if (effectiveStructuredOutput) {
			const cleanupError = clearStructuredOutputCaptures(effectiveStructuredOutput);
			if (cleanupError) {
				return omitUndefinedProperties({ agent: step.agent, output: cleanupError, error: cleanupError, exitCode: 1, context: step.context });
			}
		}
		const extensionBindings = normalizeExtensionBindings(step.extensionBindings)?.value;
		let launch: ReturnType<typeof buildRunnerChildLaunch>;
		try {
			launch = buildRunnerChildLaunch(step, ctx, {
				sessionEnabled,
				sessionDir,
				model: candidate,
				sessionName: childSessionName,
				structuredOutput: effectiveStructuredOutput,
			});
		} catch (error) { throw error; }
		if (effectiveStructuredOutput && launch.config.structuredOutput) {
			// The runner reads the value back from the runtime's files after the run.
			launch.config.structuredOutput.capture = createStructuredOutputFileCapture(effectiveStructuredOutput);
		}
		const { warnings, capabilityAudit: attemptCapabilityAudit } = launch;
		if (!launchWarningsEmitted && warnings.length > 0) {
			for (const warning of warnings) console.warn(`[pi-subagents] ${warning}`);
			launchWarningsEmitted = true;
		}
		if (step.definitionDigest) {
			const toolPlan = resolvedTaskToolPlan;
			launchResolvedExtensions = projectLaunchResolvedChildExtensions(toolPlan);
			actualLaunchContractDigest = resolveLaunchBinding({
				definitionDigest: step.definitionDigest,
				systemPromptMode: step.systemPromptMode,
				inheritProjectContext: step.inheritProjectContext,
				inheritGlobalContext: step.inheritGlobalContext,
				inheritSkills: step.inheritSkills,
				task: step.launchBindingTask ?? task,
				model: candidate,
				fast: step.fast,
				thinking: resolveEffectiveThinking(candidate, step.thinking),
				systemPrompt: step.systemPrompt ?? "",
				skills: step.skills,
				toolPlan,
				outputPath: step.outputPath,
				outputMode: step.outputMode,
				structuredOutputSchema: step.structuredOutputSchema,
				extensionBindings,
			}).launchContractDigest;
		}
		capabilityAudit = attemptCapabilityAudit;
		// Each attempt rewrites the step output log; synchronous appends keep a
		// retried attempt from interleaving with the previous attempt's flush.
		fs.writeFileSync(ctx.outputFile, "", "utf-8");
		if (step.effectiveAcceptance?.preserveStagedIndex && stagedIndexBaseline === undefined) {
			try {
				stagedIndexBaseline = captureStagedIndexBaseline(step.cwd ?? ctx.cwd);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { agent: step.agent, output: message, error: message, exitCode: 1, context: step.context };
			}
		}
		const run = await runChildSession(omitUndefinedProperties({
			factory: ctx.childSessions,
			launch,
			prompt: `Task: ${recoveryTask}`,
			childEventContext: { runId: ctx.id, stepIndex: ctx.flatIndex, agent: step.agent },
			appendChildEvent: (event) => appendDiagnosticJsonl(eventsPath, JSON.stringify(event), typeof event.type === "string" ? event.type : undefined),
			writeOutputLine: (line) => {
				try {
					fs.appendFileSync(ctx.outputFile, `${line}\n`, "utf-8");
				} catch {
					// The output log is observability only.
				}
			},
			registerInterrupt: ctx.registerInterrupt,
			registerTimeout: ctx.registerTimeout,
			registerStop: ctx.registerStop,
			registerSteer: ctx.registerSteer,
			onSteerOutcome: ctx.onSteerOutcome,
			timeoutMessage: ctx.timeoutMessage,
			stopMessage: ctx.stopMessage,
			onChildEvent: ctx.onChildEvent,
			onContextWindow: (contextLimit) => ctx.onAttemptStart?.({ ...attemptModel, contextLimit }),
			transcriptWriter,
			toolTimeoutMs: ctx.toolTimeoutMs,
			runDeadlineAt: ctx.deadlineAt,
			expectedModelForVerification,
			modelVerificationRegistry: step.modelVerificationRegistry,
			modelResponseAliases: step.modelResponseAliases,
			mutationTools: step.mutationTools,
		}));
		launched = true;
		aggregateUsage.input += run.usage.input;
		aggregateUsage.output += run.usage.output;
		aggregateUsage.cacheRead += run.usage.cacheRead;
		aggregateUsage.cacheWrite += run.usage.cacheWrite;
		aggregateUsage.cost += run.usage.cost;
		aggregateUsage.turns += run.usage.turns;
		// A parked run still owes output diagnostics when it actually finishes.
		// Stopped/timedOut runs already have terminal failures, so terminal output diagnostics are deferred.
		const terminalDiagnosticsEligible = !run.interrupted && !run.stopped && !run.timedOut;
		const toolDiagnostic = run.exitCode === 0 && !run.error ? launch.capture.toolDiagnostic() : undefined;
		const toolAvailabilityError = toolDiagnostic ? formatChildToolDiagnostic(toolDiagnostic) : undefined;
		const runtimeAcknowledgedExtensions = launch.capture.runtimeAcknowledgedExtensions();
		const midToolExitError = run.currentTool
			&& isOrdinaryToolForMidToolExit(run.currentTool)
			&& !run.interrupted
			&& !run.timedOut
			&& !run.stopped
			&& !toolAvailabilityError
			? formatMidToolExitError({ toolName: run.currentTool })
			: undefined;

		let structuredOutput: unknown;
		let structuredError: string | undefined;
		let validatedStructuredOutput = false;
		if (effectiveStructuredOutput) {
			const otherwiseSuccessful = terminalDiagnosticsEligible && run.exitCode === 0 && !run.error && !toolAvailabilityError && !midToolExitError;
			if (!run.structuredOutputToolInvoked && otherwiseSuccessful) {
				structuredError = MISSING_STRUCTURED_OUTPUT_CALL_ERROR;
			} else if (run.structuredOutputToolInvoked) {
				const structured = await readStructuredOutput({
					schema: effectiveStructuredOutput.schema,
					schemaPath: effectiveStructuredOutput.schemaPath,
					outputPath: effectiveStructuredOutput.outputPath,
				});
				if (structured.error) {
					if (otherwiseSuccessful) {
						structuredError = structured.error === MISSING_STRUCTURED_OUTPUT_CALL_ERROR
							? formatStructuredOutputRejectionError(run.messages)
							: structured.error;
					}
				}
				else {
					structuredOutput = structured.value;
					const acceptanceReport = readStructuredOutputAcceptanceReport(effectiveStructuredOutput);
					structuredAcceptanceReport = acceptanceReport.value;
					structuredAcceptanceReportError = acceptanceReport.error;
					validatedStructuredOutput = true;
				}
			}
		}
		const errorMessages = validatedStructuredOutput
			? run.messages.slice(run.structuredOutputMessageStartIndex ?? run.messages.length)
			: run.messages;
		const hiddenError = terminalDiagnosticsEligible && run.exitCode === 0 && !run.error && !toolAvailabilityError && !structuredError && !midToolExitError
			? detectSubagentError(errorMessages)
			: null;
		const terminalEmptyAfterUsefulWork = !validatedStructuredOutput
			&& hasEmptyTerminalAssistantResponse(run.messages)
			&& (run.toolCount > 0 || Boolean(run.finalOutput.trim()));
		const emptyOutputError = terminalDiagnosticsEligible && run.exitCode === 0
			&& !run.error
			&& !toolAvailabilityError
			&& !structuredError
			&& !validatedStructuredOutput
			&& (!run.finalOutput.trim() || terminalEmptyAfterUsefulWork)
			&& (!hiddenError?.hasError || hasEmptyTerminalAssistantResponse(run.messages))
			? formatEmptyTerminalAssistantResponseError(run.messages)
			: undefined;
		const mutationEvidence = collectTrackedMutationEvidence(mutationSnapshot, step.cwd ?? ctx.cwd);
		finalMutationEvidence = mutationEvidence;
		const mutationAttemptObserved = run.observedMutationAttempt === true || mutationEvidence.attemptedMutation === true;
		const finalOutputHasPersistableFileContent = run.exitCode === 0 && !run.error && !emptyOutputError && Boolean(stripAcceptanceReport(run.finalOutput).trim());
		const requiredOutput = step.outputMode === "file-only" && step.outputPath
			? { kind: "file-only" as const, path: step.outputPath, missing: !fs.existsSync(step.outputPath) && !finalOutputHasPersistableFileContent }
			: effectiveStructuredOutput
				? { kind: "structured" as const, path: effectiveStructuredOutput.outputPath, missing: !fs.existsSync(effectiveStructuredOutput.outputPath) }
			: undefined;
		finalRequiredOutputMissing = requiredOutput?.missing;
		const missingRequiredOutputError = terminalDiagnosticsEligible ? formatRequiredOutputError(requiredOutput) : undefined;
		const missingRequiredOutputAfterMutation = Boolean(missingRequiredOutputError) && (mutationAttemptObserved || Boolean(mutationEvidence.changedFiles.length));
		const effectiveExitCode = toolAvailabilityError || midToolExitError || structuredError || emptyOutputError || missingRequiredOutputError
			? 1
			: hiddenError?.hasError
				? (hiddenError.exitCode ?? 1)
				: run.error && run.exitCode === 0
					? 1
					: run.exitCode;
		const underlyingError = toolAvailabilityError
			?? midToolExitError
			?? structuredError
			?? run.error
			?? emptyOutputError
			?? (missingRequiredOutputAfterMutation ? missingRequiredOutputError : undefined)
			?? (hiddenError?.hasError
				? hiddenError.details
					? `${hiddenError.errorType} failed (exit ${effectiveExitCode}): ${hiddenError.details}`
					: `${hiddenError.errorType} failed with exit code ${effectiveExitCode}`
				: undefined);
		const error = underlyingError ?? missingRequiredOutputError;
		finalOutputSnapshot = outputSnapshot;
		if (step.toolBudget) {
			const toolMessages = run.messages.filter((message) => message.role === "toolResult");
			const blockedMessage = toolMessages.find((message) => extractTextFromContent(message.content).includes("Tool budget hard limit reached"));
			toolBudgetBlocked = Boolean(blockedMessage);
			toolBudget = toolBudgetState(step.toolBudget, toolMessages.length, blockedMessage ? (blockedMessage as { toolName?: string }).toolName : undefined);
		}
		const settlementDiagnostic = effectiveExitCode !== 0 ? {
			finalTextPresent: Boolean(stripAcceptanceReport(run.finalOutput).trim()),
			mutation: { attempted: mutationAttemptObserved, observed: mutationEvidence.attemptedMutation },
			...(requiredOutput ? { requiredOutput } : {}),
			afterCompactionSettlement: run.afterCompactionSettlement === true,
		} : undefined;
		const fileMutationEffect = missingRequiredOutputAfterMutation ? { status: "observed" as const, attempted: true as const, evidence: mutationEvidence } : undefined;
		finalResult = { ...run, exitCode: effectiveExitCode, model: candidate ?? run.model, error, structuredOutput, structuredOutputFailed: structuredError ? true : undefined, runtimeAcknowledgedExtensions, ...(step.agentContract ? { agentContract: step.agentContract } : {}), ...(fileMutationEffect || settlementDiagnostic ? { effects: { ...(fileMutationEffect ? { fileMutation: fileMutationEffect } : {}), ...(settlementDiagnostic ? { settlementDiagnostic } : {}) } } : {}) } as RunChildSessionResult;
		if (run.stopped || run.timedOut || ctx.timeoutSignal?.aborted || ctx.stopSignal?.aborted || ctx.skipAcceptance?.()) break singleLaunch;
		if (effectiveExitCode === 0 && !error) break singleLaunch;
		const recovery = planAbortRecovery({
			messages: run.messages,
			error,
			sessionAvailable: Boolean(step.sessionFile && fs.existsSync(step.sessionFile)),
			alreadyResumed: attemptIndex > 0,
			stopped: run.stopped || ctx.stopSignal?.aborted || ctx.skipAcceptance?.(),
			interrupted: run.interrupted,
			timedOut: run.timedOut || ctx.timeoutSignal?.aborted,
			toolBudgetExhausted: run.toolBudgetBlocked || toolBudgetBlocked,
			usageBudgetExhausted: ctx.usageBudgetExhausted?.(),
			structuredOutputFailed: Boolean(structuredError),
			acceptanceFailed: false,
			currentTool: run.currentTool,
			afterCompactionSettlement: run.afterCompactionSettlement,
		});
		if (recovery.action === "resume") {
			recoveryTask = recovery.prompt;
			continue singleLaunch;
		}
		if (recovery.diagnostic) {
			finalResult.abortRecoveryDiagnostic = recovery.diagnostic;
		}

		if (isContextOverflow(error)) {
			contextOverflow = true;
			break singleLaunch;
		}
		break singleLaunch;
	}

	const rawOutput = finalResult?.finalOutput ?? "";
	let outputForPersistence = stripAcceptanceReport(rawOutput);
	if (!outputForPersistence.trim() && finalResult?.structuredOutput !== undefined)
		outputForPersistence = JSON.stringify(finalResult.structuredOutput, null, 2);
	const resolvedOutput = step.outputPath && finalResult?.exitCode === 0
		? resolveSingleOutput(step.outputPath, outputForPersistence, finalOutputSnapshot, step.outputClaimPath)
		: { fullOutput: outputForPersistence };
	if (resolvedOutput.fatalError) {
		if (finalResult) {
			finalResult.exitCode = 1;
			finalResult.error = finalResult.error ? `${finalResult.error}\n${resolvedOutput.saveError}` : resolvedOutput.saveError;
		}
	}
	const output = stripAcceptanceReport(resolvedOutput.fullOutput);
	const outputReference = resolvedOutput.savedPath ? formatSavedOutputReference(resolvedOutput.savedPath, output) : undefined;
	let outputForSummary = output;
	if (finalResult?.stopped && !outputForSummary.trim()) {
		outputForSummary = ctx.stopMessage ?? "Subagent stopped by user.";
	}
	const outputForAcceptance = rawOutput;
	const childWrittenOutput = step.outputPath
		? extractChildWrittenOutput(finalResult?.messages, step.outputPath, step.cwd ?? ctx.cwd)
		: undefined;
	const outputState: SubagentOutputState = finalResult?.outputState === "present"
		|| (finalResult as (RunChildSessionResult & { structuredOutput?: unknown }) | undefined)?.structuredOutput !== undefined
		|| Boolean(childWrittenOutput?.trim())
		? "present"
		: resolvedOutput.savedPath
			? "unknown"
			: finalResult?.outputState ?? "unknown";
	const timeoutRecovery = finalResult?.timedOut === true || ctx.timeoutSignal?.aborted === true
		? buildTimeoutRecoverySummary({
			termination: "timed-out",
			evidence: finalMutationEvidence,
			requiredOutputMissing: finalRequiredOutputMissing,
			currentTool: finalResult?.currentTool,
			currentToolArgs: finalResult?.currentToolArgs,
			currentPath: finalResult?.currentPath,
			sessionFile: step.sessionFile,
			transcriptPath: transcriptWriter ? artifactPaths?.transcriptPath : undefined,
			artifactPaths,
		})
		: undefined;
	if (timeoutRecovery) outputForSummary = outputForSummary.trim()
		? `${outputForSummary}\n\n${timeoutRecovery.message}`
		: timeoutRecovery.message;
	const finalizedOutput = finalizeSingleOutput(omitUndefinedProperties({
		fullOutput: outputForSummary,
		outputPath: step.outputPath,
		outputMode: step.outputMode,
		exitCode: finalResult?.exitCode ?? 1,
		savedPath: resolvedOutput.savedPath,
		outputReference,
		saveError: resolvedOutput.saveError,
	}));
	outputForSummary = finalizedOutput.displayOutput;
	const acceptance = step.effectiveAcceptance && !finalResult?.stopped && !ctx.timeoutSignal?.aborted && !ctx.stopSignal?.aborted && !ctx.skipAcceptance?.()
		? await evaluateAcceptance(omitUndefinedProperties({
			acceptance: step.effectiveAcceptance,
			output: outputForAcceptance,
			report: structuredAcceptanceReport as import("../../shared/types.ts").AcceptanceReport | undefined,
			reportError: structuredAcceptanceReportError,
			fileOutput: childWrittenOutput !== undefined && step.outputPath
				? { content: childWrittenOutput, path: step.outputPath, authoritative: step.outputMode === "file-only", durable: resolvedOutput.savedPath !== undefined }
				: undefined,
			cwd: step.cwd ?? ctx.cwd,
			stagedIndexBaseline,
			signal: combinedAbortSignal([ctx.timeoutSignal, ctx.stopSignal]),
			abortMessage: ctx.stopSignal?.aborted ? ctx.stopMessage ?? "Subagent stopped by user." : ctx.timeoutMessage ?? "Subagent timed out.",
			reportOptional: isAgentContract(step.agentContract),
			artifactsDir: ctx.artifactsDir,
			runId: ctx.id,
			// Only a completed child whose acceptance outcome can block may repair
			// invalid evidence by resuming its retained session.
			sessionFile: (finalResult?.exitCode ?? 1) === 0 && !finalResult?.interrupted
				&& (isAgentContract(step.agentContract) ? step.gateOn === "acceptance" : step.effectiveAcceptance.explicit)
				&& step.sessionFile && fs.existsSync(step.sessionFile)
				? step.sessionFile
				: undefined,
		}))
		: undefined;
	const stoppedAfterAcceptance = finalResult?.stopped === true || ctx.stopSignal?.aborted === true;
	const timedOutAfterAcceptance = !stoppedAfterAcceptance && (finalResult?.timedOut === true || ctx.timeoutSignal?.aborted === true);
	const effectiveAcceptance = step.effectiveAcceptance
		? stoppedAfterAcceptance
			? buildSkippedAcceptanceLedger(step.effectiveAcceptance, { id: "stopped", message: "Acceptance was not evaluated because the subagent was stopped." })
			: timedOutAfterAcceptance
				? buildSkippedAcceptanceLedger(step.effectiveAcceptance, { id: "timeout", message: "Acceptance was not evaluated because the subagent timed out." })
				: acceptance
		: undefined;
	const acceptanceFailure = effectiveAcceptance ? acceptanceFailureMessage(effectiveAcceptance) : undefined;
	const acceptanceCanFailRun = acceptanceFailure && effectiveAcceptance?.explicit && (finalResult?.exitCode ?? 1) === 0 && !finalResult?.interrupted && !timedOutAfterAcceptance && !stoppedAfterAcceptance && !isAgentContract(step.agentContract);
	const effectiveFinalExitCode = timedOutAfterAcceptance || stoppedAfterAcceptance ? 1 : acceptanceCanFailRun ? 1 : finalResult?.exitCode ?? 1;
	// A passing typed gate supplies the structured output for runs that have no
	// outputSchema of their own; preflight rejects the combination.
	const typedGate = typedVerifyOutput(effectiveAcceptance);
	if (typedGate && finalResult && finalResult.structuredOutput === undefined && effectiveFinalExitCode === 0) {
		finalResult = { ...finalResult, structuredOutput: typedGate.value };
	}
	const intercomDetachReceipt = finalResult?.finalOutput === INTERCOM_DETACH_RECEIPT;
	const baseFinalError = stoppedAfterAcceptance
		? ctx.stopMessage ?? "Subagent stopped by user."
		: timedOutAfterAcceptance
			? finalResult?.error ?? ctx.timeoutMessage ?? "Subagent timed out."
			: acceptanceCanFailRun
					? (finalResult?.error ? `${finalResult.error}\n${acceptanceFailure}` : acceptanceFailure)
					: finalResult?.error ?? (intercomDetachReceipt ? INTERCOM_DETACH_RECEIPT : undefined);
	const effectiveFinalError = formatChildFailureDiagnostic({
		error: baseFinalError,
		afterCompactionSettlement: effectiveFinalExitCode !== 0 ? finalResult?.afterCompactionSettlement : undefined,
		abortRecoveryDiagnostic: effectiveFinalExitCode !== 0 ? finalResult?.abortRecoveryDiagnostic : undefined,
		requiredOutput: effectiveFinalExitCode !== 0 ? finalResult?.effects?.settlementDiagnostic?.requiredOutput : undefined,
	});
	const usage = launched ? aggregateUsage : undefined;

	const artifactErrors = artifactPaths && ctx.artifactConfig?.enabled !== false
		? persistStepArtifacts({
			artifactPaths,
			artifactConfig: ctx.artifactConfig,
			output: formatOutputArtifactContent(omitUndefinedProperties({
				output,
				error: effectiveFinalError,
				transcriptPath: transcriptWriter ? artifactPaths.transcriptPath : undefined,
				metadataPath: ctx.artifactConfig?.includeMetadata === false ? undefined : artifactPaths.metadataPath,
			})),
			metadata: {
				runId: ctx.id,
				agent: step.agent,
				task: PROMPT_REDACTED,
				exitCode: effectiveFinalExitCode,
				model: finalResult?.model,
				requestedModel: step.requestedModel,
				usage,
				error: effectiveFinalError,
				acceptance: effectiveAcceptance,
				...(capabilityAudit ? { capabilityCeiling: capabilityAudit.ceiling, capabilityAudit } : {}),
				launchContractDigest: actualLaunchContractDigest,
				launchResolvedExtensions,
				...((finalResult as (RunChildSessionResult & { runtimeAcknowledgedExtensions?: RuntimeAcknowledgedChildExtensions }) | undefined)?.runtimeAcknowledgedExtensions ? { runtimeAcknowledgedExtensions: (finalResult as RunChildSessionResult & { runtimeAcknowledgedExtensions?: RuntimeAcknowledgedChildExtensions }).runtimeAcknowledgedExtensions } : {}),
				...(transcriptWriter ? { transcriptPath: artifactPaths.transcriptPath } : {}),
				transcriptError: transcriptWriter?.getError(),
				skills: step.skills,
				timestamp: Date.now(),
			},
		})
		: {};

	const result: StepResult = omitUndefinedProperties({
		agent: step.agent,
		...(childSessionName ? { sessionName: childSessionName } : {}),
		context: step.context,
		...(step.agentContract ? { agentContract: step.agentContract } : {}),
		launchContractDigest: actualLaunchContractDigest,
		output: outputForSummary,
		outputState,
		exitCode: effectiveFinalExitCode,
		error: effectiveFinalError,
		sessionFile: step.sessionFile,
		intercomTarget: ctx.childIntercomTarget,
		model: finalResult?.model,
		thinking: resolveEffectiveThinking(finalResult?.model, step.thinking),
		requestedModel: step.requestedModel,
		contextOverflow: contextOverflow || undefined,
		totalCost: costSummaryFromUsage(usage),
		usage,
		artifactPaths,
		savedOutputPath: finalizedOutput.savedPath,
		outputSaveError: [resolvedOutput.saveError, artifactErrors.outputSaveError].filter(Boolean).join("\n") || undefined,
		artifactOutputSaveFailed: artifactErrors.outputSaveError ? true : undefined,
		metadataSaveError: artifactErrors.metadataSaveError,
		transcriptPath: transcriptWriter ? artifactPaths?.transcriptPath : undefined,
		transcriptError: transcriptWriter?.getError(),
		interrupted: timedOutAfterAcceptance || stoppedAfterAcceptance ? false : finalResult?.interrupted,
		timedOut: timedOutAfterAcceptance ? true : finalResult?.timedOut,
		stopped: stoppedAfterAcceptance ? true : finalResult?.stopped,
		timeoutRecovery,
		toolBudget,
		toolBudgetBlocked: toolBudgetBlocked || undefined,
		...((finalResult as (RunChildSessionResult & { effects?: import("../../shared/types.ts").EffectsProjection }) | undefined)?.effects ? { effects: (finalResult as RunChildSessionResult & { effects?: import("../../shared/types.ts").EffectsProjection }).effects } : {}),
		structuredOutput: (finalResult as (RunChildSessionResult & { structuredOutput?: unknown }) | undefined)?.structuredOutput,
		structuredOutputFailed: finalResult?.structuredOutputFailed,
		structuredOutputPath: effectiveStructuredOutput?.outputPath,
		structuredOutputSchemaPath: effectiveStructuredOutput?.schemaPath,
		acceptance: effectiveAcceptance,
		...(capabilityAudit ? { capabilityCeiling: capabilityAudit.ceiling, capabilityAudit } : {}),
		launchResolvedExtensions,
		...((finalResult as (RunChildSessionResult & { runtimeAcknowledgedExtensions?: RuntimeAcknowledgedChildExtensions }) | undefined)?.runtimeAcknowledgedExtensions ? { runtimeAcknowledgedExtensions: (finalResult as RunChildSessionResult & { runtimeAcknowledgedExtensions?: RuntimeAcknowledgedChildExtensions }).runtimeAcknowledgedExtensions } : {}),
	});
	return isAgentContract(step.agentContract) ? attachContractProjections(result as unknown as import("../../shared/types.ts").SingleResult) as unknown as typeof result : result;
}

type RunnerStatusStep = NonNullable<AsyncStatus["steps"]>[number] & {
	exitCode?: number | null;
	description?: string;
};

function appendCapabilityCeilingAppliedEvent(eventsPath: string, runId: string, stepIndex: number, agent: string, result: StepResult): void {
	if (!result.capabilityCeiling) return;
	appendJsonl(eventsPath, JSON.stringify({
		type: "subagent.capability-ceiling.applied",
		ts: Date.now(),
		runId,
		stepIndex,
		agent,
		capabilityCeiling: result.capabilityCeiling,
		...(result.capabilityAudit ? { capabilityAudit: result.capabilityAudit } : {}),
	}));
}

type RunnerStatusPayload = Omit<AsyncStatus, "steps" | "parallelGroups" | "runnerPid" | "ownerPid" | "cwd" | "currentStep" | "chainStepCount" | "lastUpdate"> & {
	runnerPid: number;
	cwd: string;
	currentStep: number;
	chainStepCount: number;
	parallelGroups: AsyncParallelGroupStatus[];
	steps: RunnerStatusStep[];
	lastUpdate: number;
	artifactsDir?: string;
	error?: string;
};

function requiredStatusStep(statusPayload: RunnerStatusPayload, index: number): RunnerStatusStep {
	const step = statusPayload.steps[index];
	if (!step) throw new Error(`Missing status step at index ${index}`);
	return step;
}

function setStatusWorktreeReference(statusStep: RunnerStatusStep, worktree: WorktreeSetup["worktrees"][number]): void {
	statusStep.worktreePath = worktree.path;
	statusStep.branch = worktree.branch;
	if (worktree.provider) statusStep.provider = worktree.provider;
	if (worktree.naming) statusStep.naming = worktree.naming;
}

function markParallelGroupSetupFailure(input: {
	statusPayload: RunnerStatusPayload;
	results: StepResult[];
	group: Extract<RunnerStep, { parallel: SubagentStep[] }>;
	groupStartFlatIndex: number;
	setupError: string;
	failedAt: number;
	statusPath: string;
	eventsPath: string;
	asyncDir: string;
	runId: string;
	stepIndex: number;
	writeStatus: (status: RunnerStatusPayload) => void;
}): void {
	for (let taskIndex = 0; taskIndex < input.group.parallel.length; taskIndex++) {
		const flatTaskIndex = input.groupStartFlatIndex + taskIndex;
		const statusStep = requiredStatusStep(input.statusPayload, flatTaskIndex);
		const task = input.group.parallel[taskIndex];
		if (!task) throw new Error(`Missing parallel task at index ${taskIndex}`);
		const stopped = statusStep.stopped || statusStep.stopRequested || input.statusPayload.stopped;
		const paused = !stopped && input.statusPayload.state === "paused";
		const timedOut = !stopped && !paused && input.statusPayload.timedOut === true;
		statusStep.status = stopped ? "stopped" : paused ? "paused" : "failed";
		// Mirror the run-level timeout onto the step so status readers see
		// timed_out rather than a bare failure — the StepResult below already
		// carries it, the status step must too.
		if (timedOut) statusStep.timedOut = true;
		statusStep.startedAt = input.failedAt;
		statusStep.endedAt = input.failedAt;
		statusStep.durationMs = 0;
		statusStep.exitCode = paused ? 0 : 1;
		statusStep.error ??= input.setupError;
		input.results.push(omitUndefinedProperties({ agent: task.agent, context: task.context, output: input.setupError, error: input.setupError, success: false, exitCode: paused ? 0 : 1, sessionFile: task.sessionFile, stopped: stopped || undefined, interrupted: paused || undefined, timedOut: input.statusPayload.timedOut || undefined }));
	}
	input.statusPayload.currentStep = input.groupStartFlatIndex;
	input.statusPayload.lastUpdate = input.failedAt;
	input.statusPayload.outputFile = path.join(input.asyncDir, `output-${input.groupStartFlatIndex}.log`);
	input.writeStatus(input.statusPayload);
	appendJsonl(input.eventsPath, JSON.stringify({
		type: "subagent.parallel.completed",
		ts: input.failedAt,
		runId: input.runId,
		stepIndex: input.stepIndex,
		success: false,
	}));
}

function markParallelGroupRunning(input: {
	statusPayload: RunnerStatusPayload;
	group: Extract<RunnerStep, { parallel: SubagentStep[] }>;
	groupStartFlatIndex: number;
	groupStartTime: number;
	statusPath: string;
	eventsPath: string;
	asyncDir: string;
	runId: string;
	stepIndex: number;
	writeStatus: (status: RunnerStatusPayload) => void;
}): void {
	for (let taskIndex = 0; taskIndex < input.group.parallel.length; taskIndex++) {
		const flatTaskIndex = input.groupStartFlatIndex + taskIndex;
		const statusStep = requiredStatusStep(input.statusPayload, flatTaskIndex);
		statusStep.status = "pending";
		delete statusStep.startedAt;
		delete statusStep.endedAt;
		delete statusStep.durationMs;
		delete statusStep.lastActivityAt;
		delete statusStep.activityState;
		delete statusStep.error;
	}
	input.statusPayload.currentStep = input.groupStartFlatIndex;
	delete input.statusPayload.activityState;
	input.statusPayload.lastActivityAt = input.groupStartTime;
	input.statusPayload.lastUpdate = input.groupStartTime;
	input.statusPayload.outputFile = path.join(input.asyncDir, `output-${input.groupStartFlatIndex}.log`);
	input.writeStatus(input.statusPayload);
	appendJsonl(input.eventsPath, JSON.stringify({
		type: "subagent.parallel.started",
		ts: input.groupStartTime,
		runId: input.runId,
		stepIndex: input.stepIndex,
		agents: input.group.parallel.map((task) => task.agent),
		count: input.group.parallel.length,
	}));
}

function prepareParallelTaskRun(
	task: SubagentStep,
	cwd: string,
	worktreeSetup: WorktreeSetup | undefined,
	taskIndex: number,
): { taskForRun: SubagentStep; taskCwd: string } {
	if (!worktreeSetup) return { taskForRun: task, taskCwd: cwd };
	const { cwd: _taskCwd, ...taskForRun } = task;
	return {
		taskForRun,
		taskCwd: worktreeSetup.worktrees[taskIndex]!.agentCwd,
	};
}

function captureParallelWorktreeDiffs(
	worktreeSetup: WorktreeSetup,
	asyncDir: string,
	stepIndex: number,
	group: Extract<RunnerStep, { parallel: SubagentStep[] }>,
): { diffs: ReturnType<typeof diffWorktrees>; summary: string } {
	const diffsDir = path.join(asyncDir, "worktree-diffs", `step-${stepIndex}`);
	const diffs = diffWorktrees(worktreeSetup, group.parallel.map((task) => task.agent), diffsDir);
	return { diffs, summary: formatWorktreeDiffSummary(diffs) };
}

function ensureParallelProgressFile(cwd: string, group: Extract<RunnerStep, { parallel: SubagentStep[] }>): void {
	const progressPath = path.join(cwd, "progress.md");
	if (!group.parallel.some((task) => task.task.includes(`Update progress at: ${progressPath}`))) return;
	writeInitialProgressFile(cwd);
}

function resolveAsyncStepTranscriptPath(input: {
	artifactsDir?: string;
	artifactConfig?: Partial<ArtifactConfig>;
	runId: string;
	agent: string;
	flatIndex: number;
	flatStepCount: number;
}): string | undefined {
	if (!input.artifactsDir || input.artifactConfig?.enabled === false || input.artifactConfig?.includeTranscript === false) return undefined;
	return getArtifactPaths(
		input.artifactsDir,
		input.runId,
		input.agent,
		input.flatStepCount > 1 ? input.flatIndex : undefined,
	).transcriptPath;
}

type SingleStepResult = Awaited<ReturnType<typeof runSingleStepInner>>;

function missingRequiredOutputAfterUsefulMutation(result: SingleStepResult): boolean {
	const effects = result.effects;
	return effects?.settlementDiagnostic?.requiredOutput?.missing === true
		&& (effects.settlementDiagnostic.mutation.attempted || effects.fileMutation?.attempted === true || Boolean(effects.fileMutation?.evidence?.changedFiles.length));
}

function partialExecutionWithUsefulMutation(result: SingleStepResult): boolean {
	if (result.execution?.status !== "partial") return false;
	const fileMutation = result.effects?.fileMutation;
	return fileMutation?.attempted === true || Boolean(fileMutation?.evidence?.changedFiles.length);
}

function partialEvidenceResult(result: SingleStepResult): boolean {
	return missingRequiredOutputAfterUsefulMutation(result)
		|| partialExecutionWithUsefulMutation(result)
		|| acceptanceNeedsRecovery(result.acceptance);
}

function concreteFailureResult(result: SingleStepResult): boolean {
	return result.success === false && !partialEvidenceResult(result);
}

function combinedAbortSignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
	const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
	if (activeSignals.length === 0) return undefined;
	if (activeSignals.length === 1) return activeSignals[0];
	const controller = new AbortController();
	const abort = (): void => controller.abort();
	for (const signal of activeSignals) {
		if (signal.aborted) {
			abort();
			break;
		}
		signal.addEventListener("abort", abort, { once: true });
	}
	return controller.signal;
}

async function runSingleStepWithTimeout(
	step: SubagentStep,
	ctx: SingleStepContext,
	parentDeadlineAt?: number,
): Promise<SingleStepResult> {
	if (step.timeoutMs === undefined) return runSingleStepInner(step, parentDeadlineAt === undefined ? ctx : {
		...ctx,
		deadlineAt: ctx.deadlineAt === undefined ? parentDeadlineAt : Math.min(ctx.deadlineAt, parentDeadlineAt),
	});

	const parentRemainingMs = parentDeadlineAt === undefined ? undefined : Math.max(0, parentDeadlineAt - Date.now());
	const timeoutMs = parentRemainingMs === undefined ? step.timeoutMs : Math.min(step.timeoutMs, parentRemainingMs);
	const timeoutMessage = parentRemainingMs !== undefined && parentRemainingMs <= step.timeoutMs
		? ctx.timeoutMessage
		: `Subagent timed out after ${step.timeoutMs}ms.`;
	const timeoutController = new AbortController();
	let timeoutAction: (() => void) | undefined;
	let timeoutTriggered = false;
	const triggerTimeout = (): void => {
		if (timeoutTriggered) return;
		timeoutTriggered = true;
		timeoutController.abort();
		timeoutAction?.();
	};
	const registerTimeout = (action: (() => void) | undefined): void => {
		timeoutAction = action;
		ctx.registerTimeout?.(action ? triggerTimeout : undefined);
		if (action && timeoutTriggered) action();
	};
	const timer = setTimeout(triggerTimeout, timeoutMs);
	timer.unref?.();
	try {
		return await runSingleStepInner(step, {
			...ctx,
			registerTimeout,
			deadlineAt: Date.now() + timeoutMs,
			timeoutSignal: combinedAbortSignal([ctx.timeoutSignal, timeoutController.signal]),
			timeoutMessage,
		});
	} finally {
		clearTimeout(timer);
		ctx.registerTimeout?.(undefined);
	}
}

export async function runSubagent(
	config: SubagentRunConfig,
	childSessions: ChildSessionFactory,
): Promise<void> {
	const { id, steps, resultPath, cwd, placeholder, taskIndex, totalTasks, maxOutput, artifactsDir, artifactConfig } =
		config;
	const globalSemaphore = new Semaphore(config.globalConcurrencyLimit ?? DEFAULT_GLOBAL_CONCURRENCY_LIMIT);
	let previousOutput = "";
	const outputs: ChainOutputMap = {};
	const results: StepResult[] = [];
	const overallStartTime = Date.now();
	const asyncDir = config.asyncDir;
	const handoffWorkflowKey = config.workflowKey;
	const handoffChildRunId = handoffWorkflowKey ? id : undefined;
	const statusPath = path.join(asyncDir, "status.json");
	const eventsPath = path.join(asyncDir, "events.jsonl");
	const logPath = path.join(asyncDir, `subagent-log-${id}.md`);
	const controlConfig = config.controlConfig ?? DEFAULT_CONTROL_CONFIG;
	const activeChildInterrupts = new Map<number, () => void>();
	const activeChildTimeouts = new Map<number, () => void>();
	const activeChildStops = new Map<number, () => void>();
	const activeChildSteers = new Map<number, StepSteerHandler>();
	/** Steers routed to a running step before its session was created. */
	const queuedStepSteers = new Map<number, SteerRequest[]>();
	const childStopRequests = new Map<number, { childId: string; requestedAt: number }>();
	const pendingStepSteers: SteerRequest[] = [];
	let interrupted = false;
	let currentActivityState: ActivityState | undefined;
	let activityTimer: NodeJS.Timeout | undefined;
	let timeoutTimer: NodeJS.Timeout | undefined;
	let checkpointTimer: NodeJS.Timeout | undefined;
	let timedOut = false;
	let stopped = false;
	let usageBudgetExceeded = false;
	const timeoutMessage = config.timeoutMs !== undefined ? `Subagent timed out after ${config.timeoutMs}ms.` : undefined;
	const stopMessage = "Subagent stopped by user.";
	const timeoutAbortController = new AbortController();
	const stopAbortController = new AbortController();
	const setupInterruptController = new AbortController();
	const setupSignal = AbortSignal.any([timeoutAbortController.signal, stopAbortController.signal, setupInterruptController.signal]);
	let previousCumulativeTokens: TokenUsage = { input: 0, output: 0, total: 0 };
	let latestSessionFile: string | undefined;

	const flatSteps = flattenSteps(steps);
	const initialFlatStepCount = flatSteps.length;
	const parallelGroups: Array<{ start: number; count: number; stepIndex: number }> = [];
	const initialStatusSteps: RunnerStatusStep[] = [];
	let flatStepCount = 0;
	for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
		const step = steps[stepIndex]!;
		if (isParallelGroup(step)) {
			parallelGroups.push({ start: flatStepCount, count: step.parallel.length, stepIndex });
			for (const task of step.parallel) {
				const taskFlatIndex = flatStepCount;
				const transcriptPath = resolveAsyncStepTranscriptPath(omitUndefinedProperties({ artifactsDir, artifactConfig, runId: id, agent: task.agent, flatIndex: taskFlatIndex, flatStepCount: initialFlatStepCount }));
				const taskSessionName = task.sessionName ?? deriveChildSessionName({ agent: task.agent, task: task.task, label: task.label });
				initialStatusSteps.push(omitUndefinedProperties({
					agent: task.agent,
					...(task.lane ? { lane: task.lane } : config.lane ? { lane: config.lane } : {}),
					...(taskSessionName ? { sessionName: taskSessionName } : {}),
					...(statusStepDescription(task.task) ? { description: statusStepDescription(task.task) } : {}),
					...(task.context ? { context: task.context } : {}),
					phase: task.phase,
					label: task.label,
					outputName: task.outputName,
					structured: task.structured,
					...(task.agentContract ? { agentContract: task.agentContract } : {}),
					...(task.launchContractDigest ? { launchContractDigest: task.launchContractDigest } : {}),
					...(task.launchResolvedExtensions ? { launchResolvedExtensions: task.launchResolvedExtensions } : {}),
					...(task.capabilityCeiling ? { capabilityCeiling: task.capabilityCeiling } : {}),
					...(task.thinkingCeiling ? { thinkingCeiling: task.thinkingCeiling } : {}),
					status: "pending",
					...(task.toolBudget ? { toolBudget: initialToolBudgetState(task.toolBudget) } : {}),
					...(task.sessionFile ? { sessionFile: task.sessionFile } : {}),
					...(transcriptPath ? { transcriptPath } : {}),
					skills: task.skills,
					model: task.model,
					...(task.contextLimit !== undefined ? { contextLimit: task.contextLimit } : {}),
					thinking: task.thinking,
					requestedModel: task.requestedModel,
					recentTools: [],
					recentOutput: [],
				}));
				flatStepCount++;
			}
		} else {
			const stepFlatIndex = flatStepCount;
			const transcriptPath = resolveAsyncStepTranscriptPath(omitUndefinedProperties({ artifactsDir, artifactConfig, runId: id, agent: step.agent, flatIndex: stepFlatIndex, flatStepCount: initialFlatStepCount }));
			const stepSessionName = step.sessionName ?? deriveChildSessionName({ agent: step.agent, task: step.task, label: step.label });
			initialStatusSteps.push(omitUndefinedProperties({
				agent: step.agent,
				...(step.lane ? { lane: step.lane } : config.lane ? { lane: config.lane } : {}),
				...(stepSessionName ? { sessionName: stepSessionName } : {}),
				...(statusStepDescription(step.task) ? { description: statusStepDescription(step.task) } : {}),
				...(step.context ? { context: step.context } : {}),
				phase: step.phase,
				label: step.label,
				outputName: step.outputName,
				structured: step.structured,
				...(step.agentContract ? { agentContract: step.agentContract } : {}),
				...(step.launchContractDigest ? { launchContractDigest: step.launchContractDigest } : {}),
				...(step.launchResolvedExtensions ? { launchResolvedExtensions: step.launchResolvedExtensions } : {}),
				...(step.capabilityCeiling ? { capabilityCeiling: step.capabilityCeiling } : {}),
				...(step.thinkingCeiling ? { thinkingCeiling: step.thinkingCeiling } : {}),
				status: "pending",
				...(step.toolBudget ? { toolBudget: initialToolBudgetState(step.toolBudget) } : {}),
				...(step.sessionFile ? { sessionFile: step.sessionFile } : {}),
				...(transcriptPath ? { transcriptPath } : {}),
				skills: step.skills,
				model: step.model,
				...(step.contextLimit !== undefined ? { contextLimit: step.contextLimit } : {}),
				thinking: step.thinking,
				requestedModel: step.requestedModel,
				recentTools: [],
				recentOutput: [],
			}));
			flatStepCount++;
		}
	}
	const sessionEnabled = Boolean(config.sessionDir)
		|| flatSteps.some((step) => Boolean(step.sessionFile));
	if (config.runnerProcessInstanceId) {
		for (const step of initialStatusSteps) {
			step.processTerminal = { version: 1, state: "pending", runId: id, runnerProcessInstanceId: config.runnerProcessInstanceId };
		}
	}
	const statusPayload: RunnerStatusPayload = omitUndefinedProperties({
		lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
		runId: id,
		...(config.sessionId ? { sessionId: config.sessionId } : {}),
		...(config.completionOwnerId ? { completionOwnerId: config.completionOwnerId } : {}),
		mode: config.resultMode ?? (flatSteps.length > 1 ? "chain" : "single"),
		...(config.nestedSelf ? { isNested: true } : {}),
		state: "running",
		steering: createSteeringStatus(),
		lastActivityAt: overallStartTime,
		startedAt: overallStartTime,
		lastUpdate: overallStartTime,
		...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
		...(config.deadlineAt !== undefined ? { deadlineAt: config.deadlineAt } : {}),
		...(config.toolBudget ? { toolBudget: initialToolBudgetState(config.toolBudget) } : {}),
		...(config.usageBudget ? { usageBudget: usageBudgetState(config.usageBudget, undefined) } : {}),
		runnerPid: process.pid,
		pidNamespaceScope: currentPidNamespaceScope(),
		cwd,
		currentStep: 0,
		chainStepCount: steps.length,
		parallelGroups,
		workflowGraph: config.workflowGraph,
		...(config.launchContractDigest ? { launchContractDigest: config.launchContractDigest } : {}),
		...(config.launchResolvedExtensions ? { launchResolvedExtensions: config.launchResolvedExtensions } : {}),
		...(config.capabilityCeiling ? { capabilityCeiling: config.capabilityCeiling } : {}),
		...(config.runFanoutBudget ? { runFanoutBudget: getRunFanoutBudgetSnapshot(config.runFanoutBudget) } : {}),
		...(config.parentWorkflowRunId ? { parentWorkflowRunId: config.parentWorkflowRunId } : {}),
		...(config.workflowKey ? { workflowKey: config.workflowKey } : {}),
		...(config.lane ? { lane: config.lane } : {}),
		...(config.runnerProcessInstanceId ? { processTerminal: { version: 1 as const, state: "pending" as const, runId: id, runnerProcessInstanceId: config.runnerProcessInstanceId } } : {}),
		steps: initialStatusSteps,
		artifactsDir,
		sessionDir: config.sessionDir,
		outputFile: path.join(asyncDir, "output-0.log"),
	});

	let lastIndexedStatusState: AsyncStatus["state"] | undefined;
	const indexPersistence = createCapacityResilientJsonWriter({
		keepAlive: true,
		onSuccess: (_filePath, payload) => {
			lastIndexedStatusState = (payload as { state: AsyncStatus["state"] }).state;
		},
		onError: (error, filePath) => console.error(`Failed to update async run index '${filePath}':`, error),
	});
	const queueActiveRunIndex = (status: AsyncStatus): void => {
		const state = status.state;
		if (state === lastIndexedStatusState && indexPersistence.pendingCount() === 0) return;
		indexPersistence.write(asyncDir, { state, toolCallId: status.toolCallId }, (_filePath, payload) => {
			const indexPayload = payload as { state: AsyncStatus["state"]; toolCallId?: string };
			updateActiveRunIndex(asyncDir, indexPayload.state, indexPayload.toolCallId, { retryCapacityErrors: true });
		});
	};
	let finalResultCommitted = false;
	let finalResultPublication: { resolve(): void; reject(error: unknown): void } | undefined;
	const runPersistence = createCapacityResilientJsonWriter({
		keepAlive: true,
		onSuccess: (filePath, payload) => {
			if (filePath === statusPath) queueActiveRunIndex(payload as AsyncStatus);
			if (filePath === resultPath && finalResultPublication) {
				finalResultCommitted = true;
				finalResultPublication.resolve();
			}
		},
		onError: (error, filePath) => {
			console.error(`Failed to persist async run state '${filePath}':`, error);
			if (filePath === resultPath) finalResultPublication?.reject(error);
		},
	});
	try {
		fs.mkdirSync(asyncDir, { recursive: true });
	} catch (error) {
		if (!isStorageCapacityError(error)) throw error;
		console.error(`Failed to prepare async run storage '${asyncDir}' while storage is full:`, error);
	}
	runPersistence.write(statusPath, { ...statusPayload });

	let pendingParallelUsageCost: CostSummary = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
	const currentUsageTotals = (): CostSummary => {
		const cost = results.reduce<CostSummary>((sum, result) => ({
			inputTokens: sum.inputTokens + (result.totalCost?.inputTokens ?? result.usage?.input ?? 0),
			outputTokens: sum.outputTokens + (result.totalCost?.outputTokens ?? result.usage?.output ?? 0),
			costUsd: sum.costUsd + (result.totalCost?.costUsd ?? result.usage?.cost ?? 0),
		}), { inputTokens: pendingParallelUsageCost.inputTokens, outputTokens: pendingParallelUsageCost.outputTokens, costUsd: pendingParallelUsageCost.costUsd });
		return {
			inputTokens: Math.max(cost.inputTokens, statusPayload.totalTokens?.input ?? 0),
			outputTokens: Math.max(cost.outputTokens, statusPayload.totalTokens?.output ?? 0),
			costUsd: cost.costUsd,
		};
	};
	const refreshUsageBudget = () => {
		setOptionalProperty(statusPayload, "usageBudget", usageBudgetState(config.usageBudget, currentUsageTotals()));
		return statusPayload.usageBudget;
	};
	// Continuation admission only: the existing ledger has no in-flight cost
	// coverage. Never change ordinary budget enforcement.
	let continuationUsageUncertain = false;
	const continuationUsageBudgetExhausted = (): boolean | undefined => {
		const exhausted = refreshUsageBudget()?.exhausted === true;
		return exhausted ? true : config.usageBudget && continuationUsageUncertain ? undefined : false;
	};
	const emitNestedSelfEvent = (type: "subagent.nested.updated" | "subagent.nested.completed"): void => {
		if (!config.nestedRoute || !config.nestedSelf) return;
		try {
			writeNestedEvent(config.nestedRoute, omitUndefinedProperties({
				type,
				ts: Date.now(),
				parentRunId: config.nestedSelf.parentRunId,
				parentStepIndex: config.nestedSelf.parentStepIndex,
				child: nestedSummaryFromAsyncStatus(statusPayload, asyncDir, omitUndefinedProperties({
					id,
					parentRunId: config.nestedSelf.parentRunId,
					parentStepIndex: config.nestedSelf.parentStepIndex,
					depth: config.nestedSelf.depth,
					path: config.nestedSelf.path,
					mode: statusPayload.mode,
					ts: Date.now(),
				})),
			}));
		} catch (error) {
			console.error("Failed to emit nested async status event:", error);
		}
	};
	const refreshWorkflowGraph = (): void => {
		if (!config.workflowGraph) return;
		const graph = structuredClone(statusPayload.workflowGraph ?? config.workflowGraph);
		const normalize = (status: RunnerStatusStep["status"]): "pending" | "running" | "completed" | "failed" | "paused" | "stopped" | "detached" | "rejected" => {
			if (status === "complete" || status === "completed") return "completed";
			if (status === "running" || status === "failed" || status === "paused" || status === "stopped" || status === "pending" || status === "rejected") return status;
			return "pending";
		};
		const updateNode = (node: NonNullable<typeof graph.nodes>[number]): void => {
			if (node.flatIndex !== undefined) {
				const step = statusPayload.steps[node.flatIndex];
				if (step) {
					node.status = normalize(step.status);
					setOptionalProperty(node, "error", step.error);
					setOptionalProperty(node, "acceptanceStatus", step.acceptance?.status);
				}
				if (statusPayload.currentStep === node.flatIndex) graph.currentNodeId = node.id;
			}
			for (const child of node.children ?? []) updateNode(child);
			if (node.children?.length) {
				if (node.children.every((child) => child.status === "completed")) node.status = "completed";
				else if (node.children.some((child) => child.status === "running")) node.status = "running";
				else if (node.children.some((child) => child.status === "stopped")) node.status = "stopped";
				else if (node.children.some((child) => child.status === "rejected")) node.status = "rejected";
				else if (node.children.some((child) => child.status === "failed")) node.status = "failed";
				else if (node.children.some((child) => child.status === "paused")) node.status = "paused";
			}
			if (node.error && node.status !== "stopped" && node.status !== "rejected") node.status = "failed";
		};
		for (const node of graph.nodes) updateNode(node);
		statusPayload.workflowGraph = graph;
	};
	const statusResultState = (): AsyncStatus["state"] | undefined => {
		if (statusPayload.state === "running" || statusPayload.state === "queued") return undefined;
		return statusPayload.state;
	};
	const statusResultSummary = (state: AsyncStatus["state"]): string => {
		if (statusPayload.error) return statusPayload.error;
		if (state === "paused") return "Paused after interrupt. Waiting for explicit next action.";
		if (state === "partial") return "Subagent needs attention after partial work.";
		if (state === "stopped") return stopMessage;
		if (state === "rejected") return "Subagent rejected.";
		return state === "complete" ? "Subagent completed." : "Subagent failed.";
	};
	const statusResultSuccess = (state: AsyncStatus["state"], step: RunnerStatusStep): boolean | undefined => {
		if (step.status === "complete" || step.status === "completed") return true;
		if (step.status === "failed" || step.status === "stopped" || step.status === "rejected") return false;
		if (state === "complete") return true;
		if (state === "failed" || state === "partial" || state === "stopped" || state === "rejected") return false;
		return undefined;
	};
	const writeRecoverableStatusResult = (): void => {
		const state = statusResultState();
		if (!state || finalResultCommitted || !config.sessionId) return;
		if ((state as string) === "complete") return;
		const now = statusPayload.endedAt ?? statusPayload.lastUpdate ?? Date.now();
		const summary = statusResultSummary(state);
		runPersistence.write(resultPath, omitUndefinedProperties({
			lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
			id,
			runId: id,
			agent: statusPayload.steps.length === 1 ? statusPayload.steps[0]!.agent : statusPayload.mode === "parallel" ? `parallel:${statusPayload.steps.map((step) => step.agent).join("+")}` : `chain:${statusPayload.steps.map((step) => step.agent).join("->")}`,
			mode: statusPayload.mode,
			success: state === "complete",
			state,
			summary,
			error: state === "failed" || state === "partial" || state === "stopped" || state === "rejected" ? summary : undefined,
			stopped: state === "stopped" ? true : undefined,
			results: statusPayload.steps.map((step) => omitUndefinedProperties({
				agent: step.agent,
				...(step.sessionName ? { sessionName: step.sessionName } : {}),
				output: step.status === "complete" || step.status === "completed" ? "" : step.error ?? summary,
				error: step.error,
				success: statusResultSuccess(state, step),
				sessionFile: step.sessionFile,
				model: step.model,
				thinking: step.thinking,
				requestedModel: step.requestedModel,
				contextOverflow: step.contextOverflow,
			})),
			exitCode: state === "complete" || state === "paused" ? 0 : 1,
			timestamp: now,
			durationMs: Math.max(0, now - overallStartTime),
			asyncDir,
			cwd,
			sessionId: config.sessionId,
			completionOwnerId: config.completionOwnerId,
			sessionFile: statusPayload.sessionFile ?? latestSessionFile,
		}), (filePath, payload) => writePendingAsyncResultFile(filePath, payload as Record<string, unknown>));
	};
	const writeStatusPayloadNow = (): void => {
		if (finalResultPublication) return;
		refreshWorkflowGraph();
		writeRecoverableStatusResult();
		runPersistence.write(statusPath, { ...statusPayload });
		emitNestedSelfEvent(statusPayload.state === "running" || statusPayload.state === "queued" ? "subagent.nested.updated" : "subagent.nested.completed");
	};
	const statusWriteCoalescer = createFileCoalescer(writeStatusPayloadNow, 100);
	const writeStatusPayload = (immediate = true): void => {
		if (immediate || statusPayload.state !== "running") {
			if (!statusWriteCoalescer.flush(statusPath)) writeStatusPayloadNow();
			return;
		}
		statusWriteCoalescer.schedule(statusPath);
	};
	const childStopTargetId = (index: number): string => asyncStatusChildIdentity(requiredStatusStep(statusPayload, index), index);
	const appendChildStatusEvent = (index: number, childId: string, status: "stopping" | "stopped", now = Date.now()): void => {
		const step = requiredStatusStep(statusPayload, index);
		appendJsonl(eventsPath, JSON.stringify({
			type: "subagent.child-status",
			version: 1,
			ts: now,
			runId: id,
			childId,
			status,
			reason: "user",
			source: "async",
			stepIndex: index,
			agent: step.agent,
			...(step.runId ? { childRunId: step.runId } : {}),
			...(step.workflowKey ? { workflowKey: step.workflowKey } : {}),
			...(step.phase ? { phase: step.phase } : {}),
			...(step.label ? { label: step.label } : {}),
		} satisfies SubagentChildStatusEvent));
	};
	const appendTerminalChildStatusEvent = (index: number, now = Date.now()): void => {
		const request = childStopRequests.get(index);
		if (request) appendChildStatusEvent(index, request.childId, "stopped", now);
	};
	const markChildStopRequested = (index: number, childId: string, now = Date.now()): boolean => {
		const step = statusPayload.steps[index];
		if (!step || (step.status !== "pending" && step.status !== "running")) return false;
		childStopRequests.set(index, { childId, requestedAt: now });
		step.stopRequested = true;
		step.stopRequestedAt = now;
		delete step.activityState;
		statusPayload.lastUpdate = now;
		writeStatusPayload();
		appendJsonl(eventsPath, JSON.stringify({ type: "subagent.step.stop_requested", ts: now, runId: id, stepIndex: index, childId, agent: step.agent }));
		appendChildStatusEvent(index, childId, "stopping", now);
		return true;
	};
	const markChildStopped = (index: number, now = Date.now()): void => {
		const step = requiredStatusStep(statusPayload, index);
		if (step.status === "stopped") return;
		step.status = "stopped";
		step.error = stopMessage;
		step.exitCode = 1;
		step.stopped = true;
		step.stopRequested = true;
		step.stopRequestedAt = childStopRequests.get(index)?.requestedAt ?? step.stopRequestedAt ?? now;
		delete step.activityState;
		step.endedAt = now;
		step.durationMs = step.startedAt ? now - step.startedAt : 0;
		step.lastActivityAt = now;
		statusPayload.lastUpdate = now;
		writeStatusPayload();
		const childId = childStopRequests.get(index)?.childId ?? childStopTargetId(index);
		appendJsonl(eventsPath, JSON.stringify({ type: "subagent.step.stopped", ts: now, runId: id, stepIndex: index, childId, agent: step.agent, exitCode: 1, durationMs: step.durationMs }));
		appendChildStatusEvent(index, childId, "stopped", now);
	};
	const childStopResult = (index: number, agent: string, context?: "fresh" | "fork"): SingleStepResult => {
		markChildStopped(index);
		return stoppedStepResult(agent, context, requiredStatusStep(statusPayload, index).sessionName);
	};
	const stopChildStep = (request: StopRequest): void => {
		if (request.targetIndex === undefined) {
			stopRunner();
			return;
		}
		const childId = request.childId ?? childStopTargetId(request.targetIndex);
		const now = Date.now();
		if (!markChildStopRequested(request.targetIndex, childId, now)) {
			appendJsonl(eventsPath, JSON.stringify({ type: "subagent.step.stop_failed", ts: now, runId: id, stepIndex: request.targetIndex, childId, message: "Child is not pending or running." }));
			return;
		}
		const stop = activeChildStops.get(request.targetIndex);
		if (stop) stop();
		else if (requiredStatusStep(statusPayload, request.targetIndex).status === "pending") {
			appendJsonl(eventsPath, JSON.stringify({ type: "subagent.step.stop_queued", ts: now, runId: id, stepIndex: request.targetIndex, childId }));
		}
	};
	const registerStepInterrupt = (flatIndex: number, interrupt: (() => void) | undefined): void => {
		if (!interrupt) {
			activeChildInterrupts.delete(flatIndex);
			return;
		}
		activeChildInterrupts.set(flatIndex, interrupt);
		if (interrupted) interrupt();
	};
	const registerStepTimeout = (flatIndex: number, interrupt: (() => void) | undefined): void => {
		if (!interrupt) {
			activeChildTimeouts.delete(flatIndex);
			return;
		}
		activeChildTimeouts.set(flatIndex, interrupt);
		if (timedOut) interrupt();
	};
	const registerStepStop = (flatIndex: number, stop: (() => void) | undefined): void => {
		if (!stop) {
			activeChildStops.delete(flatIndex);
			return;
		}
		activeChildStops.set(flatIndex, stop);
		if (stopped || childStopRequests.has(flatIndex)) stop();
	};
	const registerStepSteer = (flatIndex: number, steer: StepSteerHandler | undefined): void => {
		if (!steer) {
			activeChildSteers.delete(flatIndex);
			return;
		}
		activeChildSteers.set(flatIndex, steer);
		const queued = queuedStepSteers.get(flatIndex);
		queuedStepSteers.delete(flatIndex);
		for (const request of queued ?? []) steerLiveChild(flatIndex, request);
	};
	const interruptActiveChildren = (): void => {
		for (const interrupt of [...activeChildInterrupts.values()]) interrupt();
	};
	const timeoutActiveChildren = (): void => {
		for (const interrupt of [...activeChildTimeouts.values()]) interrupt();
	};
	const stopActiveChildren = (): void => {
		for (const stop of [...activeChildStops.values()]) stop();
	};
	const nestedRuns = function* (children: NestedRunSummary[] | undefined): Generator<NestedRunSummary> {
		for (const child of children ?? []) {
			yield child;
			yield* nestedRuns(child.children);
			yield* nestedRuns(child.steps?.flatMap((step) => step.children ?? []));
		}
	};
	const isNestedControlDescendant = (run: NestedRunSummary): boolean =>
		!config.nestedSelf || run.path.some((entry) => entry.runId === id);
	const interruptNestedAsyncDescendants = (): void => {
		if (!config.nestedRoute) return;
		let registry: ReturnType<typeof projectNestedEvents>;
		try {
			registry = projectNestedEvents(config.nestedRoute);
		} catch (error) {
			appendJsonl(eventsPath, JSON.stringify({
				type: "subagent.nested.interrupt_failed",
				ts: Date.now(),
				runId: id,
				message: error instanceof Error ? error.message : String(error),
			}));
			return;
		}
		for (const run of nestedRuns(registry.children)) {
			if (!isNestedControlDescendant(run) || (run.state !== "running" && run.state !== "queued")) continue;
			const nestedAsyncDir = run.asyncDir ?? resolveNestedAsyncDir(config.nestedRoute.rootRunId, run);
			if (!nestedAsyncDir) continue;
			try {
				deliverInterruptRequest({ asyncDir: nestedAsyncDir, source: "ancestor-interrupt" });
			} catch (error) {
				appendJsonl(eventsPath, JSON.stringify({
					type: "subagent.nested.interrupt_failed",
					ts: Date.now(),
					runId: id,
					targetRunId: run.id,
					message: error instanceof Error ? error.message : String(error),
				}));
			}
		}
	};
	const stopNestedAsyncDescendants = (): void => {
		if (!config.nestedRoute) return;
		let registry: ReturnType<typeof projectNestedEvents>;
		try {
			registry = projectNestedEvents(config.nestedRoute);
		} catch (error) {
			appendJsonl(eventsPath, JSON.stringify({
				type: "subagent.nested.stop_failed",
				ts: Date.now(),
				runId: id,
				message: error instanceof Error ? error.message : String(error),
			}));
			return;
		}
		for (const run of nestedRuns(registry.children)) {
			if (!isNestedControlDescendant(run) || (run.state !== "running" && run.state !== "queued")) continue;
			const nestedAsyncDir = run.asyncDir ?? resolveNestedAsyncDir(config.nestedRoute.rootRunId, run);
			if (!nestedAsyncDir) continue;
			try {
				deliverStopRequest(omitUndefinedProperties({ asyncDir: nestedAsyncDir, pid: run.runnerPid, source: "ancestor-stop" }));
			} catch (error) {
				appendJsonl(eventsPath, JSON.stringify({
					type: "subagent.nested.stop_failed",
					ts: Date.now(),
					runId: id,
					targetRunId: run.id,
					message: error instanceof Error ? error.message : String(error),
				}));
			}
		}
	};
	const timeoutNestedAsyncDescendants = (): void => {
		if (!config.nestedRoute) return;
		let registry: ReturnType<typeof projectNestedEvents>;
		try {
			registry = projectNestedEvents(config.nestedRoute);
		} catch (error) {
			appendJsonl(eventsPath, JSON.stringify({
				type: "subagent.nested.timeout_failed",
				ts: Date.now(),
				runId: id,
				message: error instanceof Error ? error.message : String(error),
			}));
			return;
		}
		for (const run of nestedRuns(registry.children)) {
			if (!isNestedControlDescendant(run) || (run.state !== "running" && run.state !== "queued")) continue;
			const nestedAsyncDir = run.asyncDir ?? resolveNestedAsyncDir(config.nestedRoute.rootRunId, run);
			if (!nestedAsyncDir) continue;
			try {
				deliverTimeoutRequest(omitUndefinedProperties({ asyncDir: nestedAsyncDir, pid: run.runnerPid, source: "ancestor-timeout" }));
			} catch (error) {
				appendJsonl(eventsPath, JSON.stringify({
					type: "subagent.nested.timeout_failed",
					ts: Date.now(),
					runId: id,
					targetRunId: run.id,
					message: error instanceof Error ? error.message : String(error),
				}));
			}
		}
	};
	const pausedStepResult = (agent: string, context?: "fresh" | "fork", sessionName?: string): SingleStepResult => omitUndefinedProperties({
		agent,
		sessionName,
		context,
		output: "Paused after interrupt. Waiting for explicit next action.",
		exitCode: 0,
		interrupted: true,
	});
	const timedOutStepResult = (agent: string, context?: "fresh" | "fork", sessionName?: string): SingleStepResult => omitUndefinedProperties({
		agent,
		sessionName,
		context,
		output: timeoutMessage ?? "Subagent timed out.",
		error: timeoutMessage ?? "Subagent timed out.",
		exitCode: 1,
		timedOut: true,
	});
	const stoppedStepResult = (agent: string, context?: "fresh" | "fork", sessionName?: string): SingleStepResult => omitUndefinedProperties({
		agent,
		sessionName,
		context,
		output: stopMessage,
		error: stopMessage,
		exitCode: 1,
		stopped: true,
	});

	const stepOutputActivityAt = (index: number): number => {
		const step = statusPayload.steps[index];
		let lastActivityAt = step?.lastActivityAt ?? step?.startedAt ?? overallStartTime;
		const outputPath = path.join(asyncDir, `output-${index}.log`);
		try {
			lastActivityAt = Math.max(lastActivityAt, fs.statSync(outputPath).mtimeMs);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				console.error(`Failed to inspect async output file '${outputPath}':`, error);
			}
		}
		return lastActivityAt;
	};
	const emittedControlEventKeys = new Set<string>();
	const activeLongRunningSteps = new Set<number>();
	const mutatingFailureStates = initialStatusSteps.map(() => createMutatingFailureState());
	const pendingToolResults: Array<{ tool: string; path?: string; mutates: boolean; startedAt?: number } | undefined> = initialStatusSteps.map(() => undefined);
	type ActiveToolCall = { attentionEmitted?: boolean; key: string; tool: string; args: string; startedAt: number; path?: string; blocksSupervisor: boolean };
	const activeToolCalls = initialStatusSteps.map(() => new Map<string, ActiveToolCall>());
	const activeToolKeysByName = initialStatusSteps.map(() => new Map<string, string[]>());
	const activeToolSequences = initialStatusSteps.map(() => 0);
	const latestActiveToolCall = (flatIndex: number): ActiveToolCall | undefined => [...(activeToolCalls[flatIndex]?.values() ?? [])].sort((left, right) => right.startedAt - left.startedAt)[0];
	const refreshStepCurrentTool = (flatIndex: number): void => {
		const step = statusPayload.steps[flatIndex];
		if (!step) return;
		const active = latestActiveToolCall(flatIndex);
		if (!active) {
			delete step.currentTool;
			delete step.currentToolArgs;
			delete step.currentToolStartedAt;
			delete step.currentPath;
			return;
		}
		step.currentTool = active.tool;
		step.currentToolArgs = active.args;
		step.currentToolStartedAt = active.startedAt;
		setOptionalProperty(step, "currentPath", active.path);
	};
	const recordActiveToolCall = (flatIndex: number, event: { toolCallId?: unknown; toolName: string }, input: { argsPreview: string; currentPath?: string; blocksSupervisor: boolean; now: number }): ActiveToolCall => {
		const sequence = (activeToolSequences[flatIndex] ?? 0) + 1;
		activeToolSequences[flatIndex] = sequence;
		const key = toolTimeoutCallKey(event, sequence);
		const active: ActiveToolCall = {
			key,
			tool: event.toolName,
			args: input.argsPreview,
			startedAt: input.now,
			blocksSupervisor: input.blocksSupervisor,
			...(input.currentPath !== undefined ? { path: input.currentPath } : {}),
		};
		activeToolCalls[flatIndex]?.set(key, active);
		const keysByName = activeToolKeysByName[flatIndex];
		const keys = keysByName?.get(active.tool) ?? [];
		keys.push(key);
		keysByName?.set(active.tool, keys);
		refreshStepCurrentTool(flatIndex);
		return active;
	};
	const removeActiveToolCallKey = (flatIndex: number, key: string): ActiveToolCall | undefined => {
		const calls = activeToolCalls[flatIndex];
		const active = calls?.get(key);
		if (!active) return undefined;
		calls?.delete(key);
		const keysByName = activeToolKeysByName[flatIndex];
		const keys = keysByName?.get(active.tool)?.filter((candidate) => candidate !== key) ?? [];
		if (keys.length > 0) keysByName?.set(active.tool, keys);
		else keysByName?.delete(active.tool);
		return active;
	};
	const removeActiveToolCall = (flatIndex: number, event: { toolCallId?: unknown; toolName?: unknown }): ActiveToolCall | undefined => {
		const calls = activeToolCalls[flatIndex];
		const key = typeof event.toolCallId === "string" && event.toolCallId.length > 0
			? `id:${event.toolCallId}`
			: typeof event.toolName === "string"
				? activeToolKeysByName[flatIndex]?.get(event.toolName)?.[0]
				: calls?.size === 1
					? [...calls.keys()][0]
					: undefined;
		return key ? removeActiveToolCallKey(flatIndex, key) : undefined;
	};
	const openToolAttentionTarget = (flatIndex: number, now: number): ActiveToolCall | undefined => [...(activeToolCalls[flatIndex]?.values() ?? [])]
		.filter((active) => !active.attentionEmitted && shouldEmitOpenToolAttention({ config: controlConfig, currentTool: active.tool, currentToolStartedAt: active.startedAt, now }))
		.sort((left, right) => left.startedAt - right.startedAt)[0];
	const supervisorAttentionSteps = new Map<number, ActivityState | undefined>();
	const mutatingFailureWindowMs = 5 * 60_000;
	const appendControlEvent = (rawEvent: ReturnType<typeof buildControlEvent>) => {
		if (!controlConfig.enabled) return;
		const contextStep = statusPayload.steps[rawEvent.index ?? statusPayload.currentStep ?? 0];
		const event = {
			...rawEvent,
			...(contextStep?.workflowKey ?? statusPayload.workflowKey ? { workflowKey: contextStep?.workflowKey ?? statusPayload.workflowKey } : {}),
			...(contextStep?.phase ? { phase: contextStep.phase } : {}),
			...(contextStep?.label ? { label: contextStep.label } : {}),
			...(contextStep?.description ? { taskPreview: contextStep.description } : {}),
		};
		const childIntercomTarget = config.childIntercomTargets?.[event.index ?? statusPayload.currentStep];
		const channels = controlConfig.notifyChannels;
		if (channels.length === 0 || !claimControlNotification(controlConfig, event, emittedControlEventKeys, childIntercomTarget)) return;
		appendJsonl(eventsPath, JSON.stringify({
			type: "subagent.control",
			event,
			channels,
			childIntercomTarget,
			noticeText: formatControlNoticeMessage(event, childIntercomTarget),
		}));
	};
	const syncTopLevelCurrentTool = (): void => {
		const activeStep = statusPayload.steps
			.filter((step) => step.status === "running" && typeof step.currentTool === "string" && step.currentTool.length > 0)
			.sort((left, right) => (right.currentToolStartedAt ?? 0) - (left.currentToolStartedAt ?? 0))[0];
		setOptionalProperty(statusPayload, "currentTool", activeStep?.currentTool);
		setOptionalProperty(statusPayload, "currentToolStartedAt", activeStep?.currentToolStartedAt);
		setOptionalProperty(statusPayload, "currentPath", activeStep?.currentPath);
	};
	const syncAggregateActivityState = (): void => {
		const nextRunState = statusPayload.steps.some((step) => step.activityState === "stale")
			? "stale"
			: statusPayload.steps.some((step) => step.activityState === "needs_attention")
				? "needs_attention"
				: statusPayload.steps.some((step) => step.activityState === "active_long_running")
					? "active_long_running"
					: undefined;
		currentActivityState = nextRunState;
		setOptionalProperty(statusPayload, "activityState", nextRunState);
	};
	const maybeEmitOpenToolAttention = (flatIndex: number, now: number): boolean => {
		const step = statusPayload.steps[flatIndex];
		if (!step || step.status !== "running" || step.activityState === "stale") return false;
		const target = openToolAttentionTarget(flatIndex, now);
		if (!target) return false;
		target.attentionEmitted = true;
		// Keep this attention when a concurrent supervisor request ends and restores its saved state.
		if (supervisorAttentionSteps.has(flatIndex)) supervisorAttentionSteps.set(flatIndex, "needs_attention");
		const previous = step.activityState;
		step.activityState = "needs_attention";
		statusPayload.activityState = statusPayload.activityState === "stale" ? "stale" : "needs_attention";
		const toolDurationMs = Math.max(0, now - target.startedAt);
		appendControlEvent(buildControlEvent(omitUndefinedProperties({
			type: "needs_attention",
			from: previous,
			to: "needs_attention",
			runId: id,
			agent: step.agent,
			index: flatIndex,
			ts: now,
			message: `${step.agent} has had tool '${target.tool}' open for ${Math.floor(toolDurationMs / 1000)}s`,
			reason: "tool_open_threshold",
			turns: step.turnCount,
			tokens: step.tokens?.total,
			toolCount: step.toolCount,
			currentTool: target.tool,
			toolCallId: target.key.startsWith("id:") ? target.key.slice(3) : undefined,
			currentToolDurationMs: toolDurationMs,
			currentPath: target.path,
		})));
		return true;
	};
	const maybeEmitActiveLongRunning = (flatIndex: number, now: number): boolean => {
		if (!controlConfig.enabled || activeLongRunningSteps.has(flatIndex)) return false;
		const step = statusPayload.steps[flatIndex];
		if (!step || step.status !== "running" || step.activityState === "needs_attention" || step.activityState === "stale") return false;
		const reason = nextLongRunningTrigger(controlConfig, {
			startedAt: step.startedAt ?? overallStartTime,
			now,
			turns: step.turnCount ?? 0,
			tokens: step.tokens?.total ?? 0,
		});
		if (!reason) return false;
		activeLongRunningSteps.add(flatIndex);
		const previous = step.activityState;
		step.activityState = "active_long_running";
		statusPayload.activityState = statusPayload.activityState === "stale"
			? "stale"
			: statusPayload.activityState === "needs_attention"
				? "needs_attention"
				: "active_long_running";
		const event = buildControlEvent(omitUndefinedProperties({
			type: "active_long_running",
			from: previous,
			to: "active_long_running",
			runId: id,
			agent: step.agent,
			index: flatIndex,
			ts: now,
			message: `${step.agent} is still active but long-running`,
			reason,
			turns: step.turnCount,
			tokens: step.tokens?.total,
			toolCount: step.toolCount,
			currentTool: step.currentTool,
			currentToolDurationMs: step.currentToolStartedAt ? Math.max(0, now - step.currentToolStartedAt) : undefined,
			currentPath: step.currentPath,
			elapsedMs: now - (step.startedAt ?? overallStartTime),
		}));
		appendControlEvent(event);
		return true;
	};
	const steeringMarkerPath = (requestId: string): string => path.join(asyncDir, "control", "steer-recovery", `${Buffer.from(requestId).toString("base64url")}.json`);
	const markSteeringAttention = (index: number): void => {
		const step = statusPayload.steps[index];
		if (step) step.activityState = "needs_attention";
		statusPayload.activityState = "needs_attention";
	};
	const emitSteeringEvent = (type: string, request: SteerRequest, index?: number, extra: Record<string, unknown> = {}): void => {
		appendJsonl(eventsPath, JSON.stringify({ type, ts: Date.now(), runId: id, requestId: request.id, ...(index !== undefined ? { index } : {}), ...extra }));
	};
	const emitSteeringNotice = (requestId: string, state: "failed" | "partial" | "recovered", message: string): void => {
		appendJsonl(eventsPath, JSON.stringify({ type: "subagent.steering.notice", ts: Date.now(), runId: id, requestId, state, message, ...(config.sessionId ? { currentSessionId: config.sessionId } : {}) }));
	};
	const recordSteeringLifecycle = (request: SteerRequest, targets: Array<{ index: number; state: SteeringTargetState; reason?: string }>): void => {
		const lifecycle = steeringStatus(statusPayload);
		recordSteeringRequest(lifecycle, omitUndefinedProperties({ id: request.id, requestedAt: request.ts, source: request.source, message: request.message, targets }));
		for (const target of targets) {
			const step = statusPayload.steps[target.index];
			if (!step) continue;
			step.steering ??= createSteeringStatus();
			recordSteeringRequest(step.steering, omitUndefinedProperties({ id: request.id, requestedAt: request.ts, source: request.source, message: request.message, targets: [target] }));
		}
	};
	const updateSteeringLifecycleTarget = (
		requestId: string,
		index: number,
		state: SteeringTargetState,
		now: number,
		fields: Pick<SteeringTargetStatus, "reason" | "replacementRunId"> = {},
	): SteeringTargetStatus | undefined => {
		const updated = updateSteeringTarget(steeringStatus(statusPayload), requestId, index, state, now, fields);
		const step = statusPayload.steps[index];
		if (step?.steering) updateSteeringTarget(step.steering, requestId, index, state, now, fields);
		return updated;
	};
	const emitTerminalSteeringNotice = (requestId: string, failureMessage: string): void => {
		const state = terminalSteeringNoticeState(steeringStatus(statusPayload), requestId);
		if (state === "partial") emitSteeringNotice(requestId, "partial", `Steering partially delivered for run ${id}.`);
		else if (state === "failed") emitSteeringNotice(requestId, "failed", failureMessage);
	};
	const deliverSteerRequest = (request: SteerRequest): void => {
		if (statusPayload.state !== "running") {
			const reason = `run became ${statusPayload.state} before steering request was consumed`;
			const indexes = request.targetIndex !== undefined
				? [request.targetIndex]
				: request.targetIndexes?.length
					? request.targetIndexes
					: statusPayload.steps.map((_, index) => index);
			const targets = indexes.map((index) => ({ index, state: "failed" as const, reason }));
			recordSteeringLifecycle(request, targets);
			emitSteeringEvent("subagent.steer.requested", request, undefined, { targets });
			for (const target of targets) emitSteeringEvent("subagent.steer.failed", request, target.index, { reason });
			emitTerminalSteeringNotice(request.id, `Steering failed for run ${id}: ${reason}.`);
			statusPayload.lastUpdate = Date.now();
			writeStatusPayload();
			return;
		}
		const runningIndexes = statusPayload.steps
			.map((step, index) => ({ step, index }))
			.filter(({ step }) => step.status === "running")
			.map(({ index }) => index);
		const targets = request.targetIndex !== undefined
			? [request.targetIndex]
			: request.targetIndexes?.length
				? request.targetIndexes
				: runningIndexes.length > 0
					? runningIndexes
					: statusPayload.mode === "single" && statusPayload.steps[0]?.status === "pending"
						? [0]
						: [];
		const now = Date.now();
		const targetStates = targets.map((index) => {
			const step = statusPayload.steps[index];
			if (!step) return { index, state: "failed" as const, reason: "child index out of range" };
			if (step.status === "pending") return { index, state: "scheduled" as const };
			if (step.status !== "running") return { index, state: "failed" as const, reason: `child is ${step.status}` };
			return { index, state: "routed" as const };
		});
		recordSteeringLifecycle(request, targetStates);
		emitSteeringEvent("subagent.steer.requested", request, undefined, { targets: targetStates });
		for (const target of targetStates) {
			if (target.state === "routed") {
				updateSteeringLifecycleTarget(request.id, target.index, "routed", now);
				emitSteeringEvent("subagent.steer.routed", request, target.index);
				steerLiveChild(target.index, request);
			} else if (target.state === "failed") {
				markSteeringAttention(target.index);
				emitSteeringEvent("subagent.steer.failed", request, target.index, { reason: target.reason });
			} else {
				emitSteeringEvent("subagent.steer.scheduled", request, target.index);
			}
		}
		emitTerminalSteeringNotice(request.id, `Steering failed for run ${id}: no requested child remained steerable.`);
		statusPayload.lastUpdate = now;
		writeStatusPayload();
	};
	/** Record the outcome of handing a routed steer to the live child session. */
	const applySteerDelivery = (requestId: string, index: number, delivery: { state: "delivered" | "queued" | "failed"; message: string }): void => {
		const lifecycle = steeringStatus(statusPayload);
		const request = lifecycle.recent.find((candidate) => candidate.id === requestId);
		const target = request?.targets.find((candidate) => candidate.index === index);
		if (!request || !target) return;
		if (target.state === "delivered" || target.state === "late" || target.state === "failed") return;
		if (target.state === delivery.state) return;
		const late = fs.existsSync(steeringMarkerPath(requestId));
		const now = Date.now();
		if (delivery.state === "delivered") {
			updateSteeringLifecycleTarget(requestId, index, late ? "late" : "delivered", now, omitUndefinedProperties({ reason: late ? "acknowledged after recovery commit" : undefined }));
			emitSteeringEvent("subagent.steer.delivered", { type: "steer", id: requestId, ts: now, message: delivery.message }, index, { late, deliveryStatus: "delivered", message: delivery.message });
		} else if (delivery.state === "queued") {
			updateSteeringLifecycleTarget(requestId, index, "queued", now);
			emitSteeringEvent("subagent.steer.queued", { type: "steer", id: requestId, ts: now, message: delivery.message }, index, { deliveryStatus: "queued", message: delivery.message });
		} else {
			markSteeringAttention(index);
			updateSteeringLifecycleTarget(requestId, index, "failed", now, { reason: delivery.message });
			emitSteeringEvent("subagent.steer.failed", { type: "steer", id: requestId, ts: now, message: delivery.message }, index, { reason: delivery.message });
		}
		emitTerminalSteeringNotice(requestId, `Steering failed for run ${id}: ${delivery.message}`);
		statusPayload.lastUpdate = now;
		writeStatusPayload();
	};
	/** Hand a routed steer to the step's live session, or hold it until the session exists. */
	const steerLiveChild = (index: number, request: SteerRequest): void => {
		const steer = activeChildSteers.get(index);
		if (!steer) {
			const queued = queuedStepSteers.get(index) ?? [];
			queued.push(request);
			queuedStepSteers.set(index, queued);
			return;
		}
		void steer(request).then(
			(delivery) => applySteerDelivery(request.id, index, delivery),
			(error) => applySteerDelivery(request.id, index, { state: "failed", message: error instanceof Error ? error.message : String(error) }),
		);
	};
	const flushPendingStepSteers = (flatIndex: number): void => {
		const remaining: SteerRequest[] = [];
		for (const request of pendingStepSteers.splice(0)) {
			if (request.targetIndex === undefined) deliverSteerRequest({ ...request, targetIndex: flatIndex });
			else if (request.targetIndex === flatIndex) deliverSteerRequest(request);
			else remaining.push(request);
		}
		pendingStepSteers.push(...remaining);
	};
	const updateStepModel = (flatIndex: number, model: string | undefined, thinking: string | undefined, contextLimit?: number, now = Date.now()): void => {
		const step = statusPayload.steps[flatIndex];
		if (!step) return;
		setOptionalProperty(step, "model", model);
		setOptionalProperty(step, "thinking", thinking);
		setOptionalProperty(step, "contextLimit", contextLimit);
		statusPayload.lastUpdate = now;
		writeStatusPayload();
	};
	const updateStepFromChildEvent = (flatIndex: number, event: ChildEvent): void => {
		const step = statusPayload.steps[flatIndex];
		if (!step) return;
		const previousActivityState = step.activityState;
		const now = Date.now();
		if (step.activityState === "stale") {
			delete step.activityState;
			syncAggregateActivityState();
		}
		statusPayload.currentStep = flatIndex;
		if (event.type === "tool_execution_start" && event.toolName) {
			const mutates = isMutatingTool(event.toolName, event.args, flatSteps[flatIndex]?.mutationTools);
			const currentPath = resolveCurrentPath(event.toolName, event.args);
			const argsPreview = extractToolArgsPreview(event.args ?? {});
			const blocksSupervisor = isBlockingSupervisorTool(event.toolName, event.args);
			step.toolCount = (step.toolCount ?? 0) + 1;
			const configuredToolBudget = flatSteps[flatIndex]?.toolBudget;
			if (configuredToolBudget) {
				step.toolBudget = toolBudgetState(configuredToolBudget, step.toolCount);
				statusPayload.toolBudget = step.toolBudget;
			}
			recordActiveToolCall(flatIndex, { toolCallId: (event as { toolCallId?: unknown }).toolCallId, toolName: event.toolName }, { argsPreview, currentPath, blocksSupervisor, now });
			pendingToolResults[flatIndex] = omitUndefinedProperties({ tool: event.toolName, path: currentPath, mutates, startedAt: now });
			statusPayload.toolCount = (statusPayload.toolCount ?? 0) + 1;
			syncTopLevelCurrentTool();
			if (controlConfig.enabled && blocksSupervisor && step.activityState !== "needs_attention") {
				const previous = step.activityState;
				step.activityState = "needs_attention";
				supervisorAttentionSteps.set(flatIndex, previous);
				currentActivityState = "needs_attention";
				statusPayload.activityState = "needs_attention";
				appendControlEvent(buildControlEvent(omitUndefinedProperties({
					type: "needs_attention",
					from: previous,
					to: "needs_attention",
					runId: id,
					agent: step.agent,
					index: flatIndex,
					ts: now,
					message: `${step.agent} is waiting for a supervisor reply`,
					reason: "supervisor_request",
					turns: step.turnCount,
					tokens: step.tokens?.total,
					toolCount: step.toolCount,
					currentTool: step.currentTool,
					toolCallId: event.toolCallId,
					currentToolDurationMs: 0,
					currentPath: step.currentPath,
				})));
			}
		} else if (event.type === "tool_execution_end") {
			const endedTool = removeActiveToolCall(flatIndex, event);
			if (endedTool) {
				step.recentTools ??= [];
				step.recentTools.push({ tool: endedTool.tool, args: endedTool.args, endMs: now });
			}
			refreshStepCurrentTool(flatIndex);
			const supervisorPreviousActivity = supervisorAttentionSteps.get(flatIndex);
			const stillBlockingSupervisor = [...(activeToolCalls[flatIndex]?.values() ?? [])].some((active) => active.blocksSupervisor);
			const clearedSupervisorAttention = endedTool?.blocksSupervisor && !stillBlockingSupervisor ? supervisorAttentionSteps.delete(flatIndex) : false;
			if (clearedSupervisorAttention && step.activityState === "needs_attention") {
				setOptionalProperty(step, "activityState", supervisorPreviousActivity);
				syncAggregateActivityState();
			}
			syncTopLevelCurrentTool();
		} else if (event.type === "tool_result_end" && event.message) {
			const toolSnapshot = pendingToolResults[flatIndex];
			pendingToolResults[flatIndex] = undefined;
			const resultText = extractTextFromContent(event.message.content);
			if (toolSnapshot && resultText.includes("Tool budget hard limit reached")) {
				const configuredToolBudget = flatSteps[flatIndex]?.toolBudget;
				if (configuredToolBudget) {
					step.toolBudget = toolBudgetState(configuredToolBudget, step.toolCount ?? 0, toolSnapshot.tool);
					step.toolBudgetBlocked = true;
					statusPayload.toolBudget = step.toolBudget;
					statusPayload.toolBudgetBlocked = true;
				}
			}
			appendRecentStepOutput(step, resultText.split("\n").slice(-10));
			if (toolSnapshot?.mutates && didMutatingToolFail(resultText)) {
				const state = mutatingFailureStates[flatIndex]!;
				recordMutatingFailure(state, omitUndefinedProperties({
					tool: toolSnapshot.tool,
					path: toolSnapshot.path,
					error: resultText.split("\n").find((line) => line.trim())?.trim().slice(0, 180) ?? "mutating tool failed",
					ts: now,
				}), mutatingFailureWindowMs);
				if (controlConfig.enabled && shouldEscalateMutatingFailures(state, controlConfig.failedToolAttemptsBeforeAttention) && step.activityState !== "needs_attention") {
					const previous = step.activityState;
					step.activityState = "needs_attention";
					statusPayload.activityState = "needs_attention";
					appendControlEvent(buildControlEvent(omitUndefinedProperties({
						type: "needs_attention",
						from: previous,
						to: "needs_attention",
						runId: id,
						agent: step.agent,
						index: flatIndex,
						ts: now,
						message: `${step.agent} needs attention after repeated mutating tool failures`,
						reason: "tool_failures",
						turns: step.turnCount,
						tokens: step.tokens?.total,
						toolCount: step.toolCount,
						currentTool: toolSnapshot.tool,
						currentToolDurationMs: toolSnapshot.startedAt ? Math.max(0, now - toolSnapshot.startedAt) : undefined,
						currentPath: toolSnapshot.path,
						recentFailureSummary: summarizeRecentMutatingFailures(state),
					})));
				}
			} else if (toolSnapshot?.mutates) {
				resetMutatingFailureState(mutatingFailureStates[flatIndex]!);
			}
		} else if (event.type === "message_end" && event.message?.role === "assistant") {
			appendRecentStepOutput(step, stripAcceptanceReport(extractTextFromContent(event.message.content)).split("\n").slice(-10));
			step.turnCount = (step.turnCount ?? 0) + 1;
			const usage = event.message.usage;
			if (config.usageBudget) {
				const known = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
				if (!known(usage?.input ?? usage?.inputTokens) || !known(usage?.output ?? usage?.outputTokens)) continuationUsageUncertain = true;
			}
			if (usage) {
				const input = usage.input ?? usage.inputTokens ?? 0;
				const output = usage.output ?? usage.outputTokens ?? 0;
				const window = input + (usage.cacheRead ?? usage.cacheReadTokens ?? 0);
				const previousInput = step.tokens?.input ?? 0;
				const previousOutput = step.tokens?.output ?? 0;
				step.tokens = { input: previousInput + input, output: previousOutput + output, total: previousInput + previousOutput + input + output, window, windowPeak: Math.max(step.tokens?.windowPeak ?? 0, window) };
				const totalInput = statusPayload.totalTokens?.input ?? 0;
				const totalOutput = statusPayload.totalTokens?.output ?? 0;
				statusPayload.totalTokens = { input: totalInput + input, output: totalOutput + output, total: totalInput + totalOutput + input + output, window, windowPeak: Math.max(statusPayload.totalTokens?.windowPeak ?? 0, window) };
				refreshUsageBudget();
			}
			statusPayload.turnCount = Math.max(statusPayload.turnCount ?? 0, step.turnCount);
		}
		syncTopLevelCurrentTool();
		step.lastActivityAt = now;
		statusPayload.lastActivityAt = now;
		statusPayload.lastUpdate = now;
		maybeEmitActiveLongRunning(flatIndex, now);
		// A sibling may keep aggregate attention unchanged; publish this step's transition.
		writeStatusPayload(step.activityState !== previousActivityState);
	};
	const updateRunnerActivityState = (now: number): boolean => {
		if (!controlConfig.enabled) return false;
		let changed = false;
		let runLastActivityAt = statusPayload.lastActivityAt ?? overallStartTime;
		for (let index = 0; index < statusPayload.steps.length; index++) {
			const step = statusPayload.steps[index]!;
			if (step.status !== "running") continue;
			const lastActivityAt = stepOutputActivityAt(index);
			runLastActivityAt = Math.max(runLastActivityAt, lastActivityAt);
			if (step.lastActivityAt !== lastActivityAt) {
				step.lastActivityAt = lastActivityAt;
				changed = true;
			}
			const idleState = deriveActivityState(omitUndefinedProperties({
				config: controlConfig,
				startedAt: step.startedAt ?? overallStartTime,
				lastActivityAt,
				turnCount: step.turnCount,
				currentTool: step.currentTool,
				now,
			}));
			if (idleState !== "stale" && step.activityState === "stale") {
				delete step.activityState;
				changed = true;
			}
			if (idleState === "stale") {
				const previous = step.activityState;
				step.activityState = "stale";
				if (previous !== "stale") {
					appendControlEvent(buildControlEvent(omitUndefinedProperties({
						type: "stale",
						from: previous,
						to: "stale",
						runId: id,
						agent: step.agent,
						index,
						ts: now,
						lastActivityAt,
						turns: step.turnCount,
						tokens: step.tokens?.total,
						toolCount: step.toolCount,
						currentTool: step.currentTool,
						currentToolDurationMs: step.currentToolStartedAt ? Math.max(0, now - step.currentToolStartedAt) : undefined,
						currentPath: step.currentPath,
					})));
					changed = true;
				}
			} else if (idleState === "needs_attention") {
				const previous = step.activityState;
				step.activityState = "needs_attention";
				if (previous !== "needs_attention") {
					appendControlEvent(buildControlEvent(omitUndefinedProperties({
						from: previous,
						to: "needs_attention",
						runId: id,
						agent: step.agent,
						index,
						ts: now,
						lastActivityAt,
					})));
					changed = true;
				}
			} else if (maybeEmitOpenToolAttention(index, now)) {
				changed = true;
			} else if (maybeEmitActiveLongRunning(index, now)) {
				changed = true;
			}
		}
		if (statusPayload.lastActivityAt !== runLastActivityAt) {
			statusPayload.lastActivityAt = runLastActivityAt;
			changed = true;
		}
		const nextRunState = statusPayload.steps.some((step) => step.activityState === "stale")
			? "stale"
			: statusPayload.steps.some((step) => step.activityState === "needs_attention")
				? "needs_attention"
				: statusPayload.steps.some((step) => step.activityState === "active_long_running")
					? "active_long_running"
					: undefined;
		if (nextRunState !== currentActivityState) {
			currentActivityState = nextRunState;
			setOptionalProperty(statusPayload, "activityState", nextRunState);
			changed = true;
		}
		statusPayload.lastUpdate = now;
		if (changed) writeStatusPayload();
		return changed;
	};
	if (controlConfig.enabled) {
		activityTimer = setInterval(() => {
			if (statusPayload.state !== "running") return;
			const now = Date.now();
			updateRunnerActivityState(now);
		}, 1000);
		activityTimer.unref?.();
	}

	const publishSetupUnknown = (progress: WorktreeSetupProgress): void => {
		if (!progress.unknown) return;
		const proof = {
			version: 1 as const, state: "unknown" as const, runId: id,
			runnerProcessInstanceId: config.runnerProcessInstanceId ?? "unknown",
			reason: "process-tree-unverified" as const,
			diagnostic: `Worktree setup settlement unknown: ${progress.unknown}; manual reconciliation required; ${parallelHandoffPath(asyncDir)}`,
		};
		statusPayload.processTerminal = proof;
		// Publish the sticky proof independently of in-process child writer counts.
		writeAtomicJson(processTerminalPath(asyncDir), proof);
	};
	const finalizeWorktree = async (setup: WorktreeSetup, stepIndex: number, flatStartIndex: number, action: () => void, deadlineAt?: number): Promise<void> => {
		let admitted = false;
		try {
			await withWorktreeTransaction(() => {
				if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw new Error("Run deadline expired before worktree cleanup");
				admitted = true;
				action();
			});
		}
		catch (error) {
			if (admitted) throw error;
			const reason = `Worktree finalization retained; manual reconciliation required: ${error instanceof Error ? error.message : String(error)}`;
			statusPayload.parallelHandoff = writeParallelHandoffGroup({
				manifestPath: parallelHandoffPath(asyncDir), runId: id,
				mode: (config.resultMode ?? statusPayload.mode) === "parallel" ? "parallel" : (config.resultMode ?? statusPayload.mode) === "single" ? "single" : "chain",
				source: "async", cwd, stepIndex, flatStartIndex, setup, diffs: [], results: [],
				cleanup: { state: "partial", pruned: false, errors: [reason], tasks: setup.worktrees.map((worktree) => ({
					index: worktree.index, path: worktree.path, branch: worktree.branch, provider: worktree.provider, naming: worktree.naming,
					worktreeRemoved: false, branchRemoved: false, preserved: true, reason,
				})) },
			});
			previousOutput = [previousOutput, reason, formatParallelHandoffReference(statusPayload.parallelHandoff)].filter(Boolean).join("\n\n");
			writeStatusPayload();
		}
	};
	const cleanupRemainingWorktree = (setup: WorktreeSetup, stepIndex: number, flatStartIndex: number) => finalizeWorktree(setup, stepIndex, flatStartIndex, () => {
		const cleanup = cleanupWorktrees(setup);
		statusPayload.parallelHandoff = writeParallelHandoffGroup({
			manifestPath: parallelHandoffPath(asyncDir), runId: id,
			mode: (config.resultMode ?? statusPayload.mode) === "parallel" ? "parallel" : (config.resultMode ?? statusPayload.mode) === "single" ? "single" : "chain",
			source: "async", cwd, stepIndex, flatStartIndex, setup, diffs: [], results: [], cleanup,
		});
		writeStatusPayload();
	}, config.deadlineAt);
	const interruptRunner = () => {
		consumeInterruptRequest(asyncDir);
		if (interrupted || statusPayload.state !== "running") return;
		interrupted = true;
		setupInterruptController.abort();
		const now = Date.now();
		statusPayload.state = "paused";
		currentActivityState = undefined;
		delete statusPayload.activityState;
		statusPayload.lastUpdate = now;
		for (const step of statusPayload.steps) {
			if (step.status === "running") {
				step.status = "paused";
				delete step.activityState;
				step.endedAt = now;
				setOptionalProperty(step, "durationMs", step.startedAt ? now - step.startedAt : undefined);
				step.lastActivityAt = now;
			}
		}
		writeStatusPayload();
		appendJsonl(eventsPath, JSON.stringify({
			type: "subagent.run.paused",
			ts: now,
			runId: id,
		}));
		interruptNestedAsyncDescendants();
		interruptActiveChildren();
	};
	const stopRunner = () => {
		if (stopped || timedOut || (statusPayload.state !== "running" && statusPayload.state !== "paused")) return;
		stopped = true;
		interrupted = false;
		const now = Date.now();
		statusPayload.stopped = true;
		statusPayload.error = stopMessage;
		currentActivityState = undefined;
		delete statusPayload.activityState;
		statusPayload.lastUpdate = now;
		for (const [index, step] of statusPayload.steps.entries()) {
			if (step.status !== "running" && step.status !== "pending" && step.status !== "paused") continue;
			step.status = "stopped";
			step.error = stopMessage;
			step.exitCode = 1;
			step.stopped = true;
			delete step.activityState;
			step.endedAt = now;
			step.durationMs = step.startedAt ? now - step.startedAt : 0;
			step.lastActivityAt = now;
			const result = results[index];
			if (result?.interrupted) results[index] = { ...result, output: stopMessage, error: stopMessage, exitCode: 1, success: false, interrupted: false, stopped: true };
		}
		writeStatusPayload();
		appendJsonl(eventsPath, JSON.stringify({
			type: "subagent.run.stopped",
			ts: now,
			runId: id,
			message: stopMessage,
		}));
		stopAbortController.abort();
		stopNestedAsyncDescendants();
		stopActiveChildren();
	};
	const timeoutRunner = () => {
		if (timedOut || stopped || interrupted || statusPayload.state !== "running") return;
		timedOut = true;
		const now = Date.now();
		const message = timeoutMessage ?? "Subagent timed out.";
		statusPayload.timedOut = true;
		statusPayload.error = message;
		currentActivityState = undefined;
		delete statusPayload.activityState;
		statusPayload.lastUpdate = now;
		for (const step of statusPayload.steps) {
			if (step.status !== "running" && step.status !== "pending") continue;
			step.status = "failed";
			step.error = message;
			step.exitCode = 1;
			step.timedOut = true;
			delete step.activityState;
			step.endedAt = now;
			step.durationMs = step.startedAt ? now - step.startedAt : 0;
			step.lastActivityAt = now;
		}
		writeStatusPayload();
		appendJsonl(eventsPath, JSON.stringify({
			type: "subagent.run.timed_out",
			ts: now,
			runId: id,
			timeoutMs: config.timeoutMs,
			deadlineAt: config.deadlineAt,
			message,
		}));
		timeoutAbortController.abort();
		timeoutNestedAsyncDescendants();
		timeoutActiveChildren();
	};
	process.on(ASYNC_INTERRUPT_SIGNAL, interruptRunner);
	// Portable control inbox: the parent drops control request files here when
	// it cannot deliver OS signals (e.g. ENOSYS on Windows) or when steering a
	// live child. Interrupts still route into the same graceful interruptRunner().
	const disposeControlInbox = watchAsyncControlInbox(asyncDir, {
		onInterrupt: interruptRunner,
		onTimeout: timeoutRunner,
		onStop: stopChildStep,
		onSteer: (request) => {
			const targetStep = request.targetIndex !== undefined ? statusPayload.steps[request.targetIndex] : undefined;
			if (targetStep?.status === "pending") {
				deliverSteerRequest(request);
				pendingStepSteers.push(request);
			} else if (request.targetIndexes !== undefined || request.targetIndex !== undefined || statusPayload.steps.some((step) => step.status === "running")) {
				deliverSteerRequest(request);
			} else {
				deliverSteerRequest(request);
				pendingStepSteers.push(request);
			}
		},
	});
	if (config.deadlineAt !== undefined) {
		const remainingMs = Math.max(0, config.deadlineAt - Date.now());
		timeoutTimer = setTimeout(timeoutRunner, remainingMs);
		timeoutTimer.unref?.();
		// Route the pre-deadline checkpoint like any external steer so its lifecycle records the receipt.
		const checkpointBeforeDeadlineMs = config.checkpointBeforeDeadlineMs;
		const checkpointDelayMs = checkpointBeforeDeadlineMs === undefined || !Number.isInteger(checkpointBeforeDeadlineMs) || checkpointBeforeDeadlineMs <= 0
			? undefined
			: remainingMs - checkpointBeforeDeadlineMs;
		if (checkpointDelayMs !== undefined && checkpointDelayMs >= 1_000) {
			const deadlineAt = config.deadlineAt;
			checkpointTimer = setTimeout(() => {
				checkpointTimer = undefined;
				if (timedOut || stopped || interrupted) return;
				if (!statusPayload.steps.some((step) => step.status === "running")) return;
				const now = Date.now();
				const seconds = Math.round(Math.max(0, deadlineAt - now) / 1000);
				deliverSteerRequest({
					type: "steer",
					id: `deadline-checkpoint-${now}`,
					ts: now,
					mode: "steer",
					source: "deadline-checkpoint",
					message: `Deadline checkpoint from the runner: this run is killed in about ${seconds} seconds. Finish the current tool call only, then stop and reply with a handoff: changed files, build/test state, remaining work, and commit/PR state. Do not start new work.`,
				});
			}, checkpointDelayMs);
			checkpointTimer.unref?.();
		}
	}
	appendJsonl(
		eventsPath,
		JSON.stringify({
			type: "subagent.run.started",
			lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
			ts: overallStartTime,
			runId: id,
			mode: statusPayload.mode,
			cwd,
			runnerPid: process.pid,
		}),
	);

	let flatIndex = 0;
	let stepCursor = 0;
	while (true) {
		if (interrupted || timedOut || stopped) break;
		if (stepCursor >= steps.length) break;
		refreshUsageBudget();
		if (statusPayload.usageBudget?.exhausted) {
			usageBudgetExceeded = true;
			statusPayload.state = "failed";
			statusPayload.error = usageBudgetExceededMessage(statusPayload.usageBudget);
			statusPayload.currentStep = flatIndex;
			statusPayload.lastUpdate = Date.now();
			writeStatusPayload();
			break;
		}
		const stepIndex = stepCursor++;
		const step = steps[stepIndex]!;

		if (isParallelGroup(step)) {
			const group = step;
			const concurrency = group.concurrency ?? MAX_PARALLEL_CONCURRENCY;
			const failFast = group.failFast ?? false;
			const groupStartFlatIndex = flatIndex;
			let aborted = false;
			let worktreeSetup: WorktreeSetup | undefined;
			let worktreeFinalized = false;
			if (group.worktree) {
				const worktreeTaskCwdConflict = findWorktreeTaskCwdConflict(group.parallel, cwd);
				if (worktreeTaskCwdConflict) {
					const failedAt = Date.now();
					markParallelGroupSetupFailure({
						statusPayload,
						results,
						group,
						groupStartFlatIndex,
						setupError: formatWorktreeTaskCwdConflict(worktreeTaskCwdConflict, cwd),
						failedAt,
						statusPath,
						eventsPath,
						asyncDir,
						runId: id,
						stepIndex,
						writeStatus: () => writeStatusPayload(),
					});
					flatIndex += group.parallel.length;
					break;
				}
				try {
					worktreeSetup = await createWorktrees(cwd, `${id}-s${stepIndex}`, group.parallel.length, omitUndefinedProperties({
						signal: setupSignal,
						deadlineAt: config.deadlineAt,
						agents: group.parallel.map((task) => task.agent),
						labels: group.parallel.map((task) => task.lane?.key ?? config.workflowKey ?? task.outputName ?? task.label),
						tasks: group.parallel.map((task) => task.task),
						baseRef: config.baseRef,
						branchPrefix: config.worktreeBranchPrefix,
						setupHook: config.worktreeSetupHook
							? omitUndefinedProperties({ hookPath: config.worktreeSetupHook, timeoutMs: config.worktreeSetupHookTimeoutMs })
							: undefined,
						baseDir: config.worktreeBaseDir,
						onProgress: (progress) => {
							publishSetupUnknown(progress);
							for (const worktree of progress.setup.worktrees) setStatusWorktreeReference(requiredStatusStep(statusPayload, groupStartFlatIndex + worktree.index), worktree);
							const pendingHandoff = writeWorktreeSetupHandoff({
								manifestPath: parallelHandoffPath(asyncDir),
								runId: id,
								mode: (config.resultMode ?? statusPayload.mode) === "parallel" ? "parallel" : "chain",
								source: "async",
								cwd,
								stepIndex,
								flatStartIndex: groupStartFlatIndex,
								progress,
								laneBindings: handoffWorkflowKey || config.lane ? [{ index: groupStartFlatIndex, taskIndex: 0, ...(handoffWorkflowKey ? { workflowKey: handoffWorkflowKey } : {}), ...(handoffChildRunId ? { runId: handoffChildRunId } : {}), ...(config.lane ? { lane: config.lane } : {}) }] : undefined,
							});
							if (!pendingHandoff) return;
							statusPayload.parallelHandoff = pendingHandoff;
							statusPayload.lastUpdate = Date.now();
							writeStatusPayload();
						},
					}));
					if (config.deadlineAt !== undefined && Date.now() >= config.deadlineAt) timeoutRunner();
					if (setupSignal.aborted) throw new Error(stopped ? stopMessage : timedOut ? timeoutMessage ?? "Subagent timed out." : "Subagent paused during worktree setup.");
				} catch (error) {
					if (worktreeSetup) await cleanupRemainingWorktree(worktreeSetup, stepIndex, groupStartFlatIndex);
					if (config.deadlineAt !== undefined && Date.now() >= config.deadlineAt) timeoutRunner();
					const setupError = error instanceof Error ? error.message : String(error);
					if (error instanceof WorktreeSetupError) publishSetupUnknown(error.snapshot);
					for (let index = groupStartFlatIndex; index < groupStartFlatIndex + group.parallel.length; index++) {
						if (childStopRequests.has(index)) markChildStopped(index);
					}
					const failedAt = Date.now();
					markParallelGroupSetupFailure({
						statusPayload,
						results,
						group,
						groupStartFlatIndex,
						setupError,
						failedAt,
						statusPath,
						eventsPath,
						asyncDir,
						runId: id,
						stepIndex,
						writeStatus: () => writeStatusPayload(),
					});
					flatIndex += group.parallel.length;
					break;
				}
			}

			try {
				if (group.worktree) ensureParallelProgressFile(cwd, group);
				const groupStartTime = Date.now();
				markParallelGroupRunning({
					statusPayload,
					group,
					groupStartFlatIndex,
					groupStartTime,
					statusPath,
					eventsPath,
					asyncDir,
					runId: id,
					stepIndex,
					writeStatus: () => writeStatusPayload(),
				});
				const parallelResults = await mapConcurrent(
					group.parallel,
					concurrency,
					async (task, taskIdx): Promise<StepResult> => {
						const fi = groupStartFlatIndex + taskIdx;
						refreshUsageBudget();
						if (statusPayload.usageBudget?.exhausted) {
							const skippedAt = Date.now();
							const message = usageBudgetExceededMessage(statusPayload.usageBudget);
							requiredStatusStep(statusPayload, fi).status = "failed";
							requiredStatusStep(statusPayload, fi).error = message;
							requiredStatusStep(statusPayload, fi).startedAt = skippedAt;
							requiredStatusStep(statusPayload, fi).endedAt = skippedAt;
							requiredStatusStep(statusPayload, fi).durationMs = 0;
							requiredStatusStep(statusPayload, fi).exitCode = 1;
							delete requiredStatusStep(statusPayload, fi).activityState;
							statusPayload.lastUpdate = skippedAt;
							usageBudgetExceeded = true;
							writeStatusPayload();
							appendJsonl(eventsPath, JSON.stringify({
								type: "subagent.step.failed", ts: skippedAt, runId: id, stepIndex: fi, agent: task.agent, exitCode: 1, durationMs: 0,
							}));
							return omitUndefinedProperties({ agent: task.agent, ...(task.sessionName ? { sessionName: task.sessionName } : {}), context: task.context, output: message, error: message, exitCode: 1 as number | null, skipped: true });
						}
						if (timedOut) return timedOutStepResult(task.agent, task.context, task.sessionName);
						if (stopped) return stoppedStepResult(task.agent, task.context, task.sessionName);
						if (childStopRequests.has(fi)) return childStopResult(fi, task.agent, task.context);
						if (interrupted) return pausedStepResult(task.agent, task.context, task.sessionName);
						if (aborted && failFast) {
							const skippedAt = Date.now();
							requiredStatusStep(statusPayload, fi).status = "failed";
							requiredStatusStep(statusPayload, fi).error = "Skipped due to fail-fast";
							requiredStatusStep(statusPayload, fi).startedAt = skippedAt;
							requiredStatusStep(statusPayload, fi).endedAt = skippedAt;
							requiredStatusStep(statusPayload, fi).durationMs = 0;
							requiredStatusStep(statusPayload, fi).exitCode = -1;
							delete requiredStatusStep(statusPayload, fi).activityState;
							statusPayload.lastUpdate = skippedAt;
							writeStatusPayload();
							appendJsonl(eventsPath, JSON.stringify({
								type: "subagent.step.failed", ts: skippedAt, runId: id, stepIndex: fi, agent: task.agent, exitCode: -1, durationMs: 0,
							}));
							return omitUndefinedProperties({ agent: task.agent, ...(task.sessionName ? { sessionName: task.sessionName } : {}), context: task.context, output: "(skipped — fail-fast)", exitCode: -1 as number | null, skipped: true });
						}

						const taskStartTime = Date.now();
						statusPayload.currentStep = fi;
						requiredStatusStep(statusPayload, fi).status = "running";
						delete requiredStatusStep(statusPayload, fi).error;
						delete requiredStatusStep(statusPayload, fi).activityState;
						resetStepLiveDetail(requiredStatusStep(statusPayload, fi));
						requiredStatusStep(statusPayload, fi).startedAt = taskStartTime;
						delete requiredStatusStep(statusPayload, fi).endedAt;
						delete requiredStatusStep(statusPayload, fi).durationMs;
						requiredStatusStep(statusPayload, fi).lastActivityAt = taskStartTime;
						statusPayload.outputFile = path.join(asyncDir, `output-${fi}.log`);
						statusPayload.lastActivityAt = taskStartTime;
						statusPayload.lastUpdate = taskStartTime;
						writeStatusPayload();

						appendJsonl(eventsPath, JSON.stringify({
							type: "subagent.step.started", ts: taskStartTime, runId: id, stepIndex: fi, agent: task.agent,
						}));

						const taskSessionDir = config.sessionDir
							? path.join(config.sessionDir, `parallel-${taskIdx}`)
							: undefined;
						const { taskForRun, taskCwd } = prepareParallelTaskRun(task, cwd, worktreeSetup, taskIdx);
						flushPendingStepSteers(fi);

						const singleResult = await runSingleStepWithTimeout(taskForRun, compactOptional<SingleStepContext>({
							previousOutput, placeholder, cwd: taskCwd, sessionEnabled,
							outputs,
							sessionDir: taskSessionDir,
							artifactsDir, artifactConfig, id,
							flatIndex: fi, flatStepCount: Math.max(statusPayload.steps.length, 1),
							projectTrusted: config.projectTrusted,
							outputFile: path.join(asyncDir, `output-${fi}.log`),
							piPackageRoot: config.piPackageRoot,
							childSessions,
							inheritedChildRuntime: config.inheritedChildRuntime,
							childIntercomTarget: config.childIntercomTargets?.[fi],
							orchestratorIntercomTarget: config.controlIntercomTarget,
							nestedRoute: config.nestedRoute,
							capabilityCeiling: config.capabilityCeiling,
							runFanoutBudget: config.runFanoutBudget,
							registerInterrupt: (interrupt) => registerStepInterrupt(fi, interrupt),
							registerTimeout: (interrupt) => registerStepTimeout(fi, interrupt),
							registerStop: (stop) => registerStepStop(fi, stop),
							registerSteer: (steer) => registerStepSteer(fi, steer),
							onSteerOutcome: (request, delivery) => applySteerDelivery(request.id, fi, delivery),
							timeoutSignal: timeoutAbortController.signal,
							stopSignal: stopAbortController.signal,
							timeoutMessage,
							stopMessage,
							toolTimeoutMs: taskForRun.toolTimeoutMs ?? config.toolTimeoutMs,
							onAttemptStart: (attempt) => updateStepModel(fi, attempt.model, attempt.thinking, attempt.contextLimit),
							onChildEvent: (event) => updateStepFromChildEvent(fi, event),
							skipAcceptance: () => timedOut || stopped || childStopRequests.has(fi),
							usageBudgetExhausted: continuationUsageBudgetExhausted,
							usageBudget: config.usageBudget,
						}), config.deadlineAt);
						if (task.sessionFile) {
							latestSessionFile = task.sessionFile;
						}

						const taskEndTime = Date.now();
						const taskDuration = taskEndTime - taskStartTime;
						const childInterrupted = singleResult.interrupted === true;
						const childStopped = singleResult.stopped === true;

						requiredStatusStep(statusPayload, fi).status = stopped || childStopped ? "stopped" : timedOut ? "failed" : childInterrupted ? "paused" : acceptanceNeedsRecovery(singleResult.acceptance) ? "paused" : singleResult.execution?.status === "partial" ? "partial" : singleResult.exitCode === 0 ? "complete" : "failed";
						requiredStatusStep(statusPayload, fi).endedAt = taskEndTime;
						requiredStatusStep(statusPayload, fi).durationMs = taskDuration;
						requiredStatusStep(statusPayload, fi).exitCode = stopped || childStopped ? 1 : timedOut ? 1 : childInterrupted ? 0 : singleResult.exitCode;
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "timedOut", timedOut || singleResult.timedOut ? true : undefined);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "stopped", stopped || childStopped ? true : undefined);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "toolBudget", singleResult.toolBudget);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "toolBudgetBlocked", singleResult.toolBudgetBlocked);
						if (singleResult.toolBudget) statusPayload.toolBudget = singleResult.toolBudget;
						if (singleResult.toolBudgetBlocked) statusPayload.toolBudgetBlocked = true;
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "sessionName", singleResult.sessionName);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "model", singleResult.model);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "thinking", resolveEffectiveThinking(singleResult.model, requiredStatusStep(statusPayload, fi).thinking));
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "requestedModel", singleResult.requestedModel);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "contextOverflow", singleResult.contextOverflow);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "totalCost", singleResult.totalCost);
						if (singleResult.totalCost) {
							pendingParallelUsageCost = {
								inputTokens: pendingParallelUsageCost.inputTokens + singleResult.totalCost.inputTokens,
								outputTokens: pendingParallelUsageCost.outputTokens + singleResult.totalCost.outputTokens,
								costUsd: pendingParallelUsageCost.costUsd + singleResult.totalCost.costUsd,
							};
							refreshUsageBudget();
						}
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "error", stopped || childStopped ? stopMessage : timedOut ? (timeoutMessage ?? "Subagent timed out.") : singleResult.error);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "transcriptPath", singleResult.transcriptPath ?? requiredStatusStep(statusPayload, fi).transcriptPath);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "transcriptError", singleResult.transcriptError);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "agentContract", singleResult.agentContract);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "launchResolvedExtensions", singleResult.launchResolvedExtensions);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "runtimeAcknowledgedExtensions", singleResult.runtimeAcknowledgedExtensions);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "effects", singleResult.effects);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "execution", singleResult.execution);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "review", singleResult.review);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "structuredOutput", singleResult.structuredOutput);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "structuredOutputPath", singleResult.structuredOutputPath);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "structuredOutputSchemaPath", singleResult.structuredOutputSchemaPath);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "acceptance", singleResult.acceptance);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "timeoutRecovery", singleResult.timeoutRecovery);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "capabilityCeiling", singleResult.capabilityCeiling);
						setOptionalProperty(requiredStatusStep(statusPayload, fi), "capabilityAudit", singleResult.capabilityAudit);
						if (singleResult.capabilityCeiling) statusPayload.capabilityCeiling = singleResult.capabilityCeiling;
						if (singleResult.capabilityAudit) statusPayload.capabilityAudit = singleResult.capabilityAudit;
						statusPayload.lastUpdate = taskEndTime;
						writeStatusPayload();
						appendCapabilityCeilingAppliedEvent(eventsPath, id, fi, task.agent, singleResult);

						appendJsonl(eventsPath, JSON.stringify({
							type: stopped || childStopped ? "subagent.step.stopped" : timedOut ? "subagent.step.failed" : childInterrupted ? "subagent.step.paused" : singleResult.exitCode === 0 ? "subagent.step.completed" : "subagent.step.failed",
							ts: taskEndTime, runId: id, stepIndex: fi, agent: task.agent,
							exitCode: stopped || childStopped ? 1 : timedOut ? 1 : childInterrupted ? 0 : singleResult.exitCode, durationMs: taskDuration,
						}));
						if (stopped || childStopped) appendTerminalChildStatusEvent(fi, taskEndTime);
						if (singleResult.exitCode !== 0 && failFast && !childStopped) aborted = true;
						return stopped || childStopped ? { ...singleResult, output: stopMessage, error: stopMessage, exitCode: 1, interrupted: false, timedOut: false, stopped: true, skipped: false } : timedOut ? { ...singleResult, output: singleResult.output || (timeoutMessage ?? "Subagent timed out."), error: singleResult.error ?? timeoutMessage ?? "Subagent timed out.", exitCode: 1, interrupted: false, timedOut: true, skipped: false } : { ...singleResult, skipped: false };
					},
					globalSemaphore,
				);

				flatIndex += group.parallel.length;

				for (let t = 0; t < group.parallel.length; t++) {
					const fi = groupStartFlatIndex + t;
					const sessionTokens = config.sessionDir
						? parseSessionTokens(path.join(config.sessionDir, `parallel-${t}`))
						: null;
					const fallbackTokens = tokenUsageFromUsage(parallelResults[t]?.usage);
					const observedTokens = requiredStatusStep(statusPayload, fi).tokens;
					const taskTokens = sessionTokens ?? (fallbackTokens
						? { ...fallbackTokens, ...(observedTokens?.window !== undefined ? { window: observedTokens.window } : {}), ...(observedTokens?.windowPeak !== undefined ? { windowPeak: observedTokens.windowPeak } : {}) }
						: null);
					if (!taskTokens) continue;
					requiredStatusStep(statusPayload, fi).tokens = taskTokens;
					previousCumulativeTokens = {
						input: previousCumulativeTokens.input + taskTokens.input,
						output: previousCumulativeTokens.output + taskTokens.output,
						total: previousCumulativeTokens.total + taskTokens.total,
						...(taskTokens.window !== undefined ? { window: taskTokens.window } : {}),
						...(previousCumulativeTokens.windowPeak !== undefined || taskTokens.windowPeak !== undefined
							? { windowPeak: Math.max(previousCumulativeTokens.windowPeak ?? 0, taskTokens.windowPeak ?? 0) }
							: {}),
					};
				}
				statusPayload.totalTokens = { ...previousCumulativeTokens };
				statusPayload.lastUpdate = Date.now();
				writeStatusPayload();

				for (const pr of parallelResults) {
					results.push(omitUndefinedProperties({
						agent: pr.agent,
						context: pr.context,
						agentContract: pr.agentContract,
						launchContractDigest: pr.launchContractDigest,
						launchResolvedExtensions: pr.launchResolvedExtensions,
						output: pr.output,
						outputState: pr.outputState,
						error: pr.error,
						success: pr.stopped !== true && pr.interrupted !== true && pr.exitCode === 0 && pr.execution?.status !== "partial" && !acceptanceNeedsRecovery(pr.acceptance),
						exitCode: pr.interrupted === true ? 0 : pr.exitCode,
						skipped: pr.skipped,
						interrupted: pr.interrupted,
						timedOut: pr.timedOut,
						stopped: pr.stopped,
						toolBudget: pr.toolBudget,
						toolBudgetBlocked: pr.toolBudgetBlocked,
						sessionFile: pr.sessionFile,
						intercomTarget: pr.intercomTarget,
						model: pr.model,
						thinking: pr.thinking,
						requestedModel: pr.requestedModel,
						contextOverflow: pr.contextOverflow,
						totalCost: pr.totalCost,
						usage: pr.usage,
						artifactPaths: pr.artifactPaths,
						outputSaveError: pr.outputSaveError,
						artifactOutputSaveFailed: pr.artifactOutputSaveFailed,
						transcriptPath: pr.transcriptPath,
						transcriptError: pr.transcriptError,
						effects: pr.effects,
						execution: pr.execution,
						review: pr.review,
						timeoutRecovery: pr.timeoutRecovery,
						structuredOutput: pr.structuredOutput,
						structuredOutputFailed: pr.structuredOutputFailed,
						structuredOutputPath: pr.structuredOutputPath,
						structuredOutputSchemaPath: pr.structuredOutputSchemaPath,
						acceptance: pr.acceptance,
					}));
				}
				pendingParallelUsageCost = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
				refreshUsageBudget();
				for (let t = 0; t < group.parallel.length; t++) {
					const outputName = group.parallel[t]?.outputName;
					if (outputName) outputs[outputName] = outputEntryFromAsyncResult({
						agent: parallelResults[t]!.agent,
						output: parallelResults[t]!.output,
						structuredOutput: parallelResults[t]!.structuredOutput,
					}, stepIndex);
				}
				statusPayload.outputs = outputs;

				previousOutput = aggregateParallelOutputs(
					parallelResults.map((r) => omitUndefinedProperties({
						agent: r.agent,
						output: r.output,
						exitCode: r.exitCode,
						error: r.error,
						model: r.model,
						requestedModel: r.requestedModel,
					})),
				);
				if (worktreeSetup) {
					const setup = worktreeSetup;
					worktreeFinalized = true;
					await finalizeWorktree(setup, stepIndex, groupStartFlatIndex, () => {
						const captured = captureParallelWorktreeDiffs(setup, asyncDir, stepIndex, group);
						if (captured.summary) previousOutput = `${previousOutput}\n\n${captured.summary}`;
						const manifestPath = parallelHandoffPath(asyncDir);
						const handoff = {
							manifestPath,
							runId: id,
							mode: (config.resultMode ?? statusPayload.mode) === "parallel" ? "parallel" as const : "chain" as const,
							source: "async" as const,
							cwd,
							stepIndex,
							flatStartIndex: groupStartFlatIndex,
							setup,
							diffs: captured.diffs,
							results: parallelResults.map((result) => ({
								agent: result.agent,
								...(handoffWorkflowKey ? { workflowKey: handoffWorkflowKey } : {}),
								...(handoffChildRunId ? { runId: handoffChildRunId } : {}),
								...(config.lane ? { lane: config.lane } : {}),
								status: result.stopped || (result.exitCode !== 0 && isUnexplainedProcessSignal(omitUndefinedProperties({
									processSignal: result.processSignal,
									interrupted: result.interrupted,
									timedOut: result.timedOut,
									stopped: result.stopped,
								}))) ? "stopped" as const : result.interrupted || acceptanceNeedsRecovery(result.acceptance) ? "paused" as const : result.exitCode === 0 ? "completed" as const : "failed" as const,
								summary: result.output || result.error || "(no output)",
								...(result.artifactPaths?.outputPath ? { outputPath: result.artifactPaths.outputPath } : {}),
								...(result.structuredOutput !== undefined ? { structuredOutput: result.structuredOutput } : {}),
								...(result.structuredOutputPath ? { structuredOutputPath: result.structuredOutputPath } : {}),
								...(result.sessionFile ? { sessionPath: result.sessionFile } : {}),
							})),
						};
						try {
							writeParallelHandoffGroup(handoff);
							const cleanup = cleanupWorktrees(setup, { kind: "preserve", capturedDiffs: captured.diffs, handoffManifestPath: manifestPath });
							statusPayload.parallelHandoff = writeParallelHandoffGroup({ ...handoff, cleanup });
							previousOutput = `${previousOutput}\n\n${formatParallelHandoffReference(statusPayload.parallelHandoff)}`;
						} catch (error) {
							previousOutput = `${previousOutput}\n\n${formatParallelHandoffError(error)}`;
						}
						writeStatusPayload();
					});
				}

				appendJsonl(eventsPath, JSON.stringify({
					type: "subagent.parallel.completed",
					ts: Date.now(),
					runId: id,
					stepIndex,
					success: parallelResults.every((r) => r.exitCode === 0 || r.exitCode === -1)
						&& parallelResults.every((result, index) => !(isAgentContract(group.parallel[index]?.agentContract) && group.parallel[index]?.gateOn === "acceptance" && acceptanceBlocksGate(result.acceptance)))
						&& !parallelResults.some((result) => acceptanceNeedsRecovery(result.acceptance)),
				}));

				const acceptanceGateFailure = parallelResults
					.map((result, index) => ({ result, index, task: group.parallel[index] }))
					.find(({ result, task }) => isAgentContract(task?.agentContract) && task?.gateOn === "acceptance" && acceptanceBlocksGate(result.acceptance));
				if (acceptanceGateFailure) {
					statusPayload.error = acceptanceGateFailure.result.acceptance && acceptanceNeedsRecovery(acceptanceGateFailure.result.acceptance)
						? acceptanceRecoveryMessage(acceptanceGateFailure.result.acceptance)
						: (acceptanceGateFailure.result.acceptance ? acceptanceFailureMessage(acceptanceGateFailure.result.acceptance) : undefined) ?? "Parallel acceptance gate rejected the step.";
					writeStatusPayload();
					break;
				}
				if (parallelResults.some((r) => r.exitCode !== 0 && r.exitCode !== -1)) {
					break;
				}
				const recoveryResult = parallelResults.find((result) => acceptanceNeedsRecovery(result.acceptance));
				if (recoveryResult?.acceptance) {
					statusPayload.error = acceptanceRecoveryMessage(recoveryResult.acceptance);
					writeStatusPayload();
					break;
				}
			} finally {
				if (worktreeSetup && !worktreeFinalized) await cleanupRemainingWorktree(worktreeSetup, stepIndex, groupStartFlatIndex);
			}
		} else {
			const seqStep = step as SubagentStep;
			if (timedOut) {
				results.push(timedOutStepResult(seqStep.agent, seqStep.context, seqStep.sessionName));
				flatIndex++;
				continue;
			}
			if (stopped) {
				results.push(stoppedStepResult(seqStep.agent, seqStep.context, seqStep.sessionName));
				flatIndex++;
				continue;
			}
			if (childStopRequests.has(flatIndex)) {
				results.push(childStopResult(flatIndex, seqStep.agent, seqStep.context));
				flatIndex++;
				continue;
			}
			if (interrupted) {
				results.push(pausedStepResult(seqStep.agent, seqStep.context, seqStep.sessionName));
				flatIndex++;
				continue;
			}
			let singleWorktreeSetup: WorktreeSetup | undefined;
			if (seqStep.worktree) {
				try {
					singleWorktreeSetup = await createWorktrees(cwd, `${id}-s${stepIndex}`, 1, omitUndefinedProperties({
						signal: setupSignal,
						deadlineAt: config.deadlineAt,
						agents: [seqStep.agent],
						labels: [seqStep.lane?.key ?? config.workflowKey ?? seqStep.outputName ?? seqStep.label],
						tasks: [seqStep.task],
						baseRef: config.baseRef,
						branchPrefix: config.worktreeBranchPrefix,
						setupHook: config.worktreeSetupHook
							? omitUndefinedProperties({ hookPath: config.worktreeSetupHook, timeoutMs: config.worktreeSetupHookTimeoutMs })
							: undefined,
						baseDir: config.worktreeBaseDir,
						onProgress: (progress) => {
							publishSetupUnknown(progress);
							const worktree = progress.setup.worktrees[0];
							if (worktree) {
								setStatusWorktreeReference(requiredStatusStep(statusPayload, flatIndex), worktree);
							}
							const pendingHandoff = writeWorktreeSetupHandoff({
								manifestPath: parallelHandoffPath(asyncDir),
								runId: id,
								mode: "single",
								source: "async",
								cwd,
								stepIndex,
								flatStartIndex: flatIndex,
								progress,
								laneBindings: handoffWorkflowKey || config.lane ? [{ index: flatIndex, taskIndex: 0, ...(handoffWorkflowKey ? { workflowKey: handoffWorkflowKey } : {}), ...(handoffChildRunId ? { runId: handoffChildRunId } : {}), ...(config.lane ? { lane: config.lane } : {}) }] : undefined,
							});
							if (!pendingHandoff) return;
							statusPayload.parallelHandoff = pendingHandoff;
							statusPayload.lastUpdate = Date.now();
							writeStatusPayload();
						},
					}));
				} catch (error) {
					if (error instanceof WorktreeSetupError) publishSetupUnknown(error.snapshot);
					if (config.deadlineAt !== undefined && Date.now() >= config.deadlineAt) timeoutRunner();
					const message = error instanceof Error ? error.message : String(error);
					if (childStopRequests.has(flatIndex)) markChildStopped(flatIndex);
					const statusStep = requiredStatusStep(statusPayload, flatIndex);
					statusStep.status = stopped || childStopRequests.has(flatIndex) ? "stopped" : interrupted ? "paused" : "failed";
					statusStep.error ??= message;
					statusStep.exitCode = interrupted ? 0 : 1;
					statusStep.endedAt = Date.now();
					results.push(stopped ? stoppedStepResult(seqStep.agent, seqStep.context, seqStep.sessionName)
						: childStopRequests.has(flatIndex) ? childStopResult(flatIndex, seqStep.agent, seqStep.context)
						: timedOut ? timedOutStepResult(seqStep.agent, seqStep.context, seqStep.sessionName)
						: interrupted ? pausedStepResult(seqStep.agent, seqStep.context, seqStep.sessionName)
						: { agent: seqStep.agent, output: message, error: message, exitCode: 1, success: false });
					statusPayload.error ??= message;
					writeStatusPayload();
					flatIndex++;
					break;
				}
			}
			if (singleWorktreeSetup && config.deadlineAt !== undefined && Date.now() >= config.deadlineAt) timeoutRunner();
			if (singleWorktreeSetup && (timedOut || stopped || interrupted || childStopRequests.has(flatIndex))) {
				await cleanupRemainingWorktree(singleWorktreeSetup, stepIndex, flatIndex);
				results.push(stopped ? stoppedStepResult(seqStep.agent, seqStep.context, seqStep.sessionName)
					: childStopRequests.has(flatIndex) ? childStopResult(flatIndex, seqStep.agent, seqStep.context)
					: timedOut ? timedOutStepResult(seqStep.agent, seqStep.context, seqStep.sessionName)
					: pausedStepResult(seqStep.agent, seqStep.context, seqStep.sessionName));
				if (interrupted) requiredStatusStep(statusPayload, flatIndex).status = "paused";
				flatIndex++;
				continue;
			}
			const singleCwd = singleWorktreeSetup?.worktrees[0]?.agentCwd ?? cwd;
			const stepStartTime = Date.now();
			statusPayload.currentStep = flatIndex;
			requiredStatusStep(statusPayload, flatIndex).status = "running";
			delete requiredStatusStep(statusPayload, flatIndex).activityState;
			delete statusPayload.activityState;
			resetStepLiveDetail(requiredStatusStep(statusPayload, flatIndex));
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "skills", seqStep.skills);
			requiredStatusStep(statusPayload, flatIndex).startedAt = stepStartTime;
			requiredStatusStep(statusPayload, flatIndex).lastActivityAt = stepStartTime;
			statusPayload.lastActivityAt = stepStartTime;
			statusPayload.lastUpdate = stepStartTime;
			statusPayload.outputFile = path.join(asyncDir, `output-${flatIndex}.log`);
			writeStatusPayload();

			appendJsonl(eventsPath, JSON.stringify({
				type: "subagent.step.started",
				ts: stepStartTime,
				runId: id,
				stepIndex: flatIndex,
				agent: seqStep.agent,
			}));

			flushPendingStepSteers(flatIndex);
			const executionStep = singleWorktreeSetup
				? { ...seqStep, cwd: singleCwd }
				: seqStep;
			let singleResult: Awaited<ReturnType<typeof runSingleStepWithTimeout>>;
			try {
				singleResult = await runSingleStepWithTimeout(executionStep, compactOptional<SingleStepContext>({
				previousOutput, placeholder, cwd: singleCwd, sessionEnabled,
				outputs: statusPayload.mode === "single" ? undefined : outputs,
				sessionDir: config.sessionDir,
				artifactsDir, artifactConfig, id,
				projectTrusted: config.projectTrusted,
				flatIndex, flatStepCount: Math.max(statusPayload.steps.length, 1),
				outputFile: path.join(asyncDir, `output-${flatIndex}.log`),
				piPackageRoot: config.piPackageRoot,
				childSessions,
				inheritedChildRuntime: config.inheritedChildRuntime,
				childIntercomTarget: config.childIntercomTargets?.[flatIndex],
				orchestratorIntercomTarget: config.controlIntercomTarget,
				nestedRoute: config.nestedRoute,
				capabilityCeiling: config.capabilityCeiling,
				runFanoutBudget: config.runFanoutBudget,
				registerInterrupt: (interrupt) => registerStepInterrupt(flatIndex, interrupt),
				registerTimeout: (interrupt) => registerStepTimeout(flatIndex, interrupt),
				registerStop: (stop) => registerStepStop(flatIndex, stop),
				registerSteer: (steer) => registerStepSteer(flatIndex, steer),
				onSteerOutcome: (request, delivery) => applySteerDelivery(request.id, flatIndex, delivery),
				timeoutSignal: timeoutAbortController.signal,
				stopSignal: stopAbortController.signal,
				timeoutMessage,
				stopMessage,
				toolTimeoutMs: seqStep.toolTimeoutMs ?? config.toolTimeoutMs,
				onAttemptStart: (attempt) => updateStepModel(flatIndex, attempt.model, attempt.thinking, attempt.contextLimit),
				onChildEvent: (event) => updateStepFromChildEvent(flatIndex, event),
				skipAcceptance: () => timedOut || stopped || childStopRequests.has(flatIndex),
				usageBudgetExhausted: continuationUsageBudgetExhausted,
				usageBudget: config.usageBudget,
				}), config.deadlineAt);
			} catch (error) {
				if (singleWorktreeSetup) await cleanupRemainingWorktree(singleWorktreeSetup, stepIndex, flatIndex);
				throw error;
			}
			if (seqStep.sessionFile) {
				latestSessionFile = seqStep.sessionFile;
			}

			previousOutput = singleResult.output;
			const childStopped = singleResult.stopped === true;
			results.push(omitUndefinedProperties({
				agent: singleResult.agent,
				...(singleResult.sessionName ? { sessionName: singleResult.sessionName } : {}),
				context: singleResult.context,
				agentContract: singleResult.agentContract,
				launchContractDigest: singleResult.launchContractDigest,
				launchResolvedExtensions: singleResult.launchResolvedExtensions,
				runtimeAcknowledgedExtensions: singleResult.runtimeAcknowledgedExtensions,
				output: stopped || childStopped ? stopMessage : timedOut ? singleResult.output || (timeoutMessage ?? "Subagent timed out.") : singleResult.output,
				outputState: singleResult.outputState,
				error: stopped || childStopped ? stopMessage : timedOut ? (timeoutMessage ?? "Subagent timed out.") : singleResult.error,
				success: !stopped && !childStopped && !timedOut && singleResult.interrupted !== true && singleResult.exitCode === 0 && singleResult.execution?.status !== "partial" && !acceptanceNeedsRecovery(singleResult.acceptance),
				exitCode: stopped || childStopped ? 1 : timedOut ? 1 : singleResult.interrupted === true ? 0 : singleResult.exitCode,
				sessionFile: singleResult.sessionFile,
				intercomTarget: singleResult.intercomTarget,
				model: singleResult.model,
				thinking: singleResult.thinking,
				requestedModel: singleResult.requestedModel,
				contextOverflow: singleResult.contextOverflow,
				totalCost: singleResult.totalCost,
				usage: singleResult.usage,
				artifactPaths: singleResult.artifactPaths,
				savedOutputPath: singleResult.savedOutputPath,
				outputSaveError: singleResult.outputSaveError,
				artifactOutputSaveFailed: singleResult.artifactOutputSaveFailed,
				transcriptPath: singleResult.transcriptPath,
				transcriptError: singleResult.transcriptError,
				effects: singleResult.effects,
				execution: singleResult.execution,
				review: singleResult.review,
				timeoutRecovery: singleResult.timeoutRecovery,
				structuredOutput: singleResult.structuredOutput,
				structuredOutputFailed: singleResult.structuredOutputFailed,
				structuredOutputPath: singleResult.structuredOutputPath,
				structuredOutputSchemaPath: singleResult.structuredOutputSchemaPath,
				acceptance: singleResult.acceptance,
				capabilityCeiling: singleResult.capabilityCeiling,
				capabilityAudit: singleResult.capabilityAudit,
				interrupted: singleResult.interrupted,
				timedOut: timedOut || singleResult.timedOut ? true : undefined,
				stopped: stopped || childStopped ? true : undefined,
				toolBudget: singleResult.toolBudget,
				toolBudgetBlocked: singleResult.toolBudgetBlocked,
			}));
			if (seqStep.outputName) {
				outputs[seqStep.outputName] = outputEntryFromAsyncResult({
					agent: singleResult.agent,
					output: singleResult.output,
					structuredOutput: singleResult.structuredOutput,
				}, stepIndex);
			}
			statusPayload.outputs = outputs;

			const cumulativeTokens = config.sessionDir ? parseSessionTokens(config.sessionDir) : null;
			let stepTokens: TokenUsage | null = cumulativeTokens
				? {
						input: cumulativeTokens.input - previousCumulativeTokens.input,
						output: cumulativeTokens.output - previousCumulativeTokens.output,
						total: cumulativeTokens.total - previousCumulativeTokens.total,
						...(cumulativeTokens.window !== undefined ? { window: cumulativeTokens.window } : {}),
						...(cumulativeTokens.windowPeak !== undefined ? { windowPeak: cumulativeTokens.windowPeak } : {}),
					}
				: null;
			if (cumulativeTokens) {
				previousCumulativeTokens = cumulativeTokens;
			} else {
				const fallbackTokens = tokenUsageFromUsage(singleResult.usage);
				const observedTokens = requiredStatusStep(statusPayload, flatIndex).tokens;
				stepTokens = fallbackTokens
					? { ...fallbackTokens, ...(observedTokens?.window !== undefined ? { window: observedTokens.window } : {}), ...(observedTokens?.windowPeak !== undefined ? { windowPeak: observedTokens.windowPeak } : {}) }
					: null;
				if (stepTokens) {
					previousCumulativeTokens = {
						input: previousCumulativeTokens.input + stepTokens.input,
						output: previousCumulativeTokens.output + stepTokens.output,
						total: previousCumulativeTokens.total + stepTokens.total,
						...(stepTokens.window !== undefined ? { window: stepTokens.window } : {}),
						...(previousCumulativeTokens.windowPeak !== undefined || stepTokens.windowPeak !== undefined
							? { windowPeak: Math.max(previousCumulativeTokens.windowPeak ?? 0, stepTokens.windowPeak ?? 0) }
							: {}),
					};
				}
			}

			const stepEndTime = Date.now();
			const childInterrupted = singleResult.interrupted === true;
			requiredStatusStep(statusPayload, flatIndex).status = stopped || childStopped ? "stopped" : timedOut ? "failed" : childInterrupted ? "paused" : acceptanceNeedsRecovery(singleResult.acceptance) ? "paused" : singleResult.execution?.status === "partial" ? "partial" : singleResult.exitCode === 0 ? "complete" : "failed";
			requiredStatusStep(statusPayload, flatIndex).endedAt = stepEndTime;
			requiredStatusStep(statusPayload, flatIndex).durationMs = stepEndTime - stepStartTime;
			requiredStatusStep(statusPayload, flatIndex).exitCode = stopped || childStopped ? 1 : timedOut ? 1 : childInterrupted ? 0 : singleResult.exitCode;
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "timedOut", timedOut || singleResult.timedOut ? true : undefined);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "stopped", stopped || childStopped ? true : undefined);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "toolBudget", singleResult.toolBudget);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "toolBudgetBlocked", singleResult.toolBudgetBlocked);
			if (singleResult.toolBudget) statusPayload.toolBudget = singleResult.toolBudget;
			if (singleResult.toolBudgetBlocked) statusPayload.toolBudgetBlocked = true;
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "sessionName", singleResult.sessionName);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "model", singleResult.model);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "thinking", resolveEffectiveThinking(singleResult.model, requiredStatusStep(statusPayload, flatIndex).thinking));
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "requestedModel", singleResult.requestedModel);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "contextOverflow", singleResult.contextOverflow);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "totalCost", singleResult.totalCost);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "error", stopped || childStopped ? stopMessage : timedOut ? (timeoutMessage ?? "Subagent timed out.") : singleResult.error);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "transcriptPath", singleResult.transcriptPath ?? requiredStatusStep(statusPayload, flatIndex).transcriptPath);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "transcriptError", singleResult.transcriptError);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "agentContract", singleResult.agentContract);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "launchResolvedExtensions", singleResult.launchResolvedExtensions);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "runtimeAcknowledgedExtensions", singleResult.runtimeAcknowledgedExtensions);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "effects", singleResult.effects);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "execution", singleResult.execution);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "review", singleResult.review);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "structuredOutput", singleResult.structuredOutput);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "structuredOutputPath", singleResult.structuredOutputPath);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "structuredOutputSchemaPath", singleResult.structuredOutputSchemaPath);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "acceptance", singleResult.acceptance);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "timeoutRecovery", singleResult.timeoutRecovery);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "capabilityCeiling", singleResult.capabilityCeiling);
			setOptionalProperty(requiredStatusStep(statusPayload, flatIndex), "capabilityAudit", singleResult.capabilityAudit);
			if (singleResult.capabilityCeiling) statusPayload.capabilityCeiling = singleResult.capabilityCeiling;
			if (singleResult.capabilityAudit) statusPayload.capabilityAudit = singleResult.capabilityAudit;
			if (stepTokens) {
				requiredStatusStep(statusPayload, flatIndex).tokens = stepTokens;
				statusPayload.totalTokens = { ...previousCumulativeTokens };
			}
			statusPayload.lastUpdate = stepEndTime;
			writeStatusPayload();
			appendCapabilityCeilingAppliedEvent(eventsPath, id, flatIndex, seqStep.agent, singleResult);

			appendJsonl(eventsPath, JSON.stringify({
				type: stopped || childStopped ? "subagent.step.stopped" : timedOut ? "subagent.step.failed" : childInterrupted ? "subagent.step.paused" : singleResult.exitCode === 0 ? "subagent.step.completed" : "subagent.step.failed",
				ts: stepEndTime,
				runId: id,
				stepIndex: flatIndex,
				agent: seqStep.agent,
				exitCode: stopped || childStopped ? 1 : timedOut ? 1 : childInterrupted ? 0 : singleResult.exitCode,
				durationMs: stepEndTime - stepStartTime,
				tokens: stepTokens,
			}));
			if (stopped || childStopped) appendTerminalChildStatusEvent(flatIndex, stepEndTime);
			if (singleWorktreeSetup && !singleResult.detached) {
				const setup = singleWorktreeSetup;
				await finalizeWorktree(setup, stepIndex, flatIndex, () => {
					const diffs = diffWorktrees(setup, [seqStep.agent], path.join(asyncDir, "worktree-diffs", `step-${stepIndex}`));
					const diffSummary = formatWorktreeDiffSummary(diffs);
					const manifestPath = parallelHandoffPath(asyncDir);
					const handoff = {
						manifestPath,
						runId: id,
						mode: "single" as const,
						source: "async" as const,
						cwd,
						stepIndex,
						flatStartIndex: flatIndex,
						setup,
						diffs,
						results: [{
							agent: singleResult.agent,
							...(handoffWorkflowKey ? { workflowKey: handoffWorkflowKey } : {}),
							...(handoffChildRunId ? { runId: handoffChildRunId } : {}),
							...(config.lane ? { lane: config.lane } : {}),
							status: singleResult.stopped ? "stopped" as const : singleResult.interrupted || acceptanceNeedsRecovery(singleResult.acceptance) ? "paused" as const : singleResult.exitCode === 0 ? "completed" as const : "failed" as const,
							summary: singleResult.output || singleResult.error || "(no output)",
							...(singleResult.artifactPaths?.outputPath ? { outputPath: singleResult.artifactPaths.outputPath } : {}),
							...(singleResult.structuredOutput !== undefined ? { structuredOutput: singleResult.structuredOutput } : {}),
							...(singleResult.structuredOutputPath ? { structuredOutputPath: singleResult.structuredOutputPath } : {}),
							...(singleResult.sessionFile ? { sessionPath: singleResult.sessionFile } : {}),
						}],
					};
					try {
						writeParallelHandoffGroup(handoff);
						const cleanup = cleanupWorktrees(setup, {
							kind: "preserve",
							capturedDiffs: diffs,
							handoffManifestPath: manifestPath,
							...(config.parentWorkflowRunId && singleResult.sessionFile && fs.existsSync(singleResult.sessionFile) && !singleResult.stopped
								? { cleanupBlocker: "retained child resume requires managed worktree cwd" }
								: {}),
						});
						statusPayload.parallelHandoff = writeParallelHandoffGroup({ ...handoff, cleanup });
						previousOutput = [previousOutput, diffSummary, formatParallelHandoffReference(statusPayload.parallelHandoff)].filter(Boolean).join("\n\n");
					} catch (error) {
						previousOutput = [previousOutput, diffSummary, formatParallelHandoffError(error)].filter(Boolean).join("\n\n");
					}
					writeStatusPayload();
				});
			}

			flatIndex++;
			if (isAgentContract(seqStep.agentContract) && seqStep.gateOn === "acceptance" && acceptanceBlocksGate(singleResult.acceptance)) {
				statusPayload.error = singleResult.acceptance && acceptanceNeedsRecovery(singleResult.acceptance)
					? acceptanceRecoveryMessage(singleResult.acceptance)
					: (singleResult.acceptance ? acceptanceFailureMessage(singleResult.acceptance) : undefined) ?? "Chain acceptance gate rejected the step.";
				writeStatusPayload();
				break;
			}
			if (singleResult.acceptance && acceptanceNeedsRecovery(singleResult.acceptance)) {
				statusPayload.error = acceptanceRecoveryMessage(singleResult.acceptance);
				writeStatusPayload();
				break;
			}
			if (singleResult.exitCode !== 0) {
				break;
			}
		}
	}

	let summary = results.map((r) => `${r.agent}:\n${r.output || (r.exitCode !== 0 ? r.error : undefined) || "(no output)"}`).join("\n\n");
	let truncated = false;

	if (maxOutput) {
		const config = { ...DEFAULT_MAX_OUTPUT, ...maxOutput };
		const lastArtifactPath = results[results.length - 1]?.artifactPaths?.outputPath;
		const truncResult = truncateOutput(summary, config, lastArtifactPath);
		if (truncResult.truncated) {
			summary = truncResult.text;
			truncated = true;
		}
	}

	const resultMode = config.resultMode ?? statusPayload.mode;
	const singleRuntimeAcknowledgedExtensions = results.length === 1 ? results[0]?.runtimeAcknowledgedExtensions : undefined;
	const totalCost = results.reduce<CostSummary>((sum, result) => ({
		inputTokens: sum.inputTokens + (result.totalCost?.inputTokens ?? 0),
		outputTokens: sum.outputTokens + (result.totalCost?.outputTokens ?? 0),
		costUsd: sum.costUsd + (result.totalCost?.costUsd ?? 0),
	}), { inputTokens: 0, outputTokens: 0, costUsd: 0 });
	const finalTotalCost = totalCost.inputTokens > 0 || totalCost.outputTokens > 0 || totalCost.costUsd > 0 ? totalCost : undefined;
	const finalFlatAgents = statusPayload.steps.map((step) => step.agent);
	const agentName = finalFlatAgents.length === 1
		? finalFlatAgents[0]!
		: resultMode === "parallel"
			? `parallel:${finalFlatAgents.join("+")}`
			: `chain:${finalFlatAgents.join("->")}`;
	if (activityTimer) {
		clearInterval(activityTimer);
		activityTimer = undefined;
	}
	if (timeoutTimer) {
		clearTimeout(timeoutTimer);
		timeoutTimer = undefined;
	}
	if (checkpointTimer) {
		clearTimeout(checkpointTimer);
		checkpointTimer = undefined;
	}
	if (!timedOut && !stopped && !interrupted && config.timeoutMs !== undefined && timeoutMessage !== undefined && results.some((result) => result.timedOut === true && result.error?.startsWith(timeoutMessage))) {
		timedOut = true;
	}
	disposeControlInbox();
	try {
		closeStopInbox(asyncDir);
	} catch (error) {
		// Result publication must not depend on the marker; without it a late stop is accepted as before.
		appendJsonl(eventsPath, JSON.stringify({ type: "subagent.run.stop_inbox_close_failed", ts: Date.now(), runId: id, message: error instanceof Error ? error.message : String(error) }));
	}
	for (const request of consumeStopRequestPayloads(asyncDir)) stopChildStep(request);
	const signalTerminated = !stopped && !timedOut && !interrupted && results.some((result) => result.exitCode !== 0 && isUnexplainedProcessSignal(omitUndefinedProperties({
		processSignal: result.processSignal,
		interrupted: result.interrupted,
		timedOut: result.timedOut,
		stopped: result.stopped,
	})));
	const partialWithEvidence = !stopped && !signalTerminated && !timedOut && !usageBudgetExceeded && !interrupted && results.some(partialEvidenceResult) && !results.some(concreteFailureResult);
	// Flush while still nonterminal; deferred status retries retain that state snapshot.
	statusWriteCoalescer.flush(statusPath);
	const publication = new Promise<void>((resolve, reject) => {
		finalResultPublication = { resolve, reject };
	});
	statusPayload.state = stopped || signalTerminated ? "stopped" : timedOut || usageBudgetExceeded ? "failed" : interrupted ? "paused" : results.every((r) => r.success) ? "complete" : partialWithEvidence ? "partial" : "failed";
	closeSteerInbox(asyncDir, statusPayload.state, (filePath, payload) => runPersistence.write(filePath, payload));
	for (const request of consumeSteerRequests(asyncDir)) deliverSteerRequest(request);
	const effectiveSessionFile = latestSessionFile;
	const steeringLifecycle = steeringStatus(statusPayload);
	for (const request of steeringLifecycle.recent) {
		let changed = false;
		for (const target of request.targets) {
			if (target.state !== "scheduled" && target.state !== "routed" && target.state !== "queued") continue;
			changed = true;
			const reason = target.state === "queued" ? unconsumedSteerReason() : "child terminated before steering delivery";
			updateSteeringLifecycleTarget(request.id, target.index, "failed", Date.now(), { reason });
			markSteeringAttention(target.index);
			emitSteeringEvent("subagent.steer.failed", { type: "steer", id: request.id, ts: request.requestedAt, message: reason }, target.index, { reason });
		}
		if (changed) emitTerminalSteeringNotice(request.id, `Steering failed for run ${id}: child terminated before delivery.`);
	}
	const runEndedAt = Date.now();
	delete statusPayload.activityState;
	if (stopped) {
		statusPayload.stopped = true;
		statusPayload.error = stopMessage;
	} else if (signalTerminated && !statusPayload.error) {
		setOptionalProperty(statusPayload, "error", results.find((result) => result.processSignal)?.error);
	}
	if (timedOut) {
		statusPayload.timedOut = true;
		statusPayload.error = timeoutMessage ?? "Subagent timed out.";
	}
	if (usageBudgetExceeded && statusPayload.usageBudget && !statusPayload.error) {
		statusPayload.error = usageBudgetExceededMessage(statusPayload.usageBudget);
	}
	if (partialWithEvidence) {
		const partialResult = results.find(partialEvidenceResult);
		statusPayload.activityState = "needs_attention";
		statusPayload.error = partialResult?.acceptance && acceptanceNeedsRecovery(partialResult.acceptance)
			? acceptanceRecoveryMessage(partialResult.acceptance)
			: partialResult?.error ?? statusPayload.error;
		// Status steps and results are not index-aligned for groups, so key
		// recovery on each step's own acceptance ledger.
		for (const step of statusPayload.steps) {
			const needsRecovery = acceptanceNeedsRecovery(step.acceptance);
			if (needsRecovery) step.status = "paused";
			if (step.status === "failed" || step.status === "partial" || needsRecovery) step.activityState = "needs_attention";
		}
	}
	statusPayload.endedAt = runEndedAt;
	statusPayload.lastUpdate = runEndedAt;
	setOptionalProperty(statusPayload, "sessionFile", effectiveSessionFile);
	if (singleRuntimeAcknowledgedExtensions) statusPayload.runtimeAcknowledgedExtensions = singleRuntimeAcknowledgedExtensions;
	setOptionalProperty(statusPayload, "totalCost", finalTotalCost);
	setOptionalProperty(statusPayload, "usageBudget", usageBudgetState(config.usageBudget, currentUsageTotals()));
	if ((statusPayload.state === "failed" || statusPayload.state === "partial") && !statusPayload.error) {
		const concreteFailure = results.find(concreteFailureResult);
		const failedStep = concreteFailure ? undefined : statusPayload.steps.find((s) => s.status === "failed");
		if (concreteFailure?.error) statusPayload.error = concreteFailure.error;
		if (failedStep?.agent) {
			statusPayload.error = `Step failed: ${failedStep.agent}`;
		}
	}
	let childSessionDisposal: Promise<void> | undefined;
	const disposeChildSessions = (): Promise<void> => childSessionDisposal ??= childSessions.dispose()
		.catch((error: unknown) => console.error("Failed to dispose runner child sessions:", error));
	try {
		runPersistence.write(resultPath, {
			lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
			id,
			agent: agentName,
			mode: resultMode,
			success: statusPayload.state === "complete",
			state: statusPayload.state,
			summary: stopped ? stopMessage : signalTerminated ? (statusPayload.error ?? "Subagent process terminated by signal.") : timedOut ? (timeoutMessage ?? "Subagent timed out.") : usageBudgetExceeded ? (statusPayload.error ?? "Usage budget exhausted.") : interrupted ? "Paused after interrupt. Waiting for explicit next action." : statusPayload.state === "partial" ? (statusPayload.error ?? summary) : summary,
			...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
			...(config.deadlineAt !== undefined ? { deadlineAt: config.deadlineAt } : {}),
			...(statusPayload.toolBudget ? { toolBudget: statusPayload.toolBudget } : {}),
			...(statusPayload.toolBudgetBlocked ? { toolBudgetBlocked: true } : {}),
			...(statusPayload.usageBudget ? { usageBudget: statusPayload.usageBudget } : {}),
			...(stopped ? { stopped: true, error: stopMessage } : timedOut ? { timedOut: true, error: timeoutMessage ?? "Subagent timed out." } : usageBudgetExceeded ? { error: statusPayload.error ?? "Usage budget exhausted." } : {}),
			results: results.map((r) => omitUndefinedProperties({
				agent: r.agent,
				...(r.sessionName ? { sessionName: r.sessionName } : {}),
				context: r.context,
				output: r.output,
				outputState: r.outputState,
				error: r.error,
				success: r.success,
				skipped: r.skipped || undefined,
				interrupted: r.interrupted || undefined,
				timedOut: r.timedOut || undefined,
				stopped: r.stopped || undefined,
				processSignal: r.processSignal || undefined,
				toolBudget: r.toolBudget,
				toolBudgetBlocked: r.toolBudgetBlocked || undefined,
				sessionFile: r.sessionFile,
				intercomTarget: r.intercomTarget,
				model: r.model,
				thinking: r.thinking,
				requestedModel: r.requestedModel,
				contextOverflow: r.contextOverflow,
				totalCost: r.totalCost,
				usage: r.usage,
				artifactPaths: r.artifactPaths,
				savedOutputPath: r.savedOutputPath,
				outputSaveError: r.outputSaveError,
				artifactOutputSaveFailed: r.artifactOutputSaveFailed,
				metadataSaveError: r.metadataSaveError,
				truncated: r.truncated,
				transcriptPath: r.transcriptPath,
				transcriptError: r.transcriptError,
				agentContract: r.agentContract,
				launchContractDigest: r.launchContractDigest,
				launchResolvedExtensions: r.launchResolvedExtensions,
				runtimeAcknowledgedExtensions: r.runtimeAcknowledgedExtensions,
				execution: r.execution,
				review: r.review,
				effects: r.effects,
				structuredOutput: r.structuredOutput,
				structuredOutputFailed: r.structuredOutputFailed,
				structuredOutputPath: r.structuredOutputPath,
				structuredOutputSchemaPath: r.structuredOutputSchemaPath,
				acceptance: r.acceptance,
				timeoutRecovery: r.timeoutRecovery,
				capabilityCeiling: r.capabilityCeiling,
				capabilityAudit: r.capabilityAudit,
			})),
			outputs,
			workflowGraph: statusPayload.workflowGraph,
			parallelHandoff: statusPayload.parallelHandoff,
			capabilityCeiling: statusPayload.capabilityCeiling,
			capabilityAudit: statusPayload.capabilityAudit,
			...(config.parentWorkflowRunId ? { parentWorkflowRunId: config.parentWorkflowRunId } : {}),
			...(config.workflowKey ? { workflowKey: config.workflowKey } : {}),
			exitCode: statusPayload.state === "complete" || statusPayload.state === "paused" ? 0 : 1,
			timestamp: runEndedAt,
			durationMs: runEndedAt - overallStartTime,
			totalTokens: statusPayload.totalTokens,
			totalCost: finalTotalCost,
			usageBudget: statusPayload.usageBudget,
			truncated,
			artifactsDir,
			cwd,
			asyncDir,
			launchContractDigest: config.launchContractDigest,
			launchResolvedExtensions: config.launchResolvedExtensions,
			runtimeAcknowledgedExtensions: singleRuntimeAcknowledgedExtensions,
			sessionId: config.sessionId,
			completionOwnerId: config.completionOwnerId,
			sessionFile: effectiveSessionFile,
			...(taskIndex !== undefined && { taskIndex }),
			...(totalTasks !== undefined && { totalTasks }),
		}, (filePath, payload) => { writeAsyncResultFile(filePath, payload as Record<string, unknown>); });
		// Only capacity deferral releases settled sessions before terminal publication.
		if (!finalResultCommitted) await Promise.all([publication, disposeChildSessions()]);
	} catch (err) {
		const message = `Failed to write result file ${resultPath}: ${err instanceof Error ? err.message : String(err)}`;
		console.error(message, err);
		statusPayload.state = "failed";
		statusPayload.error = message;
		statusPayload.lastUpdate = Date.now();
	} finally {
		finalResultPublication = undefined;
	}
	writeStatusPayload();
	appendJsonl(
		eventsPath,
		JSON.stringify({
			type: "subagent.run.completed",
			lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
			ts: runEndedAt,
			runId: id,
			status: statusPayload.state,
			durationMs: runEndedAt - overallStartTime,
			totalTokens: statusPayload.totalTokens,
			totalCost: finalTotalCost,
			usageBudget: statusPayload.usageBudget,
		}),
	);
	writeRunLog(logPath, omitUndefinedProperties({
		id,
		mode: statusPayload.mode,
		cwd,
		startedAt: overallStartTime,
		endedAt: runEndedAt,
		steps: statusPayload.steps.map((step) => omitUndefinedProperties({
			agent: step.agent,
			status: step.status,
			durationMs: step.durationMs,
		})),
		summary,
		truncated,
		artifactsDir,
		sessionFile: effectiveSessionFile,
	}), (filePath, content) => runPersistence.write(filePath, { content }, (_path, payload) => {
		fs.writeFileSync(_path, (payload as { content: string }).content, "utf-8");
	}));
	// Preserve normal-success disposal ordering, then drain remaining persistence retries.
	await disposeChildSessions();
	while (runPersistence.pendingCount() + indexPersistence.pendingCount() > 0) {
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	runPersistence.dispose();
	indexPersistence.dispose();
	if (config.runnerProcessInstanceId) {
		// Children run inside this process, so no step has writer processes to prove terminal.
		const writers: Record<string, PiWriterProcessInstanceExit[]> = {};
		const expectedWriters: Record<string, number> = {};
		for (const index of results.keys()) {
			writers[String(index)] = [];
			expectedWriters[String(index)] = 0;
		}
		const candidate: ProcessTerminalCandidate = {
			version: 1,
			runId: id,
			runnerProcessInstanceId: config.runnerProcessInstanceId,
			writers,
			expectedWriters,
			...(config.revivalLease?.sessionFile ? { sessionFile: config.revivalLease.sessionFile } : {}),
			...(config.revivalLeaseToken ? { revivalLeaseToken: config.revivalLeaseToken } : {}),
		};
		try {
			writeProcessTerminalCandidate(asyncDir, candidate);
		} catch (error) {
			console.error(`Failed to write process-terminal candidate for '${id}':`, error);
		}
	}
}

/** Heavy execution entry loaded by the bootstrap only after startup commits. */
export async function runConfiguredSubagentExecution(config: SubagentRunConfig, options?: DefaultChildSessionFactoryOptions): Promise<void> {
	let childSessions: ChildSessionFactory;
	try {
		// Detached Node runners do not receive Pi's CLI dispatcher setup. Binary
		// hosts install the same dispatcher before entering the shared bootstrap.
		if (!options?.loadPiCodingAgent) installRunnerHttpDispatcher({ agentDir: getAgentDir(), cwd: process.cwd() });
		childSessions = await loadRunnerChildSessionFactory(config, options);
	} catch (error) {
		try {
			persistRunnerStartupFailure({
				asyncDir: config.asyncDir,
				runId: config.id,
				runnerProcessInstanceId: config.runnerProcessInstanceId ?? "unknown-runner-instance",
				message: `Subagent runner startup failed: ${error instanceof Error ? error.message : String(error)}`,
				...(config.sessionId ? { sessionId: config.sessionId } : {}),
				...(config.completionOwnerId ? { completionOwnerId: config.completionOwnerId } : {}),
				candidate: {
					...(config.revivalLease?.sessionFile ? { sessionFile: config.revivalLease.sessionFile } : {}),
					...(config.revivalLeaseToken ? { revivalLeaseToken: config.revivalLeaseToken } : {}),
				},
			});
		} catch (persistenceError) {
			console.error("Failed to persist runner setup failure:", persistenceError);
		}
		throw error;
	}
	try {
		await runSubagent(config, childSessions);
	} finally {
		try {
			await childSessions.dispose();
		} catch (error) {
			console.error("Failed to dispose runner child sessions:", error);
		}
	}
}
