/** The one snapshot shape every replay surface keeps: enough to redraw a tile. */
import { Type } from 'typebox'

/**
 * One capture as a persisted replay keeps it: the alias, its source, the
 * strip's image id and the tile payload. Previews keep the capture's own mime
 * type: previews are PNG only for PNG sources, every other format passes
 * through. TypeBox-backed so boundaries that validate (e.g. session replay)
 * share this single declared rule set with the prompt entry.
 */
export const CaptureRecordSchema = Type.Object({
	alias: Type.String(),
	mimeType: Type.String(),
	filePath: Type.String(),
	/** Stable Kitty image id so strip renders reuse one screen image per capture. */
	imageId: Type.Number(),
	/** Base64 tile payload: warm preview when one exists, else the full image. */
	data: Type.String(),
})
