/** Bound display text in code instead of relying on model length estimates. */
import { TITLE_LIMIT } from './contracts.ts'

export function titleText(text: string): string {
	return Array.from(text.replace(/[\p{Cc}\s]+/gu, ' ').trim())
		.slice(0, TITLE_LIMIT)
		.join('')
		.trim()
}

export function boundedTitles(candidate: unknown): unknown {
	if (!candidate || typeof candidate !== 'object') return candidate
	const groups = ['panes', 'tabs'].map(kind => {
		const members: unknown = Reflect.get(candidate, kind)
		return [
			kind,
			Array.isArray(members) ? members.map(boundTitle) : members,
		]
	})
	return { ...candidate, ...Object.fromEntries(groups) }
}

function boundTitle(candidate: unknown): unknown {
	if (!candidate || typeof candidate !== 'object') return candidate
	const title: unknown = Reflect.get(candidate, 'title')
	return typeof title === 'string'
		? { ...candidate, title: titleText(title) }
		: candidate
}
