/** Prevent goal continuations from interrupting a questionnaire discussion. */
export class QuestionDiscussionPause {
	private isPaused = false

	get pending(): boolean {
		return this.isPaused
	}

	update(mode: unknown): void {
		if (mode !== 'answering' && mode !== 'discussing') return
		this.isPaused = mode === 'discussing'
	}

	clear(): void {
		this.isPaused = false
	}
}
