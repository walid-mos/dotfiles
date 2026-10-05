import type { Page } from 'playwright-core'
import type { BrowserLog } from './report.ts'

const HTTP_CLIENT_ERROR = 400
const HTTP_SERVER_ERROR = 500
const CONSOLE_LEVELS = { error: 'error', warning: 'warning' } as const

export function observePage(page: Page, log: BrowserLog): void {
	page.on('console', message => {
		const kind = message.type()
		const level =
			kind === 'error' || kind === 'warning'
				? CONSOLE_LEVELS[kind]
				: 'info'
		log.record({ kind: 'console', level, text: message.text() })
	})
	page.on('pageerror', error =>
		log.record({ kind: 'pageerror', level: 'error', text: error.message }),
	)
	page.on('requestfailed', request => {
		const failure = request.failure()?.errorText ?? 'failed'
		if (failure === 'net::ERR_ABORTED') return
		log.record({
			kind: 'requestfailed',
			level: 'error',
			text: `${request.method()} ${request.url()} - ${failure}`,
		})
	})
	page.on('response', response => {
		if (response.status() < HTTP_CLIENT_ERROR) return
		log.record({
			kind: 'http',
			level: response.status() >= HTTP_SERVER_ERROR ? 'error' : 'warning',
			text: `HTTP ${response.status()} ${response.request().method()} ${response.url()}`,
		})
	})
	// With no dialog listener, Playwright dismisses dialogs automatically.
}
