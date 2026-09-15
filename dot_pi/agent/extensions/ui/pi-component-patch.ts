/** Version-bound component adaptation. Reinstall replaces closures; disposal never undoes a newer patch. */
import { reflectMember, typedHost } from './pi-members.ts'

export type OriginalMethod = (...args: unknown[]) => unknown
export type ComponentMethod = (
	host: object,
	original: OriginalMethod,
	args: readonly unknown[],
) => unknown

export function patchPiComponent(
	component: unknown,
	owner: string,
	replacements: Readonly<Record<string, ComponentMethod>>,
): () => void {
	const prototype = typedHost(reflectMember(component, 'prototype'))
	if (!prototype)
		throw new Error(
			`${owner}: Pi component missing; re-audit the installed Pi version.`,
		)
	const marker = Symbol.for(owner)
	const previous: unknown = Reflect.get(prototype, marker)
	if (typeof previous === 'function') previous()
	// Validate every method before changing any of them.
	const patches = Object.entries(replacements).map(([name, replace]) => {
		const original = reflectMember(prototype, name)
		if (typeof original !== 'function')
			throw new Error(
				`${owner}: Pi method ${name} missing; re-audit the installed Pi version.`,
			)
		const originalMethod = original
		function adapted(this: object, ...args: unknown[]): unknown {
			return replace(
				this,
				(...inputs) => Reflect.apply(originalMethod, this, inputs),
				args,
			)
		}
		return { name, original, adapted }
	})
	const dispose = (): void => {
		for (const patch of patches) {
			if (Reflect.get(prototype, patch.name) === patch.adapted)
				Reflect.set(prototype, patch.name, patch.original)
		}
		if (Reflect.get(prototype, marker) === dispose)
			Reflect.deleteProperty(prototype, marker)
	}
	for (const patch of patches)
		Reflect.set(prototype, patch.name, patch.adapted)
	Reflect.set(prototype, marker, dispose)
	return dispose
}
