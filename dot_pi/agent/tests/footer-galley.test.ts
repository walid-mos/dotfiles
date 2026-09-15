import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
	getOsc8LinkAtColumn,
	stripTerminalSequences,
} from '@earendil-works/pi-tui'

import {
	deskDirHash,
	fetchLiveGalleyDesk,
	parseDeskLock,
	readLiveDeskLocks,
} from '../extensions/footer/galley-data.ts'
import { reviewLink } from '../extensions/footer/render-git.ts'
import { renderFooterLines } from '../extensions/footer/render.ts'

import type { GalleyDesk } from '../extensions/footer/galley-data.ts'
import type { FooterRenderInput } from '../extensions/footer/render.ts'

// The directory galley uses for this repo; an independent sha256 vector so a
// footer hash drift breaks against the real desk layout, not against itself.
const GALLEY_VECTOR = {
	root: '/Users/walid-mos/Development/tools/galley',
	hash: '3226c75f7500f9ca',
}

void test('desk dir hashes match the directories galley writes', () => {
	assert.equal(deskDirHash(GALLEY_VECTOR.root), GALLEY_VECTOR.hash)
})

const ALIVE_PID = process.pid
const DEAD_PID = 99_999_999 // macOS pid max stays far below this

const DESK_PORT = 61519
const OTHER_DESK_PORT = 61222
/** Built here so no test string reads like a Tailwind arbitrary class. */
function deskUrl(port: number): string {
	return ['http', '://', '127.0.0.1', ':', String(port), '/'].join('')
}

function lockJson(overrides: Record<string, unknown>): string {
	return JSON.stringify({
		pid: ALIVE_PID,
		url: deskUrl(DESK_PORT),
		session: 'review',
		startedAt: '2026-09-15T08:30:00.000Z',
		...overrides,
	})
}

void test('desk locks parse only when pid and loopback-adjacent url are sane', () => {
	const lock = parseDeskLock(lockJson({}))
	assert.ok(lock)
	assert.equal(lock.url, deskUrl(DESK_PORT))
	assert.equal(lock.session, 'review')
	const NOW = Date.parse('2026-09-15T08:30:00.000Z')
	assert.equal(lock.startedAt, NOW)
	assert.equal(parseDeskLock(lockJson({ url: 'javascript:alert(1)' })), null)
	assert.equal(parseDeskLock(lockJson({ pid: -3 })), null)
	assert.equal(
		parseDeskLock(lockJson({ startedAt: 'garbage' }))?.startedAt,
		0,
	)
	assert.equal(parseDeskLock('not json'), null)
	assert.equal(parseDeskLock('[]'), null)
})

void test('only pid-alive locks count as live desks, newest started first', async () => {
	const home = await mkdtemp(path.join(tmpdir(), 'footer-galley-'))
	const repoDir = path.join(home, '.galley', GALLEY_VECTOR.hash)
	await mkdir(path.join(repoDir, 'review'), { recursive: true })
	await mkdir(path.join(repoDir, 'earlier'))
	await mkdir(path.join(repoDir, 'litter'))
	await mkdir(path.join(home, '.galley', 'orphan'), { recursive: true })
	await writeFile(path.join(repoDir, 'review', 'desk.lock'), lockJson({}))
	await writeFile(
		path.join(repoDir, 'earlier', 'desk.lock'),
		lockJson({
			pid: DEAD_PID,
			url: 'http://127.0.0.1:61111/',
			session: 'earlier',
		}),
	)
	await writeFile(path.join(repoDir, 'litter', 'desk.lock'), 'corrupt')
	await writeFile(
		path.join(repoDir, 'review', 'review.md'),
		'# review artifact, not a lock',
	)
	await writeFile(
		path.join(home, '.galley', 'orphan', 'desk.lock'),
		lockJson({}),
	)

	const locks = await readLiveDeskLocks(GALLEY_VECTOR.hash, home)
	const [lock] = locks
	assert.ok(lock)
	assert.equal(lock.session, 'review')
	assert.equal(lock.url, deskUrl(DESK_PORT))
})

