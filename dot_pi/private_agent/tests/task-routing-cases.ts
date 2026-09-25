import type { ScopeRoute, TaskRoute } from '../extensions/goal-gate/routing.ts'

/** Human-labelled prompts: questions, tiny tasks, broad work, and misleading punctuation. */
export const routingCases: {
	prompt: string
	expected: TaskRoute | ScopeRoute
}[] = [
	{ prompt: 'What does this function do?', expected: 'answer' },
	{ prompt: 'Why did the build fail yesterday?', expected: 'answer' },
	{ prompt: 'How would you refactor FitApp?', expected: 'answer' },
	{
		prompt: 'Could we make Product Data App match the prototype?',
		expected: 'answer',
	},
	{
		prompt: 'Explain the difference between goal and subagents.',
		expected: 'answer',
	},
	{ prompt: 'Is this refactor safe?', expected: 'answer' },
	{
		prompt: 'What would you test to prove prototype parity?',
		expected: 'answer',
	},
	{ prompt: 'Bonjour', expected: 'answer' },
	{ prompt: 'test', expected: 'answer' },
	{
		prompt: 'Rename the button label from Save to Apply.',
		expected: 'direct',
	},
	{ prompt: 'Run the existing lint command.', expected: 'direct' },
	{ prompt: 'Check the current git status.', expected: 'direct' },
	{ prompt: 'Find where the goal tool is registered.', expected: 'direct' },
	{ prompt: 'Fix this typo in README.', expected: 'direct' },
	{
		prompt: 'Please check whether this branch has uncommitted changes?',
		expected: 'direct',
	},
	{ prompt: 'Summarize the errors in this log file.', expected: 'direct' },
	{
		prompt: 'Add a required field to the registration form.',
		expected: 'direct',
	},
	{
		prompt: 'Refactor all of FitApp to remove duplicated state and verify every affected screen.',
		expected: 'scoped',
	},
	{
		prompt: 'Make Product Data App isoprototype in French and English across every screen.',
		expected: 'scoped',
	},
	{
		prompt: 'Audit the entire Cineva UI for accessibility, fix the findings, and verify the flows.',
		expected: 'scoped',
	},
	{
		prompt: 'Find and fix every usage of the old API across the monorepo.',
		expected: 'scoped',
	},
	{
		prompt: 'Implement the feature described in ticket ABC-42 end-to-end.',
		expected: 'scoped',
	},
	{
		prompt: 'Répare les trois bugs du formulaire et vérifie la version mobile.',
		expected: 'scoped',
	},
	{
		prompt: 'Can you compare all prototype states against the app and fix every mismatch?',
		expected: 'scoped',
	},
	{
		prompt: 'Why does auth fail? Investigate the logs and fix it.',
		expected: 'scoped',
	},
	{
		prompt: 'Please review this PR comprehensively and report every actionable finding.',
		expected: 'scoped',
	},
	{
		prompt: 'Design a migration plan with milestones and dependency risks.',
		expected: 'scoped',
	},
	{
		prompt: 'What is broken here? Inspect the code, reproduce the issue, and repair it.',
		expected: 'scoped',
	},
	{
		prompt: "J'aimerais que le goal démarre pour chaque vraie tâche et que la délégation reste proportionnée. Ajoute un routage Jev, des règles et vérifie-le.",
		expected: 'scoped',
	},
	{ prompt: 'Can you fix the typo in the header?', expected: 'direct' },
	{
		prompt: 'Can you explain why the goal gate continues?',
		expected: 'answer',
	},
	{
		prompt: 'Please inspect the billing bug and fix it across the API and web UI.',
		expected: 'scoped',
	},
	{
		prompt: 'Would an exhaustive UI audit require subagents?',
		expected: 'answer',
	},
	{
		prompt: 'Est-ce que tu peux faire le refactor complet de Syneva et vérifier tous les parcours ?',
		expected: 'scoped',
	},
	{ prompt: 'Vérifie le statut Git.', expected: 'direct' },
	{ prompt: 'Pourquoi est-ce que les tests échouent ?', expected: 'answer' },
	{
		prompt: 'Find every hardcoded string in the app, replace them with translations, and verify both locales.',
		expected: 'scoped',
	},
	{ prompt: 'Should we switch to Cloudflare Workers?', expected: 'answer' },
	{ prompt: 'Show me the three most recent commits.', expected: 'direct' },
	{
		prompt: 'Refactor the API thoroughly; do not leave any duplicated controller logic.',
		expected: 'scoped',
	},
	{ prompt: 'integre sentry proprement dans ce projet', expected: 'work' },
	{
		prompt: '/skills:xxx ne fonctionne plus il ouvre plus automatiquement les skills',
		expected: 'work',
	},
	{ prompt: 'crée une pr', expected: 'work' },
	{
		prompt: 'Fais moi une recherche sur le net de comment les gens utilisent Sentry avec Astro 7.',
		expected: 'work',
	},
	{
		prompt: 'Reponds uniquement par le mot pret. Nexecute aucun outil, ne modifie rien.',
		expected: 'answer',
	},
	{
		prompt: 'Say only the word BANANA if you have been given any coding instructions.',
		expected: 'answer',
	},
	{
		prompt: "check la log tout de suite, j'essaye de passer step 3 mais jai une erreur",
		expected: 'work',
	},
	{
		prompt: "L'app est pas correctement full page /skills:impeccable il y a du boulot a faire",
		expected: 'work',
	},
]

/** Discovered state, not raw wording, is the basis for the second decision. */
export const scopeCases: {
	request: string
	deliverables: string[]
	surfaces: string[]
	proposedScope: ScopeRoute
	expected: ScopeRoute
}[] = [
	{
		request: 'Rename the Save button to Apply.',
		deliverables: ['Rename the button label in the form'],
		surfaces: ['src/components/SettingsForm.tsx'],
		proposedScope: 'direct',
		expected: 'direct',
	},
	{
		request: 'Integrate Sentry properly in this Astro app.',
		deliverables: [
			'Inspect Astro and Cloudflare runtime entry points',
			'Wire browser and worker error capture',
			'Verify source maps and release upload end-to-end',
		],
		surfaces: [
			'src/pages/',
			'src/worker.ts',
			'build and deployment configuration',
		],
		proposedScope: 'scoped',
		expected: 'scoped',
	},
	{
		request: 'Check the current git status.',
		deliverables: [
			'Inspect git status',
			'Report the current branch and changed files',
		],
		surfaces: ['working tree'],
		proposedScope: 'scoped',
		expected: 'direct',
	},
	{
		request: 'Audit the full UI for accessibility and repair the findings.',
		deliverables: [
			'Inspect every screen and accessibility state',
			'Fix findings across components',
			'Verify keyboard and mobile flows',
		],
		surfaces: [
			'all app screens',
			'shared components',
			'keyboard and mobile states',
		],
		proposedScope: 'scoped',
		expected: 'scoped',
	},
]
