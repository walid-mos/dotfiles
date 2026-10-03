import type { AsyncJobState } from "../../shared/types.ts";
import {
	projectAsyncStatusSnapshot as buildAsyncStatusSnapshot,
	type AsyncStatusSnapshotOptions,
} from "../shared/async-status-projection.ts";

export {
	ASYNC_STATUS_SNAPSHOT_KIND,
	ASYNC_STATUS_SNAPSHOT_VERSION,
} from "../shared/async-status-projection.ts";
export type {
	AsyncStatusSnapshotActivity,
	AsyncStatusSnapshotCaps,
	AsyncStatusSnapshotHostStep,
	AsyncStatusSnapshotKind,
	AsyncStatusSnapshotNode,
	AsyncStatusSnapshotOmitted,
	AsyncStatusSnapshotOptions,
	AsyncStatusSnapshotState,
	AsyncStatusSnapshot,
} from "../shared/async-status-projection.ts";

export const ASYNC_STATUS_SNAPSHOT_WIDGET_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";

export { buildAsyncStatusSnapshot };

export function encodeAsyncStatusSnapshotWidget(jobs: Iterable<AsyncJobState>, options: AsyncStatusSnapshotOptions = {}): string[] {
	return [`${ASYNC_STATUS_SNAPSHOT_WIDGET_PREFIX}${JSON.stringify(buildAsyncStatusSnapshot(jobs, options))}`];
}
