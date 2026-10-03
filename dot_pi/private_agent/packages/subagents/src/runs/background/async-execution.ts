/**
 * Async execution logic for subagent tool
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../agents/agents.ts";
import { createAtomicJsonWriter, writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { childCacheRetentionEnv } from "../../shared/child-cache-retention.ts";
import { buildEffectiveSystemPrompt } from "../shared/effective-system-prompt.ts";
import { currentCompletionOwnerId } from "../../shared/completion-owner.ts";
import { applyThinkingSuffix, projectLaunchResolvedChildExtensions, resolvePiLaunchToolPlan } from "../shared/child-tool-plan.ts";
import { injectSingleOutputInstruction, normalizeSingleOutputOverride, resolveSingleOutputPath, validateFileOnlyOutputMode } from "../shared/single-output.ts";
import { resolveExistingReadPaths } from "../../shared/settings.ts";
import { isParallelGroup, type RunnerStep } from "../shared/parallel-utils.ts";
import type { ContextMode } from "../shared/context-mode.ts";
import { PI_CODING_AGENT_PACKAGE, resolveBunPiExecutable, resolveInstalledPiPackageRoot, resolvePiPackageRoot } from "../shared/pi-spawn.ts";
import { JITI_ALIAS_ENV, resolveHostPeerAliases } from "./runner-aliases.ts";
import { preflightLaunchCwd } from "../shared/launch-cwd.ts";
import { resolveNodeExecutable } from "../../shared/node-executable.ts";
import { backgroundProcessOptions } from "../shared/background-process-options.ts";
import { resolveSkillsWithFallback } from "../../agents/skills.ts";
import { PI_CODING_AGENT_PACKAGE_ROOT_ENV, PROMPT_REDACTED, resolveChildCwd } from "../../shared/utils.ts";
import { resolveModelOrigin, resolveModelSelection, resolveSubagentModelOverride, type AvailableModelInfo, type ModelOrigin, type ParentModel } from "../shared/model-resolution.ts";
import { resolveToolTimeoutMs, toolTimeoutFromEnv } from "../shared/tool-timeout.ts";
import { resolveModelScopesForAgent, type ModelScopeConfig } from "../shared/model-scope.ts";
import { findModelInfo, resolveEffectiveThinking } from "../../shared/model-info.ts";
import { assertThinkingWithinCeiling, intersectThinkingCeilings, type ThinkingLevel } from "../../shared/thinking-ceiling.ts";
import { resolveExpectedWorktreeAgentCwd } from "../shared/worktree.ts";
import { createStructuredOutputRuntime } from "../shared/structured-output.ts";
import { resolveAcceptanceReportMode, resolveEffectiveAcceptance, validateAcceptanceInput } from "../shared/acceptance.ts";
import { createRunFanoutBudget, writeRunFanoutBudgetDescriptor } from "../shared/run-fanout-budget.ts";
import {
	type AcceptanceInput,
	type AgentContract,
	type AsyncStatus,
	type ArtifactConfig,
	type Details,
	type IntercomBridgeConfig,
	type JsonSchemaObject,
	type MaxOutputConfig,
	type NestedRouteInfo,
	type ResolvedControlConfig,
	type ResolvedToolBudget,
	type RunFanoutBudgetDescriptor,
	type ToolBudgetConfig,
	type SubagentRunMode,
	type SteeringRecoveryDescriptor,
	type WorkflowLaneMetadata,
	type UsageBudgetConfig,
	DIRS,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
	TEMP_ROOT_DIR,
	getAsyncConfigPath,
	resolveChildMaxSubagentDepth,
} from "../../shared/types.ts";
import { inheritedNestedParentAddressOf, inheritedNestedRouteOf, nestedResultsPath, nestedSummaryFromAsyncStatus, writeNestedEvent } from "../shared/nested-events.ts";
import { SUBAGENT_PARENT_SESSION_ENV, type ChildRuntimeConfig } from "../shared/child-runtime-config.ts";
import { childSessionFactoryModule } from "../shared/child-session.ts";
import { inheritedChildRuntime } from "../shared/child-launch.ts";
import { resultFilePath } from "./result-files.ts";
import { updateActiveRunIndex } from "./active-run-index.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { usageBudgetState } from "../shared/usage-budget.ts";
import type { SessionLeaseRequest } from "../shared/session-lease.ts";
import { finalizeProcessTerminal, initializeProcessTerminal, readProcessTerminal } from "./process-terminal.ts";
import { persistRunnerStartupFailure } from "./runner-startup-failure.ts";
import type { ActiveAsyncCapacityHandle } from "./active-async-capacity.ts";
import { currentPidNamespaceScope } from "./pid-namespace.ts";
import { SUBAGENT_PROCESS_TERMINAL_EVENT } from "../../shared/types.ts";
import { assertAgentAllowedByCapabilityCeiling, intersectSubagentCapabilityCeilings, type ResolvedSubagentCapabilityCeiling } from "../shared/capability-ceiling.ts";
import { resolveLaunchBinding } from "../../shared/launch-contract.ts";
import { resolvePermissionRules, type PermissionConfig } from "../shared/permissions.ts";
import { normalizeExtensionBindings, omitExtensionBindingsEnv, type ExtensionBindings } from "../shared/extension-bindings.ts";
import { omitGitRoutingEnv } from "../shared/git-environment.ts";
import { assertWorkflowLaneKey, normalizeWorkflowLaneMetadata } from "../shared/lane-metadata.ts";

const require = nodeModule.createRequire(import.meta.url);
const piPackageRoot = resolveAsyncPiPackageRoot();

/**
 * The detached runner resolves the same host package the foreground
 * `resolvePiCliScript` path resolves, so an explicit
 * `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT` override must be honored here
 * too. Precedence mirrors the foreground resolver: argv-based discovery wins
 * first (the foreground returns the argv script before any candidate), the
 * environment override is consulted when that discovery cannot identify the
 * host (wrapper installs, non-standard layouts), and the
 * package-manager entry is last. Without the override, such hosts fail
 * closed with "neither is available" while foreground children launch fine.
 */
function resolveAsyncPiPackageRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return resolvePiPackageRoot() || env[PI_CODING_AGENT_PACKAGE_ROOT_ENV]?.trim() || resolveInstalledPiPackageRoot();
}

function resolveJitiCliFromPackageJson(packageJsonPath: string): string | undefined {
	if (!fs.existsSync(packageJsonPath)) return undefined;
	const packageRoot = path.dirname(packageJsonPath);
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
		bin?: string | Record<string, string>;
	};
	const binField = pkg.bin;
	const binPath = typeof binField === "string"
		? binField
		: binField?.jiti ?? Object.values(binField ?? {})[0];
	const candidates = [binPath, "lib/jiti-cli.mjs"].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		const cliPath = path.resolve(packageRoot, candidate);
		if (fs.existsSync(cliPath)) return cliPath;
	}
	return undefined;
}

function resolveJitiCliPath(): string | undefined {
	const candidates: Array<() => string | undefined> = [
		() => require.resolve("jiti/package.json"),
		() => piPackageRoot
			? nodeModule.createRequire(path.join(piPackageRoot, "package.json")).resolve("jiti/package.json")
			: undefined,
		() => {
			if (!process.argv[1]) return undefined;
			const piEntry = fs.realpathSync(process.argv[1]);
			return nodeModule.createRequire(piEntry).resolve("jiti/package.json");
		},
		() => piPackageRoot ? path.join(piPackageRoot, "node_modules", "jiti", "package.json") : undefined,
	];
	for (const candidate of candidates) {
		try {
			const packageJsonPath = candidate();
			if (!packageJsonPath) continue;
			const cliPath = resolveJitiCliFromPackageJson(packageJsonPath);
			if (cliPath) return cliPath;
		} catch {
			// Candidate not available in this install, continue probing.
		}
	}
	return undefined;
}

const jitiCliPath = resolveJitiCliPath();
const asyncRunnerSourcePath = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	`subagent-runner-bootstrap${path.extname(fileURLToPath(import.meta.url))}`,
);
const sourceUnderNodeModules = asyncRunnerSourcePath.split(path.sep).some((segment) => segment.toLowerCase() === "node_modules");
function supportsNativeRunner(nodeExecutable: string): boolean {
	return Boolean(process.features.typescript)
	&& typeof nodeModule.registerHooks === "function"
	&& nodeExecutable === process.execPath
	&& !sourceUnderNodeModules;
}

