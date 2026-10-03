/**
 * The pi status-channel key the fallback extension keeps while the session
 * runs on a fallback (chain) model: `ctx.ui.setStatus(FALLBACK_STATUS_KEY, ...)`.
 *
 * The hud-footer reads the entry by this key and re-homes it onto the hero
 * model pill (the ↯ icon) instead of rendering it in the statuses column.
 */
export const FALLBACK_STATUS_KEY = 'model-fallback'
