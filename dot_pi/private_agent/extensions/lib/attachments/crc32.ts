/** CRC32 checksum as PNG chunk framing requires. */

/** PNG chunk framing uses the standard CRC-32 polynomial. */
const CRC_POLYNOMIAL = 0xedb88320
const CRC_TABLE_SIZE = 256
const CRC_BIT_COUNT = 8
const CRC_BYTE_MASK = 0xff
const CRC_SEED = -1

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
	const table = new Uint32Array(CRC_TABLE_SIZE)
	for (let byte = 0; byte < CRC_TABLE_SIZE; byte += 1) {
		let remainder = byte
		for (let bit = 0; bit < CRC_BIT_COUNT; bit += 1) {
			remainder =
				remainder & 1
					? CRC_POLYNOMIAL ^ (remainder >>> 1)
					: remainder >>> 1
		}
		table[byte] = remainder
	}
	return table
}

export function crc32(bytes: Buffer): number {
	let remainder = CRC_SEED
	for (const byte of bytes) {
		remainder =
			(CRC_TABLE[(remainder ^ byte) & CRC_BYTE_MASK] ?? 0) ^
			(remainder >>> CRC_BIT_COUNT)
	}
	return (remainder ^ CRC_SEED) >>> 0
}