interface AsyncExecutionContext {
	pi: ExtensionAPI;
	cwd: string;
	currentSessionId: string;
	completionOwnerId?: string;
	/** Parent session id used by permission-system ask forwarding. */
	parentSessionId?: string;
	permissions?: PermissionConfig;
	currentModelProvider?: string;
	currentModel?: ParentModel;
	scopedModelIds?: string[];
	/** Optional model-scope enforcement resolved from subagent settings. */
	modelScope?: ModelScopeConfig;
	modelResponseAliases?: Record<string, string[]>;
	/** Whether the parent session has an interactive UI. */
	interactive?: boolean;
	/** The executor's own child runtime when the launch comes from an in-process child. */
	childRuntime?: ChildRuntimeConfig;
	/** The launching session's project trust; undefined when the host has no trust concept. */
	projectTrusted?: boolean;
}

interface AsyncSingleParams {
	agent: string;
	task?: string;
	/** Raw caller-facing goal used only by the started event. */
	goal?: string;
	agentConfig: AgentConfig;
	/** Agent contract before per-run bridge injection, used only for recovery persistence. */
	recoveryAgentConfig?: AgentConfig;
	ctx: AsyncExecutionContext;
	cwd?: string;
	requestedCwd?: string;
	maxOutput?: MaxOutputConfig;
	artifactsDir?: string;
	artifactConfig: ArtifactConfig;
	sessionRoot?: string;
	sessionDir?: string;
	sessionFile?: string;
	revivalLease?: SessionLeaseRequest;
	context?: ContextMode;
	skills?: string[];
	output?: string | boolean;
	reads?: string[] | false;
	outputMode?: "inline" | "file-only";
	outputBaseDir?: string;
	outputClaimPath?: string;
	agentContract?: AgentContract;
	structuredOutputSchema?: JsonSchemaObject;
	modelOverride?: string;
	modelOverrideFromParent?: boolean;
	modelOrigin?: ModelOrigin;
	fast?: boolean;
	thinkingOverride?: AgentConfig["thinking"];
	availableModels?: AvailableModelInfo[];
	maxSubagentDepth: number;
	waitToolEnabled?: boolean;
	waitToolDefaultTimeoutMs?: number;
	worktreeSetupHook?: string;
	worktreeSetupHookTimeoutMs?: number;
	worktreeBaseDir?: string;
	baseRef?: string;
	worktreeBranchPrefix?: string;
	worktree?: boolean;
	controlConfig?: ResolvedControlConfig;
	intercomBridge?: IntercomBridgeConfig;
	controlIntercomTarget?: string;
	childIntercomTarget?: (agent: string, index: number) => string | undefined;
	nestedRoute?: NestedRouteInfo;
	acceptance?: AcceptanceInput;
	timeoutMs?: number;
	absoluteDeadlineAt?: number;
	/** Optional per-call hard toolTimeoutMs override (highest precedence). */
	toolTimeoutMs?: number;
	/** Steer the child to checkpoint and stop this many ms before the run deadline (resolved call param ?? config). */
	checkpointBeforeDeadlineMs?: number;
	toolBudget?: ResolvedToolBudget | ToolBudgetConfig;
	usageBudget?: UsageBudgetConfig;
	configToolBudget?: ResolvedToolBudget;
	/** Global config.toolTimeoutMs (third precedence, after agent frontmatter). */
	configToolTimeoutMs?: number;
	/** PI_SUBAGENT_TOOL_TIMEOUT_MS override (lowest precedence). */
	toolTimeoutMsEnv?: string | undefined;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	thinkingCeiling?: ThinkingLevel;
	runFanoutBudget?: RunFanoutBudgetDescriptor;
	parentWorkflowRunId?: string;
	workflowKey?: string;
	lane?: WorkflowLaneMetadata;
	workflowAwaitAsync?: boolean;
	activeAsyncCapacity?: ActiveAsyncCapacityHandle;
	extensionBindings?: ExtensionBindings;
}

interface AsyncExecutionResult {
	content: Array<{ type: "text"; text: string }>;
	details: Details;
	isError?: boolean;
}

export function formatAsyncStartedMessage(headline: string, interactive: boolean): string {
	const guidance = interactive
		? [
			"The async run is detached and running in the background.",
			"You are in an interactive session. Return control to the user now; Pi will wake you through the native completion notification when this subagent completes or needs attention. Do not run sleep/polling loops to wait for this async subagent; it does not need a wait call.",
			"Use bg_wait only for provider, detached, or other background work that lacks a native completion notification.",
			"If the current turn must receive results from work without a native notification before it ends, call blocking bg_wait(); ordinary async subagent runs do not need a wait call because their completion is delivered natively.",
			"Otherwise, continue any independent work or return control to the user. Use subagent({ action: \"status\", id: \"...\" }) for a one-shot status/result or to inspect a blocked/stale run, never as a wait loop.",
		]
		: [
			"The async run is detached. Do not run sleep timers or polling loops just to wait for it.",
			"This is a non-interactive run: Pi auto-drains current-session subagent work at agent_end so detached children are not abandoned. Use bg_wait only when this turn must receive provider, detached, or other background-work results that have no native completion notification.",
			"Use subagent({ action: \"status\", id: \"...\" }) when you need a one-shot status/result or to inspect a blocked/stale run; do not poll in a loop.",
		];
	return [headline, "", ...guidance].join("\n");
}

/** Check whether detached async execution has a supported runtime. */
export function isAsyncAvailable(): boolean {
	return resolveBunPiExecutable() !== undefined || supportsNativeRunner(resolveNodeExecutable()) || jitiCliPath !== undefined;
}

export function resolveAsyncRunnerLogPaths(cfg: object): { stdoutPath: string; stderrPath: string } | undefined {
	const asyncDir = typeof (cfg as { asyncDir?: unknown }).asyncDir === "string"
		? (cfg as { asyncDir: string }).asyncDir
		: undefined;
	if (!asyncDir) return undefined;
	return {
		stdoutPath: path.join(asyncDir, "runner.stdout.log"),
		stderrPath: path.join(asyncDir, "runner.stderr.log"),
	};
}

function closeFd(fd: number | undefined): void {
	if (fd === undefined) return;
	try {
		fs.closeSync(fd);
	} catch {
		// Best-effort cleanup; child process already owns its duplicated stdio fd.
	}
}

/**
 * Spawn the async runner process
 */
const RUNNER_STARTUP_TIMEOUT_MS = 10_000;
type RunnerStartupState = "ready" | "acknowledged" | "confirmed";

type RunnerStartupWaitResult =
	| { ok: true; token: string }
	| { ok: false; error: string; startupDidNotProceed?: boolean };

function waitForStartupInterval(delayMs = 20): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readRunnerStartup(startupPath: string, expectedState: RunnerStartupState, expectedToken?: string): RunnerStartupWaitResult | undefined {
	if (!fs.existsSync(startupPath)) return undefined;
	try {
		const payload = JSON.parse(fs.readFileSync(startupPath, "utf-8")) as { state?: unknown; token?: unknown; error?: unknown };
		if (payload.state === "error" && typeof payload.error === "string") return { ok: false, error: payload.error, startupDidNotProceed: true };
		if (payload.state !== expectedState) return undefined;
		if (typeof payload.token !== "string" || (expectedToken !== undefined && payload.token !== expectedToken)) {
			return { ok: false, error: `Async runner wrote an invalid ${expectedState} startup handshake: ${startupPath}`, startupDidNotProceed: true };
		}
		return { ok: true, token: payload.token };
	} catch (error) {
		return { ok: false, error: `Failed to read async runner startup handshake '${startupPath}': ${error instanceof Error ? error.message : String(error)}`, startupDidNotProceed: true };
	}
}

