import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const USAGE =
	'node ~/.config/agent-security/secret-names.mjs --projectId ID --env ENV [--path /]'
const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 8_388_608

function readOptions() {
	const { values } = parseArgs({
		options: {
			projectId: { type: 'string' },
			env: { type: 'string' },
			path: { type: 'string', default: '/' },
			help: { type: 'boolean', default: false },
		},
	})
	if (values.help) return values
	if (!values.projectId || !/^[a-zA-Z0-9-]+$/.test(values.projectId))
		throw new Error('Invalid project ID')
	if (!values.env || !/^[a-zA-Z0-9_-]+$/.test(values.env))
		throw new Error('Invalid environment')
	if (!values.path.startsWith('/') || /[\r\n\0]/.test(values.path))
		throw new Error('Invalid secret path')
	return values
}

function listNames(options) {
	const commandOutput = spawnSync(
		'infisical',
		[
			'secrets',
			'generate-example-env',
			'--projectId',
			options.projectId,
			'--env',
			options.env,
			'--path',
			options.path,
			'--silent',
		],
		{
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: TIMEOUT_MS,
			maxBuffer: MAX_OUTPUT_BYTES,
		},
	)
	if (commandOutput.error || commandOutput.status !== 0)
		throw new Error('Names lookup failed')
	const lines = commandOutput.stdout
		.split(/\r?\n/)
		.filter(line => line.trim() && !line.trimStart().startsWith('#'))
	const names = lines.map(line => {
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)
		if (!match) throw new Error('Unexpected names format')
		return match[1]
	})
	return [...new Set(names)].toSorted()
}

try {
	const options = readOptions()
	if (options.help) {
		process.stdout.write(`${USAGE}\n`)
	} else {
		const names = listNames(options)
		process.stdout.write(`${JSON.stringify({ names })}\n`)
	}
} catch {
	process.stderr.write(
		`Names-only lookup failed. No raw output was released. Usage: ${USAGE}\n`,
	)
	process.exitCode = 1
}
