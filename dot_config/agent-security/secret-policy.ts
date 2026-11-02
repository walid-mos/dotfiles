const SECRET_REFUSAL =
	'Cleartext secret output blocked. Infisical run, masked MCP operations, writes, and shell-variable capture remain allowed. Use masked MCP reads or node ~/.config/agent-security/secret-names.mjs for names.'

const EXECUTION_TOOLS =
	/^(?:bash|host|shell|terminal|execute|codemode|mcpScript)$/i
const READ_TOOLS = /^(?:read|grep)$/i
const INFISICAL_CALL =
	/(?:^|[\s"'`($])((?:[\w.~/-]+\/)?infisical)\b([^\n|;&)]*)/g
const VALUE_FLAGS = new Set([
	'--domain',
	'--env',
	'-e',
	'--projectId',
	'--path',
	'--profile',
	'--org',
	'--token',
	'--log-level',
	'-l',
	'--log-format',
	'--log-destination',
	'--tags',
	'-t',
	'--output',
	'-o',
	'--format',
	'-f',
	'--output-file',
])
const SAFE_SECRET_COMMANDS = new Set([
	'set',
	'delete',
	'folders',
	'generate-example-env',
	'agent-proxy',
])
const ENVIRONMENT_DUMP =
	/\bprintenv\b|(?:^|[;&|\n]|--\s+)\s*(?:env(?:\s+-(?:0|null))?|set|export\s+-p|declare\s+-x)\s*(?:$|[;&|\n])|(?:echo|printf)[^\n;|]*\$(?:\{)?[A-Z_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z_]*|(?:console\.log|print)\s*\([^\n]*(?:process\.env|os\.environ|Deno\.env)/
const SENSITIVE_PATH =
	/(?:^|[\s/"'`])(?:\.env(?:\.[\w.-]+)?|\.netrc|\.npmrc|\.pypirc|credentials(?:\.json)?|id_(?:rsa|ed25519|ecdsa)(?!\.pub)|[^\s/"'`]+\.(?:pem|key|p12|pfx))(?=$|[\s/"'`])/i
const SECRET_TEMPLATE = /\.env\.(?:example|sample|template)(?=$|[\s/"'`])/gi
const CREDENTIAL_STORE =
	/(?:\.pi\/agent\/auth\.json|\.claude\/\.credentials[^\s/]*|\.config\/infisical(?:\/|$)|\.config\/zsh\/env(?:\/|$)|\.aws\/credentials|\.config\/gh\/hosts\.yml)/i

function field(input: unknown, name: string): unknown {
	if (typeof input !== 'object' || input === null) return undefined
	return Reflect.get(input, name)
}

function positionalWords(argumentsText: string): string[] {
	const tokens = argumentsText.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []
	const words: string[] = []
	let shouldSkip = false
	for (const token of tokens) {
		if (shouldSkip) {
			shouldSkip = false
			continue
		}
		if (token.startsWith('-')) {
			shouldSkip = VALUE_FLAGS.has(token)
			continue
		}
		words.push(token.replace(/^["']|["']$/g, ''))
	}
	return words
}

function producesSecretOutput(argumentsText: string): boolean {
	if (/(?:^|\s)(?:--help|-h|--version)(?:\s|$)/.test(argumentsText))
		return false
	if (/(?:^|\s)--show-values(?:=true)?(?:\s|$)/.test(argumentsText))
		return true
	const [command, action, subject] = positionalWords(argumentsText)
	if (
		command === 'secrets' &&
		action === 'set' &&
		/(?:^|\s)(?:--output|-o)(?:=|\s+)/.test(argumentsText)
	)
		return true
	if (command === 'secrets') return !SAFE_SECRET_COMMANDS.has(action ?? '')
	if (command === 'export') return true
	if (command === 'user' && action === 'get' && subject === 'token')
		return true
	return (
		command === 'login' &&
		/--plain|--method(?:=|\s+)(?:universal-auth|aws-iam|azure)/.test(
			argumentsText,
		)
	)
}

function hasPrivateSink(prefix: string, argumentsText: string): boolean {
	if (/\b[A-Za-z_]\w*\s*=\s*"?\$\(\s*$/.test(prefix)) return true
	const destination =
		argumentsText.match(
			/(?:^|\s)--output-file(?:=|\s+)("[^"]+"|'[^']+'|[^\s]+)/,
		)?.[1] ??
		argumentsText.match(
			/(?:^|\s)(?:1|&)?>(?!>)\s*("[^"]+"|'[^']+'|[^\s]+)/,
		)?.[1]
	if (!destination) return false
	const path = destination.replace(/^["']|["']$/g, '')
	return !/^[&$(`<>]|^\/dev\/(?:stdout|stderr|tty|fd)|^\/proc\/.*\/fd\//.test(
		path,
	)
}

function exposesInfisicalOutput(commandText: string): boolean {
	const calls = [...commandText.matchAll(INFISICAL_CALL)]
	if (!calls.length) return false
	if (
		ENVIRONMENT_DUMP.test(commandText) ||
		/\bset\s+-[^\s]*x/.test(commandText)
	)
		return true
	return calls.some(call => {
		const [source, executable = '', argumentsText = ''] = call
		const executableOffset = source.indexOf(executable)
		const prefix = commandText.slice(0, call.index + executableOffset)
		return (
			producesSecretOutput(argumentsText) &&
			!hasPrivateSink(prefix, argumentsText)
		)
	})
}

function readsCredentialFile(toolName: string, input: unknown): boolean {
	if (!READ_TOOLS.test(toolName)) return false
	const paths = ['path', 'file_path', 'glob']
		.map(name => field(input, name))
		.filter(path => typeof path === 'string')
		.join(' ')
	return (
		SENSITIVE_PATH.test(paths.replace(SECRET_TEMPLATE, '')) ||
		CREDENTIAL_STORE.test(paths)
	)
}

export function secretAccessRefusal(
	toolName: string,
	input: unknown,
): string | undefined {
	if (readsCredentialFile(toolName, input)) return SECRET_REFUSAL
	if (!EXECUTION_TOOLS.test(toolName)) return undefined
	const command = field(input, 'command') ?? field(input, 'script') ?? input
	const text = typeof command === 'string' ? command : JSON.stringify(command)
	if (exposesInfisicalOutput(text)) return SECRET_REFUSAL
	return undefined
}
