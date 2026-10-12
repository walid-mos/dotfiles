/** Pi tool operation sets backed by a Runtime: the Boat for anchored paths, used by tools/workspace and tools/guard. */
import { quote } from './remote.ts'

import type {
	BashOperations,
	EditOperations,
	FindOperations,
	LsOperations,
	ReadOperations,
	WriteOperations,
} from '@earendil-works/pi-coding-agent'
import type { Runtime } from './runtime.ts'

const IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
])
const ROOT = '/'

export function readOperations(runtime: Runtime): ReadOperations {
	return {
		readFile: path => runtime.readFile(path),
		access: path => runtime.access(path),
		detectImageMimeType: async path => {
			const probe = await runtime.run(
				`file --mime-type -b -- ${quote(runtime.toTarget(path))}`,
				ROOT,
			)
			const mimeType = probe.stdout.trim()
			if (!IMAGE_TYPES.has(mimeType)) return null
			return mimeType
		},
	}
}

export function writeOperations(runtime: Runtime): WriteOperations {
	return {
		writeFile: (path, content) => runtime.writeFile(path, content),
		mkdir: path => runtime.mkdir(path),
	}
}

export function editOperations(runtime: Runtime): EditOperations {
	return {
		readFile: path => runtime.readFile(path),
		writeFile: (path, content) => runtime.writeFile(path, content),
		access: path => runtime.access(path),
	}
}

export function lsOperations(runtime: Runtime): LsOperations {
	return {
		exists: path => runtime.exists(path),
		stat: async path => {
			const stats = await runtime.stat(path)
			return { isDirectory: () => stats.isDirectory }
		},
		readdir: path => runtime.readdir(path),
	}
}

export function findOperations(runtime: Runtime): FindOperations {
	return {
		exists: path => runtime.exists(path),
		glob: async (pattern, cwd, { ignore, limit }) => {
			const globs = [pattern, ...ignore.map(excluded => `!${excluded}`)]
				.map(glob => `--glob ${quote(glob)}`)
				.join(' ')
			const listing = await runtime.run(
				`rg --files ${globs} | head -n ${limit}`,
				cwd,
			)
			return listing.stdout.split('\n').filter(Boolean)
		},
	}
}

export function bashOperations(runtime: Runtime): BashOperations {
	return {
		exec: (command, cwd, options) => runtime.exec(command, cwd, options),
	}
}
