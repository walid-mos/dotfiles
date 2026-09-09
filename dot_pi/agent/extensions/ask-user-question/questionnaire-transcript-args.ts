/** Streamed calls need only labels for the compact pending preview. */
function previewLabel(entry: unknown): string | undefined {
	if (typeof entry !== 'object' || entry === null) return undefined
	if (
		'label' in entry &&
		typeof entry.label === 'string' &&
		entry.label.trim()
	) {
		return entry.label.trim()
	}
	if ('id' in entry && typeof entry.id === 'string' && entry.id.trim()) {
		return entry.id.trim()
	}
	return '?'
}

export function previewLabels(args: unknown): string[] {
	if (typeof args !== 'object' || args === null || !('questions' in args))
		return []
	if (!Array.isArray(args.questions)) return []
	return args.questions.flatMap(entry => {
		const label = previewLabel(entry)
		return label ? [label] : []
	})
}
