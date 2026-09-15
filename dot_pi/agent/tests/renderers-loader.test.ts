import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const runNode = promisify(execFile)

void test('Jiti-loaded renderers adapt the actual CLI bundle, not only the local SDK copy', async () => {
	const fixture = fileURLToPath(
		new URL('./renderers-loader-fixture.mjs', import.meta.url),
	)
	const probe = await runNode(process.execPath, [fixture], {
		env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
	})
	assert.match(
		probe.stdout,
		/PASS: Jiti and CLI share the adapted bundle; no tool registrations\./u,
	)
})
