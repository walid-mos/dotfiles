// node catalog-compare.mjs [--scope scope.keys] fr.json en.json rows.json... out.jsonl
import { writeFileSync } from 'node:fs'

import { loadRows } from './rows.mjs'

const ARGV_START = 2
const MIN_ARGS = 4

function main() {
	const args = process.argv.slice(ARGV_START)
	let scopeFile = null
	if (args[0] === '--scope') {
		args.shift()
		scopeFile = args.shift()
	}
	if (!scopeFile && process.argv[ARGV_START] === '--scope')
		throw new Error('missing scope file')
	if (args.length < MIN_ARGS) {
		throw new Error(
			'usage: catalog-compare.mjs [--scope scope.keys] fr.json en.json rows.json... out.jsonl',
		)
	}
	const [frFile, enFile, ...files] = args
	const outFile = files.pop()
	const { rows, items } = loadRows(frFile, enFile, files, scopeFile)
	writeFileSync(
		outFile,
		`${items.map(pair => JSON.stringify(pair)).join('\n')}\n`,
	)
	const counts = {
		rows: rows.length,
		pairs: items.length,
		exact: items.filter(pair => pair.verdict === 'exact').length,
		differ: items.filter(pair => pair.verdict === 'differ').length,
		noPair: items.filter(pair => pair.verdict === 'no-pair').length,
	}
	process.stderr.write(
		`compared without API calls: ${JSON.stringify(counts)}\n`,
	)
}

main()
