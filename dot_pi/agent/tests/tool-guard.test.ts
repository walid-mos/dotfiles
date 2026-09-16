// tool-guard policy: blind waits, and bash commands a dedicated tool owns.
// Every blocked sample is a real command from the session logs.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
	MAX_WAIT_SECONDS,
	blindWaitReason,
	guardCommand,
	shadowedToolReason,
} from '../extensions/tool-guard/policy.ts'

test('a raw blind wait is blocked with the detach recipe', () => {
	const reason = blindWaitReason('sleep 240')
	assert.match(reason ?? '', /blind wait of 240s/)
	assert.match(reason ?? '', /setsid nohup/)
	assert.match(reason ?? '', /AGENTS\.md # Tool calls/)
})

test('waits that follow a detached launch are blocked too', () => {
	const samples = [
		'sleep 300; tail -4 /tmp/wt-pane-full.log; grep -cE "^(FAIL|ERROR):" /tmp/wt-pane-full.log',
		'nohup node bench.mjs > /tmp/bench.log 2>&1 & disown; sleep 150; tail -4 /tmp/bench.log',
		"cd /tmp && rm -f /tmp/x.log && (nohup sh -c 'python3 -m unittest' > /tmp/x.log 2>&1 &); sleep 120; grep -c OK /tmp/x.log",
		'sleep 420 && cat /tmp/galley-bench/full.log',
	]
	for (const command of samples) {
		assert.ok(blindWaitReason(command), `expected a block: ${command}`)
	}
})

test('the wait threshold is a floor, units are understood', () => {
	assert.equal(MAX_WAIT_SECONDS, 10)
	assert.ok(blindWaitReason('sleep 10'))
	assert.ok(blindWaitReason('sleep 1m'))
	assert.ok(blindWaitReason('sleep 30s'))
	assert.ok(blindWaitReason('sleep 0.5m'))
	assert.equal(blindWaitReason('sleep 9.5'), undefined)
	assert.equal(blindWaitReason('sleep 2'), undefined)
	assert.equal(blindWaitReason('sleep 0.2'), undefined)
})

test('the wait is found after separators, wrappers and assignments', () => {
	assert.ok(blindWaitReason('foo & sleep 30'))
	assert.ok(blindWaitReason('if true; then sleep 20; fi'))
	assert.ok(blindWaitReason('FOO=1 sleep 15'))
	assert.ok(blindWaitReason('sudo sleep 60'))
	assert.ok(blindWaitReason('cd /repo && sleep 12'))
	assert.equal(blindWaitReason('echo "sleep 240"'), undefined)
})

test('guest and fixture delays stay legal', () => {
	const allowed = [
		'container run -d --name lab --memory 1g alpine sleep 3600',
		`container exec $C bash -lc 'timeout -k 5 2 bash -lc "sleep 618 & sleep 30"; echo wrapper_exit=$?'`,
		'setsid nohup sh -c "sleep 900" > /tmp/keep.log 2>&1 &',
	]
	for (const command of allowed) {
		assert.equal(
			blindWaitReason(command),
			undefined,
			`expected no block: ${command}`,
		)
	}
})

test('a sleep inside a heredoc body is data, not a command', () => {
	const command = [
		"cat > /tmp/fixture.sh <<'SH'",
		'#!/bin/bash',
		'sleep 240',
		'SH',
		'bash /tmp/fixture.sh &',
	].join('\n')
	assert.equal(blindWaitReason(command), undefined)
})

test('cat is blocked in favor of read', () => {
	assert.match(
		shadowedToolReason('cat package.json') ?? '',
		/`read` tool instead of bash `cat`/,
	)
	assert.ok(shadowedToolReason('cat CLAUDE.md README.md'))
	assert.ok(shadowedToolReason('cd /repo && cat src/index.ts'))
	assert.ok(shadowedToolReason('echo x; cat /etc/hosts'))
})

test('cat stays legal when it transforms or stores data', () => {
	const allowed = [
		'cat package.json | jq -r .version',
		'cat api.log api2.log > /tmp/merged.log',
		"cat > /tmp/x.json <<'EOF'",
	]
	for (const command of allowed) {
		assert.equal(
			shadowedToolReason(command),
			undefined,
			`expected no block: ${command}`,
		)
	}
})

test('grep over project files is blocked, log and summary greps are not', () => {
	assert.ok(shadowedToolReason('grep -rn "foo" src/'))
	assert.ok(shadowedToolReason('rg "foo" apps/api'))
	assert.ok(shadowedToolReason('grep foo src/index.ts'))
	const allowed = [
		'grep -cE "^(FAIL|ERROR):" /tmp/wt-pane-full.log',
		'grep -rn FAIL /tmp/wt-tests2.log | head -3',
		'tail -4 /tmp/wt-tests2.log | grep -E "^FAIL"',
		'grep -rl foo src/*.ts',
		'grep -e foo -e bar /tmp/out.txt',
		'git grep -n foo',
		'curl -s localhost:3000 | grep ok',
	]
	for (const command of allowed) {
		assert.equal(
			shadowedToolReason(command),
			undefined,
			`expected no block: ${command}`,
		)
	}
})

test('find is blocked unless it mutates or pipes', () => {
	assert.ok(shadowedToolReason("find . -name '*.ts'"))
	assert.match(
		shadowedToolReason("find /repo -maxdepth 2 -iname 'wt*'") ?? '',
		/`find` tool/,
	)
	assert.equal(
		shadowedToolReason("find . -name '*.ts' -exec rm {} +"),
		undefined,
	)
	assert.equal(
		shadowedToolReason("find . -name '*.ts' | xargs wc -l"),
		undefined,
	)
})

test('plain ls is blocked, piped or redirected ls is not', () => {
	assert.ok(shadowedToolReason('ls -la'))
	assert.ok(shadowedToolReason('ls ~/.local/share/nvim/mason/packages'))
	assert.equal(shadowedToolReason('ls | wc -l'), undefined)
	assert.equal(shadowedToolReason('ls -la > /tmp/list.txt'), undefined)
})

test('a shadowed command inside quotes is not the host command', () => {
	assert.equal(shadowedToolReason('bash -c "cat package.json"'), undefined)
	assert.equal(
		shadowedToolReason("container exec wt sh -c 'grep -rn foo /workspace'"),
		undefined,
	)
})

test('missing replacement tools leave bash usable without weakening wait checks', () => {
	assert.equal(guardCommand('ls src', ['read', 'bash']), undefined)
	assert.equal(guardCommand('cat package.json', ['bash']), undefined)
	assert.match(
		guardCommand('cat package.json', ['read']) ?? '',
		/`read` tool/,
	)
	assert.match(
		guardCommand('ls src; cat package.json', ['read']) ?? '',
		/`read` tool/,
	)
	assert.match(guardCommand('sleep 15', []) ?? '', /blind wait/)
})

test('the guard reports the wait before the shadow, one reason at a time', () => {
	const reason = guardCommand(
		'cat /tmp/full.log; sleep 240; grep -rn foo src/',
	)
	assert.match(reason ?? '', /blind wait of 240s/)
	assert.equal(guardCommand('pnpm run test'), undefined)
})
