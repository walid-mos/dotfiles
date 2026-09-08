export type NonEmptyArray<T> = readonly [T, ...T[]]

export type ShuffleBag<T> = {
	next: () => T
}

// A genuine swap needs at least a pair; a lone item cannot change position
const MIN_SHUFFLE_POOL = 2

export function createShuffleBag<T>(
	items: NonEmptyArray<T>,
	random: () => number = Math.random,
): ShuffleBag<T> {
	let remaining: T[] = []
	let previous: T | undefined

	function refill(): void {
		remaining = [...items]
		for (let index = remaining.length - 1; index > 0; index--) {
			const swapIndex = Math.floor(random() * (index + 1))
			const current = remaining[index]
			const swapped = remaining[swapIndex]
			// T is arbitrary, so empty falsy values are legal pool entries:
			// entries must be tested for definedness, not truthiness.
			// oxlint-disable-next-line nextnode/no-undefined-comparison
			if (current === undefined || swapped === undefined) continue
			remaining[index] = swapped
			remaining[swapIndex] = current
		}
		if (
			remaining.length < MIN_SHUFFLE_POOL ||
			remaining[remaining.length - 1] !== previous
		)
			return
		const [first] = remaining
		const last = remaining.at(-1)
		// Definedness again (see refill): arbitrary T may be falsy yet defined.
		// oxlint-disable-next-line nextnode/no-undefined-comparison
		if (first === undefined || last === undefined) return
		remaining[0] = last
		remaining[remaining.length - 1] = first
	}

	return {
		next(): T {
			if (!remaining.length) refill()
			const drawn = remaining.pop()
			// See refill(): definedness, not truthiness, bounds the pool.
			// oxlint-disable-next-line nextnode/no-undefined-comparison
			if (drawn === undefined) {
				throw new Error('shuffle bag produced no item after refill')
			}
			previous = drawn
			return drawn
		},
	}
}

export function workingMessage(word: string): string {
	return `${word}...`
}
