import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'

import {
	citedFiles,
	dependencies,
	dictionaryLogic,
	digest,
	fileHash,
	MissingSourceReference,
	sourceFiles,
	sourceIndex,
	textFiles,
} from './mapping-source-index.mjs'

export const MAPPING_VERSION = 4
const isDictionary = file =>
	/src\/lib\/(?:backoffice-i18n|hotel-i18n)\.ts$/.test(file)

function globalHash(ts, appRoot, protoRoot, proto) {
	const shared = sourceFiles(join(appRoot, 'src/shared/i18n'))
		.filter(file => !file.includes('/locales/'))
		.map(file => [relative(appRoot, file), fileHash(file)])
	const uiRoot = resolve(appRoot, '../../packages/ui/src')
	const ui = [...sourceFiles(uiRoot), ...textFiles(uiRoot)].map(file => [
		relative(appRoot, file),
		fileHash(file),
	])
	const appText = textFiles(join(appRoot, 'src'))
		.filter(file => !file.includes('/locales/'))
		.map(file => [relative(appRoot, file), fileHash(file)])
	const logic = dictionaryLogic(ts, proto).map(([file, hash]) => [
		relative(protoRoot, file),
		hash,
	])
	const manifests = [
		join(appRoot, 'package.json'),
		resolve(appRoot, '../../package.json'),
		resolve(appRoot, '../../packages/ui/package.json'),
		join(protoRoot, 'package.json'),
	]
		.filter(existsSync)
		.map(file => fileHash(file))
	return digest(JSON.stringify({ shared, ui, appText, logic, manifests }))
}

function snapshotHash(appRoot, protoTreeHash, app, globals) {
	return digest(
		JSON.stringify({
			app: [...app.values()].map(entry => [
				relative(appRoot, entry.file),
				entry.hash,
			]),
			appText: textFiles(join(appRoot, 'src')).map(file => [
				relative(appRoot, file),
				fileHash(file),
			]),
			proto: protoTreeHash,
			globals,
			fr: fileHash(join(appRoot, 'src/shared/i18n/locales/fr.json')),
			en: fileHash(join(appRoot, 'src/shared/i18n/locales/en.json')),
		}),
	)
}

export function fingerprintSources(appRoot, protoRoot) {
	const ts = createRequire(join(appRoot, 'package.json'))('typescript')
	const app = sourceIndex(ts, appRoot)
	const proto = sourceIndex(ts, protoRoot)
	const protoText = [
		...textFiles(join(protoRoot, 'src')),
		...textFiles(join(protoRoot, 'public')),
		...sourceFiles(join(protoRoot, 'public')),
	]
	const index = join(protoRoot, 'index.html')
	if (existsSync(index)) protoText.push(index)
	const protoTreeHash = digest(
		JSON.stringify({
			code: [...proto.values()].map(entry => [
				relative(protoRoot, entry.file),
				entry.hash,
			]),
			text: protoText
				.toSorted()
				.map(file => [relative(protoRoot, file), fileHash(file)]),
		}),
	)
	const globals = globalHash(ts, appRoot, protoRoot, proto)
	return {
		appRoot,
		protoRoot,
		app,
		proto,
		appDynamic: [...app.values()]
			.filter(entry => entry.isDynamic)
			.map(entry => entry.file),
		protoDynamic: [...proto.values()]
			.filter(entry => entry.isDynamic)
			.map(entry => entry.file),
		globalHash: globals,
		protoTreeHash,
		snapshotHash: snapshotHash(appRoot, protoTreeHash, app, globals),
	}
}

function appSources(context, key, usage) {
	const literal = [...context.app.values()]
		.filter(entry => entry.strings.has(key))
		.map(entry => entry.file)
	const cited = citedFiles(context.appRoot, usage)
	return dependencies(
		context.appRoot,
		context.app,
		new Set([...literal, ...cited, ...context.appDynamic]),
		() => false,
	)
}

function matchedEntry(prototype, review) {
	const matches = prototype.filter(entry => entry.ref === review.protoRef)
	return (
		matches.find(entry => entry.id === review.protoId) ??
		(matches.length === 1
			? matches[0]
			: matches.find(entry => entry.id === review.candidate?.id))
	)
}

function prototypeSources(context, key, review, prototype) {
	if (review.protoRef === 'introuvable')
		return { files: [], counterpart: null, tree: context.protoTreeHash }
	const counterpart = matchedEntry(prototype, review)
	const path = counterpart?.id?.split('.').slice(1).join('.')
	const segment = counterpart?.id?.split('.').at(-1)
	const matched = [...context.proto.values()]
		.filter(
			entry =>
				!isDictionary(entry.file) &&
				((segment && entry.identifiers.has(segment)) ||
					(path && entry.strings.has(path))),
		)
		.map(entry => entry.file)
	const cited = citedFiles(context.protoRoot, review.protoRef)
	if (!counterpart && ![...cited].some(file => !isDictionary(file)))
		throw new MissingSourceReference(
			`${key}: counterpart needs a unique catalog entry or rendered source file`,
		)
	return {
		files: dependencies(
			context.protoRoot,
			context.proto,
			new Set([...matched, ...cited, ...context.protoDynamic]),
			isDictionary,
		),
		counterpart: counterpart ?? null,
		tree: null,
	}
}

export function fingerprintKey(context, entry, review, prototype) {
	const appFiles = appSources(context, entry.key, review.usage)
	const {
		files: protoFiles,
		counterpart,
		tree,
	} = prototypeSources(context, entry.key, review, prototype)
	return digest(
		JSON.stringify({
			version: MAPPING_VERSION,
			key: entry.key,
			translations: { fr: entry.fr, en: entry.en },
			appFiles,
			protoFiles,
			counterpart,
			protoTreeHash: tree,
			globalHash: context.globalHash,
		}),
	)
}
