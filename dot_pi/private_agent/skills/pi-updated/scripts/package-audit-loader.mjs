import { registerHooks } from 'node:module'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const hostRoot = process.env.PI_AUDIT_HOST_ROOT
if (!hostRoot)
	throw new Error('PI_AUDIT_HOST_ROOT must identify the installed Pi package')
const parentURL = pathToFileURL(join(hostRoot, 'package.json')).href
const [installation] = hostRoot.split(`${sep}node_modules${sep}`)
const installationURL = `${pathToFileURL(join(installation, 'node_modules')).href}/`
const hostNamespace = /^(?:@earendil-works\/|@mariozechner\/|typebox(?:\/|$))/
const rootAliases = new Map([
	['@earendil-works/pi-ai', '@earendil-works/pi-ai/compat'],
])

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (
			!hostNamespace.test(specifier) ||
			context.parentURL?.startsWith(installationURL)
		)
			return nextResolve(specifier, context)
		return nextResolve(rootAliases.get(specifier) ?? specifier, {
			...context,
			parentURL,
		})
	},
})
