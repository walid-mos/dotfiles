import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveHostPeerAliases } from './src/runs/background/runner-aliases.ts'
import { createChildHooks } from './src/runs/shared/child-hooks.ts'
import { createDefaultChildSessionFactory } from './src/runs/shared/child-session.ts'

import type { PackageAuditContext } from '../../skills/pi-updated/scripts/lib-package-audit.ts'
import type { ChildRuntimeConfig } from './src/runs/shared/child-runtime-config.ts'

const BACKGROUND_ARGUMENT = '--background-audit'
const BACKGROUND_TIMEOUT_MS = 45_000

async function openChild(directory: string): Promise<string> {
	mkdirSync(directory, { recursive: true })
	const factory = createDefaultChildSessionFactory()
	const runtime: ChildRuntimeConfig = {
		fanoutChild: false,
		depth: 1,
		waitTool: { enabled: false },
		fast: false,
	}
	const errors: string[] = []
	try {
		const child = await factory.create({
			cwd: directory,
			storage: { kind: 'memory' },
			tools: ['read'],
			extensionPaths: [],
			ambientExtensions: false,
			hooks: createChildHooks(runtime),
			noSkills: true,
			noContextFiles: true,
			runtime,
			onExtensionError: error =>
				errors.push(`${error.event}: ${String(error.error)}`),
		})
		if (!child.sessionId)
			throw new Error('Pi did not create a child session')
		await child.dispose()
		if (errors.length) throw new Error(errors.join('\n'))
		return 'real child session created, hooks bound, shutdown completed without a model request'
	} finally {
		await factory.dispose()
	}
}

export async function audit(context: PackageAuditContext): Promise<string[]> {
	const { aliases, missing } = resolveHostPeerAliases(context.hostRoot)
	if (missing.length)
		throw new Error(
			`Installed Pi lacks runner peers: ${missing.join(', ')}`,
		)
	const foreground = await openChild(
		join(context.temporaryDirectory, 'foreground'),
	)
	const result = spawnSync(
		process.execPath,
		[
			'--import',
			fileURLToPath(
				new URL('./runner-peer-preload.mjs', import.meta.url),
			),
			fileURLToPath(import.meta.url),
			BACKGROUND_ARGUMENT,
			join(context.temporaryDirectory, 'background'),
		],
		{
			env: {
				...process.env,
				JITI_ALIAS: JSON.stringify(aliases),
				PI_ASYNC_NATIVE_RUNNER: '1',
			},
			encoding: 'utf8',
			timeout: BACKGROUND_TIMEOUT_MS,
			killSignal: 'SIGKILL',
		},
	)
	if (result.error || result.status !== 0)
		throw new Error(
			`Production background loader failed: ${result.error?.message ?? result.stderr}`,
		)
	return [
		`${Object.keys(aliases).length} production runner peer exports resolve`,
		`foreground: ${foreground}`,
		`background: ${result.stdout.trim()}`,
	]
}

if (process.argv[2] === BACKGROUND_ARGUMENT) {
	const directory = process.argv[3]
	if (!directory) throw new Error('Missing background audit directory')
	await import('./src/runs/background/subagent-runner.ts')
	process.stdout.write(`${await openChild(directory)}\n`)
}
