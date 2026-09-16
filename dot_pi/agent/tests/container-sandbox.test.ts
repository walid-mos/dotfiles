// Pure sandbox logic: workspace selection from wt rows, host-to-guest path
// mapping, and guest process ownership (tokens, kill script, records). All of it
// runs without a TUI or a container runtime.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	shouldProbeContainer,
	toContainerPath,
} from '../extensions/container-sandbox/bash-ops.ts'
import {
	GUEST_CEILING_SECONDS,
	PROBE_FAST_SECONDS,
	PROBE_PATIENT_SECONDS,
	containerUnresponsiveMessage,
	gatewayFromInventory,
	guestDeadlineSeconds,
} from '../extensions/container-sandbox/container.ts'
import {
	GUEST_EXEC_DIR,
	GUEST_KILL_GRACE_SECONDS,
	STALE_RECORD_GRACE_MS,
	abandonedRecords,
	clearRecord,
	commandLabel,
	guestExecArgv,
	guestKillScript,
	newExecToken,
	parseExecRecord,
	parseSessionRecord,
	processIsAlive,
	readExecRecords,
	recordFileName,
	safeSegment,
	sandboxStateDir,
	writeRecord,
} from '../extensions/container-sandbox/exec-session.ts'
import {
	DEFAULT_COMMAND_TIMEOUT_SECONDS,
	withDefaultTimeout,
} from '../extensions/container-sandbox/index.ts'
import {
	isInsideWorkspace,
	locateWorkspace,
} from '../extensions/container-sandbox/wt.ts'

import type { ExecRecord } from '../extensions/container-sandbox/exec-session.ts'

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		path: '/Users/dev/worktrees/app/feat/api',
		branch: 'feat/api',
		containerized: true,
		container_name: 'wt-app-1234abcd',
		container: 'running',
		container_config: { ports: ['5173:5173'], memory: '2G' },
		...overrides,
	}
}

test('locateWorkspace picks the containerized row of the session directory', () => {
	const lookup = locateWorkspace([row()], '/Users/dev/worktrees/app/feat/api')
	assert.equal(lookup.kind, 'containerized')
	assert.deepEqual(
		lookup.kind === 'containerized' ? lookup.workspace : null,
		{
			path: '/Users/dev/worktrees/app/feat/api',
			branch: 'feat/api',
			containerName: 'wt-app-1234abcd',
			containerState: 'running',
			ports: ['5173:5173'],
			memory: '2G',
		},
	)
})

test('locateWorkspace reports an unrecorded memory limit as empty', () => {
	const legacy = row({ container_config: { ports: ['5173:5173'] } })
	const lookup = locateWorkspace(
		[legacy],
		'/Users/dev/worktrees/app/feat/api',
	)
	assert.equal(
		lookup.kind === 'containerized' ? lookup.workspace.memory : null,
		'',
	)
})

test('locateWorkspace descends into a subdirectory of the workspace', () => {
	const lookup = locateWorkspace(
		[row()],
		'/Users/dev/worktrees/app/feat/api/apps/api/src',
	)
	assert.equal(lookup.kind, 'containerized')
})

test('locateWorkspace prefers the deepest matching workspace', () => {
	const nested = row({
		path: '/Users/dev/worktrees/app/feat/api/nested',
		branch: 'nested',
	})
	const lookup = locateWorkspace(
		[row(), nested],
		'/Users/dev/worktrees/app/feat/api/nested/src',
	)
	assert.equal(
		lookup.kind === 'containerized' ? lookup.workspace.branch : null,
		'nested',
	)
})

test('locateWorkspace refuses a sibling checkout that only shares a prefix', () => {
	const lookup = locateWorkspace(
		[row()],
		'/Users/dev/worktrees/app/feat/api-2',
	)
	assert.equal(lookup.kind, 'missing')
})

test('locateWorkspace reports a registered but non-containerized workspace', () => {
	const plain = row({ containerized: false, container_name: null })
	assert.equal(
		locateWorkspace([plain], '/Users/dev/worktrees/app/feat/api').kind,
		'plain',
	)
})

test('locateWorkspace reports a containerized row without its recorded name', () => {
	assert.equal(
		locateWorkspace(
			[row({ container_name: null })],
			'/Users/dev/worktrees/app/feat/api',
		).kind,
		'plain',
	)
})

test('locateWorkspace always reports a known state and string ports', () => {
	const odd = row({
		container: 'restarting',
		container_config: { ports: ['5173:5173', 42] },
	})
	const lookup = locateWorkspace([odd], '/Users/dev/worktrees/app/feat/api')
	assert.equal(
		lookup.kind === 'containerized'
			? lookup.workspace.containerState
			: null,
		'unknown',
	)
	assert.deepEqual(
		lookup.kind === 'containerized' ? lookup.workspace.ports : null,
		['5173:5173'],
	)
})

