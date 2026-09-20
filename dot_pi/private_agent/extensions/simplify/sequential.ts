/**
 * Sequential map for work that must not run concurrently: every git call is a
 * process, and a 200-file scope would otherwise start 200 of them at once.
 */
export async function mapSequential<Subject, Result>(
	items: readonly Subject[],
	run: (subject: Subject) => Promise<Result>,
): Promise<Result[]> {
	const results: Result[] = []
	for (const subject of items) {
		// oxlint-disable-next-line no-await-in-loop -- sequential by contract: bounded process count.
		results.push(await run(subject))
	}
	return results
}
