export const MISSION_STATUSES = [
	"planned",
	"active",
	"waiting",
	"completed",
	"failed",
	"cancelled",
] as const;

export type MissionStatus = typeof MISSION_STATUSES[number];
export type MissionRunMode = "single" | "parallel" | "chain" | "workflow" | "external";
export type MissionArtifactKind = "status" | "output" | "patch" | "manifest" | "review" | "note" | "other";
export type MissionReceiptKind = "pull_request" | "ci" | "deployment" | "release";
export type MissionReceiptStatus = "pending" | "ready" | "succeeded" | "failed";

export interface MissionRunLink {
	runId: string;
	asyncDir?: string;
	childIndex?: number;
	agent?: string;
	mode: MissionRunMode;
	status?: string;
	startedAt?: string;
	completedAt?: string;
}

export interface MissionChildHeartbeat {
	updatedAt: string;
	status?: string;
	phase?: string;
	message?: string;
}

export interface MissionWorkflowChild {
	workflowRunId: string;
	key: string;
	status: string;
	startedAt: string;
	updatedAt: string;
	runId?: string;
	agent?: string;
	task?: string;
	label?: string;
	phase?: string;
	completedAt?: string;
	sessionPath?: string;
	artifactPaths: string[];
	heartbeat?: MissionChildHeartbeat;
}

export type MissionWorkflowChildUpdate = Pick<MissionWorkflowChild, "workflowRunId" | "key" | "status"> & Partial<Omit<MissionWorkflowChild, "workflowRunId" | "key" | "status" | "startedAt" | "updatedAt" | "artifactPaths" | "heartbeat">> & {
	startedAt?: string;
	artifactPaths?: string[];
	heartbeat?: Omit<MissionChildHeartbeat, "updatedAt"> & { updatedAt?: string };
};

export interface MissionArtifact {
	kind: MissionArtifactKind;
	path: string;
	description?: string;
}

export interface MissionReceipt {
	kind: MissionReceiptKind;
	status: MissionReceiptStatus;
	title: string;
	url: string;
	createdAt: string;
	description?: string;
}

export interface MissionRecord {
	schemaVersion: 1;
	id: string;
	title: string;
	objective: string;
	status: MissionStatus;
	createdAt: string;
	updatedAt: string;
	cwd?: string;
	ownerSessionId?: string;
	runs: MissionRunLink[];
	workflowChildren: MissionWorkflowChild[];
	artifacts: MissionArtifact[];
	receipts: MissionReceipt[];
	summary?: string;
	acceptance?: unknown;
	labels?: string[];
}

export interface MissionIndexEntry {
	schemaVersion: 1;
	missionId: string;
	projectRoot: string;
	recordPath: string;
	title: string;
	status: MissionStatus;
	updatedAt: string;
	lastRunId?: string;
}

export interface MissionStoreConfig {
	directory?: string;
	globalIndex?: boolean;
	globalIndexDir?: string;
	retainTerminal?: number;
}

export interface MissionStoreLocation {
	projectRoot: string;
	missionDir: string;
	globalIndexDir: string;
	writeGlobalIndex: boolean;
	retainTerminal?: number;
}

export interface MissionListResult {
	records: MissionRecord[];
	warnings: string[];
}

export interface GlobalMissionIndexRecord extends MissionIndexEntry {
	stale: boolean;
	staleReason?: string;
}

export interface GlobalMissionListResult {
	entries: GlobalMissionIndexRecord[];
	warnings: string[];
}

export interface MissionCreateInput {
	title: string;
	objective: string;
	status?: MissionStatus;
	labels?: string[];
	ownerSessionId?: string;
}

export interface MissionUpdateInput {
	title?: string;
	objective?: string;
	status?: MissionStatus;
	summary?: string;
	labels?: string[];
	acceptance?: unknown;
	addRuns?: MissionRunLink[];
	upsertWorkflowChildren?: MissionWorkflowChildUpdate[];
	addArtifacts?: MissionArtifact[];
	addReceipts?: Array<Omit<MissionReceipt, "createdAt">>;
}
