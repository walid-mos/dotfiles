import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { bashPreview } from '../extensions/renderers/bash-preview.ts'
import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { complete, runtime, toolRow, visible } from './renderers-fixture.ts'

after(installRenderers(runtime))

for (const [command, subject, annotation] of [
	['pnpm test', 'pnpm test', ''],
	[
		'cd "/tmp/my repo" && pnpm test > /tmp/tests.log 2>&1',
		'pnpm test …',
		'cd my repo',
	],
	[
		'cd /tmp/repo;\npnpm run lint; status=$?; exit $status',
		'pnpm run lint …',
		'cd repo',
	],
	['# Check the project\n\npnpm check\nprintf done', 'pnpm check …', ''],
	["printf '%s; > & text' value", "printf '%s; > & text' value", ''],
	['echo foo\\;bar && check', 'echo foo\\;bar …', ''],
	['echo 2 > /tmp/out', 'echo 2 …', ''],
	['echo ok 2>/tmp/err', 'echo ok …', ''],
	['echo ok &>/tmp/out', 'echo ok …', ''],
	['printf x | wc -c', 'printf x | wc -c', ''],
	[
		'echo "$(printf \'%s;%s\' x y)"; echo done',
		'echo "$(printf \'%s;%s\' x y)"; echo done',
		'',
	],
	['cd "$WORKSPACE" && pnpm test', 'cd "$WORKSPACE" …', ''],
	['cd /tmp/repo;', 'cd /tmp/repo …', ''],
	['cd "unfinished && pnpm test', 'cd "unfinished && pnpm test', ''],
	['cd pre"fix" && pnpm test', 'cd pre"fix" …', ''],
	["python <<'PY'\nprint(42)\nPY", 'python …', ''],
	['', '', ''],
]) {
	void test(`bash preview keeps a source excerpt and marks omissions: ${JSON.stringify(command)}`, () => {
		assert.deepEqual(bashPreview(command ?? ''), { subject, annotation })
	})
}

void test('short Bash previews never replace the stored script or its expanded details', () => {
	const args = {
		command:
			'cd "/tmp/example";\npnpm test > /tmp/test.log 2>&1\nprintf cleanup',
		timeout: 30,
	}
	const original = structuredClone(args)
	const row = toolRow('bash', args)
	complete(row)
	const line = visible(row.render(100))[0] ?? ''
	assert.match(line, /pnpm test …/u)
	assert.match(line, /cd example/u)
	assert.doesNotMatch(line, /test\.log|printf cleanup/u)
	assert.match(line, /bash\s+2l\s+pnpm test …/u)
	assert.match(line, /30s max$/u)
	assert.doesNotMatch(line, /timeout|[▸▾]/u)
	row.setExpanded(true)
	const details = visible(row.render(160)).join('\n')
	assert.ok(details.includes('cd "/tmp/example";'))
	assert.ok(details.includes('pnpm test > /tmp/test.log 2>&1'))
	assert.ok(details.includes('printf cleanup'))
	assert.deepEqual(args, original)
})
