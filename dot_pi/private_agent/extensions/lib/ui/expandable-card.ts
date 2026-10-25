import { Container, MouseRegion } from '@earendil-works/pi-tui'

import type { MessageRenderOptions } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

type CardExpansion = Pick<MessageRenderOptions, 'expanded'>

export function expandableCard(
	options: CardExpansion,
	createCard: (options: CardExpansion) => Component,
): Component {
	let isExpanded = options.expanded
	const content = new Container()
	const rebuild = (): void => {
		content.clear()
		content.addChild(createCard({ expanded: isExpanded }))
	}
	rebuild()
	return new MouseRegion(content, event => {
		if (event.type !== 'click' || event.button !== 'left') return undefined
		isExpanded = !isExpanded
		rebuild()
		return { handled: true, render: true }
	})
}