async function waitForRunnerStartup(startupPath: string, expectedState: RunnerStartupState, timeoutMs: number, expectedToken?: string, processClosed?: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>): Promise<RunnerStartupWaitResult> {
	const confirmOpen = async (result: RunnerStartupWaitResult): Promise<RunnerStartupWaitResult> => {
		if (!processClosed || result.ok === false) return result;
		const outcome = await Promise.race([processClosed.then((exit) => ({ exit })), new Promise<undefined>((resolve) => setImmediate(() => resolve(undefined)))]);
		if (!outcome) return result;
		const finalResult = readRunnerStartup(startupPath, expectedState, expectedToken);
		if (finalResult?.ok === false) return finalResult;
		const { exitCode, signal } = outcome.exit;
		return { ok: false, error: `Async runner exited before startup state '${expectedState}' (exit code ${exitCode ?? "unknown"}, signal ${signal ?? "none"}).`, startupDidNotProceed: true };
	};
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		const result = readRunnerStartup(startupPath, expectedState, expectedToken);
		if (result) return await confirmOpen(result);
		const delay = waitForStartupInterval(Math.min(20, Math.max(1, deadline - Date.now())));
		if (processClosed) {
			const outcome = await Promise.race([delay.then(() => undefined), processClosed.then((exit) => ({ exit }))]);
			if (outcome) {
				const finalResult = readRunnerStartup(startupPath, expectedState, expectedToken);
				if (finalResult?.ok === false) return finalResult;
				const { exitCode, signal } = outcome.exit;
				return { ok: false, error: `Async runner exited before startup state '${expectedState}' (exit code ${exitCode ?? "unknown"}, signal ${signal ?? "none"}).`, startupDidNotProceed: true };
			}
		} else {
			await delay;
		}
	}
	const finalResult = readRunnerStartup(startupPath, expectedState, expectedToken);
	if (finalResult) return finalResult;
	return { ok: false, error: `Timed out after ${timeoutMs}ms waiting for the async runner startup state '${expectedState}'.`, startupDidNotProceed: true };
}

const writePrivateStartupControlJson = createAtomicJsonWriter({ mode: 0o600, ignoreCleanupErrorAfterSuccess: true });

function writeRunnerStartupControl(filePath: string, payload: { action: "ack" | "confirm" | "proceed"; token: string }): void {
	// Delegate to the shared atomic JSON writer (temp file + rename, retrying
	// transient Windows EPERM/EBUSY/EACCES locks and cleaning up the temp file
	// on failure), so the startup handshake gets the same locking resilience as
	// every other async control/result file. This is exercised by
	// test/unit/atomic-json.test.ts.
	writePrivateStartupControlJson(filePath, payload);
}

function runnerIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function waitForStartupIntervalSync(delayMs = 20): void {
	const waitUntil = Date.now() + delayMs;
	while (Date.now() < waitUntil) {
		// Pre-handshake failures happen before the runner can be observed asynchronously.
	}
}

function terminateRunnerBeforeProceed(pid: number): boolean {
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		if (!runnerIsAlive(pid)) return true;
		try {
			process.kill(pid, signal);
		} catch {
			if (!runnerIsAlive(pid)) return true;
		}
		const deadline = Date.now() + 1000;
		while (runnerIsAlive(pid) && Date.now() < deadline) waitForStartupIntervalSync();
	}
	return !runnerIsAlive(pid);
}

async function terminateRunnerBeforeProceedAsync(proc: ChildProcess, processClosed: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>): Promise<boolean> {
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		if (proc.pid === undefined || !runnerIsAlive(proc.pid)) return true;
		try { process.kill(proc.pid, signal); } catch {
			if (proc.pid === undefined || !runnerIsAlive(proc.pid)) return true;
		}
		const exited = await Promise.race([processClosed.then(() => true), waitForStartupInterval(1000).then(() => false)]);
		if (exited || proc.pid === undefined || !runnerIsAlive(proc.pid)) return true;
	}
	return proc.pid === undefined || !runnerIsAlive(proc.pid);
}

