/** Reflective access to pi-core internals: the dist typings keep these members
 * private, so the patches route reads and writes through member-name strings
 * that are re-diffed per release (DESIGN.md §10). */
export function reflectMember(host: unknown, member: string): unknown {
	const object = typedHost(host)
	if (!object) return undefined
	return Reflect.get(object, member)
}

/** Call a checked runtime method without leaking Pi's private types. */
export function invokePiMethod(
	host: unknown,
	member: string,
	...args: unknown[]
): unknown {
	const method = reflectMember(host, member)
	if (typeof method !== 'function')
		throw new Error(
			`Pi method ${member} missing; re-audit the installed Pi version.`,
		)
	return Reflect.apply(method, host, args)
}

/** Validate native component output before it reaches a gutter or terminal compositor. */
export function renderPiComponent(host: unknown, width: number): string[] {
	const lines: unknown = invokePiMethod(host, 'render', width)
	if (!Array.isArray(lines) || !lines.every(line => typeof line === 'string'))
		throw new Error(
			'Pi component returned invalid render lines; expected string[].',
		)
	return lines
}

/** Object-typed view for Reflect.set targets, or undefined when the host is
 * not an object-ish value. */
export function typedHost(source: unknown): object | undefined {
	if (!source) return undefined
	if (typeof source !== 'object' && typeof source !== 'function')
		return undefined
	return source
}

/** Idempotence marker: the patch names its replacement functions. */
export function isAlreadyPatched(current: unknown, mark: string): boolean {
	return typeof current === 'function' && current.name === mark
}
