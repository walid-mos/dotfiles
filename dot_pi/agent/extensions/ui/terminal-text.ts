/** Shared terminal layout policy over Pi's grapheme/ANSI-aware primitives. */
import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from '@earendil-works/pi-tui'

export type LineSink = (line: string) => void

export function columnWidth(width: number): number {
	return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0
}

/** No local Unicode tables: measurement must agree with Pi's compositor. */
export const terminalLineWidth = visibleWidth

/** Clipping closes active hyperlinks/styles; invalid widths have no content. */
export function truncateTerminalLine(
	line: string,
	width: number,
	ellipsis = '',
): string {
	return truncateToWidth(line, columnWidth(width), ellipsis)
}

/** Preserve newlines and styles while hard-wrapping overlong words.
 * Pi can emit an APC-only row at a wrap boundary; attach it to the previous
 * row so a hardware cursor marker does not create a blank visual line. */
export function wrapTerminalLine(text: string, width: number): string[] {
	const budget = columnWidth(width)
	if (!budget) return ['']
	const lines: string[] = []
	for (const line of wrapTextWithAnsi(text, budget)) {
		const previous = lines.at(-1)
		if (line && visibleWidth(line) === 0 && typeof previous === 'string') {
			lines[lines.length - 1] = previous + line
			continue
		}
		// A double-cell grapheme cannot fit in a one-cell viewport.
		lines.push(truncateTerminalLine(line, budget))
	}
	return lines
}

/** Hanging indentation shared by dialogs, previews and answer replays. */
export function pushWrapped(
	sink: LineSink,
	prefix: string,
	text: string,
	width: number,
): void {
	const budget = columnWidth(width)
	if (!budget) return
	const prefixWidth = visibleWidth(prefix)
	if (prefixWidth >= budget) {
		for (const line of wrapTerminalLine(prefix + text, budget)) sink(line)
		return
	}
	const continuation = ' '.repeat(prefixWidth)
	wrapTerminalLine(text, budget - prefixWidth).forEach((line, index) => {
		sink(`${index === 0 ? prefix : continuation}${line}`)
	})
}
