import standards from '@nextnode-solutions/standards/oxfmt'
import { defineConfig } from 'oxfmt'

// The repo AGENTS.md mandates formatting with the house oxfmt config; the
// shared preset is the single source of that style (tabs, no semis, single
// quotes). The preset ships as plain JavaScript, so the import widens its
// option literals (arrowParens, quotes...): assert once here, at this tooling
// boundary, instead of hand-typing the preset shape.
// oxlint-disable-next-line nextnode/no-type-assertion
const preset = standards as Parameters<typeof defineConfig>[0]

export default defineConfig(preset)
