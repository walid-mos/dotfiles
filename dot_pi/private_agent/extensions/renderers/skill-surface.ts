/** Adapt Pi's skill invocation card to the house callout: the native toggle
 * contract (global Ctrl+O, plus a click that native never handled) as before,
 * but the band is painted by skill-block.ts instead of a flat Pi background. */
import { patchPiComponent } from '../ui/pi-component-patch.ts'
import { invokePiMethod, reflectMember } from '../ui/pi-members.ts'

import { SkillBlock } from './skill-block.ts'

import type { MarkdownTheme } from '@earendil-works/pi-tui'
import type { SkillSource } from './skill-block.ts'

const FALLBACK_TOGGLE = 'ctrl+o'

/** The collapse/expand key label, resolved from the running CLI's keybindings. */
export function skillToggleKey(keyText: unknown): string {
	if (typeof keyText !== 'function') return FALLBACK_TOGGLE
	const key: unknown = Reflect.apply(keyText, undefined, ['app.tools.expand'])
	return typeof key === 'string' && key ? key : FALLBACK_TOGGLE
}

function memberText(source: unknown, member: string): string {
	const resolved = reflectMember(source, member)
	return typeof resolved === 'string' ? resolved : ''
}

function isMarkdownTheme(source: unknown): source is MarkdownTheme {
	return typeof source === 'object' && source !== null
}

function skillSource(host: object): SkillSource {
	const block = reflectMember(host, 'skillBlock')
	return {
		name: memberText(block, 'name'),
		location: memberText(block, 'location'),
		content: memberText(block, 'content'),
	}
}

function cardFor(
	host: object,
	cards: WeakMap<object, SkillBlock>,
	toggleKey: string,
): SkillBlock {
	const existing = cards.get(host)
	if (existing) return existing
	const theme = reflectMember(host, 'markdownTheme')
	const card = new SkillBlock(
		skillSource(host),
		isMarkdownTheme(theme) ? theme : undefined,
		toggleKey,
	)
	cards.set(host, card)
	return card
}

/** A stationary left click anywhere on the band folds or expands the card. */
function handleBandClick(
	host: object,
	event: unknown,
	original: (...inputs: unknown[]) => unknown,
	args: readonly unknown[],
): unknown {
	if (
		reflectMember(event, 'type') !== 'click' ||
		reflectMember(event, 'button') !== 'left'
	)
		return original(...args)
	invokePiMethod(
		host,
		'setExpanded',
		reflectMember(host, 'expanded') !== true,
	)
	return { handled: true }
}

export function patchSkillInvocations(
	component: unknown,
	toggleKey: string,
): () => void {
	const cards = new WeakMap<object, SkillBlock>()
	const cardForHost = (host: object): SkillBlock =>
		cardFor(host, cards, toggleKey)
	return patchPiComponent(component, 'pi.renderers.skill', {
		render(host, _original, args) {
			return cardForHost(host).renderBand(
				typeof args[0] === 'number' ? args[0] : 0,
			)
		},
		handleMouse(host, original, args) {
			return handleBandClick(host, args[0], original, args)
		},
		invalidate(host, original, args) {
			cardForHost(host).invalidate()
			return original(...args)
		},
		updateDisplay(host) {
			cardForHost(host).setExpanded(
				reflectMember(host, 'expanded') === true,
			)
			return undefined
		},
	})
}
