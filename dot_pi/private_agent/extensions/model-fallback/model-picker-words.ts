/**
 * model-fallback - the picker's own words for the three things it targets.
 *
 * Three concepts sit next to each other and are easy to confuse, so each one
 * keeps exactly one name, spelled the same way on every surface: the model
 * this session runs (`Session`), the model new sessions start on (the
 * `startup default`, written with ctrl+s), and the list pi cycles with ctrl+p
 * (the `Ctrl+P list`, stored as `enabledModels`). The word "saved" is banned on
 * its own: it used to name the list, which reads exactly like the startup
 * default it is not.
 */

/** pi's `enabledModels`: what Ctrl+P cycles, from the next session start on. */
export const CTRL_P_LIST = 'Ctrl+P list'

/** What new sessions start on: pi's `defaultProvider`/`defaultModel`. */
export const STARTUP_DEFAULT = 'startup default'

/** The tab that edits the list, named after its key rather than the concept. */
export const CTRL_P_TAB = 'ctrl+p'
