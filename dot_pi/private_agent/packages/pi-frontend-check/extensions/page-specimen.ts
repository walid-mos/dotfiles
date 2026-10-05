// The rendered-page extractor shared by the spec check (frontend_check_spec) and the
// ISO diff (frontend_iso_diff). `extractSpecimen` is serialized by Playwright and runs
// inside the page, so it must stay self-contained: every constant and helper it uses is
// defined inside the function body, and nothing module-level is referenced there.
//
// Lesson from the jev-decision-layer audit: the extractor is the surface. Every field
// the judgment needs but the state lacks costs exactly one `cannot-tell`, so controls
// carry their attributes (type, accept, required, disabled, options) and components
// carry geometry plus computed styles. The style signature is a djb2 hash over the
// normalized styles. It is for diagnostic matching only; neither the signature
// nor the ISO diff establishes pixel equality.

export type SpecimenStyles = Record<string, string>

export type SpecimenComponent = {
	/** Element role the diff and the judge reason about: h1..h6, button, link, input, select, textarea, region. */
	role: string
	text: string
	/** Form semantics the spec items often name: type, accept, required, disabled, placeholder, options. */
	attributes: Record<string, string>
	rect: { x: number; y: number; width: number; height: number }
	styles: SpecimenStyles
	/** Hash over normalized computed styles, not geometry, content, images or pixels. */
	signature: string
}

export type PageSpecimen = {
	url: string
	title: string
	lang: string
	/** Bounded visible text of the page body. */
	text: string
	counts: Record<string, number>
	components: SpecimenComponent[]
}

/**
 * Runs inside the browser via page.evaluate: Playwright serializes exactly this
 * function, so every helper it uses must stay in its body - module-level helpers
 * would not exist in the page. That constraint also caps the 50-line function rule.
 * An optional `scope` selector restricts extraction to one element (an app region,
 * leaving wrapper chrome such as a prototype's demo panel out); default: whole body.
 */
