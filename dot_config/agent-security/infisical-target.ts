/** Shape of an Infisical secret target, shared by the agent-security scripts and the Pi secret tool. */

export const PROJECT_ID_PATTERN = '^[a-zA-Z0-9-]+$'
export const ENVIRONMENT_PATTERN = '^[a-zA-Z0-9_-]+$'
export const SECRET_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$'
export const SECRET_PATH_PATTERN = '^/[^\\r\\n\\u0000]*$'

export interface SecretLocation {
	workspaceId: string
	environment: string
}

export interface SecretTarget extends SecretLocation {
	path: string
	name: string
}

function matches(pattern: string, text: unknown): text is string {
	return typeof text === 'string' && new RegExp(pattern, 'u').test(text)
}

/** `PROJECT_ID/ENV`, the location form the scripts take on the command line. */
export function parseLocation(text: unknown): SecretLocation {
	const match =
		typeof text === 'string'
			? /^([a-zA-Z0-9-]+)\/([a-zA-Z0-9_-]+)$/u.exec(text)
			: null
	if (!match?.[1] || !match[2]) throw new Error('A location is PROJECT_ID/ENV')
	return { workspaceId: match[1], environment: match[2] }
}

export function parseSecretTarget(raw: {
	projectId?: unknown
	environment?: unknown
	path?: unknown
	name?: unknown
}): SecretTarget {
	if (!matches(PROJECT_ID_PATTERN, raw.projectId))
		throw new Error('Invalid project ID')
	if (!matches(ENVIRONMENT_PATTERN, raw.environment))
		throw new Error('Invalid environment')
	const path = raw.path ?? '/'
	if (!matches(SECRET_PATH_PATTERN, path)) throw new Error('Invalid secret path')
	if (!matches(SECRET_NAME_PATTERN, raw.name))
		throw new Error('Invalid secret name')
	return {
		workspaceId: raw.projectId,
		environment: raw.environment,
		path,
		name: raw.name,
	}
}

export function describeTarget(target: SecretTarget): string {
	return `${target.workspaceId}/${target.environment}${target.path} ${target.name}`
}
