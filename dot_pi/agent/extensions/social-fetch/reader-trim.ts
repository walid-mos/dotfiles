/** Reader markdown trimming: collapse media/link noise, bounded length. */

const MAX_LINK_HREF_CHARACTERS = 120
const TRUNCATION_SUFFIX = '\n…(truncated)'

const NESTED_IMAGE_PATTERN = /\[!\[([^\]]*)\]\(([^()\s]+)\)\]\(([^()\s]+)\)/g
const FLAT_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^()\s]+)\)/g
const LINK_PATTERN = /\[([^\]\n]*)\]\(([^()\s]+)\)/g
const BLANK_RUN_PATTERN = /\n{3,}/g

/** Alt-text-only placeholder for one rendered image. */
function imagePlaceholder(altText: string): string {
	const trimmed = altText.trim()
	return trimmed ? `(image: ${trimmed})` : '(image)'
}

/**
 * Deterministic cleanup of one Jina Reader render: image anchors become
 * alt-text placeholders (their signed CDN URLs are noise), links keep their
 * href only when short, blank runs collapse, and the result is capped at
 * `maxCharacters` with an explicit truncation marker.
 */
export function trimReaderMarkdown(
	markdown: string,
	maxCharacters: number,
): string {
	let trimmed = markdown.replace(NESTED_IMAGE_PATTERN, (_match, altText) =>
		imagePlaceholder(altText),
	)
	trimmed = trimmed.replace(FLAT_IMAGE_PATTERN, (_match, altText) =>
		imagePlaceholder(altText),
	)
	trimmed = trimmed.replace(
		LINK_PATTERN,
		(match, linkText: string, href: string) =>
			href.length <= MAX_LINK_HREF_CHARACTERS ? match : `[${linkText}]`,
	)
	trimmed = trimmed.replace(BLANK_RUN_PATTERN, '\n\n').trim()
	if (trimmed.length <= maxCharacters) return trimmed
	const keepLength = Math.max(0, maxCharacters - TRUNCATION_SUFFIX.length)
	return `${trimmed.slice(0, keepLength)}${TRUNCATION_SUFFIX}`
}
