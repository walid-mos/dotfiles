/** Applied edit/write previews; one cached code component for collapsed and expanded views. */
import { ChangeBlock } from '../ui/change-block.ts'
import { reflectMember } from '../ui/pi-members.ts'

import {
	nativeChangeDocument,
	writtenChangeDocument,
} from './change-document.ts'
import { payloadText, toolOutput } from './tool-payload.ts'
import { recalledWriteDocument } from './write-snapshots.ts'

import type { Component } from '@earendil-works/pi-tui'
import type { ChangeDocument } from '../ui/change-block.ts'
import type { RenderContext } from './tool-details.ts'

export class ToolChanges implements Component {
	private readonly name: string
	private args: unknown
	private toolResult: unknown
	private block: ChangeBlock | undefined

	constructor(name: string) {
		this.name = name
	}

	update(args: unknown, toolResult: unknown, context: RenderContext): void {
		if (!this.isMutation()) return
		if (args !== this.args || toolResult !== this.toolResult) {
			this.args = args
			this.toolResult = toolResult
			this.block = undefined
		}
		const output = toolOutput(toolResult)
		if (
			!output ||
			output.isError ||
			output.imageCount ||
			context.isPartial
		) {
			this.block = undefined
			return
		}
		if (!this.block) this.mount(this.document(context.toolCallId))
		this.block?.setView(context.expanded ? 'expanded' : 'preview')
	}

	isMutation(): boolean {
		return this.name === 'write' || this.name === 'edit'
	}

	isVisible(): boolean {
		return Boolean(this.block)
	}

	renderFooter(): string {
		return this.block?.renderFooter() ?? ''
	}

	render(width: number): string[] {
		return this.block?.render(width) ?? []
	}

	invalidate(): void {
		this.block?.invalidate()
	}

	private mount(document: ChangeDocument | undefined): void {
		if (!document) return
		this.block = new ChangeBlock(document)
	}

	private document(toolCallId: string): ChangeDocument | undefined {
		if (!payloadText(this.args, 'path')) return undefined
		const diff = payloadText(
			reflectMember(this.toolResult, 'details'),
			'diff',
		)
		if (diff) return nativeChangeDocument(diff)
		if (this.name !== 'write') return undefined
		const written = reflectMember(this.args, 'content')
		if (typeof written !== 'string') return undefined
		return (
			recalledWriteDocument(toolCallId, this.toolResult, this.args) ??
			writtenChangeDocument(written)
		)
	}
}
