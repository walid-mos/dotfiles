import { parseArgs } from 'node:util'

import { API, call, names, query, sessionToken } from './infisical-rest.ts'
import { describeTarget, parseSecretTarget } from './infisical-target.ts'

const USAGE =
	'node ~/.config/agent-security/secret-set.mjs --projectId ID --env ENV --name NAME [--path /] [--replace]  (value: masked prompt in a terminal, otherwise stdin)'
const MAX_VALUE_LENGTH = 32_768
const ENTER = /[\r\n]/u
const CTRL_C = '\u0003'
const CTRL_D = '\u0004'
const BACKSPACE = /[\b\u007f]/u

function readOptions() {
	const { values } = parseArgs({
		options: {
			projectId: { type: 'string' },
			env: { type: 'string' },
			name: { type: 'string' },
			path: { type: 'string', default: '/' },
			replace: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false },
		},
	})
	if (values.help) return { help: true }
	return {
		help: false,
		replace: values.replace,
		target: parseSecretTarget({
			projectId: values.projectId,
			environment: values.env,
			path: values.path,
			name: values.name,
		}),
	}
}

function readMaskedValue(target) {
	return new Promise((resolve, reject) => {
		const { stdin, stderr } = process
		let value = ''
		const finish = (settle, result) => {
			stdin.setRawMode(false)
			stdin.pause()
			stdin.off('data', onData)
			stderr.write('\n')
			settle(result)
		}
		const onData = chunk => {
			for (const char of chunk.toString('utf8')) {
				if (char === CTRL_C || char === CTRL_D)
					return finish(reject, new Error('Cancelled'))
				if (ENTER.test(char)) return finish(resolve, value)
				if (BACKSPACE.test(char)) value = value.slice(0, -1)
				else if (char >= ' ') value += char
			}
			return undefined
		}
		stderr.write(`Value for ${describeTarget(target)}: `)
		stdin.setRawMode(true)
		stdin.resume()
		stdin.setEncoding('utf8')
		stdin.on('data', onData)
	})
}

async function readPipedValue() {
	const chunks = []
	for await (const chunk of process.stdin) chunks.push(chunk)
	return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/u, '')
}

async function readValue(target) {
	const value = process.stdin.isTTY
		? await readMaskedValue(target)
		: await readPipedValue()
	if (!value) throw new Error('Empty value')
	if (value.length > MAX_VALUE_LENGTH) throw new Error('Value too long')
	return value
}

async function setSecret(options) {
	const { target } = options
	const where = { workspaceId: target.workspaceId, environment: target.environment }
	const value = await readValue(target)
	const token = sessionToken()
	const exists = (await names(token, where, target.path)).includes(target.name)
	if (exists && !options.replace)
		throw new Error(
			`${target.name} already exists in the target, pass --replace to overwrite it`,
		)
	const write = await call(
		token,
		exists ? 'PATCH' : 'POST',
		`${API}/${target.name}`,
		{ ...where, secretPath: target.path, secretValue: value },
	)
	if (write.status !== 200)
		throw new Error(`Write failed: HTTP ${write.status}`)
	if (!(await names(token, where, target.path)).includes(target.name))
		throw new Error(`${target.name} is not in the target after the write`)
	console.log(
		`${target.name}: ${exists ? 'updated' : 'created'} in ${target.workspaceId}/${target.environment}${target.path}`,
	)
}

try {
	const options = readOptions()
	if (options.help) process.stdout.write(`${USAGE}\n`)
	else await setSecret(options)
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : 'Failed'}. No value was printed. Usage: ${USAGE}\n`,
	)
	process.exitCode = 1
}
