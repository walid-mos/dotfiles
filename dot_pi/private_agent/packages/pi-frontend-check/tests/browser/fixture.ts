import { createServer } from 'node:http'

import { FrontendBrowser } from '../../extensions/browser.ts'
import { defaults } from '../../extensions/schema.ts'

import type { TestContext } from 'node:test'
import type { Config } from '../../extensions/schema.ts'

const html = `<!doctype html><html><head><title>Frontend Check fixture</title>
<style>body{font:18px sans-serif;margin:24px}main{max-width:700px}button,input,select{font:inherit}#mode:after{content:'desktop'}@media(max-width:500px){#mode:after{content:'phone'}}</style>
</head><body><main><h1>Brave frontend fixture</h1>
<label>Name <input id="name"></label><button id="save">Save</button><output id="saved"></output>
<select id="choice"><option value="one">First label</option><option value="two">Second label</option></select>
<a id="popup" target="_blank" href="/popup">Open popup</a><div id="mode"></div>
<button class="ambiguous">Duplicate</button><button class="ambiguous">Duplicate</button>
<script>
document.querySelector('#save').onclick=()=>{document.querySelector('#saved').textContent=document.querySelector('#name').value;};
console.warn('fixture warning');
</script></main></body></html>`

type Fixture = {
	browser: FrontendBrowser
	url: string
	evaluationStarted: Promise<void>
}
const HTTP_NOT_FOUND = 404

export async function fixture(
	context: TestContext,
	overrides: Partial<Config> = {},
): Promise<Fixture> {
	const evaluationStarted = Promise.withResolvers<void>()
	const server = createServer((request, response) => {
		if (request.url === '/never') return
		if (request.url === '/evaluation-started') evaluationStarted.resolve()
		if (request.url === '/disconnect') {
			response.destroy()
			return
		}
		if (request.url === '/missing') {
			response.writeHead(HTTP_NOT_FOUND)
			response.end('missing')
			return
		}
		response.setHeader('Content-Type', 'text/html')
		response.end(
			request.url === '/popup'
				? '<title>Popup fixture</title><h1 id="popup-ready">Popup</h1>'
				: html,
		)
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (!address || typeof address === 'string')
		throw new Error('Expected TCP fixture server')
	const browser = new FrontendBrowser({ ...defaults, ...overrides })
	context.after(async () => {
		await browser.shutdown()
		server.closeAllConnections()
		await new Promise<void>((resolve, reject) =>
			server.close(error => (error ? reject(error) : resolve())),
		)
	})
	return {
		browser,
		url: `http://127.0.0.1:${address.port}`,
		evaluationStarted: evaluationStarted.promise,
	}
}
