/** Re-register Pi's file tools so a path under the anchor runs on the Boat; any other path keeps the local tool. */
import { resolve } from 'node:path'

import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from '@earendil-works/pi-coding-agent'

import {
	editOperations,
	findOperations,
	lsOperations,
	readOperations,
	writeOperations,
} from '#lib/runtime/pi-operations.ts'
import { runtimeFor } from '#lib/runtime/runtime.ts'

import { remoteGrep } from './remote-grep.ts'

import type {
	ExtensionAPI,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import type { Runtime } from '#lib/runtime/runtime.ts'

const CURRENT_DIRECTORY = '.'

export function registerBoatTools(pi: ExtensionAPI): void {
	const cwd = process.cwd()
	pi.registerTool(
		routed(createReadToolDefinition(cwd), runtime =>
			createReadToolDefinition(cwd, {
				operations: readOperations(runtime),
			}),
		),
	)
	pi.registerTool(
		routed(createWriteToolDefinition(cwd), runtime =>
			createWriteToolDefinition(cwd, {
				operations: writeOperations(runtime),
			}),
		),
	)
	pi.registerTool(
		routed(createEditToolDefinition(cwd), runtime =>
			createEditToolDefinition(cwd, {
				operations: editOperations(runtime),
			}),
		),
	)
	pi.registerTool(
		routed(createLsToolDefinition(cwd), runtime =>
			createLsToolDefinition(cwd, { operations: lsOperations(runtime) }),
		),
	)
	pi.registerTool(
		routed(createFindToolDefinition(cwd), runtime =>
			createFindToolDefinition(cwd, {
				operations: findOperations(runtime),
			}),
		),
	)
	const localGrep = createGrepToolDefinition(cwd)
	pi.registerTool(
		routed(localGrep, runtime => remoteGrep(localGrep, runtime)),
	)
}

function routed<TParams extends TSchema, TDetails, TState>(
	local: ToolDefinition<TParams, TDetails, TState>,
	remote: (runtime: Runtime) => ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	return {
		...local,
		execute: (...args) => {
			const [, params, , , ctx] = args
			const requested: unknown = Reflect.get(Object(params), 'path')
			const path = resolve(
				ctx.cwd,
				typeof requested === 'string' ? requested : CURRENT_DIRECTORY,
			)
			const runtime = runtimeFor(path)
			const tool = runtime.isRemote ? remote(runtime) : local
			return tool.execute(...args)
		},
	}
}
