// frontend_capture_specimen: freeze the open session page's rendered specimen into a
// reusable JSON file. The session browser owns the state cold URLs cannot reach -
// Keycloak login, persona impersonation, demo-mode toggles - so capture-after-
// navigation is what makes the ISO diff usable on auth-walled apps. The captured
// file is the exact output of the shared extractor, including style signatures.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Value } from 'typebox/value'

import { specimenFileSchema } from './schema.ts'

import type { PageSpecimen, SpecimenComponent } from './page-specimen.ts'
import type { SpecimenFile } from './schema.ts'

const SPECIMEN_INDENT = 2

export function specimensDir(): string {
	return join(getAgentDir(), 'frontend-check', 'specimens')
}

export function validateSpecimenName(name: string): string {
	if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(name))
		throw new Error(
			`Invalid specimen name "${name}": use a slug (lowercase letters, digits, . _ -), max 80 chars.`,
		)
	return name
}

/** Reusing a name overwrites the previous capture; the path is the contract. */
export async function saveSpecimen(
	name: string,
	specimen: PageSpecimen,
): Promise<string> {
	const path = join(specimensDir(), `${validateSpecimenName(name)}.json`)
	await mkdir(specimensDir(), { recursive: true })
	await writeFile(path, JSON.stringify(specimen, null, SPECIMEN_INDENT))
	return path
}

/** `reference` is a capture name or an absolute path to a specimen JSON file. */
export async function loadCapturedSpecimen(
	reference: string,
): Promise<PageSpecimen> {
	const path = isAbsolute(reference)
		? reference
		: join(specimensDir(), `${reference}.json`)
	const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
	if (!Value.Check(specimenFileSchema, raw)) {
		const errors = [...Value.Errors(specimenFileSchema, raw)]
			.map(error => `${error.instancePath || '/'} ${error.message}`)
			.join('; ')
		throw new Error(
			`Invalid specimen file ${path}: expected frontend_capture_specimen output - ${errors}`,
		)
	}
	return specimenOf(raw)
}

/** The file schema is a superset of the diff's needs; PageSpecimen is its typed view. */
function specimenOf(file: SpecimenFile): PageSpecimen {
	const { url, title, lang, text, counts } = file
	const components: SpecimenComponent[] = file.components.map(component => ({
		role: component.role,
		text: component.text,
		attributes: component.attributes,
		rect: component.rect,
		styles: component.styles,
		signature: component.signature,
	}))
	return { url, title, lang, text, counts, components }
}

export function formatCaptureReport(
	path: string,
	specimen: PageSpecimen,
): string {
	const roles = Object.entries(countByRole(specimen))
		.map(([role, count]) => `${role}:${count}`)
		.join(', ')
	return [
		`specimen captured: ${path}`,
		`${specimen.title} | ${specimen.url} | lang=${specimen.lang}`,
		`components: ${specimen.components.length} (${roles})`,
		`diff it with frontend_iso_diff captured_a/captured_b - the file is self-contained, the page can be navigated away.`,
	].join('\n')
}

function countByRole(specimen: PageSpecimen): Record<string, number> {
	const byRole: Record<string, number> = {}
	for (const component of specimen.components) {
		byRole[component.role] = (byRole[component.role] ?? 0) + 1
	}
	return byRole
}