test('locateWorkspace tolerates a payload that is not a row array', () => {
	assert.equal(
		locateWorkspace(null, '/Users/dev/worktrees/app/feat/api').kind,
		'missing',
	)
	assert.equal(
		locateWorkspace(['nope', 7], '/Users/dev/worktrees/app/feat/api').kind,
		'missing',
	)
})

test('isInsideWorkspace is exact about the boundary', () => {
	assert.equal(isInsideWorkspace('/a/b', '/a/b'), true)
	assert.equal(isInsideWorkspace('/a/b', '/a/b/c'), true)
	assert.equal(isInsideWorkspace('/a/b', '/a/bc'), false)
	assert.equal(isInsideWorkspace('/a/b', '/a'), false)
})

test('the call timeout is the guest deadline, and a ceiling covers the calls without one', () => {
	assert.equal(guestDeadlineSeconds(1800), 1800)
	assert.equal(guestDeadlineSeconds(undefined), GUEST_CEILING_SECONDS)
	assert.ok(GUEST_CEILING_SECONDS > 60)
})

test('the bash tools cap a command that passed no timeout', () => {
	assert.equal(withDefaultTimeout({ command: 'sleep 1' }).timeout, 60)
})

test('an explicit timeout is never shortened by the default', () => {
	assert.equal(
		withDefaultTimeout({ command: 'tests/run.sh', timeout: 900 }).timeout,
		900,
	)
	assert.equal(
		withDefaultTimeout({ command: 'sleep 1', timeout: 0 }).timeout,
		0,
	)
})

test('a guest command runs in its own session with a pidfile naming its group', () => {
	const argv = guestExecArgv('4242-m1-7', 120, 'pnpm test')
	assert.deepEqual(argv.slice(0, 2), ['sh', '-c'])
	// The command is an argument, never interpolated into the script being run.
	assert.deepEqual(argv.slice(3), [
		'wt-exec',
		'4242-m1-7',
		'120',
		'pnpm test',
	])
	const script = argv[2] ?? ''
	assert.match(script, /setsid -w/u)
	assert.ok(script.includes(`${GUEST_EXEC_DIR}/"$0".pgid`))
	assert.ok(
		script.includes(
			`timeout -k ${GUEST_KILL_GRACE_SECONDS} "$2" bash -lc "$3"`,
		),
	)
})

test('the kill script kills a whole process group and reports the token', () => {
	const script = guestKillScript()
	assert.match(script, /kill -9 -"\$p"/u)
	assert.match(script, /echo "\$t"/u)
	// A pidfile that is gone or corrupt is handled, not left behind for the next reap.
	assert.match(script, /rm -f "\$f"/u)
})

test('tokens are unique per call and safe in a filename and a shell argument', () => {
	const first = newExecToken(4242, 1_700_000_000_000, 1)
	const second = newExecToken(4242, 1_700_000_000_000, 2)
	assert.match(first, /^4242-[0-9a-z]+-1$/u)
	assert.notEqual(first, second)
	assert.equal(safeSegment(first), first)
	assert.equal(safeSegment('a/b c'), 'a-b-c')
	assert.equal(
		recordFileName('wt-app-1234', first),
		`wt-app-1234.${first}.json`,
	)
})

test('a command label stays one short line', () => {
	assert.equal(
		commandLabel('pnpm  install\n  --frozen-lockfile'),
		'pnpm install --frozen-lockfile',
	)
	assert.ok(commandLabel('x'.repeat(400)).length <= 80)
})

function alwaysAlive(): boolean {
	return true
}

test('only work whose owner is gone is abandoned', () => {
	const now = 1_000_000
	const record: ExecRecord = {
		token: 'tok',
		containerName: 'wt-app-1234abcd',
		ownerPid: 4242,
		ownerSession: 'session',
		deadlineMs: now + 60_000,
		startedAt: now,
		label: 'pnpm test',
	}
	const alive = alwaysAlive
	assert.deepEqual(abandonedRecords([record], now, alive), [])
	assert.deepEqual(
		abandonedRecords([record], now, () => false),
		[record],
	)
	// A live owner past the deadline it set is a corpse too: the guest killer failed.
	const late = now + 60_000 + STALE_RECORD_GRACE_MS
	assert.deepEqual(abandonedRecords([record], late, alive), [record])
})

