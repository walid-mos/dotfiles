/** Reverse PNG filter prediction for a single bounded scanline. */
import {
	FILTER_AVERAGE,
	FILTER_PAETH,
	FILTER_SUB,
	FILTER_UP,
	PAIR_DIVISOR,
} from './png-format.ts'

export type ScanlineJob = {
	readonly line: Buffer
	readonly stride: number
	readonly channels: number
	readonly filter: number
	readonly previous: Uint8Array | undefined
}

export function unfilterLine(job: ScanlineJob): Uint8Array {
	if (job.filter === FILTER_SUB) return subFilter(job)
	if (job.filter === FILTER_UP) return upFilter(job)
	if (job.filter === FILTER_AVERAGE) return averageFilter(job)
	if (job.filter === FILTER_PAETH) return paethFilter(job)
	return Uint8Array.from(job.line)
}

function subFilter(job: ScanlineJob): Uint8Array {
	const row = new Uint8Array(job.stride)
	for (let index = 0; index < job.stride; index += 1) {
		row[index] =
			(job.line[index] ?? 0) +
			(index >= job.channels ? (row[index - job.channels] ?? 0) : 0)
	}
	return row
}

function upFilter(job: ScanlineJob): Uint8Array {
	const row = new Uint8Array(job.stride)
	for (let index = 0; index < job.stride; index += 1) {
		row[index] = (job.line[index] ?? 0) + (job.previous?.[index] ?? 0)
	}
	return row
}

function averageFilter(job: ScanlineJob): Uint8Array {
	const row = new Uint8Array(job.stride)
	for (let index = 0; index < job.stride; index += 1) {
		const left =
			index >= job.channels ? (row[index - job.channels] ?? 0) : 0
		row[index] =
			(job.line[index] ?? 0) +
			Math.floor((left + (job.previous?.[index] ?? 0)) / PAIR_DIVISOR)
	}
	return row
}

function paethFilter(job: ScanlineJob): Uint8Array {
	const row = new Uint8Array(job.stride)
	for (let index = 0; index < job.stride; index += 1) {
		const left =
			index >= job.channels ? (row[index - job.channels] ?? 0) : 0
		const up = job.previous?.[index] ?? 0
		const upLeft =
			index >= job.channels
				? (job.previous?.[index - job.channels] ?? 0)
				: 0
		row[index] = (job.line[index] ?? 0) + paeth(left, up, upLeft)
	}
	return row
}

function paeth(left: number, up: number, upLeft: number): number {
	const estimate = left + up - upLeft
	const toLeft = Math.abs(estimate - left)
	const toUp = Math.abs(estimate - up)
	const toUpLeft = Math.abs(estimate - upLeft)
	if (toLeft <= toUp && toLeft <= toUpLeft) return left
	if (toUp <= toUpLeft) return up
	return upLeft
}
