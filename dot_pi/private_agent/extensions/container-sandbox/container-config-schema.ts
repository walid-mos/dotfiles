/** The wt declaration schema, as the fix surface knows it: the prompt guide
 * the model writes against, and the structural validation its answer must
 * pass. wt stays the final judge - a file that passes here can still be
 * rejected by wt, and the sync flow regenerates on that verdict. */

const ALLOWED_KEYS = new Set([
	'image',
	'dns',
	'cpus',
	'memory',
	'user',
	'env',
	'ports',
	'hostServices',
	'network',
	'provision',
	'deprovision',
])

const BLOCK_PRIMITIVES = ['values', 'env', 'database', 'requests']

const MEMORY = /^\d+(K|M|G|T|P)$/
const PORT = /^\d+:\d+(\/(tcp|udp))?$/

export type Declaration = Record<string, unknown>

/** What the model writes against: wt's own schema, the defaults it may
 * override, and the house reading of when each key is worth declaring. */
export const SCHEMA_GUIDE = [
	'Allowed top-level keys: image, dns, cpus, memory, user, env, ports, hostServices, network, provision, deprovision. Never output "activation" - wt decides it at spawn.',
	'- image: string. Keep the default wt image (studio-dev:node24-pnpm11) unless the facts show the project cannot run on it - overriding it with a bare runtime image (e.g. node:24) loses the prepared toolchain (pnpm, git, socat, the relay plumbing).',
	'- dns: string. cpus: positive integer. memory: string like "2G". user: optional string.',
	'- env: object of string values, merged by key; the place for tool configuration the install needs (e.g. HUSKY=0 for a project whose hooks need host git metadata).',
	'- ports: array of "host:container[/tcp|udp]". Publish ONLY ports that must answer from the macOS host as localhost:<host>; dev servers already answer on the workspace tailnet name without any declaration.',
	'- hostServices: { ports: number[] (host-side services the VM must reach on its localhost, e.g. a database already running on the host), start: string (the project command that starts them on the host, only when they are not already running), hosts: string[] (host names the VM must resolve, e.g. a tailnet identity provider) }. All three optional.',
	'- network: object; omit unless the facts demand it.',
	'- provision / deprovision: declarations, never scripts. Primitives: values (string with ${...} substitutions, or an ordered array of match/format rules), env (array of steps: { file, seed?, values? } - seed a dotenv file from its .example template, upsert values), database ({ ensure: "<postgres url>", drop?: "<url>" }), requests (array of HTTP steps: { url, form?, json?, expect?, capture? }). A step may declare when (a substitution; the step is skipped when it resolves empty) and retries (number, for waiting on a stack that has just started). provision must be idempotent, runs inside the container with /workspace as cwd after the dependency install, at spawn and at every sync; deprovision runs before teardown so wt clean leaves nothing behind.',
].join('\n')

export type SchemaVerdict =
	| { ok: true; declaration: Declaration; summary: string }
	| { ok: false; reason: string }

/** Validate the model's reply: one JSON object, only allowed keys, only wt shapes. */
export function validateDeclaration(reply: string): SchemaVerdict {
	const parsed = parseJsonObject(reply)
	if (!parsed.ok) return parsed
	const unknown = Object.keys(parsed.value).filter(
		key => !ALLOWED_KEYS.has(key),
	)
	if (unknown.length) {
		return {
			ok: false,
			reason: `unknown keys: ${unknown.join(', ')} (allowed: ${[...ALLOWED_KEYS].join(', ')})`,
		}
	}
	if (!Object.keys(parsed.value).length) {
		return { ok: false, reason: 'the declaration declares nothing' }
	}
	const shape = shapeReason(parsed.value)
	if (shape) return { ok: false, reason: shape }
	return {
		ok: true,
		declaration: parsed.value,
		summary: describeDeclaration(parsed.value),
	}
}

function parseJsonObject(
	reply: string,
): { ok: true; value: Declaration } | { ok: false; reason: string } {
	const unfenced = reply
		.replace(/^```(?:json)?/m, '')
		.replace(/```$/m, '')
		.trim()
	const start = unfenced.indexOf('{')
	const end = unfenced.lastIndexOf('}')
	if (start < 0 || end <= start) {
		return { ok: false, reason: 'the reply held no JSON object' }
	}
	try {
		// oxlint-disable-next-line nextnode/no-generic-runtime-guard -- the model reply's own JSON boundary, narrowed by the object check that follows
		const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1))
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { ok: false, reason: 'the JSON is not an object' }
		}
		return { ok: true, value: Object.fromEntries(Object.entries(parsed)) }
	} catch (error) {
		return {
			ok: false,
			reason: `invalid JSON: ${error instanceof Error ? error.message : 'parse error'}`,
		}
	}
}

// oxlint-disable-next-line nextnode/no-generic-runtime-guard -- canonical guard on wt's untyped declaration keys, one line for every shape check below
const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
	typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)

