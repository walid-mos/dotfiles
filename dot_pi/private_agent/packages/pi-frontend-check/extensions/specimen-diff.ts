// Specimen diffing core: pair components by role, then by visible text, and
// compute code-level deltas for style, geometry and attributes. Consumed by
// iso-diff.ts, which owns side resolution, browsers and reporting.
import type { PageSpecimen, SpecimenComponent } from './page-specimen.ts'

/** Sub-pixel rounding noise; smaller geometry differences are not reported. */
const SIZE_TOLERANCE_PX = 2

const ROLE_ORDER = [
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'button',
	'link',
	'input',
	'select',
	'textarea',
	'region',
]

export type PairDiff = {
	role: string
	implementationText: string
	baselineText: string
	/** Property-level deltas computed in code; empty when only the text differs. */
	styleDeltas: {
		property: string
		implementation: string
		baseline: string
	}[]
	sizeDelta?: { implementation: string; baseline: string }
	positionDelta?: { implementation: string; baseline: string }
	attributesDelta?: { implementation: string; baseline: string }
}

export type IsoDiff = {
	implementationUrl: string
	baselineUrl: string
	/** Same component style, text, attributes and diagnostic geometry. Not pixel equality. */
	identicalSignatures: number
	pairs: PairDiff[]
	onlyImplementation: SpecimenComponent[]
	onlyBaseline: SpecimenComponent[]
}

function byRole(
	components: SpecimenComponent[],
): Map<string, SpecimenComponent[]> {
	const grouped = new Map<string, SpecimenComponent[]>()
	for (const component of components) {
		const list = grouped.get(component.role) ?? []
		list.push(component)
		grouped.set(component.role, list)
	}
	return grouped
}

function deltaFor(
	implementation: SpecimenComponent,
	baseline: SpecimenComponent,
): PairDiff {
	const styleDeltas = Object.keys(implementation.styles)
		.filter(
			property =>
				implementation.styles[property] !== baseline.styles[property],
		)
		.map(property => ({
			property,
			implementation: implementation.styles[property] ?? '',
			baseline: baseline.styles[property] ?? '',
		}))
	return {
		role: implementation.role,
		implementationText: implementation.text,
		baselineText: baseline.text,
		styleDeltas,
		...sizeDeltaFor(implementation.rect, baseline.rect),
		...positionDeltaFor(implementation.rect, baseline.rect),
		...attributesDeltaFor(implementation.attributes, baseline.attributes),
	}
}

/** Geometry difference beyond sub-pixel rounding noise, if any. */
function sizeDeltaFor(
	implementation: SpecimenComponent['rect'],
	baseline: SpecimenComponent['rect'],
): { sizeDelta: { implementation: string; baseline: string } } | undefined {
	const widthDelta = Math.abs(implementation.width - baseline.width)
	const heightDelta = Math.abs(implementation.height - baseline.height)
	if (widthDelta < SIZE_TOLERANCE_PX && heightDelta < SIZE_TOLERANCE_PX)
		return undefined
	return {
		sizeDelta: {
			implementation: `${implementation.width}x${implementation.height}`,
			baseline: `${baseline.width}x${baseline.height}`,
		},
	}
}

function attributesDeltaFor(
	implementation: SpecimenComponent['attributes'],
	baseline: SpecimenComponent['attributes'],
):
	| { attributesDelta: { implementation: string; baseline: string } }
	| undefined {
	const first = JSON.stringify(implementation)
	const second = JSON.stringify(baseline)
	if (first === second) return undefined
	return { attributesDelta: { implementation: first, baseline: second } }
}

function positionDeltaFor(
	implementation: SpecimenComponent['rect'],
	baseline: SpecimenComponent['rect'],
): { positionDelta: { implementation: string; baseline: string } } | undefined {
	if (implementation.x === baseline.x && implementation.y === baseline.y)
		return undefined
	return {
		positionDelta: {
			implementation: `${implementation.x},${implementation.y}`,
			baseline: `${baseline.x},${baseline.y}`,
		},
	}
}

/** One role's components pair by text first (same text = same control), then by
 * order for leftovers: role lists that desync because one side carries extra
 * chrome would otherwise pair the wrong elements from the divergence point on. */
function pairRole(
	implementation: SpecimenComponent[],
	baseline: SpecimenComponent[],
): {
	identical: number
	pairs: PairDiff[]
	onlyImpl: SpecimenComponent[]
	onlyBase: SpecimenComponent[]
} {
	const unmatched = [...baseline]
	const pairs: PairDiff[] = []
	const onlyImpl: SpecimenComponent[] = []
	let identical = 0
	for (const implComponent of implementation) {
		const byText = unmatched.findIndex(
			component => component.text === implComponent.text,
		)
		const [baseComponent] = unmatched.splice(byText >= 0 ? byText : 0, 1)
		if (!baseComponent) {
			onlyImpl.push(implComponent)
			continue
		}
		const delta = deltaFor(implComponent, baseComponent)
		if (
			implComponent.signature === baseComponent.signature &&
			implComponent.text === baseComponent.text &&
			!delta.sizeDelta &&
			!delta.positionDelta &&
			!delta.attributesDelta
		) {
			identical += 1
			continue
		}
		pairs.push(delta)
	}
	return { identical, pairs, onlyImpl, onlyBase: unmatched }
}

/** Components pair by role, then by visible text (order for leftovers); extras on
 * either side are reported unmatched. */
export function diffSpecimens(
	implementation: PageSpecimen,
	baseline: PageSpecimen,
): IsoDiff {
	const implRoles = byRole(implementation.components)
	const baseRoles = byRole(baseline.components)
	const pairs: PairDiff[] = []
	const onlyImplementation: SpecimenComponent[] = []
	const onlyBaseline: SpecimenComponent[] = []
	let identicalSignatures = 0
	for (const role of ROLE_ORDER) {
		const outcome = pairRole(
			implRoles.get(role) ?? [],
			baseRoles.get(role) ?? [],
		)
		identicalSignatures += outcome.identical
		pairs.push(...outcome.pairs)
		onlyImplementation.push(...outcome.onlyImpl)
		onlyBaseline.push(...outcome.onlyBase)
	}
	return {
		implementationUrl: implementation.url,
		baselineUrl: baseline.url,
		identicalSignatures,
		pairs,
		onlyImplementation,
		onlyBaseline,
	}
}
