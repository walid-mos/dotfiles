import assert from 'node:assert/strict'
import { test } from 'node:test'
import { containsPath, featureHostname, parseWorktrees, workspaceIdentity } from '../src/identity.ts'

test('branch normalization cannot collapse feature/a and feature-a identities', () => {
  assert.notEqual(workspaceIdentity('repo-one', 'feature/a'), workspaceIdentity('repo-one', 'feature-a'))
})

test('equal branch labels in different projects cannot share identities', () => {
  assert.notEqual(workspaceIdentity('repo-one', 'main'), workspaceIdentity('repo-two', 'main'))
})

test('worktree records name their fields rather than swapping branch and path', () => {
  assert.deepEqual(parseWorktrees('worktree /projects/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /projects/feature\nHEAD abc\nbranch refs/heads/feature/a\n'), [
    { path: '/projects/main', branch: 'main' }, { path: '/projects/feature', branch: 'feature/a' },
  ])
})

test('path containment rejects sibling prefix matches and parent escapes', () => {
  assert.equal(containsPath('/project/work', '/project/work/sub'), true)
  assert.equal(containsPath('/project/work', '/project/work-other'), false)
  assert.equal(containsPath('/project/work', '/project/work/../outside'), false)
})

test('feature URL has bounded DNS-safe labels and collision suffix', () => {
  assert.equal(featureHostname('Fit App', 'Feature/Auth', '0123456789abcdef'), 'feature-auth-01234567.fit-app.herdr.test')
})
