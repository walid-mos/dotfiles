import * as fs from "node:fs";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";

const aliases = JSON.parse(process.env.JITI_ALIAS ?? "{}");
const nativeRunner = process.env.PI_ASYNC_NATIVE_RUNNER === "1";
const redirected = new Set([
	"@earendil-works/pi-tui",
]);
const aliasUrls = new Map();

// Native resolution returns real paths. Resolve alias targets the same way so a
// symlinked or aliased location (macOS /var, pnpm stores) cannot load a second
// instance of a module the runner also reaches through ordinary resolution.
function aliasUrl(alias) {
	let url = aliasUrls.get(alias);
	if (url === undefined) {
		let target = alias;
		try {
			target = fs.realpathSync(alias);
		} catch {
			// A missing target keeps its literal path; resolution reports the failure.
		}
		url = pathToFileURL(target).href;
		aliasUrls.set(alias, url);
	}
	return url;
}

if (typeof nodeModule.registerHooks === "function") {
	nodeModule.registerHooks({
		resolve(specifier, context, nextResolve) {
			const alias = nativeRunner ? aliases[specifier] : redirected.has(specifier) && aliases[specifier];
			if (alias) {
				const target = aliasUrl(alias);
				return nativeRunner ? { url: target, shortCircuit: true } : nextResolve(target, context);
			}
			try {
				return nextResolve(specifier, context);
			} catch (error) {
				if (nativeRunner && specifier.endsWith(".js")) return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
				throw error;
			}
		},
	});
} else {
	nodeModule.register(new URL("./runner-peer-loader.mjs", import.meta.url), {
		data: { aliases, nativeRunner },
	});
}
