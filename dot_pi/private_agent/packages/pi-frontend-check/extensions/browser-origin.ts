const MAX_IPV4_OCTET = 255
const IPV4_GROUP_COUNT = 4

const PRIVATE_IPV4_RANGES: readonly {
	first: number
	secondMin: number
	secondMax: number
}[] = [
	{ first: 10, secondMin: 0, secondMax: MAX_IPV4_OCTET },
	{ first: 172, secondMin: 16, secondMax: 31 },
	{ first: 192, secondMin: 168, secondMax: 168 },
]

const DEV_TEST_SUFFIX = /\.(localhost|local|test)$/

/**
 * Dev/test e2e origins (localhost, private hosts, reserved test TLDs) may be
 * typed into directly with disposable test passwords. Any other origin is
 * treated as production: password fills go through the shared vault only.
 */
export function isDevTestOrigin(url: string): boolean {
	let bare: string
	try {
		bare = new URL(url).hostname.replace(/^\[|\]$/g, '')
	} catch {
		return false
	}
	if (bare === 'localhost' || bare === '::1' || bare.startsWith('127.')) {
		return true
	}
	if (DEV_TEST_SUFFIX.test(bare)) return true
	const groups = bare.split('.')
	if (groups.length !== IPV4_GROUP_COUNT) return false
	const octets = groups.map(Number)
	if (!octets.every(octet => /^\d{1,3}$/.test(octet.toString()))) return false
	if (!octets.every(octet => octet <= MAX_IPV4_OCTET)) return false
	const [first = 0, second = 0] = octets
	return PRIVATE_IPV4_RANGES.some(
		range =>
			range.first === first &&
			second >= range.secondMin &&
			second <= range.secondMax,
	)
}
