import assert from 'node:assert/strict'
import test from 'node:test'

import {
	comparedChangeDocument,
	nativeChangeDocument,
	writtenChangeDocument,
} from '../extensions/renderers/change-document.ts'

void test('native diff parsing preserves empty code lines and trailing indentation', () => {
	assert.deepEqual(nativeChangeDocument('+1 \n+2   ')?.lines, [
		{ kind: 'added', lineNumber: 1, text: '' },
		{ kind: 'added', lineNumber: 2, text: '  ' },
	])
})

void test('native line positions and hunk gaps remain distinct from code', () => {
	assert.deepEqual(
		nativeChangeDocument('     ...\n  40 before\n- 41 old\n+ 41 new')
			?.lines,
		[
			{ kind: 'gap', text: '' },
			{ kind: 'context', lineNumber: 40, text: 'before' },
			{ kind: 'removed', lineNumber: 41, text: 'old' },
			{ kind: 'added', lineNumber: 41, text: 'new' },
		],
	)
	assert.equal(nativeChangeDocument('not a numbered diff'), undefined)
})

void test('write comparison uses real before/after content, not an all-added replacement', () => {
	assert.deepEqual(
		comparedChangeDocument('const limit = 1;\n', 'const limit = 2;\n')
			?.lines,
		[
			{ kind: 'removed', lineNumber: 1, text: 'const limit = 1;' },
			{ kind: 'added', lineNumber: 1, text: 'const limit = 2;' },
		],
	)
})

void test('unknown write baselines show neutral written content, never invented deletions or additions', () => {
	assert.deepEqual(writtenChangeDocument('first\n\nlast\n'), {
		lines: [
			{ kind: 'written', lineNumber: 1, text: 'first' },
			{ kind: 'written', lineNumber: 2, text: '' },
			{ kind: 'written', lineNumber: 3, text: 'last' },
		],
		note: 'before snapshot unavailable',
	})
})