void test('several live desks collapse to the most recently started', async () => {
	const home = await mkdtemp(path.join(tmpdir(), 'footer-galley-'))
	const repoDir = path.join(
		home,
		'.galley',
		deskDirHash(path.resolve('/tmp')),
	)
	await mkdir(path.join(repoDir, 'newer'), { recursive: true })
	await mkdir(path.join(repoDir, 'older'))
	await writeFile(
		path.join(repoDir, 'newer', 'desk.lock'),
		lockJson({ session: 'newer', startedAt: '2026-09-15T09:00:00.000Z' }),
	)
	await writeFile(
		path.join(repoDir, 'older', 'desk.lock'),
		lockJson({
			session: 'older',
			url: deskUrl(OTHER_DESK_PORT),
			startedAt: '2026-09-15T08:00:00.000Z',
		}),
	)
	const desk = await fetchLiveGalleyDesk('/tmp', home)
	assert.ok(desk)
	assert.equal(desk.session, 'newer')
	assert.equal(desk.url, deskUrl(DESK_PORT))
})

void test('no live desks resolve to null outside any repo', async () => {
	const home = await mkdtemp(path.join(tmpdir(), 'footer-galley-empty-'))
	const desk = await fetchLiveGalleyDesk('/tmp', home)
	assert.equal(desk, null)
	// The lookup hashes the resolved cwd, matching galley's non-repo fallback.
	const orphanRoot = path.join(home, '.galley', deskDirHash('/tmp'))
	await mkdir(path.join(orphanRoot, 'review'), { recursive: true })
	await writeFile(path.join(orphanRoot, 'review', 'desk.lock'), lockJson({}))
	const found = await fetchLiveGalleyDesk('/tmp', home)
	assert.ok(found)
	assert.equal(found.session, 'review')
})

void test('the review link keeps the fixed label inside the brackets', () => {
	const url = deskUrl(DESK_PORT)
	const desk: GalleyDesk = { session: 'review', url }
	const line = reviewLink(desk)
	assert.equal(stripTerminalSequences(line), '[review]')
	assert.equal(getOsc8LinkAtColumn(line, 0), url)
	assert.equal(reviewLink(null), '')
})

const DESK: GalleyDesk = { session: 'review', url: deskUrl(DESK_PORT) }

const PR_NUMBER = 12
/** Composed around a template so no test string reads like a Tailwind class. */
function prUrl(number: number): string {
	return `https://github.com/acme/app/pull/${number}`
}

function baseInput(review: GalleyDesk | null): FooterRenderInput {
	return {
		width: 200,
		model: 'test-model',
		thinkingLevel: 'off',
		cwd: '~/development/app',
		branch: 'main',
		usage: undefined,
		tokens: { input: 0, output: 0, cost: 0 },
		statuses: [],
		git: null,
		pr: null,
		review,
		quotas: {},
		provider: undefined,
		tier: undefined,
		now: new Date('2026-09-10T12:00:00.000Z'),
	}
}

void test('line 2 places [review] next to [PR #n] at the git edge', () => {
	const input = baseInput(DESK)
	input.pr = { number: PR_NUMBER, url: prUrl(PR_NUMBER) }
	const [, line2 = ''] = renderFooterLines(input)
	const plain = stripTerminalSequences(line2)
	assert.ok(plain.includes(`main \u2502`))
	assert.ok(plain.includes(`[PR #${PR_NUMBER}] \u2502 [review]`))
})

void test('a review desk without a PR still renders the link on line 2', () => {
	const [, line2 = ''] = renderFooterLines(baseInput(DESK))
	const plain = stripTerminalSequences(line2)
	assert.ok(plain.includes('[review]'))
	assert.ok(!plain.includes('[PR '))
})

void test('without a live desk line 2 shows no review segment', () => {
	const [, line2 = ''] = renderFooterLines(baseInput(null))
	const plain = stripTerminalSequences(line2)
	assert.ok(!plain.includes('[review]'))
})
