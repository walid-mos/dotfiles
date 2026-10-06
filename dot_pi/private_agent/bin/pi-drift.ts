/** Gate: the running `pi` CLI must be the version the UI adapters were audited against. */
import { execFileSync } from 'node:child_process'

import { AUDITED_PI_VERSION } from '../extensions/lib/ui/pi-runtime.ts'

const running = execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim()
if (running !== AUDITED_PI_VERSION) {
	console.error(
		`pi ${running} is running; the adapters were audited against ${AUDITED_PI_VERSION}. Run the pi-updated skill before trusting the UI patches.`,
	)
	process.exit(1)
}
console.log(`pi ${running}: audited version`)
