/**
 * What the lens children actually returned. `tool_execution_end` carries an
 * untyped result, so every field is checked here: a shape that does not match
 * is reported as a failure, never silently read as "no findings".
 */

import { isRecord } from './json.ts'
import { isStructuredRecoveryKey } from './lenses.ts'

import type { ToolExecutionEndEvent } from '@earendil-works/pi-coding-agent'
import type { Lens } from './types.ts'

export const SUBAGENT_TOOL = 'subagent'

export interface CapturedChild {
	workflowKey: string
	agent: string
	structuredOutput: unknown
	/** False when the child never offered a payload at all. */
	isStructuredOutputPresent: boolean
	structuredOutputFailed: boolean
	error?: string
	exitCode?: number
}

export interface CaptureState {
	/** How many `subagent` calls were observed in this window. */
	calls: number
	children: CapturedChild[]
	/** Results that could not be read at all, as user-facing diagnostics. */
	shapeErrors: string[]
}

export interface ChildCapture {
	reset(): void
	record(event: ToolExecutionEndEvent): void
	read(): CaptureState
}

export function createSubagentCapture(): ChildCapture {
	let calls = 0
	let shapeErrors: string[] = []
	let children: CapturedChild[] = []
	return {
		reset(): void {
			calls = 0
			shapeErrors = []
			children = []
		},
		record(event: ToolExecutionEndEvent): void {
			if (event.toolName !== SUBAGENT_TOOL) return
			calls += 1
			const results = childResults(event)
			if (typeof results === 'string') {
				shapeErrors = [...shapeErrors, results]
				return
			}
			for (const child of results)
				children = [
					...children.filter(
						existing => existing.workflowKey !== child.workflowKey,
					),
					child,
				]
		},
		read: () => ({ calls, children, shapeErrors }),
	}
}

function childResults(event: ToolExecutionEndEvent): CapturedChild[] | string {
	if (!isRecord(event.result))
		return 'the subagent tool returned no readable result'
	const { details } = event.result
	if (!isRecord(details)) return 'the subagent tool result carried no details'
	const { results } = details
	if (!Array.isArray(results))
		return 'the subagent tool result carried no results array'
	const captured = results.flatMap((entry, index) =>
		captureEntry(entry, index),
	)
	if (!captured.length)
		return 'the subagent tool result carried no child results'
	return captured
}

function captureEntry(entry: unknown, index: number): CapturedChild[] {
	if (!isRecord(entry)) return []
	const {
		agent,
		error,
		exitCode,
		structuredOutput,
		structuredOutputFailed,
		workflowKey,
	} = entry
	if (typeof agent !== 'string') return []
	const child: CapturedChild = {
		workflowKey:
			typeof workflowKey === 'string' ? workflowKey : `${agent}-${index}`,
		agent,
		structuredOutput,
		isStructuredOutputPresent: Boolean(structuredOutput),
		structuredOutputFailed: structuredOutputFailed === true,
	}
	if (typeof error === 'string') child.error = error
	if (typeof exitCode === 'number') child.exitCode = exitCode
	return [child]
}

/** Child results in the order the workflow keys were launched. */
export function childrenByKey(
	state: CaptureState,
	keys: readonly Lens[],
): Map<Lens, CapturedChild | undefined> {
	const byKey = new Map<Lens, CapturedChild | undefined>()
	keys.forEach((key, index) => {
		const matching = state.children.filter(
			child =>
				child.workflowKey === key ||
				isStructuredRecoveryKey(key, child.workflowKey),
		)
		byKey.set(key, matching.at(-1) ?? state.children[index])
	})
	return byKey
}
