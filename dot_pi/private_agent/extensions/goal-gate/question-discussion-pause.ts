/** Track whether a blocked goal already raised its question to the human. */
export class QuestionDiscussionPause {
	private isPaused = false
	private didRaiseBlockingQuestion = false

	get pending(): boolean {
		return this.isPaused
	}

	get blockingQuestionRaised(): boolean {
		return this.didRaiseBlockingQuestion
	}

	update(mode: unknown): void {
		if (mode !== 'answering' && mode !== 'discussing') return
		this.didRaiseBlockingQuestion = true
		this.isPaused = mode === 'discussing'
	}

	noteBlock(): void {
		this.didRaiseBlockingQuestion = false
	}

	noteHumanPrompt(): void {
		this.didRaiseBlockingQuestion = false
	}

	clear(): void {
		this.isPaused = false
		this.didRaiseBlockingQuestion = false
	}
}
