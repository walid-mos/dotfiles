import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const USAGE =
	'node ~/.config/agent-security/secret-move.mjs --name NAME --from PROJECT_ID/ENV --to PROJECT_ID/ENV [--path /] [--keep] [--replace]'
const API = 'https://app.infisical.com/api/v3/secrets/raw'
const TIMEOUT_MS = 30_000

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
	if (!values.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.name))
		throw new Error('Invalid secret name')
	if (!values.path.startsWith('/') || /[\r\n\0]/.test(values.path))
		throw new Error('Invalid secret path')
	return {
		...values,
		from: location(values.from),
		to: location(values.to),
	}
}

function location(text) {
	const match = /^([a-zA-Z0-9-]+)\/([a-zA-Z0-9_-]+)$/.exec(text ?? '')
	if (!match) throw new Error('A location is PROJECT_ID/ENV')
	return { workspaceId: match[1], environment: match[2] }
}

function sessionToken() {
	const result = spawnSync('infisical', ['user', 'get', 'token', '--plain'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
		timeout: TIMEOUT_MS,
	})
	const token = result.stdout?.trim()
	if (result.status !== 0 || !token)
		throw new Error('No Infisical session, run: infisical login')
	return token
}

async function call(token, method, url, body) {
	const response = await fetch(url, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const json = await response.json().catch(() => ({}))
	return { status: response.status, json }
}

function query(where, path) {
	return new URLSearchParams({ ...where, secretPath: path }).toString()
}

async function names(token, where, path) {
	const { status, json } = await call(token, 'GET', `${API}?${query(where, path)}`)
	if (status !== 200) throw new Error(`Cannot list ${where.environment}: HTTP ${status}`)
	return json.secrets.map(secret => secret.secretKey)
}

async function move(options) {
	const token = sessionToken()
	const { name, from, to, path } = options
	const read = await call(token, 'GET', `${API}/${name}?${query(from, path)}`)
	if (read.status !== 200 || read.json.secret?.secretValue === undefined)
		throw new Error(`${name} is not in the source (HTTP ${read.status})`)
	const existing = await names(token, to, path)
	if (existing.includes(name) && !options.replace)
		throw new Error(`${name} already exists in the target, pass --replace to overwrite it`)
	const body = { ...to, secretPath: path, secretValue: read.json.secret.secretValue }
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