// oxlint-disable-next-line max-lines-per-function -- self-contained by serialization constraint
export function extractSpecimen(scope?: string): PageSpecimen {
	const TEXT_CHARS = 2500
	const SNIPPET = 80
	const HASH_SEED = 5381
	const HASH_SHIFT = 5
	const HEX_BASE = 16
	const SIGNATURE_CHARS = 8
	const OPTIONS_LIMIT = 30
	const DEFAULT_ROLE_CAP = 20
	const caps: Record<string, number> = {
		heading: 20,
		button: 30,
		link: 30,
		input: 30,
		select: 10,
		textarea: 5,
		region: 60,
	}
	const styleKeys = [
		'color',
		'backgroundColor',
		'fontSize',
		'fontWeight',
		'fontFamily',
		'borderRadius',
		'borderWidth',
		'borderStyle',
		'padding',
		'boxShadow',
		'textTransform',
		'letterSpacing',
	]
	// oxlint-disable nextnode/no-detached-tailwind -- CSS selector lists for the page, not Tailwind classes
	const roleSelectors: { role: string; selector: string }[] = [
		{
			role: 'button',
			selector:
				'button, input[type="submit"], input[type="button"], input[type="reset"]',
		},
		{ role: 'link', selector: 'a[href]' },
		{
			role: 'input',
			selector:
				'input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="number"], input[type="url"], input[type="tel"], input[type="date"], input[type="time"]',
		},
		{ role: 'select', selector: 'select' },
		{ role: 'textarea', selector: 'textarea' },
		{
			role: 'region',
			selector:
				'main, section, article, header, footer, nav, aside, form',
		},
	]
	// oxlint-enable nextnode/no-detached-tailwind;

	// oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside the function Playwright serializes
	// The specimen root: the scoped region when one is requested, else the body.
	// A scope that silently picks the first of several matches would compare an
	// arbitrary region, so exactly one HTML element is required.
	const scopeMatches = scope
		? [...document.querySelectorAll(scope)]
		: [document.body]
	if (scopeMatches.length !== 1 || !(scopeMatches[0] instanceof HTMLElement))
		throw new Error(
			`Specimen scope must match exactly one HTML element (matched ${scopeMatches.length}): ${scope}`,
		)
	const [root] = scopeMatches

	// The scoped root participates in extraction like any child: when it matches a
	// role selector (e.g. scope "main" is a region), it is a component too.
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside the function Playwright serializes
	const scopedCandidates = (selector: string): Element[] => {
		const elements = [...root.querySelectorAll(selector)]
		if (scope && root.matches(selector)) elements.unshift(root)
		return elements
	}

	// oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside the function Playwright serializes
	const isVisible = (element: Element): boolean => {
		const style = window.getComputedStyle(element)
		if (style.display === 'none' || style.visibility === 'hidden')
			return false
		const rect = element.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0
	}

	const clip = (raw: string): string => {
		const text = raw.replace(/\s+/g, ' ').trim()
		return text.length > SNIPPET ? `${text.slice(0, SNIPPET - 1)}…` : text
	}

	// oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside the function Playwright serializes
	const normalize = (property: string, rawStyle: string): string => {
		if (rawStyle === 'rgba(0, 0, 0, 0)') return 'transparent'
		if (property === 'fontFamily')
			return (
				rawStyle
					.split(',')[0]
					?.replaceAll('"', '')
					.replaceAll("'", '')
					.trim()
					.toLowerCase()
					// Variable and static builds of one family render alike; the " Variable"
					// suffix must not turn into a diff on environments that load only one.
					.replace(/ variable$/, '') ?? ''
			)
		return rawStyle
	}

	const signatureOf = (styles: Record<string, string>): string => {
		const canonical = styleKeys
			.map(key => `${key}:${styles[key] ?? ''}`)
			.join('|')
		let hash = HASH_SEED
		for (let index = 0; index < canonical.length; index += 1) {
			hash =
				((hash << HASH_SHIFT) + hash + canonical.charCodeAt(index)) >>>
				0
		}
		return hash.toString(HEX_BASE).padStart(SIGNATURE_CHARS, '0')
	}

	const attributesOf = (
		element: Element,
		role: string,
	): Record<string, string> => {
		const attributes: Record<string, string> = {}
		const attribute = (name: string): void => {
			const rawAttribute = element.getAttribute(name)
			if (rawAttribute !== null && rawAttribute !== '')
				attributes[name] = rawAttribute
		}
		for (const name of [
			'type',
			'accept',
			'placeholder',
			'pattern',
			'min',
			'max',
		])
			attribute(name)
		for (const name of ['required', 'disabled', 'multiple', 'readonly']) {
			if (element.hasAttribute(name)) attributes[name] = 'true'
		}
		if (role === 'select') {
			const options = [...element.querySelectorAll('option')]
				.map(option => clip(option.textContent || ''))
				.filter(Boolean)
			if (options.length)
				attributes.options = options.slice(0, OPTIONS_LIMIT).join(' | ')
		}
		if (
			element instanceof HTMLInputElement &&
			element.type !== 'password' &&
			element.value
		)
			attributes.value = clip(element.value)
		return attributes
	}

	// oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside the function Playwright serializes
	const cssName = (property: string): string =>
		property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

	const describe = (element: Element, role: string): SpecimenComponent => {
		const computed = window.getComputedStyle(element)
		const styles: Record<string, string> = {}
		for (const key of styleKeys)
			styles[key] = normalize(
				key,
				computed.getPropertyValue(cssName(key)),
			)
		const rect = element.getBoundingClientRect()
		return {
			role,
			text: clip(
				element instanceof HTMLInputElement
					? element.placeholder ||
							(element.type === 'password' ? '' : element.value)
					: element.textContent || '',
			),
			attributes: attributesOf(element, role),
			rect: {
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			},
			styles,
			signature: signatureOf(styles),
		}
	}

	const collect = (
		role: string,
		selector: string,
		components: SpecimenComponent[],
	): void => {
		const elements = scopedCandidates(selector).filter(isVisible)
		for (const element of elements.slice(
			0,
			caps[role] ?? DEFAULT_ROLE_CAP,
		)) {
			components.push(describe(element, role))
		}
	}

	const components: SpecimenComponent[] = []
	const headings = scopedCandidates('h1,h2,h3,h4,h5,h6').filter(isVisible)
	for (const heading of headings.slice(0, caps.heading)) {
		components.push(describe(heading, heading.tagName.toLowerCase()))
	}
	for (const { role, selector } of roleSelectors) {
		collect(role, selector, components)
	}

	const bodyText = (root.innerText || '').replace(/\s+/g, ' ').trim()
	return {
		url: location.href,
		title: document.title,
		lang: document.documentElement.lang,
		text: bodyText.slice(0, TEXT_CHARS),
		counts: {
			images: root.querySelectorAll('img').length,
			tables: root.querySelectorAll('table').length,
			forms: root.querySelectorAll('form').length,
			lists: root.querySelectorAll('ul,ol').length,
		},
		components,
	}
}
