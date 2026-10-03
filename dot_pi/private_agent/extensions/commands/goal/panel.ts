/** Keyboard-readable goal overlay; typing closes it and reaches the editor. */
import { Key, decodeKittyPrintable, matchesKey } from '@earendil-works/pi-tui'

import { activeGoal } from '#lib/goal/state.ts'

import { maxGoalDetailOffset, renderGoalPanel } from './panel-view.ts'
import { nextGoalItem } from './widget.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
	Component,
	TuiMouseEvent,
	TuiMouseEventResult,
} from '@earendil-works/pi-tui'
import type { GoalSnapshot, GoalState } from '#lib/goal/state.ts'

const PAGE_CHROME_ROWS = 6
const ASCII_CONTROL_END = 0x20
const DEL_CODE = 0x7f
let closeGoalPanel: (() => void) | undefined

/** Chat typing reads as text: single keys (incl. kitty CSI-u) and batched chunks. */
function typedText(keyData: string): string | undefined {
	const decoded = decodeKittyPrintable(keyData)
	if (decoded) return decoded
	if (!keyData || keyData.includes('\x1b')) return undefined
	let text = ''
	for (const char of keyData) {
		const code = char.codePointAt(0) ?? 0
		if (code < ASCII_CONTROL_END || code === DEL_CODE) return undefined
		text += char
	}
	return text
}

/** Widget visibility the screen mirrors with `^h`; wired in by callers, never imported from status. */
export type GoalWidgetVisibility = {
	isVisible: () => boolean
	setVisible: (isVisible: boolean) => void
}

type GoalPanelControls = {
	height: () => number
	repaint: () => void
	close: () => void
	visibility: GoalWidgetVisibility
}

class GoalPanel implements Component {
	private cursor = 0
	private pausedIndex = -1
	private isDetail = false
	private detailOffset = 0
	private lastWidth = 0

	constructor(
		private readonly context: ExtensionContext,
		private readonly controls: GoalPanelControls,
	) {
		this.selectNext(this.snapshot())
	}

	private state(): GoalState | undefined {
		return activeGoal(this.context.sessionManager.getBranch())
	}

	private snapshot(): GoalSnapshot {
		const state = this.state()
		return (
			(this.pausedIndex < 0
				? state
				: state?.paused?.[this.pausedIndex]) ?? { items: [] }
		)
	}

	private selectNext(snapshot: GoalSnapshot): void {
		const next = nextGoalItem(snapshot)
		this.cursor = Math.max(
			0,
			snapshot.items.findIndex(goalItem => goalItem.id === next?.id),
		)
		this.detailOffset = 0
	}

	render(width: number): string[] {
		this.lastWidth = width
		const state = this.state()
		const snapshot = this.snapshot()
		this.cursor = Math.min(
			this.cursor,
			Math.max(0, snapshot.items.length - 1),
		)
		return renderGoalPanel({
			snapshot,
			label:
				this.pausedIndex < 0
					? 'active'
					: `paused ${String(this.pausedIndex + 1)}/${String(state?.paused?.length ?? 0)}`,
			pausedCount: state?.paused?.length ?? 0,
			cursor: this.cursor,
			isDetail: this.isDetail,
			detailOffset: this.detailOffset,
			isVisible: this.controls.visibility.isVisible(),
			width,
			height: this.controls.height(),
		})
	}

	invalidate(): void {
		this.lastWidth = 0
	}

	private switchGoal(): void {
		const pausedCount = this.state()?.paused?.length ?? 0
		if (!pausedCount) return
		this.pausedIndex =
			this.pausedIndex + 1 >= pausedCount ? -1 : this.pausedIndex + 1
		this.isDetail = false
		this.selectNext(this.snapshot())
		this.controls.repaint()
	}

	private toggleVisibility(): void {
		try {
			this.controls.visibility.setVisible(
				!this.controls.visibility.isVisible(),
			)
		} catch (error) {
			this.context.ui.notify(
				error instanceof Error ? error.message : String(error),
				'error',
			)
			return
		}
		this.controls.repaint()
	}

	private move(delta: number): void {
		if (this.isDetail) {
			const limit = maxGoalDetailOffset({
				snapshot: this.snapshot(),
				cursor: this.cursor,
				width: this.lastWidth,
				height: this.controls.height(),
			})
			this.detailOffset = Math.max(
				0,
				Math.min(limit, this.detailOffset + delta),
			)
			this.controls.repaint()
		} else
			this.cursor = Math.max(
				0,
				Math.min(this.snapshot().items.length - 1, this.cursor + delta),
			)
		this.controls.repaint()
	}

	/** Chat input outranks the screen: close, then hand the typing to the editor. */
	private typeThrough(text: string): void {
		this.controls.close()
		this.context.ui.pasteToEditor(text)
	}

	/** Any left click on the checklist, like the widget, closes the screen. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== 'click' || event.button !== 'left') return undefined
		this.controls.close()
		return { handled: true }
	}

	handleInput(keyData: string): void {
		if (matchesKey(keyData, Key.escape)) {
			if (!this.isDetail) return this.controls.close()
			this.isDetail = false
			this.detailOffset = 0
			return this.controls.repaint()
		}
		if (matchesKey(keyData, Key.ctrl('h'))) return this.toggleVisibility()
		if (matchesKey(keyData, Key.ctrl('p'))) return this.switchGoal()
		if (
			matchesKey(keyData, Key.enter) &&
			!this.isDetail &&
			this.snapshot().items.length
		) {
			this.isDetail = true
			return this.controls.repaint()
		}
		if (matchesKey(keyData, Key.up)) return this.move(-1)
		if (matchesKey(keyData, Key.down)) return this.move(1)
		if (matchesKey(keyData, Key.pageUp))
			return this.move(
				-Math.max(1, this.controls.height() - PAGE_CHROME_ROWS),
			)
		if (matchesKey(keyData, Key.pageDown))
			return this.move(
				Math.max(1, this.controls.height() - PAGE_CHROME_ROWS),
			)
		if (matchesKey(keyData, Key.home))
			return this.move(-Number.MAX_SAFE_INTEGER)
		if (matchesKey(keyData, Key.end))
			return this.move(Number.MAX_SAFE_INTEGER)
		const text = typedText(keyData)
		if (text) return this.typeThrough(text)
	}
}

/** Toggle the one checklist screen through Pi's completion callback. */
export async function toggleGoalPanel(
	ctx: ExtensionContext,
	visibility: GoalWidgetVisibility,
): Promise<void> {
	if (closeGoalPanel) return closeGoalPanel()
	try {
		await ctx.ui.custom<void>(
			(tui, _theme, _keys, close) => {
				closeGoalPanel = close
				return new GoalPanel(ctx, {
					height: () => tui.terminal.rows,
					repaint: () => tui.requestRender(),
					close,
					visibility,
				})
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: 'top-left',
					width: '100%',
					maxHeight: '100%',
				},
			},
		)
	} finally {
		closeGoalPanel = undefined
	}
}
