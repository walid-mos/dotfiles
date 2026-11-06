import { parseArgs } from 'node:util'

import { API, call, names, query, sessionToken } from './infisical-rest.ts'
import {
	parseLocation,
	SECRET_NAME_PATTERN,
	SECRET_PATH_PATTERN,
} from './infisical-target.ts'

const USAGE =
	'node ~/.config/agent-security/secret-move.mjs --name NAME --from PROJECT_ID/ENV --to PROJECT_ID/ENV [--path /] [--keep] [--replace]'

function readOptions() {
	const { values } = parseArgs({
		options: {
			name: { type: 'string' },
			from: { type: 'string' },
			to: { type: 'string' },
			path: { type: 'string', default: '/' },
			keep: { type: 'boolean', default: false },
			replace: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false },
		},
	})
	if (values.help) return values
	if (!values.name || !new RegExp(SECRET_NAME_PATTERN, 'u').test(values.name))
		throw new Error('Invalid secret name')
	if (!new RegExp(SECRET_PATH_PATTERN, 'u').test(values.path))
		throw new Error('Invalid secret path')
	return {
		...values,
		from: parseLocation(values.from),
		to: parseLocation(values.to),
	}
}

async function move(options) {
	const token = sessionToken()
	const { name, from, to, path } = options
	const read = await call(token, 'GET', `${API}/${name}?${query(from, path)}`)
	const secretValue = read.json.secret?.secretValue
	if (read.status !== 200 || secretValue === undefined)
		throw new Error(`${name} is not in the source (HTTP ${read.status})`)
	const existing = await names(token, to, path)
	if (existing.includes(name) && !options.replace)
		throw new Error(`${name} already exists in the target, pass --replace to overwrite it`)
	const body = { ...to, secretPath: path, secretValue }
	const write = await call(token, existing.includes(name) ? 'PATCH' : 'POST', `${API}/${name}`, body)
	if (write.status !== 200) throw new Error(`Write to the target failed: HTTP ${write.status}`)
	if (!(await names(token, to, path)).includes(name))
		throw new Error(`${name} is not in the target after the write`)
	console.log(`${name}: written to ${to.workspaceId}/${to.environment}${path}`)
	if (options.keep) return
	const remove = await call(token, 'DELETE', `${API}/${name}`, { ...from, secretPath: path })
	if (remove.status !== 200) throw new Error(`Delete from the source failed: HTTP ${remove.status}; the target holds the value`)
	if ((await names(token, from, path)).includes(name))
		throw new Error(`${name} is still in the source after the delete`)
	console.log(`${name}: removed from ${from.workspaceId}/${from.environment}${path}`)
}

try {
	const options = readOptions()
	if (options.help) process.stdout.write(`${USAGE}\n`)
	else await move(options)
} catch (error) {
	process.stderr.write(`${error.message}. No value was printed. Usage: ${USAGE}\n`)
	process.exitCode = 1
}
