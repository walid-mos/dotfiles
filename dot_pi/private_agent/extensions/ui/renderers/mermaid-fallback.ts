/** Show Pi's Mermaid diagnostics without filling the transcript with unrendered source. */
import { Marked } from '@earendil-works/pi-tui'

import type { MarkdownTransformContext } from '@earendil-works/pi-coding-agent'
import type { Token } from '@earendil-works/pi-tui'

const markdownParser = new Marked()
const WARNING = 'Mermaid diagram not rendered:'

function isMermaid(token: Token): boolean {
	return (
		token.type === 'code' &&
		token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === 'mermaid'
	)
}

export function replaceUnrenderedMermaid(
	markdown: string,
	context: MarkdownTransformContext,
): string {
	if (context.messageType !== 'assistant' || !/mermaid/i.test(markdown))
		return markdown
	const tokens = markdownParser.lexer(markdown)
	return tokens
		.map((token, index) => {
			if (!isMermaid(token)) return token.raw
			if (context.isStreaming) return '> Mermaid diagram rendering…\n\n'
			const hasWarning = tokens[index + 1]?.raw.includes(WARNING)
			return hasWarning
				? '> Mermaid diagram has an error; see the warning below.\n\n'
				: `> Mermaid diagram could not fit in ${context.availableWidth} columns or uses unsupported syntax. Try a narrower layout.\n\n`
		})
		.join('')
}
