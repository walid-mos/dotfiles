import { createHerdrInspectorPlugin } from "./herdr/plugin.ts";
import type { InspectorPlugin } from "./types.ts";

/** Built-in inspector providers in host preference order. */
export function getInspectorPlugins(): readonly InspectorPlugin[] {
	return [createHerdrInspectorPlugin()];
}
