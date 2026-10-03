import type { WorkflowGraphNode, WorkflowGraphSnapshot } from "../../shared/types.ts";

/** Return displayable workflow stages while hiding structural parallel groups and host monitors. */
export function workflowGraphStageNodes(graph: WorkflowGraphSnapshot | undefined): WorkflowGraphNode[] {
	const nodes = graph?.nodes;
	if (!nodes?.length) return [];
	const stages: WorkflowGraphNode[] = [];
	const visit = (node: WorkflowGraphNode): void => {
		if (node.kind === "parallel-group") {
			for (const child of node.children ?? []) visit(child);
			return;
		}
		if (node.kind !== "host-step") stages.push(node);
	};
	for (const node of nodes) visit(node);
	return stages;
}
