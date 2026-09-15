/** Pi 0.85.1 assistant-content boundary. Rebuild independently of the retired raw-text patch. */
import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Container, MouseRegion, Spacer, Text } from '@earendil-works/pi-tui'

import { ActivityNotice } from '../ui/activity-notice.ts'
import { uiTheme } from '../ui/design-system/theme.ts'
import { patchPiComponent } from '../ui/pi-component-patch.ts'
import { invokePiMethod, reflectMember } from '../ui/pi-members.ts'
import { ResponseDivider } from '../ui/response-divider.ts'
import { ResponseMarkdown } from '../ui/response-markdown.ts'

import { readResponseMessage } from './response-message.ts'

import type { MarkdownTransformer } from '@earendil-works/pi-coding-agent'
import type {
	Component,
	MarkdownOptions,
	MarkdownTheme,
} from '@earendil-works/pi-tui'
import type { ResponseEmphasis } from '../ui/response-divider.ts'
import type { ResponseMessage, ResponseSection } from './response-message.ts'

type TransformContext = Parameters<MarkdownTransformer>[1]
const PARAGRAPH_GAP = 1
const THEME_METHODS = [
	'heading',
	'link',
	'linkUrl',
	'code',
	'codeBlock',
	'codeBlockBorder',
	'quote',
	'quoteBorder',
	'hr',
	'listBullet',
	'bold',
	'italic',
	'strikethrough',
	'underline',
]

function isMarkdownTheme(theme: unknown): theme is MarkdownTheme {
	return THEME_METHODS.every(
		name => typeof reflectMember(theme, name) === 'function',
	)
}

function applyTransformer(
	transformer: unknown,
	source: string,
	context: TransformContext,
): string {
	if (typeof transformer !== 'function') return source
	try {
		const transformed: unknown = transformer(source, context)
		return typeof transformed === 'string' ? transformed : source
	} catch {
		// Match Pi: a faulty display transformer cannot erase the answer or skip later hooks.
		return source
	}
}

function markdownTransform(
	host: object,
	kind: ResponseSection['kind'],
): NonNullable<MarkdownOptions['transform']> {
	const candidates = reflectMember(host, 'markdownTransformers')
	const transformers: readonly unknown[] = Array.isArray(candidates)
		? candidates
		: []
	const isStreaming = reflectMember(host, 'isStreaming') === true
	const messageType = kind === 'thinking' ? 'assistant-thinking' : 'assistant'
	return (source, availableWidth) =>
		transformers.reduce<string>(
			(markdown, transformer) =>
				applyTransformer(transformer, markdown, {
					messageType,
					isStreaming,
					availableWidth,
				}),
			source,
		)
}

function markdownBlock(
	host: object,
	section: ResponseSection,
): ResponseMarkdown {
	const theme = reflectMember(host, 'markdownTheme')
	const padding = reflectMember(host, 'outputPad')
	const transform = markdownTransform(host, section.kind)
	return new ResponseMarkdown(
		section.text,
		isMarkdownTheme(theme) ? theme : getMarkdownTheme(),
		{
			inset: typeof padding === 'number' ? padding : 0,
			tone: section.kind === 'thinking' ? 'muted' : 'text',
			transform,
		},
	)
}

function thinkingBlock(
	host: object,
	section: ResponseSection,
	index: number,
): Component {
	const overrides = reflectMember(host, 'thinkingVisibilityOverrides')
	const override: unknown =
		overrides instanceof Map ? overrides.get(index) : undefined
	const isHidden =
		typeof override === 'boolean'
			? override
			: reflectMember(host, 'hideThinkingBlock') === true
	const label = reflectMember(host, 'hiddenThinkingLabel')
	if (isHidden && label === '') return new Container()
	const title = typeof label === 'string' && label ? label : 'Thinking'
	const content = new Container()
	content.addChild(
		new Text(uiTheme.fg('dim', `${isHidden ? '▸' : '▾'} ${title}`), 0, 0),
	)
	if (!isHidden) content.addChild(markdownBlock(host, section))
	return new MouseRegion(content, event => {
		if (event.type !== 'click' || event.button !== 'left') return undefined
		if (!(overrides instanceof Map)) return undefined
		overrides.set(index, !isHidden)
		invokePiMethod(
			host,
			'updateContent',
			reflectMember(host, 'lastMessage'),
		)
		return { handled: true }
	})
}

function noticeBlock(
	notice: NonNullable<ResponseMessage['notice']>,
): Component {
	const content = new Container()
	content.addChild(new Spacer(PARAGRAPH_GAP))
	content.addChild(new ActivityNotice(notice.text, notice.tone))
	return content
}

function textSection(
	host: object,
	kind: ResponseEmphasis,
	text: string,
	notice: ResponseMessage['notice'],
): Component {
	const content = new Container()
	content.addChild(new Spacer(PARAGRAPH_GAP))
	content.addChild(new ResponseDivider(kind))
	content.addChild(new Spacer(PARAGRAPH_GAP))
	content.addChild(markdownBlock(host, { kind, text }))
	if (notice) content.addChild(noticeBlock(notice))
	if (kind === 'intermediate') {
		content.addChild(new Spacer(PARAGRAPH_GAP))
		content.addChild(new ResponseDivider('intermediate-footer'))
	}
	return content
}

function rebuildResponse(
	host: object,
	message: unknown,
	mode: 'streaming' | 'settled',
): void {
	const view = readResponseMessage(message, mode)
	Reflect.set(host, 'lastMessage', message)
	Reflect.set(host, 'isStreaming', mode === 'streaming')
	Reflect.set(host, 'hasToolCalls', view.hasToolCalls)
	const container = reflectMember(host, 'contentContainer')
	invokePiMethod(container, 'clear')
	let thinkingIndex = 0
	const lastSection = view.sections.at(-1)
	for (const section of view.sections) {
		if (section.kind === 'thinking') {
			invokePiMethod(
				container,
				'addChild',
				thinkingBlock(host, section, thinkingIndex++),
			)
			continue
		}
		invokePiMethod(
			container,
			'addChild',
			textSection(
				host,
				section.kind,
				section.text,
				section === lastSection ? view.notice : undefined,
			),
		)
	}
	if (view.notice && (!lastSection || lastSection.kind === 'thinking'))
		invokePiMethod(container, 'addChild', noticeBlock(view.notice))
	if (
		view.notice ||
		view.sections.some(section => section.kind !== 'thinking')
	)
		invokePiMethod(container, 'addChild', new Spacer(PARAGRAPH_GAP))
}

export function installAssistantSurface(component: unknown): () => void {
	return patchPiComponent(component, 'pi.renderers.assistant', {
		updateContent(host, _original, args) {
			const isStreaming =
				typeof args[1] === 'boolean'
					? args[1]
					: reflectMember(host, 'isStreaming') === true
			rebuildResponse(
				host,
				args[0],
				isStreaming ? 'streaming' : 'settled',
			)
		},
	})
}