const SHAPE_CHECKS: [key: string, reason: (field: unknown) => string | null][] = [
	['image', stringReason('image')],
	['dns', stringReason('dns')],
	['cpus', cpusReason],
	['memory', memoryReason],
	['user', stringReason('user')],
	['env', envReason],
	['ports', portsReason],
	['hostServices', hostServicesReason],
	['network', recordReason('network')],
	['provision', field => blockReason('provision', field)],
	['deprovision', field => blockReason('deprovision', field)],
]

function stringReason(label: string) {
	return (field: unknown): string | null => {
		if (typeof field === 'string') return null
		return `${label} must be a string`
	}
}

function recordReason(label: string) {
	return (field: unknown): string | null => {
		if (isRecord(field)) return null
		return `${label} must be an object`
	}
}

function cpusReason(cpus: unknown): string | null {
	if (typeof cpus === 'number' && Number.isInteger(cpus) && cpus >= 1) return null
	return 'cpus must be a positive integer'
}

function memoryReason(memory: unknown): string | null {
	if (typeof memory === 'string' && MEMORY.test(memory)) return null
	return 'memory must be a string like "2G"'
}

/** One reason per broken shape, first found; null when every declared key is well-formed. */
function shapeReason(declaration: Declaration): string | null {
	for (const [key, check] of SHAPE_CHECKS) {
		if (!(key in declaration)) continue
		const reason = check(declaration[key])
		if (reason) return reason
	}
	return null
}

function envReason(env: unknown): string | null {
	if (!isRecord(env)) return 'env must be an object'
	if (Object.values(env).some(text => typeof text !== 'string'))
		return 'env values must be strings'
	return null
}

function portsReason(ports: unknown): string | null {
	if (
		!Array.isArray(ports) ||
		ports.some(port => typeof port !== 'string' || !PORT.test(port))
	) {
		return 'ports must be strings like "5173:5173"'
	}
	return null
}

function hostServicesReason(hostServices: unknown): string | null {
	if (!isRecord(hostServices)) return 'hostServices must be an object'
	const hostPorts = Reflect.get(hostServices, 'ports')
	if (
		hostPorts &&
		(!Array.isArray(hostPorts) || hostPorts.some(port => typeof port !== 'number'))
	) {
		return 'hostServices.ports must be numbers'
	}
	const start = Reflect.get(hostServices, 'start')
	if (start && typeof start !== 'string') return 'hostServices.start must be a string'
	const hosts = Reflect.get(hostServices, 'hosts')
	if (
		hosts &&
		(!Array.isArray(hosts) || hosts.some(name => typeof name !== 'string'))
	) {
		return 'hostServices.hosts must be an array of strings'
	}
	return null
}

function blockReason(key: string, block: unknown): string | null {
	if (!isRecord(block)) return `${key} must be an object`
	const unknownStep = Object.keys(block).filter(
		name => !BLOCK_PRIMITIVES.includes(name),
	)
	if (unknownStep.length) {
		return `${key} has unknown primitives: ${unknownStep.join(', ')} (allowed: ${BLOCK_PRIMITIVES.join(', ')})`
	}
	const steps = Reflect.get(block, 'env')
	if (
		steps &&
		(!Array.isArray(steps) ||
			steps.some(step => {
				const { file } = step
				return !isRecord(step) || typeof file !== 'string'
			}))
	) {
		return `${key}.env must be steps with a "file"`
	}
	const requests = Reflect.get(block, 'requests')
	if (
		requests &&
		(!Array.isArray(requests) ||
			requests.some(step => {
				const { url } = step
				return !isRecord(step) || typeof url !== 'string'
			}))
	) {
		return `${key}.requests must be steps with a "url"`
	}
	return null
}

/** One short line for the notification: what the file now declares. */
export function describeDeclaration(declaration: Declaration): string {
	const parts: string[] = []
	const { image, memory, cpus, ports, hostServices, provision } = declaration
	if (typeof image === 'string') parts.push(`image ${image}`)
	if (typeof memory === 'string') parts.push(`memory ${memory}`)
	if (typeof cpus === 'number') parts.push(`${cpus} cpus`)
	if (Array.isArray(ports) && ports.length) parts.push(`published ports ${ports.join(', ')}`)
	if (isRecord(hostServices)) {
		const { ports: hostPorts } = hostServices
		if (Array.isArray(hostPorts) && hostPorts.length) {
			parts.push(`host services ${hostPorts.join(', ')}`)
		}
	}
	if (isRecord(provision)) {
		const { env: envSteps } = provision
		if (Array.isArray(envSteps) && envSteps.length) {
			parts.push(`${envSteps.length} env step(s)`)
		}
		if (provision.database) parts.push('database setup')
	}
	if (declaration.deprovision) parts.push('deprovision')
	return parts.join(', ') || 'defaults'
}