async function completeRunnerStartupHandshake(
	startupPath: string,
	startupAckPath: string,
	startupConfirmPath: string,
	startupProceedPath: string,
	proc: ChildProcess,
	processClosed: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>,
	getObservedProcessExit: () => { exitCode: number | null; signal: NodeJS.Signals | null } | undefined,
	runnerProcessInstanceId: string,
	persistStartupFailure: (message: string) => void,
): Promise<SpawnRunnerResult> {
	try {
		const ready = await waitForRunnerStartup(startupPath, "ready", RUNNER_STARTUP_TIMEOUT_MS, undefined, processClosed);
	if (ready.ok === false) {
		persistStartupFailure(ready.error);
		const terminationObserved = await terminateRunnerBeforeProceedAsync(proc, processClosed);
		return { pid: proc.pid, runnerProcessInstanceId, error: ready.error, terminationObserved, startupDidNotProceed: true };
	}
	try { writeRunnerStartupControl(startupAckPath, { action: "ack", token: ready.token }); } catch (error) {
		const message = `Failed to acknowledge async runner startup: ${error instanceof Error ? error.message : String(error)}`;
		persistStartupFailure(message);
		const terminationObserved = await terminateRunnerBeforeProceedAsync(proc, processClosed);
		return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
	}
	const acknowledged = await waitForRunnerStartup(startupPath, "acknowledged", RUNNER_STARTUP_TIMEOUT_MS, ready.token, processClosed);
	if (acknowledged.ok === false) {
		persistStartupFailure(acknowledged.error);
		const terminationObserved = await terminateRunnerBeforeProceedAsync(proc, processClosed);
		return { pid: proc.pid, runnerProcessInstanceId, error: acknowledged.error, terminationObserved, startupDidNotProceed: true };
	}
	try { writeRunnerStartupControl(startupConfirmPath, { action: "confirm", token: ready.token }); } catch (error) {
		const message = `Failed to confirm async runner startup: ${error instanceof Error ? error.message : String(error)}`;
		persistStartupFailure(message);
		const terminationObserved = await terminateRunnerBeforeProceedAsync(proc, processClosed);
		return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
	}
	const confirmed = await waitForRunnerStartup(startupPath, "confirmed", RUNNER_STARTUP_TIMEOUT_MS, ready.token, processClosed);
	if (confirmed.ok === false) {
		persistStartupFailure(confirmed.error);
		const terminationObserved = await terminateRunnerBeforeProceedAsync(proc, processClosed);
		return { pid: proc.pid, runnerProcessInstanceId, error: confirmed.error, terminationObserved, startupDidNotProceed: true };
	}
	const closedAtCommit = await Promise.race([
		processClosed.then((exit) => exit),
		new Promise<undefined>((resolve) => setImmediate(() => resolve(undefined))),
	]);
	const observedExit = closedAtCommit ?? getObservedProcessExit();
	if (observedExit) {
		const message = `Async runner exited after startup state 'acknowledged' before proceed (exit code ${observedExit.exitCode ?? "unknown"}, signal ${observedExit.signal ?? "none"}).`;
		persistStartupFailure(message);
		const terminationObserved = await terminateRunnerBeforeProceedAsync(proc, processClosed);
		return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
	}
	try { writeRunnerStartupControl(startupProceedPath, { action: "proceed", token: ready.token }); } catch (error) {
		const message = `Failed to authorize async runner startup: ${error instanceof Error ? error.message : String(error)}`;
		persistStartupFailure(message);
		const terminationObserved = await terminateRunnerBeforeProceedAsync(proc, processClosed);
		return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
	}
	try { fs.rmSync(startupPath, { force: true }); } catch {}
	return { pid: proc.pid, runnerProcessInstanceId };
	} finally {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

function persistPreProceedStartupFailure(asyncDir: string, runId: string, runnerProcessInstanceId: string, sessionId: string | undefined, completionOwnerId: string | undefined, message: string): void {
	try {
		persistRunnerStartupFailure({ asyncDir, runId, runnerProcessInstanceId, sessionId, completionOwnerId, message });
	} catch {
		// Startup failures must still return the original launch error.
	}
}

interface SpawnRunnerResult {
	pid?: number;
	runnerProcessInstanceId?: string;
	error?: string;
	terminationObserved?: boolean;
	startupDidNotProceed?: boolean;
}

function isStaleExtensionContextError(error: unknown): boolean {
	return error instanceof Error && /extension ctx is stale|stale after session replacement or reload/i.test(error.message);
}

export function emitProcessTerminalEvent(ctx: AsyncExecutionContext, proof: unknown): void {
	try {
		ctx.pi.events.emit(SUBAGENT_PROCESS_TERMINAL_EVENT, proof);
	} catch (error) {
		if (isStaleExtensionContextError(error)) return;
		console.error("Failed to emit subagent process-terminal event:", error);
	}
}

function spawnRunner(cfg: object, suffix: string, cwd: string, initialStatus: Omit<AsyncStatus, "runnerPid" | "ownerPid" | "processTerminal">, initialStatusPath: string, launchParentSessionId: string | undefined, onProcessTerminal?: (proof: unknown) => void, onBeforeProceed?: (runnerProcessInstanceId: string) => void, requestedCwd = cwd): SpawnRunnerResult | Promise<SpawnRunnerResult> {
	const cwdError = preflightLaunchCwd(requestedCwd, cwd);
	if (cwdError) return { error: cwdError };
	if (launchParentSessionId !== undefined && (!launchParentSessionId || launchParentSessionId.trim() !== launchParentSessionId)) {
		return { error: "Background runner parent session identity is invalid." };
	}
	const steps = (cfg as { steps?: unknown }).steps;
	if (!Array.isArray(steps)) return { error: "Background runner launch is missing its steps." };
	const inconsistentParent = (steps as RunnerStep[]).some((step) => isParallelGroup(step)
		? step.parallel.some((child) => child.parentSessionId !== launchParentSessionId)
		: step.parentSessionId !== launchParentSessionId);
	if (inconsistentParent) return { error: "Background runner steps have inconsistent parent session identities." };

	// The compiled host exposes its SDK only through Pi's extension loader.
	const binaryHost = resolveBunPiExecutable();
	const nodeExecutable = resolveNodeExecutable();
	const nativeRunnerSupported = supportsNativeRunner(nodeExecutable);
	const runner = asyncRunnerSourcePath;
	const runnerIsJavaScript = path.extname(runner) === ".js";
	const bootstrap = path.join(path.dirname(runner), `binary-bootstrap${path.extname(fileURLToPath(import.meta.url))}`);
	if (binaryHost && !fs.existsSync(bootstrap)) return { error: `Background runner bootstrap not found: ${bootstrap}` };
	if (!binaryHost && !runnerIsJavaScript && !nativeRunnerSupported && !jitiCliPath) {
		return { error: sourceUnderNodeModules
			? "Background runner source is installed under node_modules, so upstream jiti is required for TypeScript execution."
			: "Background runner requires enabled native TypeScript with synchronous module hooks, or installed upstream jiti for TypeScript execution." };
	}
	if (!binaryHost && !piPackageRoot) {
		return { error: `Background children require a supported standalone Pi host or the installed npm package (${PI_CODING_AGENT_PACKAGE}); neither is available.` };
	}
	const hostPeerAliases = !binaryHost && piPackageRoot ? resolveHostPeerAliases(piPackageRoot) : { aliases: {}, missing: [] };
	if (hostPeerAliases.missing.length > 0) {
		return { error: `Background children require the host npm package (${PI_CODING_AGENT_PACKAGE}) with its dependencies; ${piPackageRoot} does not provide ${hostPeerAliases.missing.join(", ")}.` };
	}

	fs.mkdirSync(TEMP_ROOT_DIR, { recursive: true });
	const cfgPath = getAsyncConfigPath(suffix);
	const runnerProcessInstanceId = randomUUID();
	const hasRevivalLease = typeof (cfg as { revivalLease?: unknown }).revivalLease === "object";
	const launchBarrierToken = hasRevivalLease ? undefined : runnerProcessInstanceId;
	const launchConfig = { ...cfg, runnerProcessInstanceId, ...(launchBarrierToken ? { launchBarrierToken } : {}) };
	writePrivateAtomicJson(cfgPath, launchConfig);
	const command = binaryHost ?? nodeExecutable;
	const launchForStartup = launchConfig as typeof launchConfig & { asyncDir?: unknown; id?: unknown; sessionId?: unknown; completionOwnerId?: unknown; revivalLease?: unknown };
	const launchAsyncDir = typeof launchForStartup.asyncDir === "string" ? launchForStartup.asyncDir : undefined;
	const launchRunId = typeof launchForStartup.id === "string" ? launchForStartup.id : suffix;
	const launchSessionId = typeof launchForStartup.sessionId === "string" ? launchForStartup.sessionId : undefined;
	const launchCompletionOwnerId = typeof launchForStartup.completionOwnerId === "string" ? launchForStartup.completionOwnerId : undefined;
	const startupPath = typeof launchForStartup.revivalLease === "object" && launchAsyncDir
		? path.join(launchAsyncDir, "runner-startup.json")
		: undefined;
	const startupAckPath = startupPath ? path.join(path.dirname(startupPath), "runner-startup-ack.json") : undefined;
	const startupConfirmPath = startupPath ? path.join(path.dirname(startupPath), "runner-startup-confirm.json") : undefined;
	const startupProceedPath = launchAsyncDir && (startupPath || launchBarrierToken)
		? path.join(launchAsyncDir, "runner-startup-proceed.json")
		: undefined;
	if (startupPath) fs.rmSync(startupPath, { force: true });
	if (startupAckPath) fs.rmSync(startupAckPath, { force: true });
	if (startupConfirmPath) fs.rmSync(startupConfirmPath, { force: true });
	if (startupProceedPath) fs.rmSync(startupProceedPath, { force: true });

	const logPaths = resolveAsyncRunnerLogPaths(launchConfig);
	let stdoutFd: number | undefined;
	let stderrFd: number | undefined;
	try {
		if (logPaths) {
			fs.mkdirSync(path.dirname(logPaths.stdoutPath), { recursive: true });
			stdoutFd = fs.openSync(logPaths.stdoutPath, "a");
			stderrFd = fs.openSync(logPaths.stderrPath, "a");
		}
		// Short-circuit native peer aliases so Pi's loader and generated factories preserve filesystem resolution semantics.
		const preload = Object.keys(hostPeerAliases.aliases).length > 0
			? ["--import", new URL("../../../runner-peer-preload.mjs", import.meta.url).href]
			: [];
		const args = binaryHost
			? ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-session", "--mode", "rpc", "--extension", bootstrap]
			: runnerIsJavaScript
				? [...preload, runner, cfgPath]
				: nativeRunnerSupported
				? [...preload, "--experimental-strip-types", runner, cfgPath]
				: [...preload, jitiCliPath!, runner, cfgPath];
		const runnerEnv: NodeJS.ProcessEnv = {
			...omitGitRoutingEnv(omitExtensionBindingsEnv(process.env)),
			...childCacheRetentionEnv(),
			[PI_CODING_AGENT_PACKAGE_ROOT_ENV]: binaryHost ? undefined : piPackageRoot,
			// npm must override inherited bundled layouts (#2071); binaries retain release assets.
			PI_PACKAGE_DIR: binaryHost ? process.env.PI_PACKAGE_DIR : piPackageRoot,
			[JITI_ALIAS_ENV]: binaryHost ? undefined : JSON.stringify(hostPeerAliases.aliases),
			PI_ASYNC_NATIVE_RUNNER: !binaryHost && (runnerIsJavaScript || nativeRunnerSupported) ? "1" : "0",
			PI_SUBAGENT_RUNNER_CONFIG: binaryHost ? cfgPath : undefined,
		};
		if (launchParentSessionId === undefined) delete runnerEnv[SUBAGENT_PARENT_SESSION_ENV];
		else runnerEnv[SUBAGENT_PARENT_SESSION_ENV] = launchParentSessionId;
		const proc = spawn(command, args, {
			cwd,
			...backgroundProcessOptions(),
			stdio: ["ignore", stdoutFd ?? "ignore", stderrFd ?? "ignore"],
			env: runnerEnv,
		});
		let observedProcessExit: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined;
		proc.once("exit", (exitCode, signal) => { observedProcessExit = { exitCode, signal }; });
		const processClosed = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
			proc.once("close", (exitCode, signal) => {
				observedProcessExit ??= { exitCode, signal };
				resolve({ exitCode, signal });
			});
		});
		closeFd(stdoutFd);
		closeFd(stderrFd);
		proc.on("error", (error) => {
			console.error(`[pi-subagents] async spawn failed: ${error.message}`);
		});
		proc.once("close", (exitCode, signal) => {
			const finalize = () => {
				const launch = launchConfig as { asyncDir?: unknown; id?: unknown; nestedRoute?: NestedRouteInfo; nestedSelf?: { parentRunId: string; parentStepIndex?: number; depth: number; path?: Array<{ runId: string; stepIndex?: number; agent?: string }> } };
			const asyncDir = launch.asyncDir;
			const runId = launch.id;
			if (typeof asyncDir !== "string" || typeof runId !== "string") return;
			finalizeProcessTerminal(asyncDir, runId, {
				processInstanceId: runnerProcessInstanceId,
				closeObservedAt: Date.now(),
				exitCode,
				signal,
			});
			const persisted = readProcessTerminal(asyncDir, { runId, runnerProcessInstanceId });
			if (!persisted) return;
			if (launch.nestedRoute && launch.nestedSelf) {
				try {
					let status: import("../../shared/types.ts").AsyncStatus;
					try {
						status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8")) as import("../../shared/types.ts").AsyncStatus;
						status.processTerminal = persisted;
					} catch {
						status = {
							runId,
							mode: "single",
							state: persisted.state === "observed" ? "complete" : "failed",
							startedAt: persisted.observedAt ?? Date.now(),
							lastUpdate: Date.now(),
							processTerminal: persisted,
						};
					}
					writeNestedEvent(launch.nestedRoute, {
						type: "subagent.nested.completed",
						ts: Date.now(),
						parentRunId: launch.nestedSelf.parentRunId,
						parentStepIndex: launch.nestedSelf.parentStepIndex,
						child: nestedSummaryFromAsyncStatus(status, asyncDir, {
							id: runId,
							parentRunId: launch.nestedSelf.parentRunId,
							parentStepIndex: launch.nestedSelf.parentStepIndex,
							depth: launch.nestedSelf.depth,
							path: launch.nestedSelf.path,
							mode: status.mode,
							ts: Date.now(),
						}),
					});
				} catch (error) {
					console.error("Failed to emit final nested process-terminal status:", error);
				}
			}
			onProcessTerminal?.(persisted);
			};
			if (startupPath) setImmediate(finalize);
			else finalize();
		});
		if (typeof proc.pid !== "number") {
			return { error: `async runner did not produce a pid for cwd: ${cwd}` };
		}
		try {
			writePrivateAtomicJson(initialStatusPath, {
				...initialStatus,
				runnerPid: proc.pid,
				pidNamespaceScope: currentPidNamespaceScope(),
				processTerminal: { version: 1, state: "pending", runId: initialStatus.runId, runnerProcessInstanceId },
			});
			// Aggregate waits must see the launch before the runner's first status update.
			updateActiveRunIndex(path.dirname(initialStatusPath), initialStatus.state, initialStatus.toolCallId);
		} catch (error) {
			const message = `Failed to persist initial async status: ${error instanceof Error ? error.message : String(error)}`;
			if (launchAsyncDir) persistPreProceedStartupFailure(launchAsyncDir, launchRunId, runnerProcessInstanceId, launchSessionId, launchCompletionOwnerId, message);
			const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
			return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
		}
		try {
			if (!launchAsyncDir) throw new Error("Async runner is missing its lifecycle directory.");
			initializeProcessTerminal(launchAsyncDir, launchRunId, runnerProcessInstanceId);
		} catch (error) {
			const message = `Failed to establish async runner lifecycle sidecar: ${error instanceof Error ? error.message : String(error)}`;
			if (launchAsyncDir) persistPreProceedStartupFailure(launchAsyncDir, launchRunId, runnerProcessInstanceId, launchSessionId, launchCompletionOwnerId, message);
			const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
			return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
		}
		try {
			onBeforeProceed?.(runnerProcessInstanceId);
		} catch (error) {
			const message = `Failed to establish async runner capacity ownership: ${error instanceof Error ? error.message : String(error)}`;
			if (launchAsyncDir) persistPreProceedStartupFailure(launchAsyncDir, launchRunId, runnerProcessInstanceId, launchSessionId, launchCompletionOwnerId, message);
			const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
			return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
		}
		if (launchBarrierToken && startupProceedPath) {
			try {
				writeRunnerStartupControl(startupProceedPath, { action: "proceed", token: launchBarrierToken });
			} catch (error) {
				const message = `Failed to authorize async runner startup: ${error instanceof Error ? error.message : String(error)}`;
				if (launchAsyncDir) persistPreProceedStartupFailure(launchAsyncDir, launchRunId, runnerProcessInstanceId, launchSessionId, launchCompletionOwnerId, message);
				const terminationObserved = terminateRunnerBeforeProceed(proc.pid);
				return { pid: proc.pid, runnerProcessInstanceId, error: message, terminationObserved, startupDidNotProceed: true };
			}
		}
		proc.unref();
		if (startupPath && startupAckPath && startupConfirmPath && startupProceedPath) {
			const persistStartupFailure = (message: string) => {
				if (launchAsyncDir) persistPreProceedStartupFailure(launchAsyncDir, launchRunId, runnerProcessInstanceId, launchSessionId, launchCompletionOwnerId, message);
			};
			return completeRunnerStartupHandshake(startupPath, startupAckPath, startupConfirmPath, startupProceedPath, proc, processClosed, () => observedProcessExit ?? (proc.exitCode !== null || proc.signalCode !== null ? { exitCode: proc.exitCode, signal: proc.signalCode } : undefined), runnerProcessInstanceId, persistStartupFailure);
		}
		return { pid: proc.pid, runnerProcessInstanceId };
	} catch (error) {
		closeFd(stdoutFd);
		closeFd(stderrFd);
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function formatAsyncStartError(mode: SubagentRunMode, message: string): AsyncExecutionResult {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
		details: { mode, results: [] },
	};
}

const UNAVAILABLE_SUBAGENT_SKILL_ERROR = "Skills not found: pi-subagents";

/**
 * Execute a single agent asynchronously
 */
export function workflowAwaitedAsyncResultPath(asyncDir: string): string {
	return path.join(asyncDir, "workflow-result.json");
}

export function executeAsyncSingle(
	id: string,
	params: AsyncSingleParams,
): AsyncExecutionResult | Promise<AsyncExecutionResult> {
	const {
		agent,
		agentConfig,
		ctx,
		cwd,
		maxOutput,
		artifactsDir,
		artifactConfig,
		sessionRoot,
		sessionFile,
		maxSubagentDepth,
		worktreeSetupHook,
		worktreeSetupHookTimeoutMs,
		worktreeBaseDir,
		baseRef,
		worktreeBranchPrefix,
		controlConfig,
		controlIntercomTarget,
		childIntercomTarget,
		nestedRoute,
	} = params;
	let lane: WorkflowLaneMetadata | undefined;
	try {
		lane = normalizeWorkflowLaneMetadata(params.lane, "lane");
		assertWorkflowLaneKey(lane, params.workflowKey, "lane");
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const task = params.task ?? "";
	let extensionBindings: ExtensionBindings | undefined;
	try {
		extensionBindings = normalizeExtensionBindings(params.extensionBindings)?.value;
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const acceptanceErrors = validateAcceptanceInput(params.acceptance);
	if (acceptanceErrors.length > 0) return formatAsyncStartError("single", acceptanceErrors.join(" "));
	const permissionRules = resolvePermissionRules(ctx.permissions, agentConfig.permissions);
	const capabilityCeiling = intersectSubagentCapabilityCeilings(params.capabilityCeiling, ctx.childRuntime?.capabilityCeiling);
	try {
		assertAgentAllowedByCapabilityCeiling(agentConfig.name, capabilityCeiling);
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const runnerCwd = resolveChildCwd(ctx.cwd, cwd);
	let instructionCwd = runnerCwd;
	if (params.worktree === true) {
		try {
			instructionCwd = resolveExpectedWorktreeAgentCwd(runnerCwd, `${id}-s0`, 0, worktreeBaseDir);
		} catch (error) {
			return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
		}
	}
	const skillNames = params.skills ?? agentConfig.skills ?? [];
	const availableModels = params.availableModels;
	const { resolved: resolvedSkills, missing: missingSkills } = resolveSkillsWithFallback(
		skillNames,
		runnerCwd,
		ctx.cwd,
		agentConfig.skillPath,
		agentConfig.filePath ? path.dirname(agentConfig.filePath) : runnerCwd,
	);
	if (missingSkills.includes("pi-subagents")) return formatAsyncStartError("single", UNAVAILABLE_SUBAGENT_SKILL_ERROR);

	const inheritedNestedRoute = inheritedNestedRouteOf(ctx.childRuntime);
	const nestedAddress = inheritedNestedRoute ? inheritedNestedParentAddressOf(ctx.childRuntime) : undefined;
	const asyncDir = inheritedNestedRoute
		? path.join(TEMP_ROOT_DIR, "nested-subagent-runs", inheritedNestedRoute.rootRunId, id)
		: path.join(DIRS.async, id);
	let runFanoutBudget: RunFanoutBudgetDescriptor;
	try {
		runFanoutBudget = params.runFanoutBudget ?? createRunFanoutBudget(id, 64);
		fs.mkdirSync(asyncDir, { recursive: true });
		writeRunFanoutBudgetDescriptor(asyncDir, runFanoutBudget);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create async run directory '${asyncDir}': ${message}` }],
			isError: true,
			details: { mode: "single" as const, results: [] },
		};
	}

	const effectiveOutput = normalizeSingleOutputOverride(params.output, agentConfig.output);
	const outputPath = resolveSingleOutputPath(effectiveOutput, ctx.cwd, instructionCwd, params.outputBaseDir ?? (artifactsDir ? path.join(artifactsDir, "outputs", id) : undefined));
	const systemPrompt = buildEffectiveSystemPrompt({ agent: agentConfig, resolvedSkills, cwd: runnerCwd, ...(outputPath ? { outputPath } : {}) });
	const outputMode = params.outputMode ?? agentConfig.outputMode ?? "inline";
	const validationError = validateFileOnlyOutputMode(outputMode, outputPath, `Async single run (${agent})`);
	if (validationError) return formatAsyncStartError("single", validationError);
	const taskWithOutputInstruction = injectSingleOutputInstruction(task, outputPath, agentConfig);
	// Reads: caller override > agent defaultReads > none. `~`/`~/` expand to home;
	// absolute paths pass through; relative paths resolve against the child cwd.
	const reads = params.reads !== undefined ? params.reads : agentConfig.defaultReads ?? false;
	const readPaths = Array.isArray(reads)
		? resolveExistingReadPaths(reads, runnerCwd)
		: [];
	const readsInstruction = readPaths.length > 0
		? `[Read from: ${readPaths.join(", ")}]\n\n`
		: "";
	const taskText = readsInstruction + taskWithOutputInstruction;
	const modelScopes = resolveModelScopesForAgent(ctx.modelScope, agentConfig.name, ctx.currentModel, ctx.scopedModelIds);
	const modelOrigin = resolveModelOrigin({
		fromParent: params.modelOverrideFromParent,
		storedOrigin: params.modelOrigin,
		explicitModel: params.modelOverrideFromParent ? undefined : params.modelOverride,
		agentModel: agentConfig.model,
		parentModel: ctx.currentModel,
	});
	let primaryModel: string | undefined;
	try {
		primaryModel = modelOrigin === "inherited"
			? params.modelOverride ?? (ctx.currentModel ? `${ctx.currentModel.provider}/${ctx.currentModel.id}` : undefined)
			: resolveSubagentModelOverride(
				params.modelOverride ?? agentConfig.model,
				ctx.currentModel,
				availableModels,
				ctx.currentModelProvider,
				{ scope: modelScopes, source: modelOrigin === "explicit" ? "explicit" : "inherited" },
			);
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const effectiveThinking = params.thinkingOverride ?? agentConfig.thinking;
	const model = applyThinkingSuffix(primaryModel, effectiveThinking, params.thinkingOverride !== undefined);
	const contextLimit = model ? findModelInfo(model, availableModels, agentConfig.modelProvider ?? ctx.currentModelProvider)?.contextWindow : undefined;
	const thinkingCeiling = intersectThinkingCeilings(
		params.thinkingCeiling,
		agentConfig.maxThinking,
		ctx.childRuntime?.thinkingCeiling,
	);
	try {
		assertThinkingWithinCeiling({ model, configThinking: effectiveThinking, ceiling: thinkingCeiling, agent: agentConfig.name, runId: id });
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const toolBudgetInput = params.toolBudget ?? agentConfig.toolBudget ?? params.configToolBudget;
	const resolvedToolBudget = validateToolBudgetConfig(toolBudgetInput, params.toolBudget ? "toolBudget" : agentConfig.toolBudget ? "agent.toolBudget" : "config.toolBudget");
	if (resolvedToolBudget.error) return formatAsyncStartError("single", resolvedToolBudget.error);
	const deadlineAt = params.absoluteDeadlineAt ?? (params.timeoutMs !== undefined ? Date.now() + params.timeoutMs : undefined);
	const timeoutMs = params.absoluteDeadlineAt !== undefined && deadlineAt !== undefined
		? deadlineAt - Date.now()
		: params.timeoutMs;
	if (timeoutMs !== undefined && timeoutMs <= 0) return formatAsyncStartError("single", "The source run's absolute deadline expired before recovery could launch.");
	const resolvedToolTimeout = resolveToolTimeoutMs({
		callValue: params.toolTimeoutMs,
		agentValue: agentConfig.defaultToolTimeoutMs,
		configValue: params.configToolTimeoutMs,
		envValue: params.toolTimeoutMsEnv ?? toolTimeoutFromEnv(),
	});
	if (resolvedToolTimeout.error) return formatAsyncStartError("single", resolvedToolTimeout.error);
	const toolTimeoutMs = resolvedToolTimeout.toolTimeoutMs;
	const initialUsageBudget = usageBudgetState(params.usageBudget, undefined);
	const resolvedSessionDir = params.sessionDir ?? (sessionRoot ? path.join(sessionRoot, `async-${id}`) : undefined);
	const structuredOutput = params.structuredOutputSchema
		? createStructuredOutputRuntime(params.structuredOutputSchema, path.join(asyncDir, "structured-output"), { acceptanceReport: resolveAcceptanceReportMode(params.acceptance) })
		: undefined;
	let selectedModel = model;
	let requestedModel: string | undefined;
	try {
		const modelEvidence = resolveModelSelection(primaryModel, availableModels, agentConfig.modelProvider ?? ctx.currentModelProvider, {
			scope: modelScopes,
			primaryModelFromParent: modelOrigin === "inherited",
			origin: modelOrigin,
		});
		requestedModel = modelEvidence.requestedModel;
		selectedModel = applyThinkingSuffix(modelEvidence.model, effectiveThinking, params.thinkingOverride !== undefined);
		assertThinkingWithinCeiling({ model: selectedModel, configThinking: effectiveThinking, ceiling: thinkingCeiling, agent: agentConfig.name, runId: id });
	} catch (error) {
		return formatAsyncStartError("single", error instanceof Error ? error.message : String(error));
	}
	const toolPlan = resolvePiLaunchToolPlan({
		tools: agentConfig.tools,
		excludeTools: agentConfig.excludeTools,
		allowNestedSubagents: agentConfig.allowNestedSubagents,
		extensions: agentConfig.extensions,
		subagentOnlyExtensions: agentConfig.subagentOnlyExtensions,
		mcpDirectTools: agentConfig.mcpDirectTools,
		cwd: runnerCwd,
		requireReadTool: Boolean(resolvedSkills.length),
		structuredOutput: Boolean(params.structuredOutputSchema),
		fast: params.fast ?? agentConfig.fast,
		model: selectedModel,
		capabilityCeiling,
		inheritedCapabilityCeiling: ctx.childRuntime?.capabilityCeiling,
		agentName: agentConfig.name,
		permissionRules: resolvePermissionRules(ctx.permissions, agentConfig.permissions),
		runtimeSnapshotHost: ctx.pi,
	});
	const launchResolvedExtensions = projectLaunchResolvedChildExtensions(toolPlan);
	const fast = params.fast ?? agentConfig.fast;
	const launchThinking = resolveEffectiveThinking(selectedModel, effectiveThinking);
	const { definitionDigest, launchContractDigest } = resolveLaunchBinding({
		agent: agentConfig,
		task,
		model: selectedModel,
		...(fast !== undefined ? { fast } : {}),
		...(launchThinking ? { thinking: launchThinking } : {}),
		systemPrompt,
		skills: resolvedSkills.map((skill) => skill.name),
		toolPlan,
		...(outputPath ? { outputPath } : {}),
		outputMode,
		...(params.structuredOutputSchema ? { structuredOutputSchema: params.structuredOutputSchema } : {}),
		...(extensionBindings ? { extensionBindings } : {}),
	});
	const resolvedAcceptance = resolveEffectiveAcceptance({
		explicit: params.acceptance,
		agentName: agent,
		acceptanceRole: agentConfig.acceptanceRole,
		task,
		mode: "single",
		async: true,
		agentContract: params.agentContract,
	});
	const recoveryAgentConfig = params.recoveryAgentConfig ?? agentConfig;
	const recoveryDescriptor: SteeringRecoveryDescriptor = {
		...(ctx.modelResponseAliases ? { modelResponseAliases: ctx.modelResponseAliases } : {}),
		version: 1,
		...(lane ? { lane } : {}),
		launchContractDigest,
		...(extensionBindings ? { extensionBindings } : {}),
		runFanoutBudget,
		sourceRunId: id,
		...(params.agentContract ? { agentContract: params.agentContract } : {}),
		agent,
		launchResolvedExtensions,
		...(sessionFile ? { sessionFile } : {}),
		cwd: runnerCwd,
		...(selectedModel ? { model: selectedModel } : {}),
		...(params.fast ?? recoveryAgentConfig.fast ? { fast: params.fast ?? recoveryAgentConfig.fast } : {}),
		...(recoveryAgentConfig.modelProvider ? { modelProvider: recoveryAgentConfig.modelProvider } : {}),
		...(modelOrigin === "inherited" ? { modelOverrideFromParent: true } : {}),
		modelOrigin,
		...(effectiveThinking ? { thinking: resolveEffectiveThinking(selectedModel, effectiveThinking) } : {}),
		...(thinkingCeiling ? { thinkingCeiling } : {}),
		...(recoveryAgentConfig.tools ? { tools: [...recoveryAgentConfig.tools] } : {}),
		...(recoveryAgentConfig.excludeTools ? { excludeTools: [...recoveryAgentConfig.excludeTools] } : {}),
		...(recoveryAgentConfig.allowNestedSubagents !== undefined ? { allowNestedSubagents: recoveryAgentConfig.allowNestedSubagents } : {}),
		...(recoveryAgentConfig.allowedAgents !== undefined ? { allowedAgents: [...recoveryAgentConfig.allowedAgents] } : {}),
		...(recoveryAgentConfig.extensions ? { extensions: [...recoveryAgentConfig.extensions] } : {}),
		...(recoveryAgentConfig.subagentOnlyExtensions ? { subagentOnlyExtensions: [...recoveryAgentConfig.subagentOnlyExtensions] } : {}),
		...(recoveryAgentConfig.mcpDirectTools ? { mcpDirectTools: [...recoveryAgentConfig.mcpDirectTools] } : {}),
		...(recoveryAgentConfig.mutationTools ? { mutationTools: [...recoveryAgentConfig.mutationTools] } : {}),
		...(recoveryAgentConfig.systemPrompt ? { systemPrompt: recoveryAgentConfig.systemPrompt } : {}),
		systemPromptMode: recoveryAgentConfig.systemPromptMode,
		inheritProjectContext: recoveryAgentConfig.inheritProjectContext,
		inheritGlobalContext: recoveryAgentConfig.inheritGlobalContext,
		inheritSkills: recoveryAgentConfig.inheritSkills,
		...(resolvedSkills.length ? { skills: resolvedSkills.map((skill) => skill.name) } : {}),
		...(recoveryAgentConfig.skillPath ? { skillPath: [...recoveryAgentConfig.skillPath] } : {}),
		...(recoveryAgentConfig.filePath ? { agentFilePath: recoveryAgentConfig.filePath } : {}),
		...(recoveryAgentConfig.memory ? { memory: { ...recoveryAgentConfig.memory } } : {}),
		...(outputPath ? { outputPath } : {}),
		outputMode,
		...(params.structuredOutputSchema ? { structuredOutputSchema: params.structuredOutputSchema } : {}),
		...(params.acceptance !== undefined ? { acceptance: params.acceptance } : {}),
		...(controlConfig ? { controlConfig } : {}),
		...(params.context ? { context: params.context } : {}),
		...(params.intercomBridge !== undefined ? { intercomBridge: params.intercomBridge } : {}),
		...(params.baseRef !== undefined ? { baseRef: params.baseRef } : {}),
		...(deadlineAt !== undefined ? { absoluteDeadlineAt: deadlineAt } : {}),
		...(resolvedToolBudget.budget ? { initialToolBudget: resolvedToolBudget.budget } : {}),
		maxSubagentDepth: resolveChildMaxSubagentDepth(maxSubagentDepth, recoveryAgentConfig.maxSubagentDepth),
		...(maxOutput ? { maxOutput } : {}),
		...(resolvedSessionDir ? { sessionDir: resolvedSessionDir } : {}),
		...(artifactsDir ? { artifactsDir } : {}),
		artifactConfig,
		...(capabilityCeiling ? { capabilityCeiling } : {}),
	};
	try {
		writePrivateAtomicJson(path.join(asyncDir, "recovery-descriptor.json"), recoveryDescriptor);
	} catch (error) {
		return formatAsyncStartError("single", `Failed to persist async recovery descriptor for '${id}': ${error instanceof Error ? error.message : String(error)}`);
	}
	let spawnResultOrPromise: SpawnRunnerResult | Promise<SpawnRunnerResult> = {};
	const initialStatusAt = Date.now();
	const initialCompletionOwnerId = ctx.completionOwnerId ?? currentCompletionOwnerId();
	const launchParentSessionId = ctx.parentSessionId ?? ctx.currentSessionId;
	try {
		spawnResultOrPromise = spawnRunner(
			{
				id,
				steps: [
					{
						parentSessionId: launchParentSessionId,
						permissionRules,
						...(capabilityCeiling ? { capabilityCeiling } : {}),
						agent,
						task: taskText,
						...(params.context ? { context: params.context } : {}),
						cwd: runnerCwd,
						requestedCwd: params.requestedCwd ?? runnerCwd,
						model: selectedModel,
						...(contextLimit !== undefined ? { contextLimit } : {}),
						...(params.fast ?? agentConfig.fast ? { fast: params.fast ?? agentConfig.fast } : {}),
						thinking: resolveEffectiveThinking(selectedModel, effectiveThinking),
						...(thinkingCeiling ? { thinkingCeiling } : {}),
						...(requestedModel ? { requestedModel } : {}),
						...(modelOrigin === "inherited" ? { skipPrimaryModelVerification: true } : {}),
						...(availableModels && availableModels.length > 0 ? { modelVerificationRegistry: availableModels } : {}),
						...(ctx.modelResponseAliases ? { modelResponseAliases: ctx.modelResponseAliases } : {}),
						tools: agentConfig.tools,
						excludeTools: agentConfig.excludeTools,
						allowNestedSubagents: agentConfig.allowNestedSubagents,
						allowedAgents: agentConfig.allowedAgents,
						extensions: agentConfig.extensions,
						subagentOnlyExtensions: agentConfig.subagentOnlyExtensions,
						mcpDirectTools: agentConfig.mcpDirectTools,
						mutationTools: agentConfig.mutationTools,
						systemPrompt,
						systemPromptMode: agentConfig.systemPromptMode,
						inheritProjectContext: agentConfig.inheritProjectContext,
						inheritGlobalContext: agentConfig.inheritGlobalContext,
						inheritSkills: agentConfig.inheritSkills,
						skills: resolvedSkills.map((r) => r.name),
						outputPath,
						...(params.outputClaimPath ? { outputClaimPath: params.outputClaimPath } : {}),
						outputMode,
						...(sessionFile ? { sessionFile } : {}),
						maxSubagentDepth: resolveChildMaxSubagentDepth(maxSubagentDepth, agentConfig.maxSubagentDepth),
						waitToolEnabled: params.waitToolEnabled,
						waitToolDefaultTimeoutMs: params.waitToolDefaultTimeoutMs,
						...(params.agentContract ? { agentContract: params.agentContract } : {}),
						definitionDigest,
						launchBindingTask: task,
						launchContractDigest,
						...(extensionBindings ? { extensionBindings } : {}),
						launchResolvedExtensions,
						effectiveAcceptance: resolvedAcceptance,
						acceptanceInput: params.acceptance,
						...(structuredOutput ? { structuredOutput } : {}),
						...(params.structuredOutputSchema ? { structuredOutputSchema: params.structuredOutputSchema } : {}),
						...(resolvedToolBudget.budget ? { toolBudget: resolvedToolBudget.budget } : {}),
						...(params.worktree === true ? { worktree: true } : {}),
						...(lane ? { lane } : {}),
					},
				],
				resultPath: params.parentWorkflowRunId !== undefined && (params.revivalLease !== undefined || params.workflowAwaitAsync === true)
					? workflowAwaitedAsyncResultPath(asyncDir)
					: inheritedNestedRoute ? nestedResultsPath(inheritedNestedRoute.rootRunId, id) : resultFilePath(DIRS.results, id),
				cwd: runnerCwd,
				placeholder: "{previous}",
				maxOutput,
				artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
				artifactConfig,
				sessionDir: resolvedSessionDir,
				asyncDir,
				sessionId: ctx.currentSessionId,
				completionOwnerId: ctx.completionOwnerId ?? currentCompletionOwnerId(),
				...(capabilityCeiling ? { capabilityCeiling } : {}),
				piPackageRoot,
				childSessionFactoryModule: childSessionFactoryModule(),
				projectTrusted: ctx.projectTrusted,
				inheritedChildRuntime: inheritedChildRuntime(ctx.childRuntime),
				worktreeSetupHook,
				worktreeSetupHookTimeoutMs,
				worktreeBaseDir,
				baseRef,
				worktreeBranchPrefix,
				controlConfig,
				timeoutMs,
				deadlineAt,
				toolTimeoutMs,
				checkpointBeforeDeadlineMs: params.checkpointBeforeDeadlineMs,
				toolBudget: params.toolBudget,
				usageBudget: params.usageBudget,
				controlIntercomTarget,
				childIntercomTargets: childIntercomTarget ? [childIntercomTarget(agent, 0)] : undefined,
				resultMode: "single",
				launchContractDigest,
				launchResolvedExtensions,
				runFanoutBudget,
				...(params.parentWorkflowRunId ? { parentWorkflowRunId: params.parentWorkflowRunId } : {}),
				...(params.workflowKey ? { workflowKey: params.workflowKey } : {}),
				...(lane ? { lane } : {}),
				...(params.revivalLease ? { revivalLease: params.revivalLease } : {}),
				nestedRoute: nestedRoute ?? inheritedNestedRoute,
				nestedSelf: inheritedNestedRoute && nestedAddress ? {
					parentRunId: nestedAddress.parentRunId,
					parentStepIndex: nestedAddress.parentStepIndex,
					depth: nestedAddress.depth,
					path: nestedAddress.path,
				} : undefined,
			},
			id,
			runnerCwd,
			{
				lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
				runId: id,
				...(ctx.currentSessionId ? { sessionId: ctx.currentSessionId } : {}),
				...(initialCompletionOwnerId ? { completionOwnerId: initialCompletionOwnerId } : {}),
				mode: "single",
				state: "running",
				startedAt: initialStatusAt,
				lastUpdate: initialStatusAt,
				currentStep: 0,
				chainStepCount: 1,
				...(lane ? { lane } : {}),
				steps: [{ agent, status: "pending", ...(lane ? { lane } : {}), ...(model ? { model } : {}), ...(contextLimit !== undefined ? { contextLimit } : {}) }],
			},
			path.join(asyncDir, "status.json"),
			launchParentSessionId,
			(proof) => emitProcessTerminalEvent(ctx, proof),
			(runnerProcessInstanceId) => params.activeAsyncCapacity?.markStarted(runnerProcessInstanceId),
			params.requestedCwd ?? runnerCwd,
		);
	} catch (error) {
		params.activeAsyncCapacity?.rollback();
		const message = error instanceof Error ? error.message : String(error);
		return formatAsyncStartError("single", `Failed to start async run '${id}': ${message}`);
	}
	const finishSpawnResult = (spawnResult: SpawnRunnerResult): AsyncExecutionResult => {
	if (spawnResult.error) {
		if (spawnResult.startupDidNotProceed) {
			if (!spawnResult.runnerProcessInstanceId || params.activeAsyncCapacity?.rollbackBeforeRunnerProceed(spawnResult.runnerProcessInstanceId) !== true) params.activeAsyncCapacity?.rollback();
		}
		else if (!spawnResult.pid || !spawnResult.runnerProcessInstanceId) params.activeAsyncCapacity?.rollback();
		else params.activeAsyncCapacity?.markStarted(spawnResult.runnerProcessInstanceId);
		return formatAsyncStartError("single", `Failed to start async run '${id}': ${spawnResult.error}`);
	}
	if (!spawnResult.pid || !spawnResult.runnerProcessInstanceId) {
		params.activeAsyncCapacity?.rollback();
		return formatAsyncStartError("single", `Failed to start async run '${id}': runner identity unavailable`);
	}
	if (spawnResult.pid) {
		if (inheritedNestedRoute && nestedAddress) {
			const now = Date.now();
			try {
				writeNestedEvent(inheritedNestedRoute, {
					type: "subagent.nested.started",
					ts: now,
					parentRunId: nestedAddress.parentRunId,
					parentStepIndex: nestedAddress.parentStepIndex,
					child: {
						id,
						parentRunId: nestedAddress.parentRunId,
						parentStepIndex: nestedAddress.parentStepIndex,
						depth: nestedAddress.depth,
						path: nestedAddress.path,
						asyncDir,
						runnerPid: spawnResult.pid,
						ownerIntercomTarget: ctx.childRuntime?.intercomSessionName,
						leafIntercomTarget: childIntercomTarget?.(agent, 0),
						intercomTarget: childIntercomTarget?.(agent, 0),
						ownerState: "live",
						mode: "single",
						state: "running",
						agent,
						agents: [agent],
						chainStepCount: 1,
						...(timeoutMs !== undefined ? { timeoutMs, deadlineAt } : {}),
						startedAt: now,
						lastUpdate: now,
						...(capabilityCeiling ? { capabilityCeiling } : {}),
					},
				});
			} catch (error) {
				console.error("Failed to emit nested async start event:", error);
			}
		}
		ctx.pi.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, {
			lifecycleArtifactVersion: SUBAGENT_LIFECYCLE_ARTIFACT_VERSION,
			id,
			runnerPid: spawnResult.pid,
			sessionId: ctx.currentSessionId,
			completionOwnerId: ctx.completionOwnerId ?? currentCompletionOwnerId(),
			mode: "single",
			agent,
			task: task?.trim() ? PROMPT_REDACTED : undefined,
			goal: (params.goal ?? task).trim() ? PROMPT_REDACTED : undefined,
			cwd: runnerCwd,
			asyncDir,
			...(sessionRoot ? { sessionRoot } : {}),
			launchContractDigest,
			launchResolvedExtensions,
			...(params.parentWorkflowRunId ? { parentWorkflowRunId: params.parentWorkflowRunId } : {}),
			...(params.workflowKey ? { workflowKey: params.workflowKey } : {}),
			...(timeoutMs !== undefined ? { timeoutMs, deadlineAt } : {}),
			...(initialUsageBudget ? { usageBudget: initialUsageBudget } : {}),
			...(capabilityCeiling ? { capabilityCeiling } : {}),
			nestedRoute,
		});
	}

	return {
		content: [{ type: "text", text: formatAsyncStartedMessage(`Async: ${agent} [${id}]`, ctx.interactive === true) }],
		details: { mode: "single", runId: id, results: [], asyncId: id, asyncDir, launchContractDigest, launchResolvedExtensions, ...(capabilityCeiling ? { capabilityCeiling } : {}), ...(params.context ? { context: params.context } : {}), ...(timeoutMs !== undefined ? { timeoutMs, deadlineAt } : {}), ...(params.toolBudget ? { toolBudget: resolvedToolBudget.budget ?? params.toolBudget } : {}), ...(initialUsageBudget ? { usageBudget: initialUsageBudget } : {}) } as Details,
	};
	};
	return spawnResultOrPromise instanceof Promise ? spawnResultOrPromise.then(finishSpawnResult) : finishSpawnResult(spawnResultOrPromise);
}
