/** Global display preference; goal checklist entries remain branch-local. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

const PREFERENCE_FILE = 'goal-widget.json'

function preferencePath(): string {
	return join(getAgentDir(), PREFERENCE_FILE)
}

function readVisibility(): boolean {
	try {
		const preference: unknown = JSON.parse(
			readFileSync(preferencePath(), 'utf8'),
		)
		return !(
			typeof preference === 'object' &&
			preference !== null &&
			Reflect.get(preference, 'visible') === false
		)
	} catch {
		return true
	}
}

export interface GoalVisibility {
	isVisible(): boolean
	setVisible(isVisible: boolean): void
}

export function goalVisibility(): GoalVisibility {
	let isVisible = readVisibility()
	return {
		isVisible: () => isVisible,
		setVisible: next => {
			if (next === isVisible) return
			try {
				writeFileSync(
					preferencePath(),
					`${JSON.stringify({ visible: next })}\n`,
				)
			} catch (cause) {
				throw new Error(
					'Could not save goal-widget visibility. Check agent directory permissions.',
					{ cause },
				)
			}
			isVisible = next
		},
	}
}
