/**
 * `@file` completion from the Boat: the anchor holds no project files, so an
 * `@token` at the cursor is matched against the checkout's `rg --files` list
 * (refreshed at most every 30 s); everything else stays with Pi's provider.
 */
import { runtimeFor } from '#lib/runtime/runtime.ts'

import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from '@earendil-works/pi-tui'
import type { Anchor } from '#lib/runtime/anchor.ts'

const AT_TOKEN = /(?:^|\s)@([^\s]*)$/u
const MAX_ITEMS = 20
const LIST_TTL_MS = 30_000

type FileList = {
	readonly listedAtMs: number
	readonly files: Promise<string[]>
}

export function boatFileCompletion(
	anchor: Anchor,
): (current: AutocompleteProvider) => AutocompleteProvider {
	let list: FileList | undefined
	const files = (): Promise<string[]> => {
		if (list && Date.now() - list.listedAtMs < LIST_TTL_MS)
			return list.files
		list = { listedAtMs: Date.now(), files: listFiles(anchor) }
		return list.files
	}
	return current => ({
		...(current.triggerCharacters && {
			triggerCharacters: current.triggerCharacters,
		}),
		getSuggestions: async (lines, cursorLine, cursorCol, options) => {
			const before = (lines[cursorLine] ?? '').slice(0, cursorCol)
			const match = AT_TOKEN.exec(before)
			if (!match)
				return current.getSuggestions(
					lines,
					cursorLine,
					cursorCol,
					options,
				)
			return suggestions(match[1] ?? '', await files())
		},
		applyCompletion: (...args) => current.applyCompletion(...args),
		shouldTriggerFileCompletion: (...args) =>
			current.shouldTriggerFileCompletion?.(...args) ?? false,
	})
}

async function listFiles(anchor: Anchor): Promise<string[]> {
	try {
		const listing = await runtimeFor(anchor.root).run(
			'rg --files',
			anchor.root,
		)
		return listing.stdout.split('\n').filter(Boolean).toSorted()
	} catch {
		return []
	}
}

function suggestions(
	token: string,
	files: string[],
): AutocompleteSuggestions | null {
	const query = token.toLocaleLowerCase()
	const items: AutocompleteItem[] = files
		.filter(file => file.toLocaleLowerCase().includes(query))
		.toSorted((left, right) => rank(left, query) - rank(right, query))
		.slice(0, MAX_ITEMS)
		.map(file => ({ value: `@${file}`, label: file }))
	if (!items.length) return null
	return { items, prefix: `@${token}` }
}

/** Basename hits first, then shorter paths. */
function rank(file: string, query: string): number {
	const name = file.slice(file.lastIndexOf('/') + 1).toLocaleLowerCase()
	return (name.includes(query) ? 0 : file.length) + file.length
}