test('records round-trip through the state directory per container', t => {
	const directory = mkdtempSync(join(tmpdir(), 'sandbox-records-'))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const record: ExecRecord = {
		token: '4242-m1-1',
		containerName: 'wt-app-1234abcd',
		ownerPid: process.pid,
		ownerSession: 'session',
		deadlineMs: Date.now() + 60_000,
		startedAt: Date.now(),
		label: 'pnpm build',
	}
	writeRecord(directory, record)
	writeRecord(directory, {
		...record,
		token: '4242-m1-2',
		containerName: 'other',
	})
	assert.deepEqual(readExecRecords(directory, 'wt-app-1234abcd'), [record])
	clearRecord(directory, 'wt-app-1234abcd', record.token)
	assert.deepEqual(readExecRecords(directory, 'wt-app-1234abcd'), [])
})

test('a corrupt or foreign record is ignored, never trusted', () => {
	assert.equal(parseExecRecord(null), null)
	assert.equal(parseExecRecord({ token: 'x' }), null)
	assert.equal(
		parseExecRecord({
			token: 'x',
			containerName: 'c',
			ownerPid: 0,
			ownerSession: '',
			deadlineMs: 1,
			startedAt: 1,
		}),
		null,
	)
	const session = parseSessionRecord({
		sessionId: 'session',
		containerName: 'wt-app-1234abcd',
		ownerPid: process.pid,
		worktree: '/Users/dev/worktrees/app/feat/api',
		branch: 'feat/api',
		startedAt: 1,
	})
	assert.equal(session?.branch, 'feat/api')
	assert.equal(parseSessionRecord({}), null)
})

test('a live process is alive and an impossible pid is not', () => {
	assert.equal(processIsAlive(process.pid), true)
	assert.equal(processIsAlive(0), false)
	assert.equal(processIsAlive(Number.MAX_SAFE_INTEGER), false)
})

test('extension state lives in XDG state, not in the mounted worktree', () => {
	assert.equal(
		sandboxStateDir('/Users/dev'),
		'/Users/dev/.local/state/pi-agent/container-sandbox',
	)
})

test('a recently healthy container is not probed again on every call', () => {
	assert.equal(shouldProbeContainer(undefined, 1_000), true)
	assert.equal(shouldProbeContainer(1_000, 5_000), false)
	assert.equal(shouldProbeContainer(1_000, 60_000), true)
})

test('the liveness probe outwaits a cold VM but stays shorter than the command cap', () => {
	const worstCaseSeconds = PROBE_FAST_SECONDS + PROBE_PATIENT_SECONDS
	assert.ok(worstCaseSeconds >= 15)
	assert.ok(worstCaseSeconds < DEFAULT_COMMAND_TIMEOUT_SECONDS)
})

test('an unresponsive container names itself and the recovery command', () => {
	const message = containerUnresponsiveMessage('wt-app-1234abcd')
	assert.match(message, /wt-app-1234abcd/u)
	assert.match(message, /\/container (reap|restart)/u)
})

test('the host gateway is read per container, never assumed', () => {
	const inventory = JSON.stringify([
		{
			id: 'wt-other-1111',
			status: { networks: [{ ipv4Gateway: '192.168.64.1' }] },
		},
		{
			id: 'wt-app-abcd1234',
			status: { networks: [{ ipv4Gateway: '192.168.70.1' }] },
		},
	])
	assert.equal(
		gatewayFromInventory(inventory, 'wt-app-abcd1234'),
		'192.168.70.1',
	)
})

test('an unknowable gateway stays null so nothing prints a dead address', () => {
	const noNetworks = JSON.stringify([
		{ id: 'wt-app-abcd1234', status: { state: 'running' } },
	])
	assert.equal(gatewayFromInventory(noNetworks, 'wt-app-abcd1234'), null)
	assert.equal(gatewayFromInventory(noNetworks, 'wt-app-0000'), null)
	assert.equal(gatewayFromInventory('not json', 'wt-app-abcd1234'), null)
	assert.equal(
		gatewayFromInventory('{"state":"running"}', 'wt-app-abcd1234'),
		null,
	)
})

test('toContainerPath maps the mount root, subdirectories and refuses the rest', () => {
	assert.equal(
		toContainerPath('/host/app', '/workspace', '/host/app'),
		'/workspace',
	)
	assert.equal(
		toContainerPath('/host/app', '/workspace', '/host/app/apps/api'),
		'/workspace/apps/api',
	)
	assert.throws(
		() => toContainerPath('/host/app', '/workspace', '/Users/dev/other'),
		/outside the mounted worktree/u,
	)
})
